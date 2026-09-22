import { describe, it, expect } from 'vitest'
import { LevelGrid } from '../src/grid.js'
import { BB_DEPTH, FIXTURE_BACK, crowdInstances, fixtureInstances } from '../src/sprites.js'
import { cellKey, emptyScene, type Billboard, type Scene, type TileRect } from '@orbrun/scene'

const RECT: TileRect = { atlas: 'main', sx: 0, sy: 0, w: 32, h: 32, ox: 0, oy: 0, cell: 32 }

/** A 3x3 room, the middle row floor, an upright staircase on (2, 1) with `on` standing on it. */
function stairsUnder(on: Billboard[]): Scene {
  const s = emptyScene()
  s.playerOnLevel = true
  s.player = { x: 1, y: 1 }
  s.bounds = { left: 0, top: 0, right: 2, bottom: 2 }
  for (let y = 0; y <= 2; y++) {
    for (let x = 0; x <= 2; x++) {
      const floor = y === 1
      const stairs = floor && x === 2
      s.cells.set(cellKey(x, y), {
        x,
        y,
        kind: floor ? 'floor' : 'wall',
        visibility: 'visible',
        occluder: !floor,
        floorTile: 0,
        wallTile: floor ? undefined : 1,
        featureTile: stairs ? 5 : undefined,
        stance: stairs ? 'upright' : undefined,
      })
    }
  }
  s.billboards = on
  return s
}

function build(scene: Scene) {
  const grid = new LevelGrid(scene)
  return {
    fixtures: fixtureInstances(scene, () => RECT, grid.framed, grid.occupied),
    crowd: crowdInstances(scene, () => RECT, null).sprites,
  }
}

const monster: Billboard = { x: 2, y: 1, tile: 9, kind: 'monster', height: 1, attitude: 'hostile' }
const cloud: Billboard = { x: 2, y: 1, tile: 9, kind: 'cloud', height: 1 }

describe('an upright feature and what stands on it', () => {
  /**
   * A board and the monster on it stand at the same place and both face the
   * camera, so the steps and their black outline run right through the
   * monster whichever wins the depth test. The feature lies back down on the
   * floor instead, as it already does underfoot in first person.
   */
  it('lays the feature flat under a monster', () => {
    expect(build(stairsUnder([])).fixtures).toHaveLength(1)
    expect(build(stairsUnder([monster])).fixtures).toHaveLength(0)
    // and the cell knows it: the level's own mesh draws the feature as a decal on the floor instead
    expect([...new LevelGrid(stairsUnder([monster])).occupied]).toEqual([cellKey(2, 1)])
  })

  /**
   * A cloud drifts over a cell rather than standing on it, so the staircase
   * under it keeps standing — and stands back far enough that the whole of
   * the sprite in the cell reads in front of it.
   */
  it('stands a feature back from a cloud passing over it', () => {
    const { fixtures, crowd } = build(stairsUnder([cloud]))
    const [feature] = fixtures
    const [drift] = crowd
    expect(feature.anchor).toEqual(drift.anchor)
    // the sprite's block is BB_DEPTH texels of its own scale deep; the board clears all of it
    expect(feature.z[0]).toBe(-FIXTURE_BACK)
    expect(feature.z[0]).toBeLessThanOrEqual(drift.z[0] - BB_DEPTH * drift.misc[2])
  })
})
