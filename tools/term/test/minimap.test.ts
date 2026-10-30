import { describe, it, expect } from 'vitest'
import { cellKey, emptyScene, type Billboard, type Scene, type SceneCell, type TileRect, type TileSource } from '@orbrun/scene'
import { TermView } from '../game/view'

/** four tiles side by side, each its own colours */
const ATLAS = { width: 128, height: 32, rgba: Uint8Array.from({ length: 128 * 32 * 4 }, (_, i) => (i % 4 === 3 ? 255 : (i * 53) % 251)), close() {} }
const TILES: TileSource = {
  tile: (id) => ({ atlas: 'main', sx: (id % 4) * 32, sy: 0, w: 32, h: 32, ox: 0, oy: 0, cell: 32 }) as TileRect,
  atlas: () => ATLAS as never,
  atlasNames: () => ['main'],
}

function scene(): Scene {
  const s = emptyScene()
  s.playerOnLevel = true
  const cell = (x: number, y: number): SceneCell => ({ x, y, kind: x === 0 ? 'wall' : 'floor', visibility: y > 2 ? 'remembered' : 'visible', occluder: x === 0, floorTile: 1, wallTile: x === 0 ? 2 : undefined })
  for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) s.cells.set(cellKey(x, y), cell(x, y))
  s.billboards = [{ x: 3, y: 1, tile: 3, kind: 'monster', height: 1 } as Billboard]
  return s
}

function minimap(view: TermView, s: Scene): Uint8Array {
  view.setScene(s)
  return view.minimap(0, 0, 6, 6, 5)
}

describe('the minimap', () => {
  it('draws from the tiles it kept as it draws them anew, as cells change and monsters move', () => {
    const kept = new TermView(() => {}, { threads: 0 })
    kept.setTiles(TILES)
    const s = scene()
    minimap(kept, s)
    // a door opened, a monster stepped, a cell left behind
    s.cells.get(cellKey(1, 1))!.featureTile = 3
    s.billboards = [{ x: 4, y: 1, tile: 3, kind: 'monster', height: 1 } as Billboard]
    s.cells.get(cellKey(2, 2))!.visibility = 'remembered'
    const fresh = new TermView(() => {}, { threads: 0 })
    fresh.setTiles(TILES)
    expect(Buffer.compare(Buffer.from(minimap(kept, s)), Buffer.from(minimap(fresh, s)))).toBe(0)
    kept.close()
    fresh.close()
  })
})
