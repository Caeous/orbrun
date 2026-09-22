import { describe, it, expect } from 'vitest'
import { settle, stubbed, written, type Bed, type Guts } from './bed.js'
import { CLOUD_ALPHA, SEL_GROW } from '../src/sprites.js'
import { cellKey, emptyScene, makeCamera, type Scene, type TileRect, type TileSource } from '@orbrun/scene'

/**
 * What each kind of change costs. The level is kept across frames and rebuilt
 * only when its layout moves under it (level-mesh.ts); the crowd is a list of
 * instances worked out afresh for a new scene or a new cursor and written
 * whole into the batches. These pin which of the two a change reaches, by the
 * renderer's own work counters and by the instances it wrote: no timings, so
 * nothing here flakes.
 */
const RECT: TileRect = { atlas: 'main', sx: 4, sy: 8, w: 4, h: 4, ox: 0, oy: 0, cell: 32 }
const tiles: TileSource = {
  tile: () => RECT,
  atlas: () => ({ width: 16, height: 16 }) as unknown as TexImageSource,
  atlasNames: () => ['main'],
}

/** A 20x20 room, the player at (2, 2), monsters at (5, 5), (6, 5) and far off at (18, 18), an item at (5, 8). */
function room(): Scene {
  const s = emptyScene()
  s.revision = s.layoutRevision = 1
  s.bounds = { left: 0, top: 0, right: 19, bottom: 19 }
  s.playerOnLevel = true
  s.player = { x: 2, y: 2 }
  for (let y = 0; y < 20; y++)
    for (let x = 0; x < 20; x++) {
      const wall = x === 0 || y === 0 || x === 19 || y === 19
      s.cells.set(cellKey(x, y), { x, y, kind: wall ? 'wall' : 'floor', visibility: 'visible', occluder: wall, floorTile: 0, wallTile: wall ? 1 : undefined })
    }
  s.billboards = [
    { x: 5, y: 5, tile: 1, kind: 'monster', height: 1, attitude: 'hostile' },
    { x: 6, y: 5, tile: 1, kind: 'monster', height: 0.8, attitude: 'hostile' },
    { x: 18, y: 18, tile: 1, kind: 'monster', height: 1, attitude: 'hostile' },
    { x: 5, y: 8, tile: 1, kind: 'item', height: 0.6 },
  ]
  return s
}

const snapshot = (g: Guts) => ({ ...g.stats })
/** Every instance in every batch, by key: what the GPU holds after the frame. */
const buffers = (g: Guts) => [...g.batches.keys()].sort().map((k) => [k, written(g, k.split('|')[0], k.split('|')[1] as 'opaque')] as const)

/** One frame, and the frames after it the level's build is sliced over: the counters then stand still. */
function frame(bed: Bed, s: Scene) {
  bed.r.setScene(s)
  bed.r.render()
  settle(bed)
}

