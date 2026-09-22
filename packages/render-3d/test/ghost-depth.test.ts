import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { stubbed } from './bed.js'
import { cellKey, emptyScene, makeCamera, type Scene, type TileRect, type TileSource } from '@orbrun/scene'

const RECT: TileRect = { atlas: 'main', sx: 0, sy: 0, w: 32, h: 32, ox: 0, oy: 0, cell: 32 }
const tiles: TileSource = {
  tile: () => RECT,
  atlas: () => ({ width: 64, height: 64 }) as unknown as TexImageSource,
  atlasNames: () => ['main'],
}

/** A 6x6 room with one monster in it, on a cell it cannot see, so the monster has a ghost. */
function room(): Scene {
  const s = emptyScene()
  s.revision = s.layoutRevision = 1
  s.bounds = { left: 0, top: 0, right: 5, bottom: 5 }
  s.playerOnLevel = true
  s.player = { x: 1, y: 1 }
  for (let y = 0; y < 6; y++)
    for (let x = 0; x < 6; x++) {
      const wall = x === 0 || y === 0 || x === 5 || y === 5
      s.cells.set(cellKey(x, y), { x, y, kind: wall ? 'wall' : 'floor', visibility: 'visible', occluder: wall, floorTile: 0, wallTile: wall ? 1 : undefined })
    }
  s.billboards = [{ x: 3, y: 3, tile: 1, kind: 'monster', height: 1, attitude: 'hostile' }]
  return s
}

/**
 * The depth pass renders the scene into the very texture the ghost shaders
 * sample, so the ghosts themselves must be out of it: a draw that reads the
 * image it writes is a framebuffer feedback loop, which GL refuses. It draws
 * layer 0 alone — the masonry and the fixtures standing in it — so a monster
 * behind any of those shows through, while the crowd, the ghosts and the
 * shadows stand on a layer the depth camera does not see and cost it no
 * draw calls.
 */
describe('ghost depth pass', () => {
  it('sees layer 0 alone while the depth image is drawn, and the frame sees both', () => {
    const { r, g } = stubbed({}, tiles)
    const seen: { mask: number; target: unknown }[] = []
    let target: unknown = null
    g.renderer = {
      getDrawingBufferSize: (v: THREE.Vector2) => v.set(64, 32),
      getRenderTarget: () => target,
      setRenderTarget: (t: unknown) => void (target = t),
      setClearColor: () => {},
      clear: () => {},
      clearDepth: () => {},
      render: () => void seen.push({ mask: g.cam.layers.mask, target }),
      dispose: () => {},
    }
    const frameMask = g.cam.layers.mask
    r.setCamera(makeCamera(1, 1))
    r.setScene(room())
    r.render()
    expect(g.ghostCount).toBeGreaterThan(0)
    // the depth image, then the frame, then the blit on the canvas
    expect(seen).toHaveLength(3)
    expect(seen[0].mask).toBe(1 << 0)
    expect(seen[1].mask).toBe(frameMask)
    expect(seen[2].target).toBeNull()
    expect(g.cam.layers.mask).toBe(frameMask)
    // the frame's camera sees the level and the standing layer alike
    expect(frameMask & (1 << 0)).toBeTruthy()
    expect(frameMask & (1 << 1)).toBeTruthy()
    r.destroy()
  })

  it('keeps the ghosts, the crowd and the shadows off the depth image, and the level and its fixtures on it', () => {
    const { r, g } = stubbed({}, tiles)
    const s = room()
    // a statue at (4, 2): a fixture is part of the depth image, as the masonry is
    const statue = s.cells.get(cellKey(4, 2))!
    statue.featureTile = 3
    statue.stance = 'upright'
    statue.feature = { type: 'other', name: 'statue' }
    r.setCamera(makeCamera(1, 1))
    r.setScene(s)
    r.render()
    const depthCam = new THREE.Layers()
    depthCam.set(0)
    const on = (key: string) => g.batches.get(key)!.mesh.layers.test(depthCam)
    expect(g.batches.get('main|fixture')!.size).toBeGreaterThan(0)
    expect(on('main|fixture')).toBe(true)
    for (const key of ['main|opaque', 'main|ghostVisible']) {
      expect(g.batches.get(key)!.size).toBeGreaterThan(0)
      expect(on(key)).toBe(false)
    }
    expect(g.shadowBatch.mesh.layers.test(depthCam)).toBe(false)
    for (const meshes of g.levelMeshes.values()) for (const m of meshes) expect(m.layers.test(depthCam)).toBe(true)
    // and the frame's camera draws every one of them
    for (const b of g.batches.values()) expect(b.mesh.layers.test(g.cam.layers)).toBe(true)
    expect(g.shadowBatch.mesh.layers.test(g.cam.layers)).toBe(true)
    r.destroy()
  })

  it('skips the depth pass where nothing has a ghost', () => {
    const bed = stubbed({}, tiles)
    const s = room()
    s.billboards = []
    bed.r.setCamera(makeCamera(1, 1))
    bed.r.setScene(s)
    bed.r.render()
    expect(bed.g.ghostCount).toBe(0)
    // the frame and the blit, and no depth image before them
    expect(bed.draws).toBe(2)
    bed.r.destroy()
  })
})
