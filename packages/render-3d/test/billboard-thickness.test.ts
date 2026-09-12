import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { Render3d } from '../src/index.js'
import { emptyScene, type Scene, type TileRect, type TileSource } from '@orbrun/scene'

/**
 * Standing sprites have the hands' thickness: behind the front quad the
 * opaque texels are extruded into a block with a shaded rim. The front quad
 * keeps its four corners first, so what the sprite shows is unchanged.
 */
const RECT: TileRect = { atlas: 'main', sx: 4, sy: 8, w: 4, h: 4, ox: 0, oy: 0, cell: 32 }

const tiles: TileSource = {
  tile: () => RECT,
  atlas: () => ({ width: 16, height: 16 }) as unknown as TexImageSource,
  atlasNames: () => ['main'],
}

type Priv = {
  setTiles(t: TileSource): void
  billboardGroup: THREE.Group
  rebuildBillboards(s: Scene): void
  atlas(name: string): { mask?: Uint8Array | null }
}

/** A 16x16 atlas, opaque only on the 2x2 square at the middle of the tile's 4x4 rect. */
function maskedRenderer(): Priv {
  const r = new Render3d() as unknown as Priv
  r.setTiles(tiles)
  const mask = new Uint8Array(16 * 16)
  for (const [x, y] of [[5, 9], [6, 9], [5, 10], [6, 10]]) mask[y * 16 + x] = 1
  r.atlas('main').mask = mask
  return r
}

function scene(alpha?: number): Scene {
  const s = emptyScene()
  s.playerOnLevel = true
  s.player = { x: 0, y: 0 }
  s.billboards = [{ x: 3, y: 3, tile: 1, kind: 'monster', height: 1, attitude: 'hostile', alpha, statusIcons: [{ tile: 2, ox: 0, oy: 0, at: 'top' }] }]
  return s
}

function quads(r: Priv, kind: string): THREE.Mesh[] {
  const h = r.billboardGroup.children.find((c) => c.userData.kind === kind)!
  return h.children.filter((c) => (c as THREE.Mesh).geometry && !c.userData.shared) as THREE.Mesh[]
}

describe('billboard thickness', () => {
  it('extrudes the opaque texels into a block behind the front quad', () => {
    const r = maskedRenderer()
    r.rebuildBillboards(scene())
    const [m] = quads(r, 'monster')
    const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute
    // the front quad's four corners, then a rim of eight faces (four texel edges on each of two axes)
    expect(pos.count).toBe(4 + 8 * 4)
    const k = 1 / 32
    let zmin = 0
    for (let i = 0; i < 4; i++) expect(pos.getZ(i)).toBe(0)
    for (let i = 4; i < pos.count; i++) zmin = Math.min(zmin, pos.getZ(i))
    expect(zmin).toBeCloseTo(-2 * k, 6)
    // the rim spans the opaque square: texels 1..3 of the 4-wide rect, rows 1..3
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (let i = 4; i < pos.count; i++) {
      x0 = Math.min(x0, pos.getX(i)); x1 = Math.max(x1, pos.getX(i))
      y0 = Math.min(y0, pos.getY(i)); y1 = Math.max(y1, pos.getY(i))
    }
    const hw = (4 / 32) / 2
    expect(x0).toBeCloseTo(-hw + 1 * k, 6)
    expect(x1).toBeCloseTo(-hw + 3 * k, 6)
    expect(y1).toBeCloseTo(hw - 1 * k, 6)
    expect(y0).toBeCloseTo(hw - 3 * k, 6)
    // rim faces sample their own texel's centre and are darker than the front
    const uv = m.geometry.getAttribute('uv') as THREE.BufferAttribute
    const col = m.geometry.getAttribute('color') as THREE.BufferAttribute
    expect(uv.getX(4)).toBeCloseTo((5 + 0.5) / 16, 6)
    expect(uv.getY(4)).toBeCloseTo((9 + 0.5) / 16, 6)
    const front = col.getX(0)
    for (let i = 4; i < col.count; i++) expect(col.getX(i)).toBeLessThan(front)
  })
  it('leaves the damage bar and badges, the ghost, and a translucent sprite flat', () => {
    const r = maskedRenderer()
    r.rebuildBillboards(scene())
    expect((quads(r, 'monster')[1].geometry.getAttribute('position') as THREE.BufferAttribute).count).toBe(4)
    expect((quads(r, 'ghost')[0].geometry.getAttribute('position') as THREE.BufferAttribute).count).toBe(4)
    r.rebuildBillboards(scene(0.5))
    expect((quads(r, 'monster')[0].geometry.getAttribute('position') as THREE.BufferAttribute).count).toBe(4)
  })
  it('stays flat where the atlas pixels cannot be read', () => {
    const r = new Render3d() as unknown as Priv
    r.setTiles(tiles)
    r.rebuildBillboards(scene())
    expect((quads(r, 'monster')[0].geometry.getAttribute('position') as THREE.BufferAttribute).count).toBe(4)
  })
})
