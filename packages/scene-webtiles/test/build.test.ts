import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { initialState, reduce, type Monster, type ServerMessage } from '@orbrun/webtiles'
import { loadGamedata, type Gamedata } from '@orbrun/gamedata'
import { cellKey, emptyScene, monstersInView, type Scene } from '@orbrun/scene'
import { buildScene, missingTileNames, CEILING_REACH, classifyFeature, stanceFor, levelPresentation, isScenery, isVegetation, isExcludedFromList, monsterGroups, monsterSort, viewmodelFor, itemTileName } from '../src/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const gdRoot = join(here, 'fixtures', 'gamedata')
const version = readdirSync(gdRoot)[0]

async function fixtureGamedata(): Promise<Gamedata> {
  return loadGamedata({
    base: 'fixture://x',
    version,
    skipImages: true,
    io: {
      async fetchText(url) {
        const file = url.split('/').pop()!
        return readFileSync(join(gdRoot, version, file), 'utf8')
      },
      async loadImage() {
        throw new Error('no images in tests')
      },
    },
  })
}

function fixtureMessages(): ServerMessage[] {
  const text = readFileSync(join(here, '..', '..', 'webtiles', 'test', 'fixtures', 'cdi-0.34-watch.ndjson'), 'utf8')
  return text
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l).m as ServerMessage)
}

describe('gamedata loader', () => {
  let gd: Gamedata
  beforeAll(async () => {
    gd = await fixtureGamedata()
  })
  it('loads tile modules with increasing ranges', () => {
    const r = gd.ranges
    expect(r.floorMax).toBeGreaterThan(0)
    expect(r.wallMax).toBeGreaterThan(r.floorMax)
    expect(r.featMax).toBeGreaterThan(r.wallMax)
    expect(r.mainMax).toBeGreaterThan(r.featMax)
    expect(r.playerMax).toBeGreaterThan(r.mainMax)
    expect(r.firstTransparent).toBeGreaterThan(r.floorMax)
    expect(r.firstTransparent).toBeLessThan(r.wallMax)
  })
  it('resolves names and tile rects', () => {
    const down = gd.dngn.id('DNGN_STONE_STAIRS_DOWN')
    expect(down).toBeDefined()
    expect(gd.dngn.name(down!)).toBe('DNGN_STONE_STAIRS_DOWN')
    const rect = gd.tile(down!)
    expect(rect?.atlas).toBe('feat')
    expect(rect?.w).toBeGreaterThan(0)
    const floorVar = gd.dngn.id('FLOOR_GREY_DIRT_3')!
    expect(gd.dngn.baseName(floorVar)).toBe('FLOOR_GREY_DIRT')
  })
  it('names the first tile of a module, not the previous module sentinel', () => {
    // TILE_WALL_MAX and DNGN_TREE share an id; the tree is the tile
    const tree = gd.dngn.id('DNGN_TREE')!
    expect(tree).toBe(gd.ranges.wallMax)
    expect(gd.dngn.name(tree)).toBe('DNGN_TREE')
    expect(gd.dngn.baseName(gd.dngn.id('DNGN_TREE_3')!)).toBe('DNGN_TREE')
    expect(gd.dngn.name(gd.ranges.floorMax)).not.toMatch(/_MAX$/)
    expect(gd.main.name(gd.ranges.featMax)).toBe('UNRAND_AIR')
  })
  it('decodes flag words from the server enums', () => {
    const fg = gd.fg([531768, 268435456])
    expect(fg.value).toBe(531768 & 0xffff)
    expect(fg.FLYING).toBe(true)
    expect(fg.S_UNDER).toBe(false)
    const bg = gd.bg(947)
    expect(bg.value).toBe(947)
    expect(bg.UNSEEN).toBe(false)
  })
})

