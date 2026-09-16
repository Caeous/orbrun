import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { Render3d } from '../src/index.js'
import { emptyScene, type Scene, type TileRect, type TileSource } from '@orbrun/scene'

/**
 * A block's rim is built one face per texel edge, each wearing its own
 * texel. Two neighbouring faces whose texels hold the same colour sample the
 * same thing, so they are built as one face (`rimTemplate`). Pinned: the same
 * edges covered, each once, every face wearing a texel of its own colour.
 */
const RECT: TileRect = { atlas: 'main', sx: 4, sy: 8, w: 6, h: 6, ox: 0, oy: 0, cell: 32 }
const tiles: TileSource = {
  tile: () => RECT,
  atlas: () => ({ width: 16, height: 16 }) as unknown as TexImageSource,
  atlasNames: () => ['main'],
}

type Priv = {
  setTiles(t: TileSource): void
  billboardGroup: THREE.Group
  syncBillboards(s: Scene): void
  atlas(name: string): { mask?: Uint8Array | null; texel?: (x: number, y: number) => number }
}

function scene(): Scene {
  const s = emptyScene()
  s.playerOnLevel = true
  s.player = { x: 0, y: 0 }
  s.billboards = [{ x: 3, y: 3, tile: 1, kind: 'monster', height: 1, attitude: 'hostile' }]
  return s
}

/** Every rim face as (edge, texel it wears): the edge is its plane and the texel span it covers. */
function edges(r: Priv): Map<string, string> {
  const h = r.billboardGroup.children.find((c) => c.userData.kind === 'monster')!
  const m = h.children.find((c) => (c as THREE.Mesh).geometry && !c.userData.shared && !c.userData.hull) as THREE.Mesh
  const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute
  const uv = m.geometry.getAttribute('uv') as THREE.BufferAttribute
  const k = 1 / 32, hw = (RECT.w / 32) / 2
  const out = new Map<string, string>()
  for (let f = 4; f < pos.count; f += 4) {
    const xs = [0, 1, 2, 3].map((i) => Math.round((pos.getX(f + i) + hw) / k))
    const ys = [0, 1, 2, 3].map((i) => Math.round((hw - pos.getY(f + i)) / k))
    const zs = [0, 1, 2, 3].map((i) => Math.round(pos.getZ(f + i) / k))
    const texel = `${Math.floor(uv.getX(f) * 16) - RECT.sx},${Math.floor(uv.getY(f) * 16) - RECT.sy}`
    const [x0, x1] = [Math.min(...xs), Math.max(...xs)], [y0, y1] = [Math.min(...ys), Math.max(...ys)]
    // a horizontal edge: one texel row's top or bottom; a vertical one: one column's side. z tells nothing here.
    void zs
    if (y0 === y1) for (let x = x0; x < x1; x++) out.set(`y${y0}:${x}`, texel)
    else for (let y = y0; y < y1; y++) out.set(`x${x0}:${y}`, texel)
  }
  return out
}

function build(colours?: (x: number, y: number) => number): { r: Priv; faces: number } {
  const r = new Render3d() as unknown as Priv
  r.setTiles(tiles)
  // a 4x4 body at (5..8, 9..12) with a notch out of its bottom-right corner
  const mask = new Uint8Array(16 * 16)
  for (let y = 9; y < 13; y++) for (let x = 5; x < 9; x++) if (!(x === 8 && y === 12)) mask[y * 16 + x] = 1
  r.atlas('main').mask = mask
  r.atlas('main').texel = colours
  r.syncBillboards(scene())
  const h = r.billboardGroup.children.find((c) => c.userData.kind === 'monster')!
  const m = h.children.find((c) => (c as THREE.Mesh).geometry && !c.userData.shared && !c.userData.hull) as THREE.Mesh
  return { r, faces: (m.geometry.getAttribute('position').count - 4) / 4 }
}

describe('rim faces of one colour', () => {
  it('keeps one face per texel where the colours cannot be read', () => {
    const { faces } = build()
    // the notched square's perimeter is 16 texel edges: a corner taken out swaps two edges for two
    expect(faces).toBe(16)
  })
  it('joins neighbouring faces of the same colour, covering the same edges with the same texels\' colours', () => {
    const per = build()
    // the top row is one colour, the rest a checkerboard: the top edge joins into one face, the others stay apart
    const colour = (x: number, y: number) => (y === 9 ? 0xff0000ff : ((x + y) & 1 ? 0x00ff00ff : 0x0000ffff))
    const merged = build(colour)
    expect(merged.faces).toBeLessThan(per.faces)
    expect(merged.faces).toBe(16 - 3)
    const a = edges(per.r), b = edges(merged.r)
    expect([...b.keys()].sort()).toEqual([...a.keys()].sort())
    for (const [edge, texel] of a) {
      const [x, y] = texel.split(',').map(Number)
      const [mx, my] = b.get(edge)!.split(',').map(Number)
      expect(colour(RECT.sx + mx, RECT.sy + my)).toBe(colour(RECT.sx + x, RECT.sy + y))
    }
  })
})
