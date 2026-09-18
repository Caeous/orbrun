import { describe, it, expect } from 'vitest'
import * as GL from '@orbrun/gl'
import { Render3d } from '../src/index.js'
import { cellKey, emptyScene, type Scene, type Billboard, type TileRect, type TileSource } from '@orbrun/scene'

const RECT: TileRect = { atlas: 'main', sx: 0, sy: 0, w: 32, h: 32, ox: 0, oy: 0, cell: 32 }

const tiles: TileSource = {
  tile: () => RECT,
  atlas: () => ({ width: 64, height: 64 }) as unknown as TexImageSource,
  atlasNames: () => ['main'],
}

function sceneWith(b: Partial<Billboard>): Scene {
  const s = emptyScene()
  s.playerOnLevel = true
  s.player = { x: 0, y: 0 }
  s.cells.set(cellKey(3, 3), { x: 3, y: 3, kind: 'floor', visibility: 'visible', occluder: false, floorTile: 0 })
  s.billboards = [{ x: 3, y: 3, tile: 1, kind: 'monster', height: 1, attitude: 'hostile', ...b } as Billboard]
  return s
}

function kinds(scene: Scene): string[] {
  const r = new Render3d() as unknown as {
    setTiles(t: TileSource): void
    billboardGroup: GL.Group
    syncBillboards(s: Scene): void
  }
  r.setTiles(tiles)
  r.syncBillboards(scene)
  return r.billboardGroup.children.map((c) => c.userData.kind as string)
}

/**
 * The ghost pass exists so the geometry never hides what the server reports.
 * A plant behind a wall reports nothing — drawing its ghost only puts foliage
 * through the masonry, which is the bug this pins.
 */
describe('scenery and the ghost pass', () => {
  it('gives a monster a ghost', () => {
    expect(kinds(sceneWith({}))).toContain('ghost')
  })
  it('gives a plant no ghost, but keeps the sprite', () => {
    const k = kinds(sceneWith({ scenery: true }))
    expect(k).toContain('monster')
    expect(k).not.toContain('ghost')
  })
})