describe('classification', () => {
  it('needs two of three signals', () => {
    expect(classifyFeature('DNGN_STONE_STAIRS_DOWN', '>', 13)).toEqual({ type: 'stairs', dir: 'down' })
    expect(classifyFeature('DNGN_STONE_STAIRS_DOWN', '.', 1)?.type).toBe('stairs')
    expect(classifyFeature('DNGN_CLOSED_DOOR', '+', 5)).toEqual({ type: 'door', state: 'closed' })
    expect(classifyFeature('DNGN_ENTER_SHOP', undefined, 15)?.type).toBe('shop')
    expect(classifyFeature('DNGN_ALTAR_ZIN', '_', 15)).toEqual({ type: 'altar', god: 'zin' })
    expect(classifyFeature('DNGN_ENTER_LAIR', '>', 14)).toEqual({ type: 'portal' })
  })
  it('the D:1 start square is the dungeon exit, an up stair, not a portal', () => {
    // under the player the glyph is `@`, so only the name and the minimap category vote (tileweb.cc _send_cell)
    const fx = JSON.parse(readFileSync(join(here, 'fixtures', 'cdi-git-newgame-d1-cell.json'), 'utf8'))
    expect(fx.cell.g).toBe('@')
    expect(fx.cell.mf).toBe(12) // MF_STAIR_UP
    expect(classifyFeature(fx.bgName, fx.cell.g, fx.cell.mf)).toEqual({ type: 'stairs', dir: 'up', exit: true })
    // seen from a distance the glyph is `<` (feature-data.h DCHAR_STAIRS_UP)
    expect(classifyFeature('DNGN_EXIT_DUNGEON', '<', 12)).toEqual({ type: 'stairs', dir: 'up', exit: true })
    // branch exits (feature-data.h BRANCH_EXIT: DCHAR_STAIRS_UP, MF_STAIR_UP) are up stairs underfoot too
    expect(classifyFeature('DNGN_EXIT_LAIR', '@', 12)).toEqual({ type: 'stairs', dir: 'up' })
    expect(classifyFeature('DNGN_EXIT_LAIR', '<', 12)).toEqual({ type: 'stairs', dir: 'up' })
    // portal exits (PORTAL_EXIT: DCHAR_ARCH, MF_PORTAL) stay portals
    expect(classifyFeature('DNGN_EXIT_ABYSS', '@', 23)).toEqual({ type: 'portal' })
  })
  it('chooses stances', () => {
    // stairs stand: a floor decal is a sliver at eye height, and stairs are what a player steers by
    expect(stanceFor('DNGN_STONE_STAIRS_DOWN', { type: 'stairs', dir: 'down' })).toBe('upright')
    expect(stanceFor('DNGN_STONE_STAIRS_UP_I', undefined)).toBe('upright')
    // holes in the floor stay on the floor
    expect(stanceFor('DNGN_ESCAPE_HATCH_DOWN', { type: 'hatch', dir: 'down' })).toBe('decal')
    expect(stanceFor('DNGN_ALTAR_ZIN', { type: 'altar' })).toBe('upright')
    expect(stanceFor('DNGN_TRAP_ARROW', { type: 'trap' })).toBe('decal')
    expect(stanceFor('DNGN_GRANITE_STATUE', undefined)).toBe('upright')
    expect(stanceFor('DNGN_TREE', undefined)).toBe('upright')
    expect(stanceFor('DNGN_MANGROVE', undefined)).toBe('upright')
  })
  it('treats piles of debris and other stationary rubble as scenery', () => {
    expect(isScenery('pile of debris')).toBe(true)
    expect(isScenery('briar patch')).toBe(true)
    expect(isScenery('bush')).toBe(true)
    expect(isVegetation('pile of debris')).toBe(false)
    expect(isScenery('orc warrior')).toBe(false)
    expect(isScenery('orb of destruction')).toBe(false)
  })
  it('picks level presentation by branch', () => {
    expect(levelPresentation('Shoals').sky).toBe('open')
    expect(levelPresentation('Abyss').sky).toBe('dark')
    expect(levelPresentation('Dungeon').sky).toBe('none')
  })
})

