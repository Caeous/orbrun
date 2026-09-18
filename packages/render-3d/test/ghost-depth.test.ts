import { describe, it, expect } from 'vitest'
import * as GL from '@orbrun/gl'
import { Render3d } from '../src/index.js'
import { emptyScene, type Scene, type TileRect, type TileSource } from '@orbrun/scene'

const RECT: TileRect = { atlas: 'main', sx: 0, sy: 0, w: 32, h: 32, ox: 0, oy: 0, cell: 32 }
const tiles: TileSource = {
  tile: () => RECT,
  atlas: () => ({ width: 64, height: 64 }) as unknown as TexImageSource,
  atlasNames: () => ['main'],
}

type Guts = {
  cam: GL.PerspectiveCamera
  billboardGroup: GL.Group
  setTiles(t: TileSource): void
  syncBillboards(s: Scene): void
  renderOccluderDepth(r: unknown): void
}

/**
 * The depth pass renders the scene into the very texture the ghost shaders
 * sample, so the ghosts themselves must be out of it: a draw that reads the
 * image it writes is a framebuffer feedback loop, which GL refuses. They
 * stand on a layer the depth pass's camera does not see, along with what
 * writes no depth anyway (the shadow discs), so the pass costs no draw
 * calls for them and no traversal to hide and show them.
 */
describe('ghost depth pass', () => {
  it('sees layer 0 alone while the depth image is drawn, and the frame sees both', () => {
    const r = new Render3d() as unknown as Guts
    const seen: number[] = []
    let target: unknown = 'frame'
    const fake = {
      getDrawingBufferSize: (v: GL.Vector2) => v.set(64, 32),
      getRenderTarget: () => target,
      setRenderTarget: (t: unknown) => void (target = t),
      clear: () => {},
      render: () => void seen.push(r.cam.layers.mask),
    }
    const frameMask = r.cam.layers.mask
    r.renderOccluderDepth(fake)
    expect(seen).toEqual([1 << 0])
    expect(r.cam.layers.mask).toBe(frameMask)
    expect(target).toBe('frame')
    // the frame's camera sees the occluders and the no-depth layer alike
    expect(frameMask & (1 << 0)).toBeTruthy()
    expect(frameMask & (1 << 1)).toBeTruthy()
  })

  it('keeps the ghosts, their rings and the shadows off the depth image, and the sprites on it', () => {
    const r = new Render3d() as unknown as Guts
    r.setTiles(tiles)
    const s = emptyScene()
    s.playerOnLevel = true
    s.player = { x: 0, y: 0 }
    s.billboards = [{ x: 3, y: 3, tile: 1, kind: 'monster', height: 1, attitude: 'hostile' }]
    r.syncBillboards(s)
    const depthCam = new GL.Layers()
    depthCam.set(0)
    const ghost = r.billboardGroup.children.find((h) => h.userData.kind === 'ghost')!
    const sprite = r.billboardGroup.children.find((h) => h.userData.kind === 'monster')!
    const meshes = (h: GL.Object3D) => h.children.filter((c) => (c as GL.Mesh).geometry)
    expect(meshes(ghost).length).toBeGreaterThan(0)
    for (const m of meshes(ghost)) expect(m.layers.test(depthCam)).toBe(false)
    const body = meshes(sprite).filter((c) => !c.userData.shared && !c.userData.hull)
    const hulls = meshes(sprite).filter((c) => c.userData.hull)
    const shadows = meshes(sprite).filter((c) => c.userData.shared)
    expect(body.length).toBe(1)
    expect(shadows.length).toBe(1)
    for (const m of [...body, ...hulls]) expect(m.layers.test(depthCam)).toBe(true)
    for (const m of shadows) expect(m.layers.test(depthCam)).toBe(false)
    // and the frame's camera draws every one of them
    for (const m of [...meshes(ghost), ...meshes(sprite)]) expect(m.layers.test(r.cam.layers)).toBe(true)
  })
})
