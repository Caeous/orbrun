import { describe, it, expect } from 'vitest'
import { cellKey, emptyScene, type Scene, type SceneCell, type TileRect } from '@orbrun/scene'
import { bodyRect, inPoly, type ClassAt } from '../src/footprint.js'
import { faceTile, floorLayers, insetStrips, stripAt } from '../src/cells.js'
import { boardAlong, boardTexel, doorBoard, featureStance, framedDoors, occupiedFeatures } from '../src/doors.js'
import { CLOUD_ALPHA, FIXTURE_H, PROJECTILE_LIFT, STAIR_H, crowd, fixtures } from '../src/things.js'
import { cursorColour, ringCover } from '../src/marks.js'

const cell = (x: number, y: number, o: Partial<SceneCell> = {}): SceneCell => ({
  x,
  y,
  kind: 'floor',
  visibility: 'visible',
  occluder: false,
  floorTile: 1,
  flags: { water: false, lava: false, excluded: false, travelTrail: false, newStair: false, cursor: false, outOfRange: false, magicMapped: false },
  ...o,
})

const scene = (cells: SceneCell[]): Scene => {
  const s = emptyScene()
  for (const c of cells) s.cells.set(cellKey(c.x, c.y), c)
  return s
}

describe('the strips a wall leaves of its cell', () => {
  it('floor every point outside the body from the cell insetStrips lays there, as stripAt finds it', () => {
    // every pattern of the eight cells round a wall
    for (let pattern = 0; pattern < 256; pattern++) {
      const round: [number, number][] = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]
      const at: ClassAt = (x, z) => {
        const i = round.findIndex(([dx, dz]) => dx === x && dz === z)
        return i >= 0 && pattern & (1 << i) ? 'floor' : 'wall'
      }
      const b = bodyRect(at, 0, 0, { inset: 0.375 })
      if (!b) continue
      const open = [at(0, -1), at(0, 1), at(-1, 0), at(1, 0)].map((c) => c === 'floor') as [boolean, boolean, boolean, boolean]
      const strips = insetStrips(b, open)
      // off every edge: an edge's point is either side's
      for (let i = 0; i < 23; i++)
        for (let j = 0; j < 23; j++) {
          const lx = (i + 0.5) / 23, lz = (j + 0.5) / 23
          const inBody = lx >= b.x0 && lx < b.x1 && lz >= b.z0 && lz < b.z1 && !stripsHave(strips, lx, lz, true)
          const found = stripAt(b, lx, lz)
          const laid = strips.find((s) => inPoly(s.pts, lx, lz))
          if (inBody) expect(found).toBeNull()
          else expect(found && [found[0], found[1]]).toEqual(laid && [laid.dx, laid.dz])
        }
    }
  })
})

/** whether a cut corner's strip holds the point */
const stripsHave = (strips: { pts: [number, number][]; dx: number; dz: number }[], lx: number, lz: number, cuts: boolean) =>
  strips.some((s) => (!cuts || (s.dx !== 0 && s.dz !== 0)) && inPoly(s.pts, lx, lz))

describe("a cell's floor and faces", () => {
  it('leaves the wall shadows and shorelines off the floor, unless asked, and paints a feature only where it lies flat', () => {
    const c = cell(0, 0, { underlays: [2], overlays: [3, 4, 5], wallShadows: [4], shorelines: [5], featureTile: 6, icons: [10] })
    expect(floorLayers(c, 'floor')).toEqual({ under: [2], feature: 6, over: [3], marks: [10] })
    expect(floorLayers(c, 'upright', true)).toEqual({ under: [2], feature: undefined, over: [3, 4, 5], marks: [10] })
  })

  it("wears a face's own tile where crawl gives one, else the wall's", () => {
    const c = cell(0, 0, { occluder: true, wallTile: 7, faceTiles: { e: 8 } })
    expect(faceTile(c, 'e')).toBe(8)
    expect(faceTile(c, 'w')).toBe(7)
  })
})

