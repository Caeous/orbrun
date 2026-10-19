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

  /**
   * Full height, and flush with the wall run it hangs in: its front in the
   * run's face, a texel deep, as a slab would show its whole depth edge-on
   * from the doorway. The shader moves it to the other face for an eye on
   * that side.
   */
  it('fills its doorway', () => {
    const s = corridor('x')
    const grid = new LevelGrid(s)
    const [inst] = fixtureInstances(s, () => RECT, grid.framed, grid.occupied, undefined, WALL_INSET)
    // the quad runs floor to lid
    expect(inst.quad[1] + inst.quad[3]).toBeCloseTo(1, 6)
    expect(inst.quad[1] - inst.quad[3]).toBeCloseTo(0, 6)
    const run = 1 - 2 * WALL_INSET
    expect(inst.z[0]).toBeCloseTo(run / 2, 6)
    expect(inst.z[1]).toBeCloseTo(inst.misc[2], 6)
    expect(inst.misc[0] & MODE_RING).toBeTruthy()
    expect(inst.misc[0] & MODE_THICK).toBeTruthy()
  })

  /**
   * The walls either side keep the inset they have beside any opening: the
   * door stands free in the middle of the doorway. Reaching in to meet a
   * board one cell wide, they would narrow the opening below what crawl sees
   * through, and hide the cells beside the doorway's far side.
   */
  it('stands clear of the wall run it hangs in', () => {
    expect(jambReach(level(corridor('x')))).toBeCloseTo(1 - WALL_INSET, 5)
  })

  /**
   * The wall's corners beside the doorway stay square: the door stands flush
   * with the wall's face, and a chamfer there would open a texel between
   * them.
   */
  it('meets the walls beside it at square corners', () => {
    const t = WALL_INSET
    // a wall run across a room, open both sides, the door at (2, 2)
    const s = emptyScene()
    s.playerOnLevel = true
    s.player = { x: 2, y: 4 }
    s.bounds = { left: 0, top: 0, right: 4, bottom: 4 }
    for (let y = 0; y <= 4; y++)
      for (let x = 0; x <= 4; x++) {
        const isDoor = x === 2 && y === 2, wall = y === 2 && !isDoor
        s.cells.set(cellKey(x, y), {
          x, y,
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
    // the west jamb's corners on the doorway's side, at its north and south faces
    const corners = [[2 - t, 2 + t], [2 - t, 3 - t]]
    const found = corners.map(() => false)
    for (const g of level(s, 1 / 32))
      for (let i = 0; i < g.position.length; i += 3)
        corners.forEach(([cx, cz], j) => {
          if (Math.abs(g.position[i] - cx) < 1e-6 && Math.abs(g.position[i + 2] - cz) < 1e-6 && g.position[i + 1] > 0.5) found[j] = true
        })
    expect(found).toEqual([true, true])
  })

  /**
   * What crawl sees through a doorway, the 3D view sees: from two cells back
   * down a corridor, the room's cells beside the doorway's far side are in
   * line of sight, and no masonry stands between the eye and them.
   */
  it('lets the eye see the room cells beside the doorway', () => {
    //  #####    the room's row (y = 1), the door at (2, 2) in its south wall
    //  #...#
    //  ##'##
    //   #.#     the corridor; the eye two cells back, at (2, 4)
    //   #.#
    const rows = ['#####', '#...#', "##'##", ' #.# ', ' #.# ', ' ### ']
    const s = emptyScene()
    s.playerOnLevel = true
    s.player = { x: 2, y: 4 }
    s.bounds = { left: 0, top: 0, right: 4, bottom: 5 }
    rows.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (ch === ' ') return
        const wall = ch === '#', isDoor = ch === "'"
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
      }),
    )
    const grid = new LevelGrid(s)
    const fo = { inset: WALL_INSET }
    const blocked = (tx: number, tz: number) => {
      const ex = 2.5, ez = 4.5
      for (let i = 1; i < 1000; i++) {
        const u = i / 1000
        const px = ex + (tx - ex) * u, pz = ez + (tz - ez) * u
        const cx = Math.floor(px), cz = Math.floor(pz)
        if (!grid.isSolid(cx, cz)) continue
        const r = grid.footprintAt(cx, cz, fo, new Map()).rect
        if (r && px - cx > r.x0 && px - cx < r.x1 && pz - cz > r.z0 && pz - cz < r.z1) return true
      }
      return false
    }
    // the middles of the room cells either side of the doorway's far side
    expect(blocked(1.5, 1.5)).toBe(false)
    expect(blocked(3.5, 1.5)).toBe(false)
  })

  /**
   * Two doorways turning a corner share one wall cell between them, and it
   * stands back from both: nothing of it reaches into the corner between the
   * doors.
   */
  it('leaves the corner between two doorways open', () => {
    // the corner wall at (2, 1), a door west of it at (1, 1) and one south of it at (2, 2), the player at (1, 2)
    const s = emptyScene()
    s.playerOnLevel = true
    s.player = { x: 1, y: 2 }
    s.bounds = { left: 0, top: 0, right: 3, bottom: 3 }
    const walls = new Set([cellKey(0, 1), cellKey(2, 1), cellKey(2, 3), cellKey(2, 0), cellKey(3, 1)])
    const doors = new Set([cellKey(1, 1), cellKey(2, 2)])
    for (let y = 0; y <= 3; y++) {
      for (let x = 0; x <= 3; x++) {
        const k = cellKey(x, y)
        const wall = walls.has(k), isDoor = doors.has(k)
        s.cells.set(k, {
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
    const grid = new LevelGrid(s)
    expect(grid.framed.size).toBe(2)
    // the corner cell's south-west inset square, beside both doorways: no masonry stands inside it
    const t = WALL_INSET
    for (const g of level(s)) {
      for (let i = 0; i < g.position.length; i += 3) {
        const x = g.position[i], y = g.position[i + 1], z = g.position[i + 2]
        if (y <= 1e-6) continue
        expect(x > 2 + 1e-6 && x < 2 + t - 1e-6 && z > 2 - t + 1e-6 && z < 3 - 1e-6).toBe(false)
      }
    }
  })

  /**
   * The leaves of a double door or a gate stand side by side, each with the
   * other beside it rather than a wall. They are one opening in one wall run,
   * and every leaf stands squared to it.
   */
  it('stands in its wall run beside the other leaves of a gate', () => {
    for (const leaves of [2, 3]) {
      for (const along of ['x', 'z'] as const) {
        // a wall run across a room, open on both sides, with the leaves in a row from (2, 2)
        const s = emptyScene()
        s.playerOnLevel = true
        s.bounds = { left: 0, top: 0, right: 6, bottom: 6 }
        const doors = new Set<number>()
        for (let i = 0; i < leaves; i++) doors.add(along === 'x' ? cellKey(2 + i, 2) : cellKey(2, 2 + i))
        s.player = along === 'x' ? { x: 2, y: 4 } : { x: 4, y: 2 }
        for (let y = 0; y <= 6; y++) {
          for (let x = 0; x <= 6; x++) {
            const k = cellKey(x, y)
            const isDoor = doors.has(k)
            const wall = !isDoor && (along === 'x' ? y === 2 : x === 2)
            s.cells.set(k, {
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
        const grid = new LevelGrid(s)
        expect(grid.framed.size).toBe(leaves)
        for (const k of doors) expect(grid.framed.get(k)).toBeCloseTo(along === 'x' ? 0 : Math.PI / 2)
        const insts = fixtureInstances(s, () => RECT, grid.framed, grid.occupied)
        expect(insts).toHaveLength(leaves)
        for (const inst of insts) expect(inst.misc[0] & MODE_BILLBOARD).toBe(0)
      }
    }
  })

  /**
   * A door with walls either side of it stands in their run, whatever doors
   * are in line with it: the walls beside a door outrank the run read past
   * other doors. Here a row of doors meets one in a north–south corridor end
   * on, and runs on into the unknown either side.
   */
  it('keeps to the walls beside it before reading past other doors', () => {
    // #.#
    // #'#    the corridor's door, walled east and west
    // '''    the row; its ends walled north and south, its middle open north and south
    // #.#
    const rows = ['#.#', "#'#", "'''", '#.#']
    const s = emptyScene()
    s.playerOnLevel = true
    s.player = { x: 1, y: 3 }
    s.bounds = { left: 0, top: 0, right: 2, bottom: 3 }
    rows.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        const wall = ch === '#', isDoor = ch === "'"
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
      }),
    )
    const grid = new LevelGrid(s)
    expect(grid.framed.get(cellKey(1, 1))).toBe(0)
    expect(grid.framed.get(cellKey(0, 2))).toBeCloseTo(Math.PI / 2)
    expect(grid.framed.get(cellKey(2, 2))).toBeCloseTo(Math.PI / 2)
    // the middle of the row has a door north and floor south, and reads past its neighbours to the row's ends
    expect(grid.framed.get(cellKey(1, 2))).toBe(0)
  })

  /**
   * Someone in the doorway stands in its open middle, between the jambs, so
   * the door stays up rather than lying down under every monster that walks
   * through, or under the player.
   */
  it('stays standing with a monster or the player in the doorway', () => {
    const s = corridor('x')
    s.billboards.push({ x: 1, y: 2, tile: 9, kind: 'monster', height: 1 })
    let grid = new LevelGrid(s)
    expect(grid.occupied.has(cellKey(1, 2))).toBe(false)
    expect(fixtureInstances(s, () => RECT, grid.framed, grid.occupied)).toHaveLength(1)
    s.player = { x: 1, y: 2 }
    grid = new LevelGrid(s)
    expect(grid.occupied.has(cellKey(1, 2))).toBe(false)
    expect(fixtureInstances(s, () => RECT, grid.framed, grid.occupied)).toHaveLength(1)
  })

  /**
   * crawl draws a gate running north–south from above; standing in its
   * doorway a leaf wears the horizontal piece of its east face instead, the
   * side its board reads the right way round from.
   */
  it('wears the east face of a gate running north–south', () => {
    const s = corridor('z')
    const cell = s.cells.get(cellKey(1, 2))!
    cell.faceTiles = { w: 6, e: 7 }
    const east: TileRect = { ...RECT, sx: 32 }
    const grid = new LevelGrid(s)
    const [inst] = fixtureInstances(s, (id) => (id === 7 ? east : RECT), grid.framed, grid.occupied)
    expect(inst.texel[0]).toBe(32)
    // an east–west run shows the feature itself, as crawl draws it
    const x = corridor('x')
    x.cells.get(cellKey(1, 2))!.faceTiles = { n: 7 }
    const gx = new LevelGrid(x)
    expect(fixtureInstances(x, (id) => (id === 7 ? east : RECT), gx.framed, gx.occupied)[0].texel[0]).toBe(0)
  })

  /**
   * An open door is one board stretched to the walls either side, which
   * stand the inset back from the doorway as from any opening: it reaches
   * the inset out past the cell's edges, as many texels wider than its art.
   * In a gate only the ends reach; an end facing the next door of the gate
   * stays at the cell's edge.
   */
  it('stretches to the jambs, the ends of a gate only', () => {
    const t = WALL_INSET
    // a board's left and right edges in cells from the cell's middle, and how many texels wider than its art it is
    const edges = (i: { quad: number[]; texel: number[]; misc: number[] }) => [i.quad[0] - i.quad[2], i.quad[0] + i.quad[2], 2 * i.quad[2] / i.misc[2] - i.texel[2]].map((v) => +v.toFixed(6))
    const one = corridor('x')
    const g1 = new LevelGrid(one)
    expect(fixtureInstances(one, () => RECT, g1.framed, g1.occupied, undefined, t).map(edges)).toEqual([[-0.5 - t, 0.5 + t, 2 * t * 32]])
    // a gate of three across a room, from (2, 2): the west end reaches west, the east end east, the middle neither
    const s = emptyScene()
    s.playerOnLevel = true
    s.player = { x: 3, y: 4 }
    s.bounds = { left: 0, top: 0, right: 6, bottom: 4 }
    for (let y = 0; y <= 4; y++)
      for (let x = 0; x <= 6; x++) {
        const isDoor = y === 2 && x >= 2 && x <= 4
        const wall = y === 2 && !isDoor
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
    const g3 = new LevelGrid(s)
    const byX = new Map(fixtureInstances(s, () => RECT, g3.framed, g3.occupied, undefined, t).map((i) => [i.x, edges(i)]))
    expect(byX.get(2)).toEqual([-0.5 - t, 0.5, t * 32])
    expect(byX.get(3)).toEqual([-0.5, 0.5, 0])
    expect(byX.get(4)).toEqual([-0.5, 0.5 + t, t * 32])
  })

  /**
   * Closed, a door in its wall run is the same board in the same opening:
   * the walls either side stand the inset back as they do from an open one,
   * and the board is stretched to meet them.
   */
  it('is the same stretched board when closed', () => {
    const t = WALL_INSET
    const s = corridor('x')
    const c = s.cells.get(cellKey(1, 2))!
    Object.assign(c, { kind: 'door', occluder: true, wallTile: 5, feature: { type: 'door', state: 'closed' } })
    const grid = new LevelGrid(s)
    expect(grid.framed.get(cellKey(1, 2))).toBe(0)
    expect(grid.isSolid(1, 2)).toBe(false)
    expect(jambReach(level(s))).toBeCloseTo(1 - t, 5)
    const insts = fixtureInstances(s, () => RECT, grid.framed, grid.occupied, undefined, t)
    expect(insts).toHaveLength(1)
    expect(insts[0].quad[0] - insts[0].quad[2]).toBeCloseTo(-0.5 - t, 6)
    expect(insts[0].quad[0] + insts[0].quad[2]).toBeCloseTo(0.5 + t, 6)
    // a block from one face of the run to the other
    expect(insts[0].z[0]).toBeCloseTo((1 - 2 * t) / 2, 6)
    expect(insts[0].z[1]).toBeCloseTo(1 - 2 * t, 6)
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
    // no hull: the ring is the ink, and where `grow` would be the hull's width is the columns its stretch keeps
    expect(inst.misc[1]).toBe(12)
    // every other fixture wears the hull instead
    const plain = door(corridor('none'))
    expect(plain.inst.misc[0] & MODE_RING).toBe(0)
    expect(plain.inst.misc[1]).toBe(1)
  })
})