describe('buildScene on a recorded level', () => {
  let gd: Gamedata
  beforeAll(async () => {
    gd = await fixtureGamedata()
  })
  it('stands a tree upright rather than laying it on the floor', () => {
    const st = initialState()
    for (const m of fixtureMessages()) reduce(st, m)
    const floor = [...st.map.cells.values()].find((c) => c.t?.bg && gd.bg(c.t.bg).value < gd.ranges.floorMax)!
    const tree = gd.dngn.id('DNGN_TREE_2')!
    st.map.cells.set(cellKey(floor.x, floor.y), { ...floor, g: '\u2663', t: { ...floor.t, bg: tree } })
    const cell = buildScene(st, gd).cells.get(cellKey(floor.x, floor.y))!
    expect(cell.kind).toBe('feature')
    expect(cell.featureTile).toBe(tree)
    expect(cell.stance).toBe('upright')
    expect(cell.label).toBe('tree')
  })
  it('names the water shorelines among the overlays, so 3D can leave the flat wave lines out', () => {
    const st = initialState()
    for (const m of fixtureMessages()) reduce(st, m)
    const floor = [...st.map.cells.values()].find((c) => c.t?.bg && gd.bg(c.t.bg).value < gd.ranges.floorMax)!
    const water = gd.dngn.id('DNGN_SHALLOW_WATER')!
    const shore = gd.dngn.id('SHORE_N')!
    const wave = gd.dngn.id('DNGN_WAVE_N')!
    const murky = gd.dngn.id('MURKY_WAVE_NW')!
    const deep = gd.dngn.id('WAVE_DEEP_N')!
    const ink = gd.dngn.id('WAVE_INK_FULL')!
    const shadow = gd.dngn.id('DNGN_WALL_SHADOW')!
    // the runs stand in dc-floor.txt order, with the colour variations of the
    // shallow border between its base tiles and the murky set
    expect(murky).toBeGreaterThan(wave + 8)
    const green = wave + 8
    // the shoals water tiles sit between the murky borders and the deep waves: floors, not shorelines
    const shoals = gd.dngn.id('SHOALS_SHALLOW_WATER')!
    const ov = [shore, wave, green, murky, shoals, deep, ink, shadow]
    st.map.cells.set(cellKey(floor.x, floor.y), { ...floor, t: { ...floor.t, bg: water, ov } })
    const cell = buildScene(st, gd).cells.get(cellKey(floor.x, floor.y))!
    for (const o of ov) expect(cell.overlays).toContain(o)
    expect(cell.shorelines).toEqual([shore, wave, green, murky, deep, ink])
    expect(cell.shorelines).not.toContain(shoals)
    expect(cell.wallShadows).toEqual([shadow])
  })
  it('names a shop by its wares, the only thing the tile says about it (tilepick.cc tileidx_shop)', () => {
    const st = initialState()
    for (const m of fixtureMessages()) reduce(st, m)
    const floor = [...st.map.cells.values()].find((c) => c.t?.bg && gd.bg(c.t.bg).value < gd.ranges.floorMax)!
    const shop = gd.dngn.id('SHOP_WEAPONS')
    expect(shop).toBeDefined()
    st.map.cells.set(cellKey(floor.x, floor.y), { ...floor, mf: 15, t: { ...floor.t, bg: shop } })
    const cell = buildScene(st, gd).cells.get(cellKey(floor.x, floor.y))!
    expect(cell.feature).toEqual({ type: 'shop' })
    // the shopkeeper's own name (shopping.cc `shop_name`) is never sent per square
    expect(cell.label).toBe('weapon shop')
  })
  it('builds a scene with walls, floors and monsters', () => {
    const st = initialState()
    let best = 0
    let scene = buildScene(st, gd)
    for (const m of fixtureMessages()) {
      reduce(st, m)
      if (m.msg === 'map' || m.msg === 'player') {
        const s = buildScene(st, gd)
        const n = monstersInView(s).length
        if (n >= best) {
          best = n
          scene = s
        }
      }
    }
    expect(scene.playerOnLevel).toBe(true)
    const kinds = new Map<string, number>()
    for (const c of scene.cells.values()) kinds.set(c.kind, (kinds.get(c.kind) || 0) + 1)
    expect(kinds.get('floor')).toBeGreaterThan(50)
    expect(kinds.get('wall')).toBeGreaterThan(20)
    const under = scene.cells.get(cellKey(scene.player.x, scene.player.y))
    expect(under?.kind).not.toBe('unknown')
    expect(under?.visibility).toBe('visible')
    const mons = monstersInView(scene)
    expect(mons.length).toBeGreaterThan(0)
    expect(mons.every((m) => scene.cells.get(cellKey(m.x, m.y))?.visibility === 'visible')).toBe(true)
    // the player's own doll is not a monster
    expect(mons.some((m) => m.x === scene.player.x && m.y === scene.player.y)).toBe(false)
    expect(scene.level.ceilingTile).not.toBeNull()
    // a per-cell ceiling always names a wall type standing within reach of that cell
    let roofed = 0
    for (const c of scene.cells.values()) {
      if (c.ceilingTile === undefined) continue
      roofed++
      let near = false
      for (let dy = -CEILING_REACH; dy <= CEILING_REACH && !near; dy++)
        for (let dx = -CEILING_REACH; dx <= CEILING_REACH && !near; dx++) {
          const w = scene.cells.get(cellKey(c.x + dx, c.y + dy))
          if (w?.kind === 'wall' && w.wallTile !== undefined && gd.modules.wall.basetile(w.wallTile) === c.ceilingTile) near = true
        }
      expect(near).toBe(true)
    }
    // walls are never roofed
    expect([...scene.cells.values()].some((c) => c.occluder && c.ceilingTile !== undefined)).toBe(false)
    void roofed
  })

  it('reuses the lids of the last build when the walls stood, and votes again when they moved', () => {
    const st = initialState()
    let scene: Scene = emptyScene()
    for (const m of fixtureMessages()) {
      reduce(st, m)
      if (m.msg === 'map' || m.msg === 'player') scene = buildScene(st, gd, { previous: scene })
      if (st.map.cells.size > 800) break
    }
    const lids = (s: Scene) => [...s.cells.values()].map((c) => [c.x, c.y, c.ceilingTile ?? -1].join(','))
    const fresh = buildScene(st, gd)
    const reused = buildScene(st, gd, { previous: scene })
    expect(lids(reused)).toEqual(lids(fresh))
    expect(fresh.cells.size).toBeGreaterThan(100)
    // a new wall: the lids are voted again, and match a build from nothing
    const wallCell = [...st.map.cells.values()].find((c) => c.t?.bg && gd.bg(c.t.bg).value >= gd.ranges.floorMax && gd.bg(c.t.bg).value < gd.ranges.wallMax)!
    const other = [...st.map.cells.values()].find((c) => c.t?.bg && gd.bg(c.t.bg).value < gd.ranges.floorMax && Math.abs(c.x - wallCell.x) > 10)!
    st.map.cells.set(cellKey(other.x, other.y), { ...other, t: { ...other.t, bg: wallCell.t!.bg } })
    const changed = buildScene(st, gd, { previous: reused })
    expect(lids(changed)).toEqual(lids(buildScene(st, gd)))
  })

  it('keeps the layout revision while only monsters, light and cursors change', () => {
    const st = initialState()
    let scene: Scene = emptyScene()
    // play the recording until a monster is in view; every `map` or `player` is a build, as the session does it
    for (const m of fixtureMessages()) {
      reduce(st, m)
      if (m.msg === 'map' || m.msg === 'player') scene = buildScene(st, gd, { previous: scene })
      if (m.msg === 'map' && scene.playerOnLevel && monstersInView(scene).length > 0) break
    }
    expect(monstersInView(scene).length).toBeGreaterThan(0)
    expect(scene.layoutRevision).toBeGreaterThan(0)
    expect(scene.layoutRevision).toBeLessThanOrEqual(scene.revision)
    // the same state again: a new revision, the same layout
    const again = buildScene(st, gd, { previous: scene })
    expect(again.revision).toBe(scene.revision + 1)
    expect(again.layoutRevision).toBe(scene.layoutRevision)
    // a monster stepping onto another floor cell moves nothing in the level
    const mc = [...st.map.cells.values()].find((c) => c.mon && c.t?.fg)!
    const mon = { x: mc.x, y: mc.y }
    const spots = [...st.map.cells.values()].filter((c) => c.t?.bg && gd.bg(c.t.bg).value < gd.ranges.floorMax && !c.mon && !(c.x === st.player.pos.x && c.y === st.player.pos.y))
    const dest = spots[0]
    st.map.cells.set(cellKey(dest.x, dest.y), { ...dest, mon: mc.mon, t: { ...dest.t, fg: mc.t!.fg, doll: mc.t!.doll, mcache: mc.t!.mcache } })
    st.map.cells.set(cellKey(mon.x, mon.y), { ...mc, mon: undefined, t: { ...mc.t, fg: 0, doll: undefined, mcache: undefined } })
    const moved = buildScene(st, gd, { previous: again })
    expect(moved.revision).toBe(again.revision + 1)
    expect(moved.layoutRevision).toBe(again.layoutRevision)
    // a floor cell becoming a tree is the level changing
    const tree = gd.dngn.id('DNGN_TREE_2')!
    const floor = spots[1]
    st.map.cells.set(cellKey(floor.x, floor.y), { ...floor, g: '\u2663', t: { ...floor.t, bg: tree } })
    const grown = buildScene(st, gd, { previous: moved })
    expect(grown.layoutRevision).toBe(grown.revision)
    // the player stepping is a new layout too: the light and the lowered walls follow them
    st.player.pos = { x: st.player.pos.x + 1, y: st.player.pos.y }
    const stepped = buildScene(st, gd, { previous: grown })
    expect(stepped.layoutRevision).toBe(stepped.revision)
  })

  it('carries what the official client paints on a cell', () => {
    const st = initialState()
    const from = gd.icons.id('TRAVEL_PATH_FROM')!
    const to = gd.icons.id('TRAVEL_PATH_TO')!
    const blood = gd.dngn.id('BLOOD')!
    const bloodN = gd.tileCount(blood)
    const shadow = gd.dngn.id('DNGN_WALL_SHADOW')!
    const shadowDark = gd.dngn.id('DNGN_WALL_SHADOW_DARK')!
    const shadowN = gd.tileCount(shadow)
    expect(shadowN).toBe(7) // W, NW corner, N, NE corner, E, W with open NW, E with open NE (tilecell.cc)
    let trail = 0
    let bloody = 0
    let shadows = 0
    let badges = 0
    for (const m of fixtureMessages()) {
      reduce(st, m)
      if (m.msg !== 'map') continue
      const scene = buildScene(st, gd)
      for (const mc of st.map.cells.values()) {
        const cell = scene.cells.get(cellKey(mc.x, mc.y))!
        const tt = mc.t?.travel_trail || 0
        if (tt) {
          // the step in and the step out, as arrow icons above everything
          const want: number[] = []
          if (tt & 0xf) want.push(from + (tt & 0xf) - 1)
          if (tt & 0xf0) want.push(to + ((tt & 0xf0) >> 4) - 1)
          for (const w of want) expect(cell.icons).toContain(w)
          // the same arrows as headings of travel: 1 S, 2 SW ... 8 SE, so index + 3 mod 8 is the way in
          if (tt & 0xf) expect(cell.trail?.from).toBe(((tt & 0xf) + 3) % 8)
          if (tt & 0xf0) expect(cell.trail?.to).toBe((((tt & 0xf0) >> 4) + 7) % 8)
          trail++
        } else if (cell.icons) {
          for (const i of cell.icons) expect(i < from || i >= to + 8).toBe(true)
        }
        if (mc.t?.bloody && cell.kind === 'floor') {
          const seed = mc.t.flv?.s ?? 0
          expect(cell.overlays).toContain(blood + (seed % bloodN))
          bloody++
        }
        if (mc.t?.ov?.length && cell.kind === 'floor') {
          // server overlays (wall shadows) survive on floor cells, and the
          // shadows among them are named so 3D can leave them out
          for (const o of mc.t.ov) {
            if (o <= 0 || o >= gd.ranges.featMax) continue
            expect(cell.overlays).toContain(o)
            const isShadow = (o >= shadow && o < shadow + shadowN) || (o >= shadowDark && o < shadowDark + shadowN)
            expect(cell.wallShadows?.includes(o) ?? false).toBe(isShadow)
            if (isShadow) shadows++
          }
        }
      }
      for (const b of scene.billboards) if (b.statusIcons?.length) badges++
    }
    expect(trail).toBeGreaterThan(0)
    expect(bloody).toBeGreaterThan(0)
    expect(shadows).toBeGreaterThan(0)
    expect(badges).toBeGreaterThan(0)
  })

  it('draws no decoration by a name the server does not publish', () => {
    // the guard that would have caught SOMETHING_UNDER: a renamed tile stops
    // being drawn silently, so every name in the tables is checked at load
    expect(missingTileNames(gd)).toEqual([])
  })

  it('badges the "something under" flag with the icon the server has, whatever it is called', () => {
    // 0.34 and earlier publish one SOMETHING_UNDER icon; master splits it into
    // ITEM_STACK_1..3 with S_UNDER / _GOOD / _ARTEFACT. Either way a monster or
    // item standing on a pile gets the badge.
    const under = gd.icons.id('ITEM_STACK_1') ?? gd.icons.id('SOMETHING_UNDER')
    expect(under).toBeDefined()
    const st = initialState()
    let seen = 0
    for (const m of fixtureMessages()) {
      reduce(st, m)
      if (m.msg !== 'map') continue
      let flagged = 0
      for (const mc of st.map.cells.values()) if (gd.fg(mc.t?.fg).S_UNDER) flagged++
      if (!flagged) continue
      for (const b of buildScene(st, gd).billboards) for (const i of b.statusIcons || []) if (i.tile === under) seen++
    }
    expect(seen).toBeGreaterThan(0)
  })

  it('pins the damage bar to the top of the frame and leaves every other badge where WebTiles puts it', () => {
    const st = initialState()
    const mdam = new Set(['MDAM_LIGHTLY_DAMAGED', 'MDAM_MODERATELY_DAMAGED', 'MDAM_HEAVILY_DAMAGED', 'MDAM_SEVERELY_DAMAGED', 'MDAM_ALMOST_DEAD'].map((n) => gd.icons.id(n)!))
    let bars = 0
    let others = 0
    for (const m of fixtureMessages()) {
      reduce(st, m)
      if (m.msg !== 'map') continue
      for (const b of buildScene(st, gd).billboards) {
        for (const i of b.statusIcons || []) {
          if (mdam.has(i.tile)) {
            expect(i.at).toBe('top')
            expect(b.damage).not.toBe('uninjured')
            bars++
          } else {
            expect(i.at).toBeUndefined()
            others++
          }
        }
      }
    }
    expect(bars).toBeGreaterThan(0)
    expect(others).toBeGreaterThan(0)
  })
})