describe('the crowd across scenes', () => {
  it('leaves the level and the fixtures standing for a scene revision that carries the same billboards', () => {
    const bed = stubbed({}, tiles)
    const { r, g } = bed
    r.setCamera(makeCamera(2, 2))
    const s = room()
    frame(bed, s)
    expect(g.stats.levelChunkBuilds).toBeGreaterThan(0)
    const before = snapshot(g)
    const was = buffers(g)
    s.revision++
    frame(bed, s)
    s.revision++
    frame(bed, s)
    const after = snapshot(g)
    expect([after.levelBuilds, after.levelChunkBuilds, after.fixtureBuilds]).toEqual([before.levelBuilds, before.levelChunkBuilds, before.fixtureBuilds])
    // the crowd is worked out and written again, as every revision asks, and comes out the same picture
    expect(after.crowdSyncs).toBe(before.crowdSyncs + 2)
    expect(buffers(g)).toEqual(was)
  })

  it('rebuilds nothing when the player moves and relights the crowd', () => {
    const bed = stubbed({}, tiles)
    const { r, g } = bed
    r.setCamera(makeCamera(2, 2))
    const s = room()
    frame(bed, s)
    const before = snapshot(g)
    s.player = { x: 3, y: 3 }
    s.revision++
    frame(bed, s)
    const after = snapshot(g)
    // the level stands as it was: a step is not a layout change
    expect([after.levelBuilds, after.levelChunkBuilds, after.fixtureBuilds]).toEqual([before.levelBuilds, before.levelChunkBuilds, before.fixtureBuilds])
    // the light moved with the player: the shade field is what carries it
    expect(after.fieldUpdates).toBe(before.fieldUpdates + 1)
  })

  it('rebuilds the level only when the player steps onto or off a standing feature', () => {
    const bed = stubbed({}, tiles)
    const { r, g } = bed
    const s = room()
    // a staircase at (4, 2), standing
    const stairs = s.cells.get(cellKey(4, 2))!
    stairs.featureTile = 2
    stairs.stance = 'upright'
    r.setCamera(makeCamera(2, 2))
    frame(bed, s)
    const before = snapshot(g)
    // a step beside it: the level stands
    s.player = { x: 3, y: 2 }
    s.revision++
    frame(bed, s)
    expect(g.stats.levelBuilds).toBe(before.levelBuilds)
    // a step onto it: the staircase lies down under the camera, which is a new level
    s.player = { x: 4, y: 2 }
    s.revision++
    frame(bed, s)
    expect(g.stats.levelBuilds).toBe(before.levelBuilds + 1)
    expect(g.fixtures).toHaveLength(0)
    // and off again: it stands back up
    s.player = { x: 5, y: 2 }
    s.revision++
    frame(bed, s)
    expect(g.stats.levelBuilds).toBe(before.levelBuilds + 2)
    expect(g.fixtures).toHaveLength(1)
  })

  it('moves one sprite and leaves the rest of the crowd as it stood', () => {
    const bed = stubbed({}, tiles)
    const { r, g } = bed
    r.setCamera(makeCamera(2, 2))
    const s = room()
    frame(bed, s)
    const before = snapshot(g)
    const was = written(g, 'main', 'opaque')
    // the far monster steps
    s.billboards[2] = { ...s.billboards[2], x: 17 }
    s.revision++
    frame(bed, s)
    const now = written(g, 'main', 'opaque')
    expect(now).toHaveLength(was.length)
    const moved = now.filter((w, i) => JSON.stringify(w) !== JSON.stringify(was[i]))
    expect(moved).toHaveLength(1)
    expect(moved[0].anchor).toEqual([17.5, 0, 18.5])
    // and the level is untouched: a monster is not masonry
    expect(g.stats.levelChunkBuilds).toBe(before.levelChunkBuilds)
  })
})

describe('the fixtures across layouts', () => {
  /** The room with a statue at (8, 8) and a fountain at (12, 12), both standing. */
  function furnished(): Scene {
    const s = room()
    for (const [x, y] of [[8, 8], [12, 12]]) {
      const c = s.cells.get(cellKey(x, y))!
      c.featureTile = 3
      c.feature = { type: 'other', name: 'statue' }
      c.stance = 'upright'
    }
    return s
  }

  it('stands its fixtures with the level, and takes one down when the level no longer has it', () => {
    const bed = stubbed({}, tiles)
    const { r, g } = bed
    const s = furnished()
    r.setCamera(makeCamera(2, 2))
    frame(bed, s)
    expect(g.fixtures).toHaveLength(2)
    const before = snapshot(g)
    // a wall becomes floor: the level's chunks are built again, and the fixtures with them
    s.cells.get(cellKey(19, 10))!.kind = 'floor'
    s.cells.get(cellKey(19, 10))!.occluder = false
    s.revision++
    s.layoutRevision = s.revision
    frame(bed, s)
    expect(g.stats.levelBuilds).toBe(before.levelBuilds + 1)
    expect(g.stats.fixtureBuilds).toBe(before.fixtureBuilds + 1)
    expect(g.fixtures).toHaveLength(2)
    // the statue goes: its instance comes down, the fountain's stays
    const statue = s.cells.get(cellKey(8, 8))!
    statue.featureTile = undefined
    statue.feature = undefined
    statue.stance = undefined
    s.revision++
    s.layoutRevision = s.revision
    frame(bed, s)
    expect(g.fixtures).toHaveLength(1)
    expect(g.fixtures[0].cell).toEqual([12, 12])
    // and new tiles bring everything down, to be built from them
    r.setTiles(tiles)
    expect(g.fixtures).toHaveLength(0)
    expect(g.levelMeshes.size).toBe(0)
    frame(bed, s)
    expect(g.fixtures).toHaveLength(1)
  })
})

