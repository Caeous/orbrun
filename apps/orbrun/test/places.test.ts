// @vitest-environment happy-dom
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cellKey, emptyScene, type Scene } from '@orbrun/scene'
import { readScene, sceneTileIds, writeScene, type PlaceFile } from '../src/room/place-data'
import { nextHomePlace, placeCamera, PLACES } from '../src/room/places'
import { RoomTiles } from '../src/room/tiles'

const here = path.dirname(fileURLToPath(import.meta.url))
const dir = path.join(here, '../public/room/places')
const read = (id: string) => JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8')) as PlaceFile

/** Whether a sight line from x, y along `yaw` (0 north, clockwise) reaches the unknown before a wall stops it. */
function seesVoid(scene: Scene, x: number, y: number, yaw: number): boolean {
  for (let t = 0.25; t < 48; t += 0.25) {
    const c = scene.cells.get(cellKey(Math.round(x + Math.sin(yaw) * t), Math.round(y - Math.cos(yaw) * t)))
    if (!c || c.kind === 'unknown') return true
    if (c.occluder && c.wallStyle !== 'transparent') return false
  }
  return false
}

/** The places the menus stand in are build assets: each one listed is there, whole, and drawable from its own atlas. */
describe('the places', () => {
  it('each have their level and their tiles, and nothing else: no picture of a place ships', () => {
    for (const p of PLACES) for (const ext of ['json', 'png']) expect(fs.existsSync(path.join(dir, `${p.id}.${ext}`)), `${p.id}.${ext}`).toBe(true)
    expect(fs.readdirSync(dir).filter((f) => !/\.(json|png)$/.test(f))).toEqual([])
  })

  it('each hold every tile their level names', () => {
    for (const p of PLACES) {
      const file = read(p.id)
      expect(file.format).toBe(1)
      expect(file.id).toBe(p.id)
      const tiles = RoomTiles.fromPlace(file, undefined)
      const scene = readScene(file.scene)
      const missing = [...sceneTileIds(scene)].filter((id) => !tiles.tile(id))
      expect(missing, p.id).toEqual([])
      // the eye stands on the level, on a cell the player stood on
      expect(scene.cells.get(cellKey(file.eye.x, file.eye.y))?.occluder, p.id).toBe(false)
    }
  })

  it('keep nothing of whose game it was, and nothing but the dungeon: no monster, no item, no cloud; scenery stays', () => {
    for (const p of PLACES) {
      const file = read(p.id)
      expect(file.scene.billboards.every((b) => b.scenery && !('ref' in b)), p.id).toBe(true)
      expect(file.scene.cells.some((c) => c.icons || c.trail || c.cloud !== undefined), p.id).toBe(false)
    }
  })

  it('stand the eye clear of the walls, where it sees no void (an open level known only in part excepted)', () => {
    for (const p of PLACES) {
      const file = read(p.id)
      const scene = readScene(file.scene)
      const { x, y } = file.eye
      for (let oy = -1; oy <= 1; oy++)
        for (let ox = -1; ox <= 1; ox++) {
          const c = scene.cells.get(cellKey(x + ox, y + oy))
          expect(c && c.kind !== 'unknown' && !c.occluder, `${p.id}: ${x + ox},${y + oy} beside the eye`).toBe(true)
        }
      const voids = Array.from({ length: 180 }, (_, i) => seesVoid(scene, x, y, (i / 180) * Math.PI * 2)).filter(Boolean).length
      if (p.openLevel) expect(voids / 180, p.id).toBeLessThan(0.1)
      else expect(voids, `${p.id}: rays into the void`).toBe(0)
    }
  })

  it('give the front screen more than one to go round', () => {
    expect(PLACES.filter((p) => p.cycle).length).toBeGreaterThan(1)
    expect(new Set(PLACES.map((p) => p.id)).size).toBe(PLACES.length)
  })
})

describe('a place file', () => {
  it('reads back the scene it was written from', () => {
    const scene: Scene = emptyScene()
    const flags = { water: true, lava: false, excluded: false, travelTrail: false, newStair: false, cursor: false, outOfRange: false, magicMapped: false }
    scene.cells.set(cellKey(1, 2), { x: 1, y: 2, kind: 'floor', visibility: 'visible', occluder: false, floorTile: 5, overlays: [9], glyph: '.', label: 'water', flags })
    scene.cells.set(cellKey(0, 0), { x: 0, y: 0, kind: 'unknown', visibility: 'unseen', occluder: false, floorTile: 0, flags: { ...flags, water: false } })
    scene.billboards.push({ x: 1, y: 2, tile: 7, kind: 'monster', height: 1, name: 'rat', ref: { id: 3 } }, { x: 1, y: 2, tile: 8, kind: 'player', height: 1 })
    const back = readScene(JSON.parse(JSON.stringify(writeScene(scene))))
    expect([...back.cells.keys()]).toEqual([cellKey(1, 2)])
    expect(back.cells.get(cellKey(1, 2))).toEqual({ x: 1, y: 2, kind: 'floor', visibility: 'visible', occluder: false, floorTile: 5, overlays: [9], flags })
    expect(back.billboards).toEqual([{ x: 1, y: 2, tile: 7, kind: 'monster', height: 1, name: 'rat' }])
    expect([...sceneTileIds(back)].sort()).toEqual([5, 7, 9])
  })

  it('opens its eye where the place file stands it', () => {
    const c = placeCamera({ eye: { x: 4, y: -2, yaw: Math.PI / 2 } })
    expect(c).toMatchObject({ x: 4, y: -2, yaw: Math.PI / 2 })
  })
})

describe('the front screen', () => {
  // happy-dom's localStorage has no working methods
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) })
  })

  it('stands somewhere else each visit, round the cycle', () => {
    const cycle = PLACES.filter((p) => p.cycle).map((p) => p.id)
    const seen = cycle.map(() => nextHomePlace().id)
    expect(new Set(seen).size).toBe(cycle.length)
    expect(nextHomePlace().id).toBe(seen[0])
  })
})
