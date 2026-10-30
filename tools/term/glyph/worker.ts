/**
 * One of threads.ts's workers: a GlyphView of its own that draws bands of
 * the view's rows as cells, packs them into the memory the frame shares, and
 * writes each band as terminal output against the frame shown before.
 * Bundled for the worker by threads.ts.
 *
 * Its tiles and pictures are asked of the main thread as they are wanted,
 * and waited on (`ask`): each once, its pixels in memory all the workers
 * share.
 *
 * main -> worker: { type: 'scene', data } { type: 'opts', opts } { type: 'inks', inks } { type: 'frame', ... (`Frame`) }
 * worker -> main: { type: 'done', id, parts: [band, end, ms][] } (each band's output in `out` up to `end`) (none for a thread come too late to take a band)
 * on the port, worker -> main and back: { type: 'tile', id } { type: 'pixels', name } (an atlas) { type: 'pixels', pid } (a thing's)
 */
import { parentPort, receiveMessageOnPort, workerData, type MessagePort } from 'node:worker_threads'
import { deserialize } from 'node:v8'
import type { Camera, Scene, TileRect, TileSource } from '@orbrun/scene'
import type { Pixels } from '@orbrun/render-term'
import { bandOut, cellsOut, GlyphView, type GlyphViewOptions, type Thing } from './render'
import { setInks } from './font'

/** a thing as sent: its art's pixels named by `pid`, asked for once */
export type SentThing = Omit<Thing, 'art'> & { art: { pid: number; rect: TileRect; mirror?: boolean }[] }

/** a frame to draw: the bands of its rows, taken by whichever thread is free */
export interface Frame {
  type: 'frame'
  id: number
  cam: Camera
  cols: number
  rows: number
  /** the terminal row the view's first is on */
  top: number
  /** the things standing, serialized, or null where they are as in the frame before */
  things: Uint8Array | null
  /** band i is rows bands[i] up to bands[i + 1] */
  bands: number[]
  /** the bands in the order they are taken, those with the most to draw first */
  order: number[]
  /** how many of `order` are taken, shared by all the threads drawing the frame (this one too), and only this frame */
  next: Int32Array
  /** the cells, packed, as drawn now and as shown before (null: the screen is to be drawn whole) */
  cur: Int32Array
  prev: Int32Array | null
  /** the terminal output, each band's from `at[band]` */
  out: Uint8Array
  at: number[]
  /** the cells only, with no terminal output */
  cellsOnly: boolean
}

const { port, flag } = workerData as { port: MessagePort; flag: Int32Array }

/** a question for the main thread, waited on: it answers on the port, then wakes this one */
function ask<T>(q: object): T {
  Atomics.store(flag, 0, 0)
  port.postMessage(q)
  Atomics.wait(flag, 0, 0)
  for (;;) {
    const m = receiveMessageOnPort(port)
    if (m) return m.message as T
  }
}

const rects = new Map<number, TileRect | undefined>()
const atlases = new Map<string, Pixels | undefined>()
const pictures = new Map<number, Pixels>()
const tiles: TileSource = {
  tile(id) {
    if (!rects.has(id)) rects.set(id, ask<TileRect | undefined>({ type: 'tile', id }))
    return rects.get(id)
  },
  atlas: () => undefined,
  atlasNames: () => [],
}
const atlas = (name: string) => {
  if (!atlases.has(name)) atlases.set(name, ask<Pixels | undefined>({ type: 'pixels', name }))
  return atlases.get(name)
}
const picture = (pid: number) => {
  let px = pictures.get(pid)
  if (!px) pictures.set(pid, (px = ask<Pixels>({ type: 'pixels', pid })))
  return px
}

const view = new GlyphView(tiles, atlas)
/** the things as last sent, made the view's only when this thread next draws */
let things: Uint8Array | null = null

parentPort!.on('message', (m: { type: string } & Record<string, unknown>) => {
  if (m.type === 'scene') view.setScene(deserialize(m.data as Uint8Array) as Scene)
  else if (m.type === 'opts') view.opts = m.opts as GlyphViewOptions
  else if (m.type === 'inks') setInks(m.inks as never)
  else if (m.type === 'frame') {
    const f = m as unknown as Frame
    const parts: [number, number, number][] = []
    // bands taken one at a time until none are left, so a thread slower than the others takes fewer, and one come late none
    if (f.things) things = f.things
    let i = Atomics.add(f.next, 0, 1)
    if (i < f.order.length) {
      if (things) view.things = (deserialize(things) as SentThing[]).map((t) => ({ ...t, art: t.art.map((a) => ({ px: picture(a.pid), rect: a.rect, mirror: a.mirror })) }))
      things = null
      // what the frame is drawn from, once for all the bands this thread takes
      const prepared = view.prepare(f.cam, f.cols, f.rows)
      for (; i < f.order.length; i = Atomics.add(f.next, 0, 1)) {
        const b = f.order[i]
        const t0 = performance.now()
        parts.push([b, f.cellsOnly ? cellsOut(view, prepared, f.bands[b], f.bands[b + 1], f.cur) : bandOut(view, prepared, f.bands[b], f.bands[b + 1], f.top, f.prev, f.cur, f.out, f.at[b]), performance.now() - t0])
      }
    }
    parentPort!.postMessage({ type: 'done', id: f.id, parts })
  }
})
