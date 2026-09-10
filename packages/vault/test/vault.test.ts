import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadGamedata, type Gamedata } from '@orbrun/gamedata'
import { cellKey, getCell, isWalkable } from '@orbrun/scene'
import { DesError, DIRECTIVES, parseDes, vaultCamera, vaultScene, vaultTileNames, variantAt, type TileNames } from '../src/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..', '..', '..')
const VERSION = 'acd3d60e20f899c1c8a546953d6ffa0f6c7fe0c8'
const gdRoot = join(ROOT, 'packages', 'scene-webtiles', 'test', 'fixtures', 'gamedata')

async function fixtureGamedata(): Promise<Gamedata> {
  return loadGamedata({
    base: 'f://x',
    version: VERSION,
    skipImages: true,
    io: {
      async fetchText(url) {
        return readFileSync(join(gdRoot, VERSION, url.split('/').pop()!), 'utf8')
      },
      async loadImage() {
        throw new Error('no images in tests')
      },
    },
  })
}

/** the tile set a Gamedata gives a vault: names across every module, and the variant count */
function namesOf(gd: Gamedata): TileNames {
  return {
    id: (n) => gd.dngn.id(n) ?? gd.main.id(n) ?? gd.player.id(n),
    tileCount: (id) => gd.tileCount(id),
  }
}

const ROOM = readFileSync(join(ROOT, 'apps', 'orbrun', 'src', 'room', 'antechamber.des'), 'utf8')

const SMALL = `
NAME: small
TILE: # = wall_brick_dark
FTILE: . = floor_grey_dirt
KFEAT: > = dngn_stone_stairs_down
KFEAT: + = dngn_closed_door
KITEM: $ = gold05
KMONS: P = mons_plant
EYE: @ S
MAP
#######
#..>..#
#.@.P.#
#..$..#
###+###
#.....#
#######
ENDMAP
`

