import { describe, it, expect } from 'vitest'
import { stubbed } from './bed.js'
import { cellKey, emptyScene, makeCamera, type Scene, type TileRect, type TileSource } from '@orbrun/scene'

const RECT: TileRect = { atlas: 'main', sx: 0, sy: 0, w: 32, h: 32, ox: 0, oy: 0, cell: 32 }
const tiles: TileSource = {
  tile: () => RECT,
  atlas: () => ({ width: 64, height: 64 }) as unknown as TexImageSource,
  atlasNames: () => ['main'],
}

/** A corridor running north and south, x = 1, with walls either side and an open door at (1, 3) set into the run. */
function corridor(player: { x: number; y: number }): Scene {
  const s = emptyScene()
  s.revision = s.layoutRevision = 1
  s.bounds = { left: 0, top: 0, right: 2, bottom: 6 }
  s.playerOnLevel = true
  s.player = player
  for (let y = 0; y <= 6; y++)
    for (let x = 0; x <= 2; x++) {
      const isDoor = x === 1 && y === 3
      const wall = x !== 1
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
  return s
}

/** The cell under the point (100, py) of a 200×100 view looking north, on the floor a few cells ahead. */
function pickAhead(player: { x: number; y: number }, py: number) {
  const bed = stubbed({}, tiles)
  bed.r.resize(200, 100, 1)
  bed.r.setCamera(makeCamera(player.x, player.y, 0))
  bed.r.setScene(corridor(player))
  bed.r.render()
  const key = bed.r.pick(100, py)
  bed.r.destroy()
  return key === null ? null : { x: (key & 1023) - 512, y: (key >> 10) - 512 }
}

/**
 * An open door in a wall run counts as wall for the masonry around it, but
 * the doorway is open: a click goes through it to the floor beyond, and from
 * the doorway itself the click finds the cells ahead, not the player's own.
 */
describe('picking through a doorway', () => {
  it('finds the floor beyond an open door', () => {
    const hit = pickAhead({ x: 1, y: 5 }, 55)
    expect(hit?.x).toBe(1)
    expect(hit!.y).toBeLessThan(3)
  })

  it('finds the floor ahead from inside the doorway', () => {
    const hit = pickAhead({ x: 1, y: 3 }, 75)
    expect(hit?.x).toBe(1)
    expect(hit!.y).toBeLessThan(3)
  })
})