describe('the cursor and the crowd', () => {
  it('shells the sprite it stands on, and takes the shell down as it moves off', () => {
    const bed = stubbed({}, tiles)
    const { r, g } = bed
    r.setCamera(makeCamera(2, 2))
    const s = room()
    frame(bed, s)
    const grown = () => written(g, 'main', 'opaque').filter((w) => w.misc[1] === SEL_GROW)
    expect(grown()).toHaveLength(0)

    r.setCursor({ x: 5, y: 5, mode: 'target' })
    r.render()
    expect(grown()).toHaveLength(1)
    expect(grown()[0].anchor).toEqual([5.5, 0, 5.5])
    // onto the next sprite, then off both
    r.setCursor({ x: 6, y: 5, mode: 'target' })
    r.render()
    expect(grown()[0].anchor).toEqual([6.5, 0, 5.5])
    r.setCursor({ x: 7, y: 5, mode: 'target' })
    r.render()
    expect(grown()).toHaveLength(0)
    // the level never hears about any of it
    expect(g.stats.levelChunkBuilds).toBe(g.stats.levelChunkBuilds)
  })

  it('shells every sprite standing on the cell, the cloud over them aside', () => {
    const bed = stubbed({}, tiles)
    const { r, g } = bed
    const s = room()
    s.billboards.push({ x: 5, y: 5, tile: 1, kind: 'projectile', height: 0.5 })
    s.billboards.push({ x: 5, y: 5, tile: 1, kind: 'cloud', height: 0.9 })
    r.setCamera(makeCamera(2, 2))
    r.setCursor({ x: 5, y: 5, mode: 'target' })
    frame(bed, s)
    const shelled = written(g, 'main', 'opaque').filter((w) => w.misc[1] === SEL_GROW)
    expect(shelled).toHaveLength(2) // the monster and the projectile
    // a cloud is a wash over the cell, not a thing standing on it: it is never inked
    const [cloud] = written(g, 'main', 'blend')
    expect(cloud.color[3]).toBeCloseTo(CLOUD_ALPHA, 6)
    expect(cloud.misc[1]).toBe(0)
  })

  it('drops the crowd with the tiles, the map and the renderer', () => {
    const bed = stubbed({}, tiles)
    const { r, g } = bed
    const s = room()
    r.setCamera(makeCamera(2, 2))
    r.setCursor({ x: 5, y: 5, mode: 'target' })
    frame(bed, s)
    expect(g.crowd.length).toBeGreaterThan(0)
    // a new tileset: every batch was built from the old atlases
    r.setTiles(tiles)
    expect(g.batches.size).toBe(0)
    expect(g.atlases.size).toBe(0)
    g.atlas('main')!.peeled = true
    s.revision++
    frame(bed, s)
    expect(written(g, 'main', 'opaque').length).toBeGreaterThan(0)
    // the map is cleared: an empty scene stands nothing
    const empty = emptyScene()
    empty.revision = s.revision + 1
    frame(bed, empty)
    expect(g.crowd).toHaveLength(0)
    expect(written(g, 'main', 'opaque')).toHaveLength(0)
    expect(g.levelMeshes.size).toBe(0)
    // and destroy leaves nothing, twice over
    frame(bed, { ...s, revision: empty.revision + 1 })
    expect(g.crowd.length).toBeGreaterThan(0)
    r.destroy()
    expect(g.batches.size).toBe(0)
    expect(g.levelMeshes.size).toBe(0)
    r.destroy()
  })
})
