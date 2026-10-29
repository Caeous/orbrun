import { describe, it, expect } from 'vitest'
import { RenderTerm, linearAtlas, type Pixels } from '../src/index.js'
import { REST_PITCH, cellKey, emptyScene, type Billboard, type Camera, type Scene, type SceneCell, type TileRect, type TileSource } from '@orbrun/scene'

const RECT: TileRect = { atlas: 'main', sx: 0, sy: 0, w: 32, h: 32, ox: 0, oy: 0, cell: 32 }
const TILES: TileSource = { tile: () => RECT, atlas: () => undefined, atlasNames: () => ['main'] }
/** a texture with something in it, so a band drawn wrong shows */
const PIXELS: Pixels = { width: 32, height: 32, data: Uint8Array.from({ length: 32 * 32 * 4 }, (_, i) => (i % 4 === 3 ? 255 : (i * 37) % 251)) }
const W = 160
const H = 96
/** looking north-east from (0, 0), across the corridor, so walls, floor and lid all slant */
const CAM: Camera = { x: 0, y: 0, eyeX: 0, eyeY: 0, yaw: 0.4, pitch: REST_PITCH, facing: 0 }

/** A corridor three cells wide with a monster down it. */
function corridor(): Scene {
  const s = emptyScene()
  s.playerOnLevel = true
  const cell = (x: number, y: number, wall: boolean): SceneCell => ({ x, y, kind: wall ? 'wall' : 'floor', visibility: 'visible', occluder: wall, floorTile: 1, wallTile: 2 })
  for (let y = -40; y <= 1; y++) for (let x = -2; x <= 2; x++) s.cells.set(cellKey(x, y), cell(x, y, Math.abs(x) === 2))
  s.bounds = { left: -2, top: -40, right: 2, bottom: 1 }
  const c = s.cells.get(cellKey(0, -25))!
  c.glyph = 'o'
  c.colour = 4
  s.billboards = [{ x: 0, y: -25, tile: 3, kind: 'monster', height: 1 } as Billboard]
  return s
}

function renderer(linear = false): RenderTerm {
  const r = new RenderTerm()
  const shared = linearAtlas(PIXELS)
  r.setTiles(TILES, () => PIXELS, linear ? () => shared : undefined)
  r.setScene(corridor())
  return r
}

describe('bands', () => {
  it('draws a frame band by band as it draws it whole, and names the same things', () => {
    const whole = new Uint8Array(W * H * 3)
    const named = renderer().render(CAM, W, H, whole, 2, 8)
    const banded = new Uint8Array(W * H * 3)
    const r = renderer()
    const bandNamed = [0, 13, 40, 41, 77, H].slice(1).flatMap((to, i, ends) => r.render(CAM, W, H, banded, 2, 8, [i ? ends[i - 1] : 0, to]))
    expect(Buffer.compare(Buffer.from(banded), Buffer.from(whole))).toBe(0)
    expect(bandNamed).toEqual(named)
  })

  it('leaves the rows outside its band as they were', () => {
    const out = new Uint8Array(W * H * 3).fill(7)
    renderer().render(CAM, W, H, out, 2, 0, [30, 50])
    expect(out.subarray(0, 30 * W * 3).every((v) => v === 7)).toBe(true)
    expect(out.subarray(50 * W * 3).every((v) => v === 7)).toBe(true)
  })

  it('draws from an atlas made in linear light already as from its pixels', () => {
    const a = new Uint8Array(W * H * 3), b = new Uint8Array(W * H * 3)
    renderer().render(CAM, W, H, a, 2)
    renderer(true).render(CAM, W, H, b, 2)
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0)
  })
})
