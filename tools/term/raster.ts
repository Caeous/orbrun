/**
 * The view drawn as a terminal's cells, on several threads: each worker
 * (raster-worker.ts) a RenderTerm of its own drawing a band of the frame's
 * rows, MOSAIC_SX x MOSAIC_SY samples a cell, then encoding those rows of
 * cells as mosaics (frame.mjs `mosaicEncoder`), into memory they all share.
 * The scene goes to each as it changes; the tiles are asked for as wanted
 * and answered here, an atlas made once, in linear light, for all of them.
 * With no threads (ORBRUN_TERM_THREADS=0), the same on this one.
 */
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serialize } from 'node:v8'
import { MessageChannel, Worker } from 'node:worker_threads'
import { RenderTerm, linearAtlas, type Atlas, type Pixels, type RenderTermOptions, type TermGlyph } from '@orbrun/render-term'
import type { Camera, Scene, SceneCursor, TileSource, Viewmodel } from '@orbrun/scene'
// @ts-expect-error: plain JS, shared with the browser bridge
import { MOSAICS, MOSAIC_SX, MOSAIC_SY, mosaicEncoder } from './frame.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
/** how many bands of rows a frame is cut into, for each thread */
const BANDS_PER_THREAD = Number(process.env.ORBRUN_TERM_BANDS) || 3

/** the cells a frame comes to: a character and two colours each */
export interface Cells {
  char: string[]
  fg: Uint8Array
  bg: Uint8Array
}

/** How a frame is drawn: each cell `cellAspect` times as tall as wide, in the glyphs of mosaic `kind` (frame.mjs `MOSAICS`). */
export interface DrawOptions {
  cellAspect: number
  /** a monster or an item under this many samples tall is named by its glyph (render-term's `glyphBelow`) */
  glyphBelow: number
  kind: string
  /** where a font's blocks stop short of the cell (frame.mjs `mosaicGlyphs`) */
  box?: Box
  /** what a colour escape costs, for a terminal slow to change colour (frame.mjs `mosaicEncoder`) */
  rate?: number
}

/**
 * The terminals known to draw octants themselves, by TERM_PROGRAM, TERM or
 * XTVERSION name. Showing kitty graphics says nothing of it: iTerm2 shows
 * them and draws octants as missing glyphs.
 */
const DRAWS_OCTANTS = /ghostty|rex|kitty/i
/** the terminals that draw sextants and wedges themselves but not octants, by TERM_PROGRAM or XTVERSION name */
const DRAWS_SEXTANTS = /iterm/i
/** How far short of a cell's top, right and bottom a font's blocks stop, as shares of the cell (frame.mjs `mosaicGlyphs`). */
export interface Box {
  top: number
  right: number
  bottom: number
}
const NO_BOX: Box = { top: 0, right: 0, bottom: 0 }
/**
 * Terminal.app's blocks, from its own font (SF Mono), as measured from its
 * screen: unless ORBRUN_TERM_BOX ("top,right,bottom") says otherwise.
 */
const APPLE_BOX: Box = { top: 0.16, right: 0.02, bottom: 0.03 }

/**
 * What a colour escape costs each terminal, in squared error (frame.mjs
 * `mosaicEncoder`), as measured: Terminal.app takes about 10 µs for each
 * change of colour, whatever the bytes, so a frame of fine detail took it
 * 70 ms at 160x50 and takes 18 ms at this; iTerm2 gains less and has less to
 * give; the GPU terminals keep every colour.
 */
const RATE = { apple: 10000, sextant: 2000, octant: 0, other: 2000 }

/**
 * The glyphs the view is drawn in (frame.mjs `MOSAICS`) on the terminal
 * named `name` (its XTVERSION, as well as TERM_PROGRAM and TERM): everything
 * where it is known to draw octants (`DRAWS_OCTANTS`), all but those where
 * it draws sextants (`DRAWS_SEXTANTS`), Terminal.app's font's blocks with
 * the box they stand in, else the blocks and quadrants every terminal with a
 * decent font has; and what a colour costs it (`RATE`).
 * ORBRUN_TERM_BLOCKS and ORBRUN_TERM_RATE say otherwise.
 */
export function mosaicFor(name = ''): { kind: string; box: Box; rate: number } {
  const said = process.env.ORBRUN_TERM_BLOCKS
  const [top, right, bottom] = (process.env.ORBRUN_TERM_BOX ?? '').split(',').map(Number)
  const box = Number.isFinite(top) && process.env.ORBRUN_TERM_BOX ? { top, right: right || 0, bottom: bottom || 0 } : APPLE_BOX
  const all = `${process.env.TERM_PROGRAM ?? ''} ${process.env.TERM ?? ''} ${name}`
  const apple = process.env.TERM_PROGRAM === 'Apple_Terminal'
  const known = DRAWS_OCTANTS.test(all) ? 'octant' : DRAWS_SEXTANTS.test(all) ? 'sextant' : apple ? 'block' : 'quadrant'
  const kind = said && MOSAICS.includes(said) ? said : known
  const rateSaid = process.env.ORBRUN_TERM_RATE
  const rate = rateSaid ? Math.max(0, Number(rateSaid) || 0) : apple ? RATE.apple : known === 'octant' ? RATE.octant : known === 'sextant' ? RATE.sextant : RATE.other
  return { kind, box: kind === 'block' ? box : NO_BOX, rate }
}

