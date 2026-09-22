import { describe, it, expect } from 'vitest'
import { WALL_INSET } from '../src/index.js'
import { LevelGrid } from '../src/grid.js'
import { LevelMesher, uvFor, type ChunkGeometry, type MeshContext } from '../src/level-mesh.js'
import { MODE_BILLBOARD, MODE_RING, MODE_THICK, fixtureInstances } from '../src/sprites.js'
import { cellKey, emptyScene, type Scene, type TileRect } from '@orbrun/scene'

const RECT: TileRect = { atlas: 'main', sx: 0, sy: 0, w: 32, h: 32, ox: 0, oy: 0, cell: 32 }
const tileOf = () => ({ r: RECT, atlas: 'main', uv: uvFor(RECT, 64, 64) })

function ctx(chamfer = 1 / 32): MeshContext {
  return { tileOf, fo: { inset: WALL_INSET }, chamfer }
}

/** Every chunk of the level, built whole. */
function level(scene: Scene, chamfer?: number): ChunkGeometry[] {
  const mesher = new LevelMesher(() => 0)
  mesher.update(new LevelGrid(scene), ctx(chamfer))
  return [...mesher.chunks.values()].flat()
}

/** The door's own instance, and whether the grid found it a wall run to hang in. */
function door(scene: Scene) {
  const grid = new LevelGrid(scene)
  const [inst] = fixtureInstances(scene, () => RECT, grid.framed, grid.occupied)
  return { inst, yaw: grid.framed.get(cellKey(1, 2)) }
}

/**
 * A corridor running `along` with an open door in the middle of it. 'x' walls
 * the door east and west, 'z' walls it north and south; 'none' opens every
 * side, so there is no wall run to read.
 */
function corridor(along: 'x' | 'z' | 'none'): Scene {
  const s = emptyScene()
  s.playerOnLevel = true
  s.player = { x: 1, y: 3 }
  s.bounds = { left: 0, top: 0, right: 2, bottom: 4 }
  for (let y = 0; y <= 4; y++) {
    for (let x = 0; x <= 2; x++) {
      const isDoor = x === 1 && y === 2
      const wall = !isDoor && (along === 'x' ? x !== 1 : along === 'z' ? y !== 2 : false)
      s.cells.set(cellKey(x, y), {
        x,
        y,
        kind: wall ? 'wall' : 'floor',
        visibility: 'visible',
        occluder: wall,
        floorTile: 0,
        wallTile: wall ? 1 : undefined,
        featureTile: isDoor ? 5 : undefined,
        stance: isDoor ? 'upright' : undefined,
        feature: isDoor ? { type: 'door', state: 'open' } : undefined,
      })
    }
  }
  return s
}

/** How far east the level's masonry reaches inside the door's row (world x), the door's own board aside. */
function jambReach(parts: ChunkGeometry[]): number {
  let max = 0
  for (const g of parts) {
    for (let i = 0; i < g.position.length; i += 3) {
      const x = g.position[i], y = g.position[i + 1], z = g.position[i + 2]
      // the masonry itself, not the floor patch that continues under what the inset removed
      if (y <= 1e-6 || x > 1 + 1e-6 || z < 2 - 1e-6 || z > 3 + 1e-6) continue
      max = Math.max(max, x)
    }
  }
  return max
}

