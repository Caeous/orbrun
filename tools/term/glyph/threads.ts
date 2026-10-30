/**
 * The glyph view on several threads: each worker (worker.ts) a GlyphView of
 * its own drawing bands of the view's rows, taken as each comes free, and
 * writing each as terminal output against the frame shown before, so this
 * thread only joins them. The scene goes to each as it changes, the things
 * standing in it each frame, and the tiles and pictures are asked for as
 * wanted and answered here, each once, in memory they all share. With no
 * threads (ORBRUN_TERM_THREADS=0), the same on this one.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serialize } from 'node:v8'
import { MessageChannel, Worker } from 'node:worker_threads'
import type { Camera, Scene, TileSource } from '@orbrun/scene'
import type { Pixels } from '@orbrun/render-term'
import { defaultThreads } from '../raster'
import { glyphInks } from './font'
import { ANSI_BAND, ANSI_CELL, bandOut, cellsOut, GLYPH_DEFAULTS, GlyphView, type GlyphViewOptions, type Thing } from './render'
import type { Frame, SentThing } from './worker'

const here = path.dirname(fileURLToPath(import.meta.url))
/** how many bands of rows a frame is cut into, for each thread */
const BANDS_PER_THREAD = Number(process.env.ORBRUN_TERM_BANDS) || 4

/**
 * ORBRUN_TERM_THREADS, else raster.ts's, up to five: past that a frame is
 * slower, not faster (an M1 Pro's best is four to six, this thread
 * drawing too), each thread's share of it small beside what each must do
 * to begin (`prepare`) and the wait on the last.
 */
export function glyphThreads(): number {
  const said = process.env.ORBRUN_TERM_THREADS
  return said !== undefined && said !== '' ? defaultThreads() : Math.min(5, defaultThreads())
}

