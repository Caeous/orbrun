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
  setCursor(c: { x: number; y: number; mode?: string } | null): void
  billboardGroup: THREE.Group
  rebuildBillboards(s: Scene): void
  atlas(name: string): { mask?: Uint8Array | null }
}

/** A 16x16 atlas, opaque on the given texels; by default the 2x2 square at the middle of the tile's 4x4 rect. */
function maskedRenderer(texels: number[][] = [[5, 9], [6, 9], [5, 10], [6, 10]], rect: TileRect = RECT): Priv {
  const r = new Render3d() as unknown as Priv
  r.setTiles({ ...tiles, tile: () => rect })
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
  return h.children.filter((c) => (c as THREE.Mesh).geometry && !c.userData.shared && !c.userData.hull) as THREE.Mesh[]
}

function hulls(r: Priv, kind: string): THREE.Mesh[] {
  const h = r.billboardGroup.children.find((c) => c.userData.kind === kind)!
  return h.children.filter((c) => c.userData.hull) as THREE.Mesh[]
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

  /**
   * Crawl's line round a sprite is the ink `peelInk` takes off the art, and
   * it comes back as a hull: the body grown a texel each way, as deep as the
   * block, black, drawn back faces only. What shows is the part that pokes
   * out past the body from wherever the eye is — the line, a texel wide,
   * from every angle — while the body's own lit sides stay in view.
   */
  it('lines the block with a black hull a texel wider than the body', () => {
    const r = maskedRenderer()
    r.rebuildBillboards(scene())
    const [ink] = hulls(r, 'monster')
    expect(ink).toBeTruthy()
    const mat = ink.material as THREE.MeshBasicMaterial
    expect(mat.side).toBe(THREE.BackSide)
    expect(mat.color.getHex()).toBe(0x000000)
    const pos = ink.geometry.getAttribute('position') as THREE.BufferAttribute
    // the 2x2 body grown a texel on four sides is a 12-texel cross: a back face each, and one side per
    // exposed edge — the cross's perimeter is 16 edges
    expect(pos.count).toBe((12 + 16) * 4)
    const k = 1 / 32, hw = (4 / 32) / 2
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity
    for (let i = 0; i < pos.count; i++) {
      x0 = Math.min(x0, pos.getX(i)); x1 = Math.max(x1, pos.getX(i))
      y0 = Math.min(y0, pos.getY(i)); y1 = Math.max(y1, pos.getY(i))
      z0 = Math.min(z0, pos.getZ(i)); z1 = Math.max(z1, pos.getZ(i))
    }
    // the whole tile across, the block's depth back, and nothing in front of the quad
    expect(x0).toBeCloseTo(-hw, 6)
    expect(x1).toBeCloseTo(hw, 6)
    expect(y1).toBeCloseTo(hw, 6)
    expect(y0).toBeCloseTo(-hw, 6)
    expect(z0).toBeCloseTo(-2 * k, 6)
    expect(z1).toBe(0)
    // no front face: nothing lies wholly at z = 0
    const idx = ink.geometry.getIndex()!
    for (let f = 0; f < idx.count; f += 3) {
      const zs = [idx.getX(f), idx.getX(f + 1), idx.getX(f + 2)].map((i) => pos.getZ(i))
      expect(zs.every((z) => z === 0)).toBe(false)
    }
    // the hull stands where the sprite does
    const [m] = quads(r, 'monster')
    expect(ink.position.toArray()).toEqual(m.position.toArray())
  })

  /**
   * The ghost pass draws a flat quad with no block, and its shader is the
   * depth test. Its line is a flat ring in the quad's plane: the texels round
   * the body and none of the body, black, on the ghost's own material so it
   * is hidden and faded as the ghost is, and added under the ghost so the
   * body paints over none of it.
   */
  it('lines a ghost with a flat ring in its plane', () => {
    const r = maskedRenderer()
    r.rebuildBillboards(scene())
    const [ink] = hulls(r, 'ghost')
    expect(ink).toBeTruthy()
    const pos = ink.geometry.getAttribute('position') as THREE.BufferAttribute
    // eight texels round the 2x2 body, one face each
    expect(pos.count).toBe(8 * 4)
    for (let i = 0; i < pos.count; i++) expect(pos.getZ(i)).toBe(0)
    const col = ink.geometry.getAttribute('color') as THREE.BufferAttribute
    for (let i = 0; i < col.count; i++) expect([col.getX(i), col.getY(i), col.getZ(i)]).toEqual([0, 0, 0])
    const mat = ink.material as THREE.ShaderMaterial
    expect(mat.isShaderMaterial).toBe(true)
    expect(mat.uniforms.map).toBeUndefined()
    const h = r.billboardGroup.children.find((c) => c.userData.kind === 'ghost')!
    const [ghost] = quads(r, 'ghost')
    expect(h.children.indexOf(ink)).toBeLessThan(h.children.indexOf(ghost))
    expect(ink.renderOrder).toBe(ghost.renderOrder)
    expect(ink.position.toArray()).toEqual(ghost.position.toArray())
  })

  it('keeps the hull inside the tile', () => {
    // a body on the tile's top-left corner: the hull cannot grow past the tile's edge
    const r = maskedRenderer([[4, 8]])
    r.rebuildBillboards(scene())
    const [ink] = hulls(r, 'monster')
    const pos = ink.geometry.getAttribute('position') as THREE.BufferAttribute
    const hw = (4 / 32) / 2
    // three texels: the body, and one to its right and below; back faces plus eight exposed edges
    expect(pos.count).toBe((3 + 8) * 4)
    let x0 = Infinity, y1 = -Infinity
    for (let i = 0; i < pos.count; i++) {
      x0 = Math.min(x0, pos.getX(i))
      y1 = Math.max(y1, pos.getY(i))
    }
    expect(x0).toBeCloseTo(-hw, 6)
    expect(y1).toBeCloseTo(hw, 6)
  })

  it('leaves the damage bar and badges, the ghost, and a translucent sprite flat', () => {
    const r = maskedRenderer()
    r.rebuildBillboards(scene())
    expect((quads(r, 'monster')[1].geometry.getAttribute('position') as THREE.BufferAttribute).count).toBe(4)
    expect((quads(r, 'ghost')[0].geometry.getAttribute('position') as THREE.BufferAttribute).count).toBe(4)
    expect(hulls(r, 'monster')).toHaveLength(1)
    r.rebuildBillboards(scene(0.5))
    expect((quads(r, 'monster')[0].geometry.getAttribute('position') as THREE.BufferAttribute).count).toBe(4)
    expect(hulls(r, 'monster')).toHaveLength(0)
  })
  it('puts a wider shell round the sprite under the cursor, outside the black hull', () => {
    const r = maskedRenderer()
    const shells = () => hulls(r, 'monster').filter((m) => m.userData.shell)
    const width = (m: THREE.Mesh) => {
      const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute
      let x0 = Infinity, x1 = -Infinity
      for (let i = 0; i < pos.count; i++) { x0 = Math.min(x0, pos.getX(i)); x1 = Math.max(x1, pos.getX(i)) }
      return x1 - x0
    }
    r.rebuildBillboards(scene())
    expect(shells()).toHaveLength(0)
    r.setCursor({ x: 3, y: 3 })
    r.rebuildBillboards(scene())
    const [shell] = shells()
    // the hull's black is untouched: the shell is a second mesh beside it, in the cursor's colour
    const ink = hulls(r, 'monster').find((m) => !m.userData.shell)!
    expect((ink.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0x000000)
    expect((shell.material as THREE.MeshBasicMaterial).color.getHex()).not.toBe(0x000000)
    // a texel wider each side than the hull — the shell is free of the tile's bounds, which the ink keeps to —
    // and its back sits deeper so the hull paints over what they share
    const k = 1 / 32
    expect(width(shell)).toBeCloseTo(width(ink) + 2 * k, 6)
    const sz = shell.geometry.getAttribute('position') as THREE.BufferAttribute
    const iz = ink.geometry.getAttribute('position') as THREE.BufferAttribute
    let smin = 0, imin = 0
    for (let i = 0; i < sz.count; i++) smin = Math.min(smin, sz.getZ(i))
    for (let i = 0; i < iz.count; i++) imin = Math.min(imin, iz.getZ(i))
    expect(smin).toBeLessThan(imin)
    // the ghost is never shelled, and a cursor on another cell leaves the sprite alone
    expect(hulls(r, 'ghost').some((m) => m.userData.shell)).toBe(false)
    r.setCursor({ x: 4, y: 3 })
    r.rebuildBillboards(scene())
    expect(shells()).toHaveLength(0)
  })
  it('keeps the shell above the floor where the sprite stands on it', () => {
    // a standing sprite's art runs to the bottom of its rect (oy + h is the cell), so its base is the
    // ground: a shell grown below there would lie under the floor and tear against it
    const grounded: TileRect = { ...RECT, oy: 28 }
    const r = maskedRenderer(undefined, grounded)
    r.setCursor({ x: 3, y: 3 })
    r.rebuildBillboards(scene())
    const holder = r.billboardGroup.children.find((c) => c.userData.kind === 'monster')!
    const shell = (holder.children as THREE.Mesh[]).find((m) => m.userData.shell)!
    const pos = shell.geometry.getAttribute('position') as THREE.BufferAttribute
    let y0 = Infinity
    for (let i = 0; i < pos.count; i++) y0 = Math.min(y0, pos.getY(i))
    // the holder stands on the cell, so the sprite's own frame puts the floor at -(mesh y)
    expect(y0 + shell.position.y).toBeGreaterThanOrEqual(-1e-6)
  })
  it('stays flat where the atlas pixels cannot be read', () => {
    const r = new Render3d() as unknown as Priv
    r.setTiles(tiles)
    r.rebuildBillboards(scene())
    expect((quads(r, 'monster')[0].geometry.getAttribute('position') as THREE.BufferAttribute).count).toBe(4)
  })
})
