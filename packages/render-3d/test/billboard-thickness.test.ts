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

/** A 16x16 atlas, opaque on the given texels; by default the 2x2 square at the middle of the tile's 4x4 rect. */
function maskedRenderer(texels: number[][] = [[5, 9], [6, 9], [5, 10], [6, 10]]): Priv {
  const r = new Render3d() as unknown as Priv
  r.setTiles(tiles)
  const mask = new Uint8Array(16 * 16)
  for (const [x, y] of texels) mask[y * 16 + x] = 1
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
    // rim faces wear their own texel's centre — the block is body all through — and are darker than the front
    const uv = m.geometry.getAttribute('uv') as THREE.BufferAttribute
    const col = m.geometry.getAttribute('color') as THREE.BufferAttribute
    expect(uv.getX(4)).toBeCloseTo((5 + 0.5) / 16, 6)
    expect(uv.getY(4)).toBeCloseTo((9 + 0.5) / 16, 6)
    const front = col.getX(0)
    for (let i = 4; i < col.count; i++) expect(col.getX(i)).toBeLessThan(front)
  })
  /**
   * Crawl draws a black line a texel thick round every sprite and paints the
   * shadow at its feet with the same ink. Standing that up walls the sprite
   * into its own outline, and where the block shows its lid or its floor — the
   * top and the bottom — a line a texel thick smears into a band BB_DEPTH deep
   * that lines up with nothing the front quad draws. Ink is drawn, never stood
   * up: the block is the body the ink outlines.
   */
  it('stands up the body and leaves the art\'s ink flat', () => {
    const r = maskedRenderer()
    // ink the top row of the opaque square: the block is then the row below it alone
    const mask = r.atlas('main').mask!
    mask[9 * 16 + 5] = 2
    mask[9 * 16 + 6] = 2
    r.rebuildBillboards(scene())
    const [m] = quads(r, 'monster')
    const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute
    // the front quad, then a rim round the 2x1 body: two faces on the long sides, one at each end
    expect(pos.count).toBe(4 + 6 * 4)
    let y1 = -Infinity
    for (let i = 4; i < pos.count; i++) y1 = Math.max(y1, pos.getY(i))
    // the ink row is not stood up, so the block's top is a texel below the sprite's
    const k = 1 / 32
    expect(y1).toBeCloseTo((4 / 32) / 2 - 2 * k, 6)
  })
  /**
   * The uvs are inset a quarter texel so a sample never reaches the next tile
   * in the atlas, so the quad is inset by the same. Mapped across the whole
   * tile instead, the art is drawn a shade larger than the tile it came from
   * and every texel boundary drifts outward from the one the rim stands on —
   * the flat part bigger than the block behind it, worst at the edges, and a
   * sprite a couple of texels wide comes off its own block.
   */
  it('draws the tile at the scale the block is built at', () => {
    const r = maskedRenderer()
    r.rebuildBillboards(scene())
    const [m] = quads(r, 'monster')
    const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute
    const uv = m.geometry.getAttribute('uv') as THREE.BufferAttribute
    // the quad's top-left and top-right corners, and the uvs mapped onto them
    const [x0, x1] = [pos.getX(0), pos.getX(1)]
    const [u0, u1] = [uv.getX(0), uv.getX(1)]
    const k = 1 / 32
    const hw = (RECT.w * k) / 2
    // every texel boundary of the block falls on the same boundary of the art
    for (let tx = 0; tx <= RECT.w; tx++) {
      const x = -hw + tx * k
      const u = u0 + ((x - x0) / (x1 - x0)) * (u1 - u0)
      expect(u * 16).toBeCloseTo(RECT.sx + tx, 6)
    }
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