describe('parseDes: the supported subset', () => {
  it('reads the map, the legend, the eye and its heading', () => {
    const v = parseDes(SMALL)
    expect(v.name).toBe('small')
    expect(v.width).toBe(7)
    expect(v.height).toBe(7)
    expect(v.eye).toEqual({ x: 2, y: 2, facing: 4 })
    expect(v.light).toEqual({ x: 2, y: 2 })
    expect(vaultTileNames(v)).toEqual(['WALL_BRICK_DARK', 'FLOOR_GREY_DIRT', 'DNGN_STONE_STAIRS_DOWN', 'DNGN_CLOSED_DOOR', 'GOLD05', 'MONS_PLANT'])
  })

  it('pads short rows with void and drops blank rows around the map', () => {
    const v = parseDes('FTILE: . = floor_grey_dirt\nTILE: # = wall_brick_dark\nEYE: @\nMAP\n\n###\n#@#\n#####\n###\n\nENDMAP\n')
    expect(v.map).toEqual(['###  ', '#@#  ', '#####', '###  '])
  })

  it('refuses every directive outside the subset, naming the line', () => {
    expect(() => parseDes('NAME: x\nSUBST: . = .:9 ,\nMAP\n@\nENDMAP\n')).toThrow(/line 2: SUBST is not in the supported subset/)
    expect(() => parseDes('TAGS: no_monster_gen\n')).toThrow(/line 1: TAGS/)
    expect(() => parseDes('MARKER: > = lua:foo\n')).toThrow(/line 1: MARKER/)
    expect(() => parseDes('nonsense here\n')).toThrow(/line 1: not a directive/)
    expect(DIRECTIVES).toEqual(['NAME', 'TILE', 'FTILE', 'KFEAT', 'KITEM', 'KMONS', 'EYE', 'LIGHT', 'MAP', 'ENDMAP'])
  })

  it('names the line of every mistake in the map or the legend', () => {
    const base = 'TILE: # = wall_brick_dark\nFTILE: . = floor_grey_dirt\nEYE: @\n'
    expect(() => parseDes(base + 'MAP\n###\n#@#\n###\n')).toThrow(/line 4: MAP without ENDMAP/)
    expect(() => parseDes(base + 'MAP\n###\n#x#\n###\nENDMAP\n')).toThrow(/line 6: "x" at 1,1 of the map has no legend entry/)
    // a glyph with only a floor tile is open floor of that tile
    const pool = parseDes(base + 'FTILE: w = dngn_deep_water\nMAP\n####\n#@w#\n####\nENDMAP\n')
    expect(pool.map[1]).toBe('#@w#')
    expect(pool.legend.find((e) => e.glyph === 'w')).toMatchObject({ kind: 'floor', tile: 'DNGN_DEEP_WATER' })
    expect(() => parseDes(base + 'MAP\n#####\n#@.@#\n#####\nENDMAP\n')).toThrow(/a second "@" \(the eye\)/)
    expect(() => parseDes(base + 'MAP\n###\n#.#\n###\nENDMAP\n')).toThrow(/the eye's glyph "@" is not on the map/)
    expect(() => parseDes('TILE: # = wall_brick_dark\nEYE: @\nMAP\n###\n#@#\n###\nENDMAP\n')).toThrow(/no floor: add "FTILE: \. = <tile>"/)
    expect(() => parseDes(base + 'TILE: # = wall_stone_dark\nMAP\n#@#\nENDMAP\n')).toThrow(/line 4: "#" is already defined on line 1/)
    expect(() => parseDes(base + 'KFEAT: @ = dngn_stone_stairs_down\nMAP\n###\n#@#\n###\nENDMAP\n')).toThrow(/"@" is the eye and cannot also be a feat/)
    expect(() => parseDes(base + 'EYE: x\n')).toThrow(/line 4: a second EYE/)
    expect(() => parseDes('EYE: @ UP\n')).toThrow(/heading UP is not one of/)
    expect(() => parseDes('KFEAT: > dngn_stone_stairs_down\n')).toThrow(/KFEAT reads "KFEAT: <glyph> = <tile>"/)
    expect(() => parseDes('KFEAT: > = not a name\n')).toThrow(/KFEAT reads/)
  })

  it('is an error type with the line on it', () => {
    try {
      parseDes('WEIGHT: 5\n')
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(DesError)
      expect((e as DesError).line).toBe(1)
    }
  })
})

describe('vaultScene: the vault as a Scene', () => {
  it('builds walls, features, doors, items and monsters from the tile set, seen and lit once', async () => {
    const gd = await fixtureGamedata()
    const v = parseDes(SMALL)
    const s = vaultScene(v, namesOf(gd))
    expect(s.bounds).toEqual({ left: 0, top: 0, right: 6, bottom: 6 })
    expect(s.cells.size).toBe(49)
    const wall = getCell(s, 0, 0)!
    expect(wall.kind).toBe('wall')
    expect(wall.occluder).toBe(true)
    expect(gd.dngn.baseName(wall.wallTile!)).toMatch(/^WALL_BRICK_DARK/)
    expect(wall.wallStyle).toBe('solid')
    const floor = getCell(s, 1, 1)!
    expect(floor.kind).toBe('floor')
    expect(isWalkable(floor)).toBe(true)
    expect(floor.visibility).toBe('visible')
    expect(gd.dngn.baseName(floor.floorTile)).toMatch(/^FLOOR_GREY_DIRT/)
    const stairs = getCell(s, 3, 1)!
    expect(stairs.kind).toBe('feature')
    expect(stairs.feature).toEqual({ type: 'stairs', dir: 'down' })
    expect(stairs.stance).toBe('upright')
    expect(stairs.beacon).toBe('down')
    expect(stairs.featureTile).toBe(gd.dngn.id('DNGN_STONE_STAIRS_DOWN'))
    const door = getCell(s, 3, 4)!
    expect(door.kind).toBe('door')
    expect(door.occluder).toBe(true)
    expect(door.feature).toEqual({ type: 'door', state: 'closed' })
    expect(s.billboards).toHaveLength(2)
    const plant = s.billboards.find((b) => b.kind === 'monster')!
    expect(plant).toMatchObject({ x: 4, y: 2, scenery: true, attitude: 'hostile', height: 0.95, name: 'plant' })
    expect(gd.player.baseName(plant.tile)).toMatch(/^MONS_PLANT/)
    const gold = s.billboards.find((b) => b.kind === 'item')!
    expect(gold).toMatchObject({ x: 3, y: 3, height: 0.4, tile: gd.main.id('GOLD05') })
    expect(s.player).toEqual({ x: 2, y: 2 })
    expect(s.playerOnLevel).toBe(true)
    expect(s.level.sky).toBe('none')
    expect(gd.dngn.baseName(s.level.ceilingTile!)).toMatch(/^WALL_BRICK_DARK/)
    expect(s.revision).toBe(1)
    expect(s.layoutRevision).toBe(1)
    expect(vaultCamera(v)).toMatchObject({ x: 2, y: 2, facing: 4, yaw: Math.PI })
  })

  it('gives floors and walls their variants by position, the same every build', () => {
    expect(variantAt(100, 1, 3, 4)).toBe(100)
    const a = variantAt(100, 8, 3, 4)
    expect(a).toBeGreaterThanOrEqual(100)
    expect(a).toBeLessThan(108)
    expect(variantAt(100, 8, 3, 4)).toBe(a)
    const seen = new Set<number>()
    for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) seen.add(variantAt(100, 8, x, y))
    expect(seen.size).toBeGreaterThan(3)
  })

  it('refuses a tile the tile set lacks and a room open to void', async () => {
    const gd = await fixtureGamedata()
    const names = namesOf(gd)
    expect(() => vaultScene(parseDes(SMALL.replace('gold05', 'gold99')), names)).toThrow(/tiles not in this tile set: GOLD99/)
    // a floor cell on the edge touches void
    expect(() => vaultScene(parseDes('TILE: # = wall_brick_dark\nFTILE: . = floor_grey_dirt\nEYE: @\nMAP\n#####\n#.@..\n#####\nENDMAP\n'), names)).toThrow(/the room is open at 5,\d/)
    // a tree may stand at the edge of the void: the wood is the boundary
    expect(() => vaultScene(parseDes('TILE: # = wall_brick_dark\nFTILE: . = floor_grey_dirt\nKFEAT: T = dngn_tree\nEYE: @\nMAP\n#####\n#.@T\n#####\nENDMAP\n'), names)).not.toThrow()
    expect(() => vaultScene(parseDes('TILE: # = wall_brick_dark\nFTILE: . = floor_grey_dirt\nKFEAT: T = dngn_tree\nEYE: @\nMAP\n#####\n#.@T.\n#####\nENDMAP\n'), names)).toThrow(/the room is open at 5,\d/)
    // the eye's and the light's glyphs are floor by construction; a wall beside void is fine, an open cell beside void is not
    expect(() => vaultScene(parseDes('TILE: # = wall_brick_dark\nFTILE: . = floor_grey_dirt\nEYE: @\nLIGHT: l\nMAP\n#####\n#.@.#\n##l##\n#####\nENDMAP\n'), names)).not.toThrow()
  })
})