let bundle: Promise<string> | null = null
/** worker.ts and all it imports as one script a worker can run */
function workerCode(): Promise<string> {
  bundle ??= import('esbuild').then(async (esbuild) => {
    const r = await esbuild.build({ entryPoints: [path.join(here, 'worker.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent', external: ['sharp'] })
    return r.outputFiles[0].text
  })
  return bundle
}

/** a frame being drawn: where each band's output ends as it comes, how long each took, and how many are still to come */
interface Pending {
  ends: Int32Array
  took: Float64Array
  left: number
  /** true when every band is in, false when a thread failed */
  done: (ok: boolean) => void
}

/** whether the things are as they were (`was`, copies of each as it was sent), so need not be sent again */
function sameThings(now: Thing[], was: Thing[] | null): boolean {
  if (!was || now.length !== was.length) return false
  for (let i = 0; i < now.length; i++) {
    const a = now[i], b = was[i]
    if (a.x !== b.x || a.y !== b.y || a.size !== b.size || a.glyph !== b.glyph || a.name !== b.name || a.alive !== b.alive) return false
    if (a.colour[0] !== b.colour[0] || a.colour[1] !== b.colour[1] || a.colour[2] !== b.colour[2] || a.art.length !== b.art.length) return false
    if (a.alpha !== b.alpha || a.light !== b.light || String(a.flash) !== String(b.flash) || JSON.stringify(a.hand) !== JSON.stringify(b.hand)) return false
    for (let k = 0; k < a.art.length; k++) if (a.art[k].px !== b.art[k].px || a.art[k].mirror !== b.art[k].mirror || JSON.stringify(a.art[k].rect) !== JSON.stringify(b.art[k].rect)) return false
  }
  return true
}

/** pixels copied once into memory the threads share */
const shared = (px: Pixels): Pixels => {
  const data = new Uint8Array(new SharedArrayBuffer(px.data.length))
  data.set(px.data)
  return { width: px.width, height: px.height, data }
}

export class GlyphThreads {
  /** the view on this thread: what draws when there are no workers, and what `art` is found by */
  readonly view: GlyphView
  things: Thing[] = []
  private threads: Worker[] = []
  private pending = new Map<number, Pending>()
  private ready: Promise<void>
  private scene: Scene | null = null
  private sent: { scene: Scene | null; revision: number; opts: string; inks: number } = { scene: null, revision: -1, opts: '', inks: 0 }
  /** the things as last sent, each as it was then */
  private sentThings: Thing[] | null = null
  private atlases = new Map<string, Pixels | undefined>()
  /** each thing's picture by a number of its own, for the workers to ask for */
  private pids = new Map<Pixels, number>()
  private pictures: Pixels[] = []
  private frameId = 0
  /** the cells drawn and those shown before, packed (encode.ts `pack`), traded each frame */
  private cur: Int32Array = new Int32Array(0)
  private prev: Int32Array = new Int32Array(0)
  /** the frame's terminal output, a band's after another's (`ANSI_CELL`) */
  private out: Uint8Array = new Uint8Array(0)
  private whole = true
  /** how long each band took to draw, of late: the slowest are taken first, so none is left to last */
  private cost = new Float64Array(0)

  constructor(
    private tiles: TileSource,
    private atlas: (name: string) => Pixels | undefined,
    opts: GlyphViewOptions = { ...GLYPH_DEFAULTS },
    threads = glyphThreads(),
  ) {
    this.view = new GlyphView(tiles, atlas, opts)
    this.ready = threads <= 0 ? Promise.resolve() : workerCode().then(
      (code) => {
        for (let i = 0; i < threads; i++) this.threads.push(this.spawn(code))
      },
      () => {},
    )
  }

  get opts(): GlyphViewOptions {
    return this.view.opts
  }

  private spawn(code: string): Worker {
    const { port1, port2 } = new MessageChannel()
    const flag = new Int32Array(new SharedArrayBuffer(4))
    const worker = new Worker(code, { eval: true, workerData: { port: port1, flag }, transferList: [port1] })
    // the worker waits on its questions: the answer, then the flag that wakes it
    port2.on('message', (q: { type: string; id?: number; name?: string; pid?: number }) => {
      port2.postMessage(q.type === 'tile' ? this.tiles.tile(q.id!) : q.name !== undefined ? this.atlasFor(q.name) : this.pictures[q.pid!])
      Atomics.store(flag, 0, 1)
      Atomics.notify(flag, 0)
    })
    // the frame is drawn when its every band is, whichever threads drew them: one come too late to take any is not waited for
    worker.on('message', (m: { type: string; id: number; parts: [number, number, number][] }) => {
      const p = m.type === 'done' ? this.pending.get(m.id) : undefined
      if (!p) return
      for (const [b, end, ms] of m.parts) (p.ends[b] = end), (p.took[b] = ms)
      p.left -= m.parts.length
      if (p.left <= 0) p.done(true)
    })
    // a worker that fails takes the others with it: the view is drawn here from then on
    const fail = () => {
      this.destroy()
      for (const p of this.pending.values()) p.done(false)
    }
    worker.on('error', fail)
    worker.on('exit', fail)
    worker.unref()
    return worker
  }

  private atlasFor(name: string): Pixels | undefined {
    if (!this.atlases.has(name)) {
      const px = this.atlas(name)
      this.atlases.set(name, px && shared(px))
    }
    return this.atlases.get(name)
  }

  setScene(scene: Scene) {
    this.scene = scene
    this.view.setScene(scene)
  }

  /** The next frame drawn whole, as on a screen cleared. */
  redraw() {
    this.whole = true
  }

  /** The last frame's cells, packed (encode.ts `pack`), a cell's three numbers after another's. */
  get cells(): Int32Array {
    return this.prev
  }

  /**
   * The view from `cam`, `cols` x `rows` cells from the terminal's row `top`,
   * as terminal output: only the cells that differ from the frame before.
   * Its bytes are this frame's, until the next.
   */
  async frame(cam: Camera, cols: number, rows: number, top = 1): Promise<Uint8Array> {
    return (await this.draw(cam, cols, rows, top, false))!
  }

  /**
   * The view from `cam` as cells only (`cells`, packed), for a host that
   * writes them to the terminal itself, with its own over them.
   */
  async cellsOnly(cam: Camera, cols: number, rows: number): Promise<Int32Array> {
    await this.draw(cam, cols, rows, 1, true)
    return this.prev
  }

  private async draw(cam: Camera, cols: number, rows: number, top: number, cellsOnly: boolean): Promise<Uint8Array | null> {
    await this.ready
    const n = cols * rows * 3
    if (this.prev.length !== n) {
      this.prev = new Int32Array(new SharedArrayBuffer(n * 4))
      this.whole = true
    }
    if (this.cur.length !== n) this.cur = new Int32Array(new SharedArrayBuffer(n * 4))
    const prev = this.whole ? null : this.prev
    // the bands, more than threads, taken as each comes free; on this thread alone, one
    const count = this.threads.length ? Math.min(rows, (this.threads.length + 1) * BANDS_PER_THREAD) : 1
    const bands = Array.from({ length: count + 1 }, (_, i) => Math.floor((rows * i) / count))
    // each band's output from where its rows' worst would start
    const at = bands.map((r, b) => r * cols * ANSI_CELL + b * ANSI_BAND)
    if (this.out.length < at[count]) this.out = new Uint8Array(new SharedArrayBuffer(at[count]))
    if (this.cost.length !== count) this.cost = new Float64Array(count)
    const cost = this.cost
    const order = Array.from(cost.keys()).sort((a, b) => cost[b] - cost[a])
    // a counter of its own, so a thread still on an earlier frame never takes a band of this one
    const next = new Int32Array(new SharedArrayBuffer(4))
    const ends = new Int32Array(count)
    const took = new Float64Array(count)
    const p: Pending = { ends, took, left: count, done: () => {} }
    const ok = new Promise<boolean>((done) => (p.done = done))
    const id = ++this.frameId
    if (this.threads.length) {
      this.sync()
      // the things standing, where they are not as they were sent last
      const things = sameThings(this.things, this.sentThings) ? null : serialize(this.things.map((t): SentThing => ({ ...t, art: t.art.map((a) => ({ pid: this.pid(a.px), rect: a.rect, mirror: a.mirror })) })))
      if (things) this.sentThings = this.things.map((t) => ({ ...t, art: [...t.art] }))
      this.pending.set(id, p)
      const m: Frame = { type: 'frame', id, cam, cols, rows, top, things, bands, order, next, cur: this.cur, prev, out: this.out, at, cellsOnly }
      for (const t of this.threads) t.postMessage(m)
    }
    // and this thread takes bands as they do, while it waits, ready once they are on their way
    this.view.things = this.things
    const prepared = this.view.prepare(cam, cols, rows)
    for (let i = Atomics.add(next, 0, 1); i < count; i = Atomics.add(next, 0, 1)) {
      const b = order[i]
      const t0 = performance.now()
      ends[b] = cellsOnly ? cellsOut(this.view, prepared, bands[b], bands[b + 1], this.cur) : bandOut(this.view, prepared, bands[b], bands[b + 1], top, prev, this.cur, this.out, at[b])
      took[b] = performance.now() - t0
      if (--p.left === 0) p.done(true)
    }
    const drawn = await ok
    this.pending.delete(id)
    if (!drawn) {
      // a thread failed: the frame again, here, in memory of its own
      this.whole = true
      this.cur = new Int32Array(0)
      this.out = new Uint8Array(0)
      return this.draw(cam, cols, rows, top, cellsOnly)
    }
    for (let b = 0; b < count; b++) cost[b] = cost[b] * 0.5 + took[b] * 0.5
    ;[this.prev, this.cur] = [this.cur, this.prev]
    this.whole = false
    return cellsOnly ? null : Buffer.concat(Array.from(ends, (end, b) => this.out.subarray(at[b], end)))
  }

  private pid(px: Pixels): number {
    let id = this.pids.get(px)
    if (id === undefined) {
      this.pids.set(px, (id = this.pictures.length))
      this.pictures.push(shared(px))
    }
    return id
  }

  /** the scene, the options and the letters' inks to the workers, where they have changed since */
  private sync() {
    const s = this.sent
    const post = (m: object) => {
      for (const t of this.threads) t.postMessage(m)
    }
    if (this.scene && (this.scene !== s.scene || this.scene.revision !== s.revision)) {
      post({ type: 'scene', data: serialize(this.scene) })
      s.scene = this.scene
      s.revision = this.scene.revision
    }
    const opts = JSON.stringify(this.view.opts)
    if (opts !== s.opts) post({ type: 'opts', opts: this.view.opts })
    s.opts = opts
    const inks = glyphInks()
    if (inks.length !== s.inks) post({ type: 'inks', inks })
    s.inks = inks.length
  }

  destroy() {
    for (const t of this.threads) {
      t.removeAllListeners('exit')
      void t.terminate()
    }
    this.threads = []
  }
}
