import { describe, it, expect } from 'vitest'
import { crowdInstances } from '../src/sprites.js'
import { cellKey, emptyScene, type Billboard, type Scene, type TileRect } from '@orbrun/scene'

const RECT: TileRect = { atlas: 'main', sx: 0, sy: 0, w: 32, h: 32, ox: 0, oy: 0, cell: 32 }

function sceneWith(b: Partial<Billboard>): Scene {
  const s = emptyScene()
  s.playerOnLevel = true
  s.player = { x: 0, y: 0 }
  s.cells.set(cellKey(3, 3), { x: 3, y: 3, kind: 'floor', visibility: 'visible', occluder: false, floorTile: 0 })
  s.billboards = [{ x: 3, y: 3, tile: 1, kind: 'monster', height: 1, attitude: 'hostile', ...b } as Billboard]
  return s
}

const passes = (scene: Scene) => crowdInstances(scene, () => RECT, null).sprites.map((i) => i.pass)

/**
 * The ghost pass exists so the geometry never hides what the server reports.
 * A plant behind a wall reports nothing — drawing its ghost only puts foliage
 * through the masonry, which is the bug this pins.
 */
describe('scenery and the ghost pass', () => {
  it('gives a monster a ghost', () => {
    expect(passes(sceneWith({}))).toEqual(['opaque', 'ghostVisible'])
  })
  it('gives a plant no ghost, but keeps the sprite', () => {
    expect(passes(sceneWith({ scenery: true }))).toEqual(['opaque'])
  })
})