describe('the antechamber', () => {
  it('compiles against the pinned tile set, closed, with the eye in the middle facing the stairs', async () => {
    const gd = await fixtureGamedata()
    const v = parseDes(ROOM)
    expect(v.name).toBe('orbrun_antechamber')
    const s = vaultScene(v, namesOf(gd))
    expect(v.eye.facing).toBe(0)
    // the stairs straight ahead of the eye, in the recess of the north wall
    const stairs = [...s.cells.values()].find((c) => c.feature?.type === 'stairs')!
    expect(stairs.x).toBe(v.eye.x)
    expect(stairs.y).toBeLessThan(v.eye.y)
    for (let y = stairs.y + 1; y < v.eye.y; y++) expect(getCell(s, v.eye.x, y)!.occluder).toBe(false)
    // lit from between the statues, not from the eye
    expect(s.player).not.toEqual({ x: v.eye.x, y: v.eye.y })
    expect(Math.hypot(s.player.x - stairs.x, s.player.y - stairs.y)).toBeLessThan(Math.hypot(v.eye.x - stairs.x, v.eye.y - stairs.y))
    expect(s.cells.get(cellKey(v.eye.x, v.eye.y))!.kind).toBe('floor')
    expect(s.billboards.filter((b) => b.kind === 'monster').every((b) => b.scenery)).toBe(true)
  })

  it('uses only tiles the packed room atlas holds, every variant included', () => {
    const atlas = JSON.parse(readFileSync(join(ROOT, 'apps', 'orbrun', 'public', 'room', 'atlas.json'), 'utf8')) as {
      source: { version: string; des: string }
      names: Record<string, { id: number; count: number }>
      tiles: Record<string, { w: number; h: number }>
    }
    expect(atlas.source.version).toBe(VERSION)
    expect(atlas.source.des).toBe('apps/orbrun/src/room/antechamber.des')
    const v = parseDes(ROOM)
    for (const name of vaultTileNames(v)) {
      const n = atlas.names[name]
      expect(n, name).toBeDefined()
      for (let i = 0; i < n.count; i++) expect(atlas.tiles[String(n.id + i)], `${name} +${i}`).toBeDefined()
    }
    // and a scene built from it asks for nothing else
    const names: TileNames = { id: (n) => atlas.names[n]?.id, tileCount: (id) => Object.values(atlas.names).find((n) => n.id === id)?.count ?? 1 }
    const s = vaultScene(v, names)
    const used = new Set<number>()
    for (const c of s.cells.values()) {
      used.add(c.floorTile)
      if (c.wallTile !== undefined) used.add(c.wallTile)
      if (c.featureTile !== undefined) used.add(c.featureTile)
    }
    if (s.level.ceilingTile !== null) used.add(s.level.ceilingTile)
    for (const b of s.billboards) used.add(b.tile)
    for (const id of used) expect(atlas.tiles[String(id)], `tile ${id}`).toBeDefined()
  })
})
