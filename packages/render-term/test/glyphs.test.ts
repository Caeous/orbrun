import { describe, it, expect } from 'vitest'
import { RenderTerm } from '../src/index.js'
import { REST_PITCH, cellKey, emptyScene, type Billboard, type Camera, type Scene, type SceneCell, type TileRect, type TileSource } from '@orbrun/scene'

const RECT: TileRect = { atlas: 'main', sx: 0, sy: 0, w: 32, h: 32, ox: 0, oy: 0, cell: 32 }
const TILES: TileSource = { tile: () => RECT, atlas: () => undefined, atlasNames: () => ['main'] }
const PIXELS = { width: 32, height: 32, data: new Uint8Array(32 * 32 * 4).fill(200) }
/** 80x24 cells of octants: 2x4 dots a cell */
const W = 160
const H = 96
/** looking north from (0, 0), down a corridor three cells wide */
const CAM: Camera = { x: 0, y: 0, eyeX: 0, eyeY: 0, yaw: 0, pitch: REST_PITCH, facing: 0 }

/** The corridor, with `things` on it ([x, y, glyph]) and walls across it where `walls` says. */
function corridor(things: [number, number, string][], o: { walls?: [number, number][]; remembered?: boolean } = {}): Scene {
  const s = emptyScene()
  s.playerOnLevel = true
  const cell = (x: number, y: number, wall: boolean): SceneCell => ({ x, y, kind: wall ? 'wall' : 'floor', visibility: 'visible', occluder: wall, floorTile: 1, wallTile: 2 })
  for (let y = -40; y <= 1; y++)
    for (let x = -2; x <= 2; x++) {
      const wall = Math.abs(x) === 2 || !!o.walls?.some(([wx, wy]) => wx === x && wy === y)
      s.cells.set(cellKey(x, y), cell(x, y, wall))
    }
  s.bounds = { left: -2, top: -40, right: 2, bottom: 1 }
  s.billboards = things.map(([x, y, glyph]): Billboard => {
    const c = s.cells.get(cellKey(x, y))!
    c.glyph = glyph
    c.colour = 4
    if (o.remembered) c.visibility = 'remembered'
    return { x, y, tile: 3, kind: 'monster', height: 1 }
  })
  return s
}

function renderer(scene: Scene): RenderTerm {
  const r = new RenderTerm()
  r.setTiles(TILES, () => PIXELS)
  r.setScene(scene)
  return r
}

const draw = (r: RenderTerm, below: number) => r.render(CAM, W, H, new Uint8Array(W * H * 3), 1, below)

describe('glyphs', () => {
  it('names what is too small to make out, and leaves what is near to its art', () => {
    const glyphs = draw(renderer(corridor([[1, -3, 'g'], [0, -25, 'o']])), 8)
    expect(glyphs).toHaveLength(1)
    expect(glyphs[0]).toMatchObject({ char: 'o', colour: 4, dim: false, behind: false, selected: false })
    // it stands where its sprite does: in the middle, at the far end
    expect(Math.abs(glyphs[0].x - W / 2)).toBeLessThan(W * 0.05)
  })

  it('names nothing when not asked to', () => {
    expect(draw(renderer(corridor([[0, -25, 'o']])), 0)).toEqual([])
  })

  it('keeps a glyph until its sprite has grown past the edge by a margin, so it does not flicker', () => {
    const scene = corridor([[0, -12, 'o']])
    let edge = 1
    while (!draw(renderer(scene), edge).length) edge++
    const r = renderer(scene)
    expect(draw(r, edge)).toHaveLength(1)
    // a frame later, a little under the edge: still named, where a renderer that never named it would not
    expect(draw(r, edge - 1)).toHaveLength(1)
    expect(draw(renderer(scene), edge - 1)).toHaveLength(0)
  })

  it('marks the one the cursor is on', () => {
    const r = renderer(corridor([[0, -25, 'o']]))
    r.setCursor({ x: 0, y: -25, mode: 'examine' })
    expect(draw(r, 8)[0].selected).toBe(true)
  })

  it('dims what is remembered', () => {
    expect(draw(renderer(corridor([[0, -25, 'o']], { remembered: true })), 8)[0].dim).toBe(true)
  })

  it('shows what is in sight behind the level as a ghost, and nothing remembered there', () => {
    const walls: [number, number][] = [[-1, -15], [0, -15], [1, -15]]
    const seen = draw(renderer(corridor([[0, -25, 'o']], { walls })), 8)
    expect(seen).toHaveLength(1)
    expect(seen[0].behind).toBe(true)
    expect(draw(renderer(corridor([[0, -25, 'o']], { walls, remembered: true })), 8)).toHaveLength(0)
  })

  it('names nothing whose glyph is the ground', () => {
    expect(draw(renderer(corridor([[0, -25, '.']])), 8)).toHaveLength(0)
  })
})