describe('monster list grouping (monster_list.js)', () => {
  const mon = (name: string, att: number, avghp: number, type: number, extra: Partial<Monster> = {}): Monster => ({ name, plural: name + 's', att, type, typedata: { avghp }, ...extra })
  const sceneWith = (mons: { x: number; y: number; m: Monster; visible?: boolean }[]): Scene => {
    const scene = emptyScene()
    scene.playerOnLevel = true
    for (const { x, y, m, visible } of mons) {
      scene.cells.set(cellKey(x, y), { x, y, kind: 'floor', visibility: visible === false ? 'remembered' : 'visible', occluder: false, floorTile: 1, flags: { water: false, lava: false, excluded: false, travelTrail: false, newStair: false, cursor: false, outOfRange: false, magicMapped: false } })
      scene.billboards.push({ x, y, tile: 1, kind: 'monster', height: 1, name: m.name, ref: m })
    }
    return scene
  }

  it('sorts as monster_info::less_than: attitude, average hp desc, type desc, name', () => {
    const rat = mon('rat', 0, 5, 10)
    const ogre = mon('ogre', 0, 40, 50)
    const friend = mon('ally', 4, 60, 70)
    expect(monsterSort(ogre, rat)).toBe(-1)
    expect(monsterSort(rat, friend)).toBe(-1)
    expect(monsterSort(rat, mon('rat', 0, 5, 10))).toBe(0)
    // named monsters (with a client id) never combine, and come before unnamed ones of the same kind
    expect(monsterSort(mon('rat', 0, 5, 10, { clientid: 1 }), mon('rat', 0, 5, 10, { clientid: 2 }))).toBe(-1)
    expect(monsterSort(rat, mon('rat', 0, 5, 10, { clientid: 1 }))).toBe(1)
  })

  it('groups equal monsters into one row and leaves out no-experience monsters', () => {
    const scene = sceneWith([
      { x: 1, y: 1, m: mon('jackal', 0, 8, 20) },
      { x: 2, y: 1, m: mon('jackal', 0, 8, 20) },
      { x: 3, y: 1, m: mon('ogre', 0, 40, 50) },
      { x: 4, y: 1, m: mon('plant', 0, 10, 60, { typedata: { avghp: 10, no_exp: true } }) },
      { x: 5, y: 1, m: mon('kraken tentacle', 0, 10, 61, { typedata: { avghp: 10, no_exp: true } }) },
      { x: 6, y: 1, m: mon('bat', 0, 3, 5), visible: false },
    ])
    const groups = monsterGroups(scene)
    expect(groups.map((g) => g.map((b) => b.name))).toEqual([['ogre'], ['kraken tentacle'], ['jackal', 'jackal']])
    expect(isExcludedFromList(mon('plant', 0, 1, 1, { typedata: { no_exp: true } }))).toBe(true)
    expect(isExcludedFromList(mon('active ballistomycete', 0, 1, 1, { typedata: { no_exp: true } }))).toBe(false)
  })
})