describe('an open door', () => {
  /**
   * A door hangs in its doorway. A board that turned with the camera would
   * pull the leaves and their arch off the walls they are set into, so the
   * door stands squared to the wall run instead and never turns.
   */
  it('stands in the plane of the wall run it is set into', () => {
    const x = door(corridor('x'))
    expect(x.yaw).toBe(0)
    expect(x.inst.misc[0] & MODE_BILLBOARD).toBe(0)
    expect(x.inst.misc[3]).toBe(0)
    const z = door(corridor('z'))
    expect(z.yaw).toBeCloseTo(Math.PI / 2)
    expect(z.inst.misc[0] & MODE_BILLBOARD).toBe(0)
    expect(z.inst.misc[3]).toBeCloseTo(Math.PI / 2)
  })

  /** Full height, like the closed door's block, and in the wall plane rather than standing back from it. */
  it('fills its doorway', () => {
    const { inst } = door(corridor('x'))
    // the quad runs the whole cell, floor to lid, and its front is the wall's own plane
    expect(inst.quad[1] + inst.quad[3]).toBeCloseTo(1, 6)
    expect(inst.quad[1] - inst.quad[3]).toBeCloseTo(0, 6)
    expect(inst.z[0]).toBe(0)
    expect(inst.misc[0] & MODE_THICK).toBeTruthy()
  })

  /**
   * The wall run keeps its full thickness up to the doorway rather than
   * stepping back by the inset either side of it: a board one cell wide fills
   * an opening one cell wide, and the door meets the walls it hangs between.
   */
  it('is met by the wall run it hangs in', () => {
    expect(jambReach(level(corridor('x')))).toBeCloseTo(1, 5)
  })

  /**
   * The run's cut ends stand open to the doorway: the face of each flanking
   * wall on the door cell's boundary, which the footprint rule hides between
   * two walls (the door's cell counts as one), is drawn here from the floor
   * up, so that looking through the doorway at an angle meets masonry and
   * not the inside of the wall.
   */
  it('has a reveal either side, the full height of the wall', () => {
    // a wall run across a room, open on both sides, with the door at (2, 2): the flanking walls (1, 2) and (3, 2)
    // are inset north and south, so their faces on the door cell's boundary are wholly the reveals
    const s = emptyScene()
    s.playerOnLevel = true
    s.player = { x: 2, y: 3 }
    s.bounds = { left: 0, top: 0, right: 4, bottom: 4 }
    for (let y = 0; y <= 4; y++) {
      for (let x = 0; x <= 4; x++) {
        const isDoor = x === 2 && y === 2
        const wall = !isDoor && y === 2
        s.cells.set(cellKey(x, y), {
          x,
          y,
          kind: wall ? 'wall' : 'floor',
          visibility: 'visible',
          occluder: wall,
          floorTile: 0,
          wallTile: wall ? 1 : undefined,
          featureTile: isDoor ? 5 : undefined,
          stance: isDoor ? 'upright' : undefined,
          feature: isDoor ? { type: 'door', state: 'open' } : undefined,
        })
      }
    }
    const chamfer = 1 / 32
    // the standing triangles lying wholly in the plane of each jamb (world x = 2 to the west, x = 3 to the east);
    // the floor patch that continues under the inset is squeezed to nothing against a doorway and left out
    const jambs = { 2: { tris: 0, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity }, 3: { tris: 0, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity } }
    for (const g of level(s, chamfer)) {
      const at = (j: number, c: number) => g.position[j * 3 + c]
      for (let i = 0; i + 2 < g.index.length; i += 3) {
        const v = [g.index[i], g.index[i + 1], g.index[i + 2]]
        const xs = v.map((k) => at(k, 0))
        const j = jambs[Math.round(xs[0]) as 2 | 3]
        if (!j || xs.some((x) => Math.abs(x - Math.round(xs[0])) > 1e-6) || v.every((k) => at(k, 1) < 1e-6)) continue
        j.tris++
        for (const k of v) {
          j.y0 = Math.min(j.y0, at(k, 1)); j.y1 = Math.max(j.y1, at(k, 1))
          j.z0 = Math.min(j.z0, at(k, 2)); j.z1 = Math.max(j.z1, at(k, 2))
        }
      }
    }
    for (const j of Object.values(jambs)) {
      expect(j.tris).toBe(2)
      expect(j.y0).toBeCloseTo(0, 5)
      expect(j.y1).toBeCloseTo(1, 5)
      // the run's thickness, inset to inset, less the chamfer that turns each corner of the run into the doorway
      expect(j.z0).toBeCloseTo(2 + WALL_INSET + chamfer, 5)
      expect(j.z1).toBeCloseTo(3 - WALL_INSET - chamfer, 5)
    }
  })

  /** With no wall run to read, there is no plane to stand in: the board faces the eye as any fixture does. */
  it('faces the camera where there is no doorway', () => {
    const { inst, yaw } = door(corridor('none'))
    expect(yaw).toBeUndefined()
    expect(inst.misc[0] & MODE_BILLBOARD).toBeTruthy()
  })

  /**
   * Seen from every side and edge-on as the player walks through, a hull round
   * the door is a band, not a line: its back swings out from the board in
   * parallax and it pokes into the masonry either side. The door's ink is the
   * flat ring in the board's plane instead, which the shader draws off the
   * tile's edge columns — they stand in the masonry — and with no rim face on
   * the tile's boundary.
   */
  it('wears its ink as a flat ring in its plane, not a hull', () => {
    const { inst } = door(corridor('x'))
    expect(inst.misc[0] & MODE_RING).toBeTruthy()
    // no hull: the ring is the ink, and `grow` would be the hull's width
    expect(inst.misc[1]).toBe(0)
    // every other fixture wears the hull instead
    const plain = door(corridor('none'))
    expect(plain.inst.misc[0] & MODE_RING).toBe(0)
    expect(plain.inst.misc[1]).toBe(1)
  })
})
