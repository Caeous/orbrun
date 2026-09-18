import { describe, it, expect } from 'vitest'
import * as GL from '@orbrun/gl'
import { Render3d } from '../src/index.js'
import { CHUNK } from '../src/crowd.js'
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
  bakeStanding(g: GL.Group, eye: { x: number; y: number }): void
}

function crowd(): Scene {
  const s = emptyScene()
  s.playerOnLevel = true
  s.player = { x: 0, y: 0 }
  s.billboards = [
    { x: 3, y: 3, tile: 1, kind: 'monster', height: 1, attitude: 'hostile' },
    { x: 5, y: 2, tile: 1, kind: 'item', height: 0.6 },
    { x: 6, y: 6, tile: 1, kind: 'monster', height: 1, attitude: 'hostile', statusIcons: [{ tile: 2, ox: 0, oy: 0 }] },
    // translucent: wears a material of its own, so it stays a holder
    { x: 2, y: 7, tile: 1, kind: 'monster', height: 1, attitude: 'hostile', alpha: 0.5 },
  ]
  return s
}

const meshes = (g: GL.Object3D) => g.children.filter((c) => (c as GL.Mesh).geometry) as GL.Mesh[]

/**
 * A crowd of standing holders is baked into one mesh per material and draw
 * order (`bakeStanding`), each sprite's vertices in its own frame with the
 * holder's place as an anchor, and the eye's yaw applied in the shader. What
 * has a material or a motion of its own stays a holder.
 */
describe('baked crowd', () => {
  it('merges the holders into a few meshes and keeps the odd ones out', () => {
    const r = new Render3d() as unknown as Guts
    r.setTiles(tiles)
    r.syncBillboards(crowd())
    const before = r.billboardGroup.children.length
    expect(before).toBe(8) // three sprites and their ghosts, the translucent one and its ghost
    const meshesBefore = r.billboardGroup.children.reduce((n, h) => n + h.children.length, 0)

    r.bakeStanding(r.billboardGroup, { x: 0, y: 0 })

    const baked = meshes(r.billboardGroup).filter((m) => m.userData.baked)
    const holders = r.billboardGroup.children.filter((c) => !(c as GL.Mesh).geometry)
    // body, hull, badge, ghost, ghost badge, ring, shadow: one mesh each, whatever the crowd
    expect(baked.length).toBeGreaterThan(3)
    expect(baked.length).toBeLessThan(meshesBefore)
    // the translucent sprite and its ghost are left as they were: its ghost has no material of its own, so it is merged
    expect(holders.length).toBe(1)
    expect(holders[0].userData.kind).toBe('monster')
    expect(holders[0].userData.billboard).toBe(true)
    for (const m of baked) {
      // a chunk mesh is culled by the chunk's own sphere, never by its vertices' bounds (they are in the sprites' frames):
      // every anchor drawn lies inside it with a cell to spare, whichever way the sprite turns
      expect(m.frustumCulled).toBe(true)
      const sphere = m.geometry.boundingSphere!
      expect(sphere).toBeTruthy()
      const anchor = m.geometry.getAttribute('anchor') as GL.BufferAttribute
      const index = m.geometry.getIndex()!
      for (let i = 0; i < m.geometry.drawRange.count; i++) {
        const v = index.getX(i)
        expect(Math.hypot(anchor.getX(v) - sphere.center.x, anchor.getZ(v) - sphere.center.z) + 1).toBeLessThanOrEqual(sphere.radius)
      }
      expect(m.position.toArray()).toEqual([0, 0, 0])
      expect(sphere.radius).toBeLessThan(CHUNK * 2)
      expect(m.geometry.getAttribute('anchor')).toBeTruthy()
      expect(m.geometry.getAttribute('anchor').count).toBe(m.geometry.getAttribute('position').count)
      expect((m.material as GL.Material).defines?.MERGED).toBe('')
    }
    // the ghost meshes keep their layer, so the depth pass still leaves them out
    const depthCam = new GL.Layers()
    depthCam.set(0)
    const offDepth = baked.filter((m) => !m.layers.test(depthCam))
    expect(offDepth.length).toBeGreaterThan(0)
    for (const m of offDepth) expect(m.renderOrder <= 0).toBe(true)
  })

  it('anchors every vertex on its holder, with the vertices left in the sprite frame', () => {
    const r = new Render3d() as unknown as Guts
    r.setTiles(tiles)
    const s = crowd()
    s.billboards = [s.billboards[0]]
    r.syncBillboards(s)
    const body = r.billboardGroup.children.find((h) => h.userData.kind === 'monster')!
    const quad = meshes(body).find((m) => !m.userData.shared && !m.userData.hull)!
    const local = (quad.geometry.getAttribute('position') as GL.BufferAttribute).getY(0) + quad.position.y
    r.bakeStanding(r.billboardGroup, { x: 0, y: 0 })
    const merged = meshes(r.billboardGroup).find((m) => m.userData.baked && m.geometry.hasAttribute('uv') && m.renderOrder === 1)!
    const anchor = merged.geometry.getAttribute('anchor') as GL.BufferAttribute
    const pos = merged.geometry.getAttribute('position') as GL.BufferAttribute
    // anchors are the holder's place itself, and the chunk mesh stands at the origin: every vertex is summed exactly as
    // one merged mesh summed it (the buffers carry headroom past the last vertex drawn, so only what the draw range
    // indexes is looked at)
    expect(merged.position.toArray()).toEqual([0, 0, 0])
    const index = merged.geometry.getIndex()!
    const used = new Set<number>()
    for (let i = 0; i < merged.geometry.drawRange.count; i++) used.add(index.getX(i))
    expect(used.size).toBeGreaterThan(0)
    for (const i of used) {
      expect([anchor.getX(i), anchor.getY(i), anchor.getZ(i)]).toEqual([3.5, 0, 3.5])
    }
    // the first vertex is the body's first corner, lifted by the mesh's own place in the holder and no more
    expect(pos.getY(0)).toBeCloseTo(local, 6)
    expect(Math.abs(pos.getX(0))).toBeLessThan(1)
  })
})
