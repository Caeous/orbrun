/**
 * One of raster.ts's workers: a RenderTerm of its own that draws a band of
 * the frame's rows into the memory the frame shares, then encodes the cells
 * of those rows as mosaics (frame.mjs `mosaicEncoder`) into the cells it
 * shares. Bundled for the worker by raster.ts.
 *
 * Its tiles are asked of the main thread as they are wanted, and waited on
 * (`ask`): a tile once, an atlas once, in linear light, in memory all the
 * workers share.
 *
 * main -> worker: { type: 'scene', fresh, data } { type: 'cursor', cursor } { type: 'viewmodel', vm }
 *                 { type: 'options', opts } { type: 'tiles' } { type: 'frame', ... (`Frame`) }
 * worker -> main: { type: 'done', id, glyphs }
 * on the port, worker -> main and back: { type: 'tile', id, layer } { type: 'atlas', name }
 */
import { parentPort, receiveMessageOnPort, workerData, type MessagePort } from 'node:worker_threads'
import { deserialize } from 'node:v8'
import { RenderTerm, type Atlas } from '@orbrun/render-term'
import type { Camera, Scene, TileRect, TileSource } from '@orbrun/scene'
import type { TermGlyph } from '@orbrun/render-term'
import type { Box } from './raster'
// @ts-expect-error: plain JS, shared with the browser bridge
import { mosaicEncoder } from './frame.mjs'

/** a frame's band to draw: the frame, the rows of it, and where it and its cells go */
export interface Frame {
  type: 'frame'
  id: number
  cam: Camera
  width: number
  height: number
  aspect: number
  glyphBelow: number
  /** the cells across, and the bands of rows of cells: band i is rows bands[i] up to bands[i + 1] */
  cols: number
  bands: number[]
  /** the next band to take, shared by all the threads drawing the frame */
  next: Int32Array
  /** samples a cell across and down */
  sx: number
  sy: number
  kind: string
  /** where a font's blocks stop short of the cell (frame.mjs `mosaicGlyphs`) */
  box: Box
  rate: number
  px: Uint8Array
  /** how much each sample stands out (`RenderTerm.render`'s `weights`) */
  wt: Uint8Array
  char: Uint32Array
  fg: Uint8Array
  bg: Uint8Array
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

const tileCache = new Map<string, TileRect | undefined>()
const atlasCache = new Map<string, Atlas | null>()
const atlas = (name: string): Atlas | null => {
  if (!atlasCache.has(name)) atlasCache.set(name, ask<Atlas | null>({ type: 'atlas', name }))
  return atlasCache.get(name)!
}
const tiles: TileSource = {
  tile(id, layer) {
    const key = `${id}|${layer ?? ''}`
    if (!tileCache.has(key)) tileCache.set(key, ask<TileRect | undefined>({ type: 'tile', id, layer }))
    return tileCache.get(key)
  },
  atlas: () => undefined,
  atlasNames: () => [],
}

const r = new RenderTerm()
const setTiles = () => {
  tileCache.clear()
  atlasCache.clear()
  // the pixels only for their size: what is drawn is the linear atlas
  r.setTiles(tiles, (name) => {
    const a = atlas(name)
    return a ? { width: a.levels[0].w, height: a.levels[0].h, data: new Uint8Array(0) } : undefined
  }, atlas)
}
setTiles()
let scene: Scene | null = null
const encoders = new Map<string, (px: Uint8Array, cols: number, rows: number, out: object, r0: number, r1: number, prev: Uint32Array, wt: Uint8Array) => void>()

parentPort!.on('message', (m: { type: string } & Record<string, unknown>) => {
  if (m.type === 'scene') {
    const next = deserialize(m.data as Uint8Array) as Scene
    // the same scene as before, changed: kept as the same object, so the renderer keeps what it built of it
    if (scene && !m.fresh) Object.assign(scene, next)
    else scene = next
    r.setScene(scene)
  } else if (m.type === 'cursor') r.setCursor(m.cursor as never)
  else if (m.type === 'viewmodel') r.setViewmodel(m.vm as never)
  else if (m.type === 'options') r.setOptions(m.opts as never)
  else if (m.type === 'tiles') setTiles()
  else if (m.type === 'frame') {
    const f = m as unknown as Frame
    const key = `${f.kind}|${f.box.top},${f.box.right},${f.box.bottom}|${f.rate}`
    let enc = encoders.get(key)
    if (!enc) encoders.set(key, (enc = mosaicEncoder(f.kind, f.box, f.rate)))
    const glyphs: TermGlyph[] = []
    const cells = { char: new Array(f.cols * f.bands[f.bands.length - 1]), fg: f.fg, bg: f.bg }
    // bands taken one at a time until none are left, so a thread slower than the others takes fewer
    for (;;) {
      const b = Atomics.add(f.next, 0, 1)
      if (b >= f.bands.length - 1) break
      const r0 = f.bands[b], r1 = f.bands[b + 1]
      for (const g of r.render(f.cam, f.width, f.height, f.px, f.aspect, f.glyphBelow, [r0 * f.sy, r1 * f.sy], f.wt)) glyphs.push(g)
      // last frame's glyphs are still in the cells, until these rows are written
      enc(f.px, f.cols, r1, cells, r0, r1, f.char, f.wt)
      for (let i = r0 * f.cols; i < r1 * f.cols; i++) f.char[i] = cells.char[i].codePointAt(0)!
    }
    parentPort!.postMessage({ type: 'done', id: f.id, glyphs })
  }
})