/** ORBRUN_TERM_THREADS, else all the cores but two, up to eight */
export function defaultThreads(): number {
  const said = process.env.ORBRUN_TERM_THREADS
  if (said !== undefined && said !== '') return Math.max(0, Number(said) | 0)
  return Math.max(1, Math.min(8, os.availableParallelism() - 2))
}

let bundle: Promise<string> | null = null
/** raster-worker.ts and all it imports as one script a worker can run */
function workerCode(): Promise<string> {
  bundle ??= import('esbuild').then(async (esbuild) => {
    const r = await esbuild.build({ entryPoints: [path.join(here, 'raster-worker.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' })
    return r.outputFiles[0].text
  })
  return bundle
}

interface Thread {
  worker: Worker
  /** the frames asked of it, answered with the glyphs of its bands, or null when it failed */
  pending: Map<number, (glyphs: TermGlyph[] | null) => void>
}

export class TermRaster {
  private tiles: TileSource | null = null
  private pixels: (name: string) => Pixels | undefined = () => undefined
  private atlases = new Map<string, Atlas | null>()
  private threads: Thread[] = []
  /** what is told the workers before there are any, for when there are */
  private queue: object[] | null = []
  private ready: Promise<void>
  /** on this thread: with no workers, or when they failed */
  private local: RenderTerm | null = null
  private encoders = new Map<string, ReturnType<typeof mosaicEncoder>>()
  // what the view is drawn from, for a renderer made late (`goLocal`)
  private scene: Scene | null = null
  private cursor: SceneCursor | null = null
  private viewmodel: Viewmodel | null = null
  private opts: RenderTermOptions = {}
  private sent: { scene: Scene | null; revision: number; layout: number } = { scene: null, revision: -1, layout: -1 }
  private frameId = 0
  private next = new Int32Array(new SharedArrayBuffer(4))
  private shared = { size: '', px: new Uint8Array(0), wt: new Uint8Array(0), char: new Uint32Array(0), fg: new Uint8Array(0), bg: new Uint8Array(0) }

  constructor(threads = defaultThreads()) {
    if (threads <= 0) {
      this.goLocal()
      this.ready = Promise.resolve()
      return
    }
    this.ready = workerCode().then(
      (code) => {
        for (let i = 0; i < threads; i++) this.threads.push(this.spawn(code))
        const queued = this.queue ?? []
        this.queue = null
        for (const m of queued) this.post(m)
      },
      () => this.goLocal(),
    )
  }

  private spawn(code: string): Thread {
    const { port1, port2 } = new MessageChannel()
    const flag = new Int32Array(new SharedArrayBuffer(4))
    const worker = new Worker(code, { eval: true, workerData: { port: port1, flag }, transferList: [port1] })
    const t: Thread = { worker, pending: new Map() }
    // the worker waits on its questions: the answer, then the flag that wakes it
    port2.on('message', (q: { type: string; id?: number; layer?: string; name?: string }) => {
      port2.postMessage(q.type === 'tile' ? this.tiles?.tile(q.id!, q.layer) : this.atlas(q.name!))
      Atomics.store(flag, 0, 1)
      Atomics.notify(flag, 0)
    })
    worker.on('message', (m: { type: string; id: number; glyphs: TermGlyph[] }) => {
      if (m.type !== 'done') return
      t.pending.get(m.id)?.(m.glyphs)
      t.pending.delete(m.id)
    })
    // a worker that fails takes the others with it: the view is drawn here from then on
    const fail = () => {
      for (const th of this.threads) for (const done of th.pending.values()) done(null)
      if (!this.local) this.goLocal()
    }
    worker.on('error', fail)
    worker.on('exit', fail)
    worker.unref()
    return t
  }

  /** Drawing on this thread from now on, with all the view is drawn from. */
  private goLocal() {
    const threads = this.threads
    this.threads = []
    this.queue = null
    for (const t of threads) {
      t.worker.removeAllListeners('exit')
      void t.worker.terminate()
    }
    const r = (this.local = new RenderTerm(this.opts))
    if (this.tiles) r.setTiles(this.tiles, this.pixels, (name) => this.atlas(name))
    if (this.scene) r.setScene(this.scene)
    r.setCursor(this.cursor)
    r.setViewmodel(this.viewmodel)
  }

  private atlas(name: string): Atlas | null {
    if (!this.atlases.has(name)) {
      const px = this.pixels(name)
      this.atlases.set(name, px ? linearAtlas(px) : null)
    }
    return this.atlases.get(name)!
  }

  /** a message to every worker, in order: now, or once they are there */
  private post(m: object) {
    if (this.queue) this.queue.push(m)
    else for (const t of this.threads) t.worker.postMessage(m)
  }

  setTiles(tiles: TileSource, pixels: (name: string) => Pixels | undefined): void {
    this.tiles = tiles
    this.pixels = pixels
    this.atlases.clear()
    this.local?.setTiles(tiles, pixels, (name) => this.atlas(name))
    this.post({ type: 'tiles' })
  }
  setScene(scene: Scene): void {
    this.scene = scene
    this.local?.setScene(scene)
  }
  setCursor(cursor: SceneCursor | null): void {
    this.cursor = cursor
    this.local?.setCursor(cursor)
    this.post({ type: 'cursor', cursor })
  }
  setViewmodel(vm: Viewmodel | null): void {
    this.viewmodel = vm
    this.local?.setViewmodel(vm)
    this.post({ type: 'viewmodel', vm })
  }
  setOptions(opts: RenderTermOptions): void {
    this.opts = { ...this.opts, ...opts }
    this.local?.setOptions(opts)
    this.post({ type: 'options', opts })
  }

  /** The view from `cam` as `cols` x `rows` cells, and the monsters and items to be named by their glyphs, in samples. */
  async draw(cam: Camera, cols: number, rows: number, o: DrawOptions): Promise<{ cells: Cells; glyphs: TermGlyph[] }> {
    await this.ready
    const sx = MOSAIC_SX, sy = MOSAIC_SY
    const width = cols * sx, height = rows * sy
    // a sample `aspect` times as tall as wide
    const aspect = (o.cellAspect * sx) / sy
    const box = o.box ?? NO_BOX
    const key = `${cols}x${rows}`
    const sh = this.shared
    if (sh.size !== key) {
      const bytes = (n: number) => new Uint8Array(new SharedArrayBuffer(n))
      Object.assign(sh, { size: key, px: bytes(width * height * 3), wt: bytes(width * height), char: new Uint32Array(new SharedArrayBuffer(cols * rows * 4)), fg: bytes(cols * rows * 3), bg: bytes(cols * rows * 3) })
    }
    if (!this.local) {
      this.sync()
      const id = ++this.frameId
      // more bands than threads, taken as each comes free
      const count = Math.min(rows, this.threads.length * BANDS_PER_THREAD)
      const bands = Array.from({ length: count + 1 }, (_, i) => Math.floor((rows * i) / count))
      Atomics.store(this.next, 0, 0)
      const got = await Promise.all(
        this.threads.map(
          (t) =>
            new Promise<TermGlyph[] | null>((done) => {
              t.pending.set(id, done)
              t.worker.postMessage({ type: 'frame', id, cam, width, height, aspect, glyphBelow: o.glyphBelow, cols, bands, next: this.next, sx, sy, kind: o.kind, box, rate: o.rate ?? 0, px: sh.px, wt: sh.wt, char: sh.char, fg: sh.fg, bg: sh.bg })
            }),
        ),
      )
      if (got.every((g) => g)) {
        const char = new Array<string>(cols * rows)
        for (let i = 0; i < cols * rows; i++) char[i] = String.fromCodePoint(sh.char[i])
        return { cells: { char, fg: sh.fg.slice(), bg: sh.bg.slice() }, glyphs: got.flat() as TermGlyph[] }
      }
    }
    const glyphs = this.local!.render(cam, width, height, sh.px, aspect, o.glyphBelow, undefined, sh.wt)
    const cells = this.encoder(o.kind, box, o.rate ?? 0)(sh.px, cols, rows, undefined, 0, rows, sh.char, sh.wt)
    for (let i = 0; i < cols * rows; i++) sh.char[i] = cells.char[i].codePointAt(0)!
    return { cells: { char: cells.char, fg: cells.fg, bg: cells.bg }, glyphs }
  }

  /** the scene to the workers, when it is another or has changed since */
  private sync() {
    const sc = this.scene
    if (!sc) return
    const s = this.sent
    if (sc === s.scene && sc.revision === s.revision && sc.layoutRevision === s.layout) return
    const data = serialize(sc)
    this.post({ type: 'scene', fresh: sc !== s.scene, data })
    this.sent = { scene: sc, revision: sc.revision, layout: sc.layoutRevision }
  }

  private encoder(kind: string, box: Box, rate: number) {
    const key = `${kind}|${box.top},${box.right},${box.bottom}|${rate}`
    let e = this.encoders.get(key)
    if (!e) this.encoders.set(key, (e = mosaicEncoder(kind, box, rate)))
    return e
  }

  destroy(): void {
    for (const t of this.threads) {
      t.worker.removeAllListeners('exit')
      void t.worker.terminate()
    }
    this.threads = []
  }
}
