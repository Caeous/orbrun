/**
 * The view drawn as a picture, on several threads: each worker
 * (raster-worker.ts) a RenderTerm of its own drawing bands of the frame's
 * rows into memory they all share. The scene goes to each as it changes; the
 * tiles are asked for as wanted and answered here, an atlas made once, in
 * linear light (and once with its sprites' ink peeled), for all of them.
 * What moves (render-3d's `Movers`, the swing's lift) is kept here and each
 * frame's handed to them, so every band draws it alike. With no threads
 * (ORBRUN_TERM_THREADS=0), the same on this one.
 */
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serialize } from 'node:v8'
import { MessageChannel, Worker } from 'node:worker_threads'
import { RenderTerm, linearAtlas, spriteAtlas, type Atlas, type Motion, type Pixels, type RenderTermOptions } from '@orbrun/render-term'
import { Movers, monsterId, liftEnvelope } from '@orbrun/world'
import type { Camera, Scene, SceneCursor, TileSource, Viewmodel } from '@orbrun/scene'

const here = path.dirname(fileURLToPath(import.meta.url))
/** how many bands of rows a frame is cut into, for each thread */
const BANDS_PER_THREAD = Number(process.env.ORBRUN_TERM_BANDS) || 4

/** How a frame is drawn. */
export interface DrawOptions {
  /** how many times taller than wide a pixel is */
  pixelAspect: number
}

/** render-term's options, and whether things move (render-3d's `motion`). */
export type RasterOptions = RenderTermOptions & { motion?: boolean }

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
  /** the frames asked of it, answered true when its bands are drawn, or false when it failed */
  pending: Map<number, (ok: boolean) => void>
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
  // what the view is drawn from, for a renderer made late (`goLocal`)
  private scene: Scene | null = null
  private cursor: SceneCursor | null = null
  private viewmodel: Viewmodel | null = null
  private opts: RenderTermOptions = {}
  private sent: { scene: Scene | null; revision: number; layout: number } = { scene: null, revision: -1, layout: -1 }
  private frameId = 0
  private next = new Int32Array(new SharedArrayBuffer(4))
  /** the memory the threads draw the frame into: kept from frame to frame, made bigger only where a frame needs it */
  private shared: Uint8Array = new Uint8Array(0)
  // what moves
  private motionOn = true
  private movers = new Movers()
  private motionRevision = -1
  /** when the swing began, seconds; NaN at rest */
  private liftAt = NaN

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
    port2.on('message', (q: { type: string; id?: number; layer?: string; name?: string; sprite?: boolean }) => {
      port2.postMessage(q.type === 'tile' ? this.tiles?.tile(q.id!, q.layer) : this.atlas(q.name!, !!q.sprite))
      Atomics.store(flag, 0, 1)
      Atomics.notify(flag, 0)
    })
    worker.on('message', (m: { type: string; id: number }) => {
      if (m.type !== 'done') return
      t.pending.get(m.id)?.(true)
      t.pending.delete(m.id)
    })
    // a worker that fails takes the others with it: the view is drawn here from then on
    const fail = () => {
      for (const th of this.threads) for (const done of th.pending.values()) done(false)
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
    if (this.tiles) r.setTiles(this.tiles, this.pixels, (name, sprite) => this.atlas(name, sprite))
    if (this.scene) r.setScene(this.scene)
    r.setCursor(this.cursor)
    r.setViewmodel(this.viewmodel)
  }

  /** An atlas in linear light, as the level draws it, or peeled, as the sprites do (`sprite`): made once, for every thread. */
  private atlas(name: string, sprite: boolean): Atlas | null {
    const key = `${sprite ? 'sprite' : 'level'}|${name}`
    if (!this.atlases.has(key)) {
      const px = this.pixels(name)
      this.atlases.set(key, px ? (sprite ? spriteAtlas(px, this.tiles?.spriteRects?.(name)) : linearAtlas(px)) : null)
    }
    return this.atlases.get(key)!
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
    this.local?.setTiles(tiles, pixels, (name, sprite) => this.atlas(name, sprite))
    this.post({ type: 'tiles' })
  }
  setScene(scene: Scene): void {
    this.scene = scene
    this.local?.setScene(scene)
    this.track()
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
  setOptions({ motion, ...opts }: RasterOptions): void {
    if (motion === false && this.motionOn) {
      this.resetMotion()
      this.liftAt = NaN
    }
    if (motion !== undefined) this.motionOn = motion
    this.opts = { ...this.opts, ...opts }
    this.local?.setOptions(opts)
    this.post({ type: 'options', opts })
  }

  // ---- what moves, as render-3d keeps it

  /** The weapon lifts a touch for a swing. */
  attack(): void {
    if (this.motionOn) this.liftAt = performance.now() / 1000
  }

  /** Every monster forgotten, so none glides from where a level or the map left it. */
  resetMotion(): void {
    this.movers.clear()
    this.motionRevision = -1
  }

  /** Whether something is still moving, so frames are still wanted. */
  get animating(): boolean {
    return !Number.isNaN(this.liftAt) || this.movers.active
  }

  /** the scene's monsters read against the last revision's, for their glides */
  private track(now = performance.now() / 1000) {
    const sc = this.scene
    if (!sc || !this.motionOn || sc.revision === this.motionRevision) return
    this.movers.track(sc.billboards, now)
    this.motionRevision = sc.revision
  }

  /** What moves at `now`: each monster's glide off its cell, and the lift (world hands.ts `liftEnvelope`). */
  private motionAt(now: number): Motion {
    this.track(now)
    const offsets = new Map<number, { x: number; y: number }>()
    if (this.motionOn && this.scene)
      for (const b of this.scene.billboards) {
        const id = b.kind === 'monster' ? monsterId(b) : undefined
        const o = id === undefined ? null : this.movers.offset(id, now)
        if (o) offsets.set(id!, o)
      }
    this.movers.landed(now)
    let lift = 0
    if (!Number.isNaN(this.liftAt)) {
      const e = liftEnvelope(now - this.liftAt)
      if (Number.isNaN(e)) this.liftAt = NaN
      else lift = e
    }
    return { offsets, lift }
  }

  /** The view from `cam`, `width` x `height` RGB, into memory the threads share (kept until the next frame). */
  async draw(cam: Camera, width: number, height: number, o: DrawOptions): Promise<Uint8Array> {
    await this.ready
    const motion = this.motionAt(performance.now() / 1000)
    if (this.shared.length < width * height * 3) this.shared = new Uint8Array(new SharedArrayBuffer(width * height * 3))
    const px = this.shared.subarray(0, width * height * 3)
    if (!this.local) {
      this.sync()
      const id = ++this.frameId
      // more bands than threads, taken as each comes free
      const count = Math.min(height, this.threads.length * BANDS_PER_THREAD)
      const bands = Array.from({ length: count + 1 }, (_, i) => Math.floor((height * i) / count))
      Atomics.store(this.next, 0, 0)
      const got = await Promise.all(
        this.threads.map(
          (t) =>
            new Promise<boolean>((done) => {
              t.pending.set(id, done)
              t.worker.postMessage({ type: 'frame', id, cam, width, height, aspect: o.pixelAspect, motion, bands, next: this.next, px })
            }),
        ),
      )
      if (got.every((g) => g)) return px
    }
    this.local!.render(cam, width, height, px, o.pixelAspect, undefined, motion)
    return px
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

  destroy(): void {
    for (const t of this.threads) {
      t.worker.removeAllListeners('exit')
      void t.worker.terminate()
    }
    this.threads = []
  }
}