describe('features and doors', () => {
  it('stands a feature, lays it down where something stands on it, and keeps a door in its doorway up', () => {
    const wall = (x: number, y: number) => cell(x, y, { kind: 'wall', occluder: true, wallTile: 1 })
    const s = scene([
      wall(-1, 0), wall(1, 0), cell(0, -1), cell(0, 1),
      cell(0, 0, { kind: 'door', feature: { type: 'door', state: 'open' }, featureTile: 3, stance: 'upright' }),
      cell(0, 2, { featureTile: 4, stance: 'upright' }),
      cell(1, 2, { featureTile: 4, stance: 'upright' }),
      cell(2, 2, { featureTile: 5, stance: 'lying' }),
      cell(3, 2, { featureTile: 5, stance: 'decal' }),
    ])
    s.billboards.push({ kind: 'monster', x: 1, y: 2, tile: 9, height: 1 } as Scene['billboards'][number], { kind: 'monster', x: 0, y: 0, tile: 9, height: 1 } as Scene['billboards'][number])
    const framed = framedDoors(s)
    const occupied = occupiedFeatures(s, framed)
    const at = (x: number, y: number) => featureStance(s.cells.get(cellKey(x, y))!, framed, occupied)
    expect([at(0, 0), at(0, 2), at(1, 2), at(2, 2), at(3, 2), at(-1, 0)]).toEqual(['framed', 'upright', 'floor', 'lying', 'floor', null])
  })

  it("stretches a door's board to the walls standing back either side, its art's left west, or south running north–south", () => {
    const art: TileRect = { atlas: 'a', sx: 0, sy: 0, w: 32, h: 32, ox: 0, oy: 0, cell: 32 }
    const east: TileRect = { ...art, sx: 32 }
    const tile = (id: number) => (id === 3 ? art : id === 4 ? east : undefined)
    const wall = (x: number, y: number) => cell(x, y, { kind: 'wall', occluder: true, wallTile: 1 })
    const door = (x: number, y: number, closed = false) => cell(x, y, { kind: 'door', occluder: closed, feature: { type: 'door', state: closed ? 'closed' : 'open' }, featureTile: 3, faceTiles: { e: 4 } })
    // a two-leaf gate east–west, and a door north–south
    const s = scene([wall(-1, 0), door(0, 0), door(1, 0, true), wall(2, 0), cell(0, -1), cell(1, -1), cell(0, 1), cell(1, 1), wall(5, -1), door(5, 0), wall(5, 1), cell(4, 0), cell(6, 0)])
    const framed = framedDoors(s)
    const board = (x: number, y: number) => doorBoard(s.cells.get(cellKey(x, y))!, framed, 0.375, tile)!
    const west = board(0, 0), shut = board(1, 0), ns = board(5, 0)
    expect([west.left, west.right, west.closed, west.native]).toEqual([12, 0, false, 12])
    expect([shut.left, shut.right, shut.closed, shut.native]).toEqual([0, 12, true, 8])
    expect(ns.yaw).toBe(Math.PI / 2)
    expect(ns.tile).toBe(4)
    expect(ns.art).toBe(east)
    // along the run from the art's left end: east for a run east–west, north for one north–south
    expect(boardAlong(west, 0.25, 0.5)).toBe(0.25)
    expect(boardAlong(ns, 0.5, 0.25)).toBe(0.75)
    // the board reaches 12 texels into the wall at its left; its 12 columns each end as they are, the middle stretched
    expect(boardTexel(west, -12 / 32)).toBe(0)
    expect(boardTexel(west, -13 / 32)).toBeNaN()
    expect(boardTexel(west, 0)).toBe(12)
    expect(boardTexel(west, 1 - 6 / 32)).toBeCloseTo(26)
    expect(boardTexel(west, 1)).toBeNaN()
    let last = -1
    for (let s = -12 / 32; s < 1; s += 1 / 64) {
      const tx = boardTexel(west, s)
      expect(tx).toBeGreaterThan(last)
      last = tx
    }
  })
})

describe('what stands', () => {
  const mon = (x: number, y: number, o: Partial<Scene['billboards'][number]> = {}) => ({ kind: 'monster', x, y, tile: 9, height: 1, ...o }) as Scene['billboards'][number]

  it('stands the billboards but the player and what shares its cell, a cloud bare, a missile lifted, what lies unshadowed', () => {
    const s = scene([cell(0, 0, { glyph: 'g', colour: 4 }), cell(1, 0), cell(2, 0), cell(3, 0), cell(4, 0)])
    s.playerOnLevel = true
    s.player = { x: 4, y: 0 }
    s.billboards.push(
      mon(0, 0, { ref: { id: 7, name: 'goblin' }, statusIcons: [{ tile: 20, ox: 1, oy: 2, at: 'top' }] }),
      { kind: 'cloud', x: 1, y: 0, tile: 11, height: 1 } as Scene['billboards'][number],
      { kind: 'projectile', x: 2, y: 0, tile: 12, height: 0.5 } as Scene['billboards'][number],
      { kind: 'item', x: 3, y: 0, tile: 13, height: 0.6, lying: true } as Scene['billboards'][number],
      mon(4, 0),
      { kind: 'player', x: 4, y: 0, tile: 1, height: 0.7 } as Scene['billboards'][number],
    )
    const [g, cloud, missile, corpse, ...rest] = crowd(s)
    expect(rest).toEqual([])
    expect(g).toMatchObject({ kind: 'monster', moverId: 7, name: 'goblin', glyph: 'g', colour: 4, ghost: true, shadow: 1 })
    expect(g.layers).toEqual([{ tile: 9, ox: 0, oy: 0 }, { tile: 20, ox: 1, oy: 2, badge: true, top: true }])
    expect(cloud).toMatchObject({ alpha: CLOUD_ALPHA, ghost: false })
    expect(cloud.shadow).toBeUndefined()
    expect(missile.lift).toBe(PROJECTILE_LIFT)
    expect(corpse.lie).toBe(true)
    expect(corpse.shadow).toBeUndefined()
  })

  it("stands the level's features by their stance, stairs lower", () => {
    const s = scene([cell(0, 0, { featureTile: 4, stance: 'upright', feature: { type: 'stairs', dir: 'down' } }), cell(1, 0, { featureTile: 5, stance: 'upright' }), cell(2, 0, { featureTile: 6, stance: 'decal' })])
    expect(fixtures(s, new Map(), new Set()).map((f) => [f.x, f.stance, f.height])).toEqual([[0, 'upright', STAIR_H], [1, 'upright', FIXTURE_H]])
  })
})

describe('the cursor', () => {
  it("covers the diamond band round the cell's middle, its colour by its mode", () => {
    expect(ringCover(0.5 + 0.4, 0.5, 1e-6)).toBeCloseTo(1)
    expect(ringCover(0.5 + 0.2, 0.5 + 0.2, 1e-6)).toBeCloseTo(1)
    expect(ringCover(0.5, 0.5, 1e-6)).toBe(0)
    expect(ringCover(0.5 + 0.3, 0.5 + 0.3, 1e-6)).toBe(0)
    // a pixel wider than the band still covers some of it
    expect(ringCover(0.5 + 0.4, 0.5, 0.5)).toBeGreaterThan(0)
    expect(cursorColour({ mode: 'map' })).toBe(0xffffff)
    expect(cursorColour({ mode: 'target' })).toBe(0xff8800)
  })
})
