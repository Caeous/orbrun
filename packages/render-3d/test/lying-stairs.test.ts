import { describe, it, expect } from 'vitest'
import { WALL_INSET } from '../src/index.js'
import { LevelGrid } from '../src/grid.js'
import { LevelMesher, uvFor } from '../src/level-mesh.js'
import { BB_DEPTH, LIE_LIFT, MODE_BILLBOARD, MODE_LIE, MODE_RING, MODE_THICK, fixtureInstances } from '../src/sprites.js'
import { cellKey, emptyScene, type Scene, type TileRect } from '@orbrun/scene'

const RECT: TileRect = { atlas: 'main', sx: 0, sy: 0, w: 32, h: 32, ox: 0, oy: 0, cell: 32 }

/** A 5x5 room walled round, with a down staircase lying at (2, 2). */
function room(): Scene {
  const s = emptyScene()
  s.bounds = { left: 0, top: 0, right: 4, bottom: 4 }
  for (let y = 0; y <= 4; y++) {
    for (let x = 0; x <= 4; x++) {
      const solid = x === 0 || y === 0 || x === 4 || y === 4
      const stairs = x === 2 && y === 2
      s.cells.set(cellKey(x, y), {
        x,
        y,
        kind: solid ? 'wall' : 'floor',
        visibility: 'visible',
        occluder: solid,
        floorTile: 0,
        wallTile: solid ? 1 : undefined,
        featureTile: stairs ? 5 : undefined,
        feature: stairs ? { type: 'stairs', dir: 'down' } : undefined,
        stance: stairs ? 'lying' : undefined,
      })
    }
  }
  return s
}

describe('a way down lies in the floor', () => {
  it('as a block with its ink, like a corpse, fixed to the level', () => {
    const s = room()
    // something standing on it leaves it lying
    s.player = { x: 2, y: 2 }
    s.playerOnLevel = true
    const grid = new LevelGrid(s)
    const [stairs] = fixtureInstances(s, () => RECT, grid.framed, grid.occupied)
    const mode = stairs.misc[0]
    expect(mode & MODE_LIE).toBeTruthy()
    expect(mode & MODE_THICK).toBeTruthy()
    expect(mode & (MODE_BILLBOARD | MODE_RING)).toBe(0)
    expect(stairs.misc[1]).toBe(1) // the hull
    expect(stairs.misc[3]).toBe(0) // its top to the north, as the floor paints it
  })

  it('wears its new-stairs star on top, not under it', () => {
    const s = room()
    s.cells.get(cellKey(2, 2))!.icons = [7]
    const mesher = new LevelMesher(() => 0)
    mesher.update(new LevelGrid(s), { tileOf: () => ({ r: RECT, atlas: 'main', uv: uvFor(RECT, 64, 64) }), fo: { inset: WALL_INSET }, chamfer: 1 / 32 })
    const marks = [...mesher.chunks.values()].flat().filter((g) => g.kind === 'marks')
    expect(marks.length).toBe(1)
    const p = marks[0].position
    for (let i = 1; i < p.length; i += 3) expect(p[i]).toBeGreaterThan(LIE_LIFT + BB_DEPTH / 32)
  })
})