describe('viewmodel', () => {
  it('resolves the wielded weapon and the off-hand item from their inventory slots', () => {
    const st = initialState()
    st.player.weapon_index = 0
    st.player.offhand_index = 3
    st.player.inv[0] = { slot: 0, name: '+0 war axe', tile: [3672] }
    st.player.inv[3] = { slot: 3, name: '+1 kite shield', tile: [{ t: 4000, tex: 4 }, { t: 4001, tex: 4, ymax: 20 }] }
    const vm = viewmodelFor(st)
    expect(vm.weapon).toEqual({ layers: [{ tile: 3672 }], name: '+0 war axe' })
    expect(vm.offhand).toEqual({ layers: [{ tile: 4000, layer: '4' }, { tile: 4001, layer: '4', ymax: 20 }], name: '+1 kite shield' })
  })
  it('leaves a hand empty when unarmed, when the server publishes no off hand, or when the slot has no tile', () => {
    const st = initialState()
    expect(viewmodelFor(st)).toEqual({ weapon: null, offhand: null })
    st.player.weapon_index = 2
    st.player.inv[2] = { slot: 2, name: 'a stick' }
    expect(viewmodelFor(st).weapon).toBeNull()
  })
  it('finds the watched player\'s weapon in the recorded session, and the shield from the paperdoll', async () => {
    const gd = await fixtureGamedata()
    const st = initialState()
    for (const m of fixtureMessages()) reduce(st, m)
    const vm = viewmodelFor(st, gd)
    expect(vm.weapon).not.toBeNull()
    expect(vm.weapon!.layers.length).toBeGreaterThan(0)
    expect(vm.weapon!.name).toBe(st.player.inv[st.player.weapon_index].name)
    // 0.34 publishes no off-hand slot for armour; the doll's HAND2 part is the shield
    expect(st.player.offhand_index).toBe(-1)
    expect(vm.offhand?.name).toMatch(/^HAND2_/)
    expect(vm.offhand?.layers[0].layer).toBe(String(gd.enums.texture.PLAYER))
    // without gamedata nothing is guessed
    expect(viewmodelFor(st).offhand).toBeNull()
  })
})

