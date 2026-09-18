import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { RoomTiles, type RoomAtlasJson } from '../src/room/tiles'

const json = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/room/atlas.json'), 'utf8')) as RoomAtlasJson
const tiles = new RoomTiles(json, undefined)

/**
 * The room's one atlas packs floors beside sprites. The renderer peels the ink
 * off sprite art before drawing an atlas; in the game that never touches a
 * floor, which lives in an atlas of its own. So the room says which rects are
 * sprite art: what came from the game's feat, main and player atlases, and
 * none of what came from floor or wall.
 */
describe('the room atlas tells the renderer where its sprites are', () => {
  it('names every feature, item and monster and no floor or wall', () => {
    const rects = tiles.spriteRects('room')!
    const key = (r: { sx: number; sy: number }) => `${r.sx},${r.sy}`
    const named = new Set(rects.map(key))
    for (const t of Object.values(json.tiles)) {
      expect(named.has(key(t)), `${t.name} from ${t.from}`).toBe(t.from === 'feat' || t.from === 'main' || t.from === 'player')
    }
    expect(rects.length).toBeGreaterThan(0)
  })
  it('says nothing of an atlas it does not serve', () => {
    expect(tiles.spriteRects('floor')).toBeUndefined()
  })
})
