/**
 * One of raster.ts's workers: a RenderTerm of its own that draws bands of
 * the frame's rows into the memory the frame shares. Bundled for the worker
 * by raster.ts.
 *
 * Its tiles are asked of the main thread as they are wanted, and waited on
 * (`ask`): a tile once, an atlas once, in linear light, in memory all the
 * workers share.
 *
 * main -> worker: { type: 'scene', fresh, data } { type: 'cursor', cursor } { type: 'viewmodel', vm }
 *                 { type: 'options', opts } { type: 'tiles' } { type: 'frame', ... (`Frame`) }
 * worker -> main: { type: 'done', id }
 * on the port, worker -> main and back: { type: 'tile', id, layer } { type: 'atlas', name, sprite }
 */
import { parentPort, receiveMessageOnPort, workerData, type MessagePort } from 'node:worker_threads'
import { deserialize } from 'node:v8'
import { RenderTerm, type Atlas, type Motion } from '@orbrun/render-term'
import type { Camera, Scene, TileRect, TileSource } from '@orbrun/scene'

/** a frame to draw: the picture, and the bands of its rows, taken by whichever thread is free */
export interface Frame {
  type: 'frame'
  id: number
  cam: Camera
  width: number
  height: number
  aspect: number
  /** what moves this frame, the same for every band */
  motion: Motion
  /** band i is rows bands[i] up to bands[i + 1] */
  bands: number[]
  /** the next band to take, shared by all the threads drawing the frame */
  next: Int32Array
  px: Uint8Array
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
const atlas = (name: string, sprite = false): Atlas | null => {
  const key = `${sprite ? 'sprite' : 'level'}|${name}`
  if (!atlasCache.has(key)) atlasCache.set(key, ask<Atlas | null>({ type: 'atlas', name, sprite }))
  return atlasCache.get(key)!
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
    return a ? { width: a.w, height: a.h, data: new Uint8Array(0) } : undefined
  }, atlas)
}
setTiles()
let scene: Scene | null = null

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
    // bands taken one at a time until none are left, so a thread slower than the others takes fewer
    for (;;) {
      const b = Atomics.add(f.next, 0, 1)
      if (b >= f.bands.length - 1) break
      r.render(f.cam, f.width, f.height, f.px, f.aspect, [f.bands[b], f.bands[b + 1]], f.motion)
    }
    parentPort!.postMessage({ type: 'done', id: f.id })
  }
})