describe('itemTileName', () => {
  it('reads the tile the server sent back as words: the class, "of" its type, sprite-set suffixes dropped', () => {
    expect(itemTileName('WPN_DAGGER')).toBe('dagger')
    expect(itemTileName('WPN_DAGGER_MAGIC')).toBe('dagger')
    expect(itemTileName('WPN_DAGGER_RANDART')).toBe('dagger')
    expect(itemTileName('WPN_GREAT_MACE')).toBe('great mace')
    expect(itemTileName('ARM_ROBE_RANDART_1')).toBe('robe')
    expect(itemTileName('MI_ARROW_STEEL_MAGIC')).toBe('steel arrow')
    expect(itemTileName('MI_DART_POISONED')).toBe('poisoned dart')
    expect(itemTileName('MI_LARGE_ROCK0')).toBe('large rock')
    expect(itemTileName('MI_THROWING_NET3')).toBe('throwing net')
    expect(itemTileName('GOLD04')).toBe('gold')
    expect(itemTileName('FOOD_RATION_2')).toBe('ration')
    expect(itemTileName('MISC_LAMP_OF_FIRE_INERT')).toBe('lamp of fire')
    expect(itemTileName('CORPSE_BAT')).toBe('bat corpse')
    expect(itemTileName('GEM_ORC_1')).toBe('gem')
    expect(itemTileName('TALISMAN_SNAKE')).toBe('talisman')
    expect(itemTileName('STAFF_OFFSET_2')).toBe('staff')
    expect(itemTileName('WAND_FLAME')).toBe('wand of flame')
    expect(itemTileName('WAND_OFFSET_3')).toBe('wand')
    expect(itemTileName('SCR_IDENTIFY')).toBe('scroll of identify')
    expect(itemTileName('SCROLL')).toBe('scroll')
    expect(itemTileName('AMU_THE_GOURMAND')).toBe('amulet of the gourmand')
    expect(itemTileName('AMU_NORMAL_OFFSET_12')).toBe('amulet')
    expect(itemTileName('RING_RANDART_OFFSET_2')).toBe('ring')
    expect(itemTileName('RING_PROTECTION_FROM_FIRE')).toBe('ring of protection from fire')
    expect(itemTileName('POTION_OFFSET_5')).toBe('potion')
    expect(itemTileName('UNSEEN_POTION')).toBe('potion')
    expect(itemTileName('BOOK_17')).toBe('book')
    expect(itemTileName('PARCHMENT_SINGLE_FIRE_HIGH')).toBe('parchment')
    expect(itemTileName('ARM_LEATHER_ARMOUR')).toBe('leather armour')
    expect(itemTileName(undefined)).toBe('')
  })
  it('names every item tile in the fixture gamedata from its base', async () => {
    const gd = await fixtureGamedata()
    for (let id = gd.ranges.featMax; id < gd.ranges.mainMax; id++) {
      const n = gd.main.baseName(id)
      if (!n) continue
      const w = itemTileName(n)
      expect(w, n).toMatch(/^[a-z][a-z0-9 ]*$/)
    }
    expect(itemTileName(gd.main.baseName(gd.main.id('WPN_DAGGER_MAGIC')!))).toBe('dagger')
  })
})
