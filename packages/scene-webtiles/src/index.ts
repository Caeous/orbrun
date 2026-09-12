import { MapFeature, MenuFlag, MouseMode, UiState, mapKey, type CellTiles, type GameState, type InvItem, type MapCell, type Monster } from '@orbrun/webtiles'
import { verifyEnums, type Gamedata, type FlagWord } from '@orbrun/gamedata'
import {
  cellKey,
  type Billboard,
  type Dir8,
  type CellKey,
  type Feature,
  type HandItem,
  type Scene,
  type SceneCell,
  type Visibility,
  type Viewmodel,
  emptyScene,
  sceneLayoutEquals,
} from '@orbrun/scene'

/**
 * @orbrun/scene-webtiles
 *
 * GameState + Gamedata -> Scene. Every piece of DCSS knowledge that rendering
 * needs is spent here: tile ranges, tile names, glyphs, map-feature
 * categories, body sizes, branches. Renderers only ever see the Scene.
 */

const FLASH_COLOURS = [
  [0, 0, 0, 0],
  [0, 0, 128, 100],
  [0, 128, 0, 100],
  [0, 128, 128, 100],
  [128, 0, 0, 100],
  [150, 0, 150, 100],
  [165, 91, 0, 100],
  [50, 50, 50, 150],
  [0, 0, 0, 150],
  [64, 64, 255, 100],
  [64, 255, 64, 100],
  [0, 255, 255, 100],
  [255, 64, 64, 100],
  [255, 64, 255, 100],
  [150, 150, 0, 100],
  [255, 255, 255, 100],
]

// Map-feature categories (map-feature.h). The server publishes them as
// `MF_*` in enums.js; the protocol table is only the fallback for a server
// that does not, and `mfFor(gd)` says which is in use.
type MfTable = Record<keyof typeof MapFeature, number>
const MF_DEFAULT: MfTable = { ...MapFeature }

/** Halo values on the wire (enums.js HALO_*). */
interface HaloTable {
  RANGE: number
  UMBRA_FIRST: number
  UMBRA_LAST: number
}
const HALO_DEFAULT: HaloTable = { RANGE: 1, UMBRA_FIRST: 2, UMBRA_LAST: 5 }

interface ServerEnums {
  mf: MfTable
  halo: HaloTable
  /** one line per constant that differs from what the client hardcodes */
  mismatches: string[]
}

const enumCache = new WeakMap<Gamedata, ServerEnums>()

/**
 * Enum values from the server's own enums.js, resolved once per gamedata.
 * Values the server does not publish fall back to the protocol tables, and
 * every difference between the two is reported (and logged once) so a
 * hardcoded constant can never drift silently.
 */
function serverEnums(gd: Gamedata): ServerEnums {
  let e = enumCache.get(gd)
  if (e) return e
  const en = gd.enums as Record<string, unknown>
  const mf = { ...MapFeature } as MfTable
  for (const k of Object.keys(MapFeature) as (keyof typeof MapFeature)[]) {
    const v = en['MF_' + k]
    if (typeof v === 'number') mf[k] = v
  }
  const halo: HaloTable = {
    RANGE: typeof en.HALO_RANGE === 'number' ? en.HALO_RANGE : HALO_DEFAULT.RANGE,
    UMBRA_FIRST: typeof en.HALO_UMBRA_FIRST === 'number' ? en.HALO_UMBRA_FIRST : HALO_DEFAULT.UMBRA_FIRST,
    UMBRA_LAST: typeof en.HALO_UMBRA_LAST === 'number' ? en.HALO_UMBRA_LAST : HALO_DEFAULT.UMBRA_LAST,
  }
  const mismatches = enumMismatches(gd)
  e = { mf, halo, mismatches }
  enumCache.set(gd, e)
  if (mismatches.length) console.warn('[orbrun] enums.js differs from the client tables:\n' + mismatches.join('\n'))
  return e
}

/**
 * Every constant the client hardcodes (protocol MouseMode, MenuFlag, UiState,
 * MapFeature; the HALO values; the texture order) checked against enums.js.
 * Map-feature names past what the server publishes (transporters, explore
 * horizon) are only reported when the server publishes a different value.
 */
function enumMismatches(gd: Gamedata): string[] {
  const en = gd.enums as Record<string, unknown>
  const out = verifyEnums(gd, {
    mouse_mode: MouseMode as unknown as Record<string, number>,
    menu_flag: MenuFlag as unknown as Record<string, number>,
    ui: UiState as unknown as Record<string, number>,
    texture: { FLOOR: 0, WALL: 1, FEAT: 2, PLAYER: 3, DEFAULT: 4, GUI: 5, ICONS: 6 },
    '': { HALO_RANGE: HALO_DEFAULT.RANGE, HALO_UMBRA_FIRST: HALO_DEFAULT.UMBRA_FIRST, HALO_UMBRA_LAST: HALO_DEFAULT.UMBRA_LAST },
  })
  for (const [k, v] of Object.entries(MapFeature)) {
    const got = en['MF_' + k]
    if (got !== undefined && got !== v) out.push(`enums.js MF_${k} = ${String(got)}, client assumes ${v}`)
  }
  return out
}

function word(w: FlagWord | number | number[] | undefined): number {
  if (w === undefined) return 0
  if (typeof w === 'number') return w
  return w[0] || 0
}

/**
 * Feature classification from name, glyph, and minimap category. Two of three
 * must agree. Under the player only two signals exist: the server sends the
 * screen glyph, `@` on the player's own cell (tileweb.cc `_send_cell`, `g`),
 * so the name and the minimap category settle it there. feature-data.h gives
 * every branch exit (`BRANCH_EXIT`) and the dungeon exit `DNGN_EXIT_DUNGEON`
 * an `EXIT_` name with `DCHAR_STAIRS_UP` and `MF_STAIR_UP`: when the name
 * reads as a portal but the minimap says stair, the stair wins, since the
 * minimap category is the direction. Pinned to a new game's start square
 * (`fixtures/cdi-git-newgame-d1-cell.json`).
 */
export function classifyFeature(name: string | undefined, glyph: string | undefined, mf: number | undefined, MF: MfTable = MF_DEFAULT): Feature | undefined {
  const n = name || ''
  const votes: { feature: Feature; from: 'name' | 'glyph' | 'mf' }[] = []
  // name
  if (/^DNGN_EXIT_DUNGEON$/.test(n)) votes.push({ feature: { type: 'stairs', dir: 'up', exit: true }, from: 'name' })
  else if (/^DNGN_STONE_STAIRS_DOWN/.test(n)) votes.push({ feature: { type: 'stairs', dir: 'down' }, from: 'name' })
  else if (/^DNGN_STONE_STAIRS_UP/.test(n)) votes.push({ feature: { type: 'stairs', dir: 'up' }, from: 'name' })
  else if (/^DNGN_ESCAPE_HATCH_DOWN|^DNGN_TRAP_SHAFT/.test(n)) votes.push({ feature: { type: 'hatch', dir: 'down' }, from: 'name' })
  else if (/^DNGN_ESCAPE_HATCH_UP/.test(n)) votes.push({ feature: { type: 'hatch', dir: 'up' }, from: 'name' })
  else if (/^DNGN_ENTER_SHOP|^DNGN_.*SHOP/.test(n) || /^SHOP_/.test(n)) votes.push({ feature: { type: 'shop' }, from: 'name' })
  else if (/^DNGN_ALTAR_/.test(n)) votes.push({ feature: { type: 'altar', god: n.replace(/^DNGN_ALTAR_/, '').toLowerCase() }, from: 'name' })
  else if (/FOUNTAIN/.test(n)) votes.push({ feature: { type: 'fountain', kind: n.replace(/^DNGN_/, '').toLowerCase() }, from: 'name' })
  else if (/^DNGN_TRANSPORTER$|^DNGN_TRANSPORTER_/.test(n) && !/LANDING/.test(n)) votes.push({ feature: { type: 'transporter' }, from: 'name' })
  else if (/^DNGN_TRAP_/.test(n)) votes.push({ feature: { type: 'trap', kind: n.replace(/^DNGN_TRAP_/, '').toLowerCase() }, from: 'name' })
  else if (/^DNGN_(CLOSED|RUNED|SEALED)_.*DOOR|^DNGN_.*CLOSED_DOOR|_DOOR_CLOSED/.test(n))
    votes.push({ feature: { type: 'door', state: /RUNED/.test(n) ? 'runed' : /SEALED/.test(n) ? 'sealed' : 'closed' }, from: 'name' })
  else if (/^DNGN_OPEN_.*DOOR|_DOOR_OPEN|^DNGN_.*OPEN_DOOR/.test(n)) votes.push({ feature: { type: 'door', state: 'open' }, from: 'name' })
  else if (/^DNGN_ENTER_|^DNGN_RETURN_|^DNGN_EXIT_|^DNGN_PORTAL|^DNGN_ABYSSAL_STAIR|^DNGN_.*GATE|^DNGN_TRANSIT|^DNGN_ENTRANCE/.test(n))
    votes.push({ feature: { type: 'portal' }, from: 'name' })
  else if (n) votes.push({ feature: { type: 'other', name: n.replace(/^DNGN_/, '').toLowerCase() }, from: 'name' })
  // glyph
  if (glyph === '>') votes.push({ feature: { type: 'stairs', dir: 'down' }, from: 'glyph' })
  else if (glyph === '<') votes.push({ feature: { type: 'stairs', dir: 'up' }, from: 'glyph' })
  else if (glyph === '+') votes.push({ feature: { type: 'door', state: 'closed' }, from: 'glyph' })
  else if (glyph === "'") votes.push({ feature: { type: 'door', state: 'open' }, from: 'glyph' })
  else if (glyph === '_') votes.push({ feature: { type: 'altar' }, from: 'glyph' })
  else if (glyph === '^') votes.push({ feature: { type: 'trap' }, from: 'glyph' })
  else if (glyph === '\\' || glyph === '{' || glyph === '}') votes.push({ feature: { type: 'portal' }, from: 'glyph' })
  // map feature category
  if (mf === MF.STAIR_DOWN) votes.push({ feature: { type: 'stairs', dir: 'down' }, from: 'mf' })
  else if (mf === MF.STAIR_UP) votes.push({ feature: { type: 'stairs', dir: 'up' }, from: 'mf' })
  else if (mf === MF.STAIR_BRANCH) votes.push({ feature: { type: 'portal' }, from: 'mf' })
  else if (mf === MF.DOOR) votes.push({ feature: { type: 'door', state: 'closed' }, from: 'mf' })
  else if (mf === MF.PORTAL) votes.push({ feature: { type: 'portal' }, from: 'mf' })
  else if (mf === MF.TRAP) votes.push({ feature: { type: 'trap' }, from: 'mf' })
  else if (mf === MF.TRANSPORTER) votes.push({ feature: { type: 'transporter' }, from: 'mf' })

  const typeOf = (f: Feature) => (f.type === 'stairs' || f.type === 'hatch' ? 'stairs:' + f.dir : f.type)
  // group by type; pick the type with >= 2 votes, preferring the name vote's detail
  const counts = new Map<string, { n: number; best: Feature }>()
  for (const v of votes) {
    const t = typeOf(v.feature)
    const c = counts.get(t)
    if (!c) counts.set(t, { n: 1, best: v.feature })
    else {
      c.n++
      if (v.from === 'name') c.best = v.feature
    }
  }
  let winner: { n: number; best: Feature } | undefined
  for (const c of counts.values()) if (!winner || c.n > winner.n) winner = c
  if (winner && winner.n >= 2) {
    // stairs into a branch: name says entrance (portal) but mf says branch stair
    if (winner.best.type === 'stairs' && mf === MF.STAIR_BRANCH) return { ...winner.best, branch: true }
    return winner.best
  }
  const nameVote = votes.find((v) => v.from === 'name')
  // an `EXIT_` / `RETURN_` name over a stair minimap category: a branch exit (feature-data.h BRANCH_EXIT), a stair up
  const mfVote = votes.find((v) => v.from === 'mf')
  if (nameVote?.feature.type === 'portal' && mfVote?.feature.type === 'stairs') return mfVote.feature
  // A single name vote for a door/altar/shop is still a good hint for the reticle label.
  if (nameVote && nameVote.feature.type !== 'other') return nameVote.feature
  if (nameVote) return nameVote.feature
  return undefined
}

const UPRIGHT = /DOOR|ARCH|GATE|ALTAR|FOUNTAIN|STATUE|IDOL|GRAVE|SARCOPHAG|COLUMN|PILLAR|SHRINE|PORTAL|ENTER_|EXIT_|RETURN_|ENTRANCE|SHOP|TREE|MANGROVE|PLANT|BUSH|FUNGUS|LANTERN|TORCH|ORCISH_IDOL|STONE_ARCH|WAX_WALL|TRANSPORTER$|RUNELIGHT|SEAL|CRYSTAL|STAIRS|ABYSSAL_STAIR|WELL/
const DECAL = /HATCH|TRAP|TELEPORT|LANDING|SHAFT|MAGIC_CIRCLE|WATER|LAVA|BLOOD|MOLD|SLIME/

/**
 * Whether a feature stands as a billboard in its cell or lies on the floor.
 *
 * Stairs stand. Their tile is the one thing on the floor a player steers by,
 * and a floor decal seen at eye height is a sliver: a staircase two rooms away
 * has to read as a staircase. Hatches, shafts and traps stay decals — they
 * are holes in the floor, and nothing to walk towards.
 */
export function stanceFor(name: string | undefined, feature: Feature | undefined): 'upright' | 'decal' {
  if (feature) {
    if (feature.type === 'stairs') return 'upright'
    if (feature.type === 'hatch' || feature.type === 'trap' || feature.type === 'transporter') return 'decal'
    if (feature.type === 'door' || feature.type === 'altar' || feature.type === 'shop' || feature.type === 'fountain' || feature.type === 'portal') return 'upright'
  }
  const n = name || ''
  if (DECAL.test(n)) return 'decal'
  if (UPRIGHT.test(n)) return 'upright'
  return 'decal'
}

function beaconFor(feature: Feature | undefined): 'down' | 'up' | 'portal' | undefined {
  if (!feature) return undefined
  if (feature.type === 'stairs' || feature.type === 'hatch') return feature.dir
  if (feature.type === 'portal' || feature.type === 'transporter') return 'portal'
  return undefined
}

/** Branch presentation from the place name. */
export function levelPresentation(place: string): { sky: 'none' | 'open' | 'dark'; tint: { r: number; g: number; b: number } } {
  const p = place.toLowerCase()
  if (/shoal|swamp/.test(p)) return { sky: 'open', tint: /shoal/.test(p) ? { r: 0.8, g: 0.9, b: 1 } : { r: 0.85, g: 1, b: 0.85 } }
  if (/abyss/.test(p)) return { sky: 'dark', tint: { r: 0.9, g: 0.8, b: 1 } }
  if (/zot|pandemonium|hell|gehenna|cocytus|tartarus|dis\b/.test(p)) return { sky: 'dark', tint: /cocytus/.test(p) ? { r: 0.8, g: 0.9, b: 1 } : { r: 1, g: 0.85, b: 0.85 } }
  if (/lair|snake|spider|slime|orc/.test(p)) return { sky: 'none', tint: { r: 0.9, g: 1, b: 0.9 } }
  if (/vault|crypt|tomb|depths|elf/.test(p)) return { sky: 'none', tint: { r: 1, g: 0.9, b: 0.9 } }
  return { sky: 'none', tint: { r: 1, g: 1, b: 1 } }
}

// monster_list.js attitude_classes and mthreat_classes, by server index
const ATTITUDE = ['hostile', 'neutral', 'good_neutral', 'good_neutral', 'friendly'] as const
const THREAT = ['trivial', 'easy', 'tough', 'nasty', 'invisible'] as const

export interface BuildOptions {
  /** Previous scene, reused for stability where possible. */
  previous?: Scene
}

/**
 * Build the renderable scene from the game state. Pure: reads state and
 * gamedata, never mutates them.
 */
export function buildScene(state: GameState, gd: Gamedata, opts: BuildOptions = {}): Scene {
  const scene = emptyScene()
  scene.revision = (opts.previous?.revision ?? 0) + 1
  const map = state.map
  scene.player = { x: state.player.pos.x, y: state.player.pos.y }
  scene.playerOnLevel = map.playerOnLevel
  const r = gd.ranges
  const wallCounts = new Map<number, number>()
  const b = map.bounds
  scene.bounds = b ? { ...b } : { left: 0, top: 0, right: -1, bottom: -1 }
  const pres = levelPresentation(state.player.place || '')
  scene.level.sky = pres.sky
  scene.level.tint = pres.tint

  const wallBase = new Map<CellKey, number>()
  for (const mc of map.cells.values()) {
    const cell = buildCell(mc, gd)
    if (!cell) continue
    const key = cellKey(mc.x, mc.y)
    scene.cells.set(key, cell)
    if (cell.kind === 'wall' && cell.wallTile !== undefined) {
      const base = safeBase(gd, cell.wallTile)
      wallBase.set(key, base)
      wallCounts.set(base, (wallCounts.get(base) || 0) + 1)
    }
    // billboards
    addBillboards(scene, mc, cell, gd, state)
  }
  // dominant wall tile as the ceiling
  let best = -1
  let bestN = 0
  for (const [t, n] of wallCounts) if (n > bestN) (best = t), (bestN = n)
  scene.level.ceilingTile = best >= 0 ? best : null
  // the lids depend on the walls alone: the same walls as last build give every cell it had its lid again
  const prevWalls = opts.previous && wallsOf.get(opts.previous)
  const reuse = opts.previous && prevWalls && opts.previous.level.ceilingTile === scene.level.ceilingTile && sameWalls(prevWalls, wallBase) ? opts.previous : undefined
  assignCeilings(scene, wallBase, reuse)
  wallsOf.set(scene, wallBase)
  void r
  // keep monster ordering: threat then distance
  scene.billboards.sort((a, b2) => {
    if (a.kind !== b2.kind) return 0
    if (a.kind === 'monster') {
      const ta = threatRank(a.threat)
      const tb = threatRank(b2.threat)
      if (ta !== tb) return tb - ta
      return dist(scene, a) - dist(scene, b2)
    }
    return 0
  })
  // the level's geometry stands across builds that only moved monsters, light or cursors
  const prev = opts.previous
  scene.layoutRevision = prev && sceneLayoutEquals(prev, scene) ? prev.layoutRevision : scene.revision
  return scene
}

/**
 * How far, in cells, a wall's masonry reaches out over the floor beside it.
 * A room this wide or narrower is roofed entirely in its own wall type.
 */
export const CEILING_REACH = 3

/** The wall base tiles each built scene's lids were voted from, for the next build to reuse them (Part IV). */
const wallsOf = new WeakMap<Scene, Map<CellKey, number>>()

function sameWalls(a: Map<CellKey, number>, b: Map<CellKey, number>): boolean {
  if (a.size !== b.size) return false
  for (const [k, v] of a) if (b.get(k) !== v) return false
  return true
}

/**
 * Roof each open cell in the wall type nearest it. Every wall within
 * `CEILING_REACH` (Chebyshev) votes for its base tile, nearer walls counting
 * more, so a vault of other masonry keeps its own lid up to its doorway and a
 * stray odd block does not recolour a whole corridor. Cells out of reach of
 * any wall, and ties, keep the level ceiling and get no per-cell tile.
 *
 * `reuse` is a scene voted from the same walls under the same level lid: a
 * cell it has keeps the lid it had there, and only cells new since then are
 * voted on. The votes are most of a build's cost and the walls seldom change.
 */
function assignCeilings(scene: Scene, wallBase: Map<CellKey, number>, reuse?: Scene): void {
  const level = scene.level.ceilingTile
  if (level === null) return
  const R = CEILING_REACH
  for (const cell of scene.cells.values()) {
    if (cell.kind === 'unknown' || cell.occluder) continue
    if (reuse) {
      const had = reuse.cells.get(cellKey(cell.x, cell.y))
      if (had && !had.occluder && had.kind !== 'unknown') {
        if (had.ceilingTile !== undefined) cell.ceilingTile = had.ceilingTile
        continue
      }
    }
    const votes = new Map<number, number>()
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        if (!dx && !dy) continue
        const base = wallBase.get(cellKey(cell.x + dx, cell.y + dy))
        if (base === undefined) continue
        const w = R + 1 - Math.max(Math.abs(dx), Math.abs(dy))
        votes.set(base, (votes.get(base) || 0) + w)
      }
    }
    if (!votes.size) continue
    let pick: number = level
    let pickN = votes.get(level) || 0
    for (const [t, n] of votes) if (n > pickN) (pick = t), (pickN = n)
    if (pick !== level) cell.ceilingTile = pick
  }
}

function safeBase(gd: Gamedata, id: number): number {
  try {
    return gd.modules.wall.basetile(id)
  } catch {
    return id
  }
}

/** Tutorial cursor first, then CURSOR1..3, as cell_renderer.js draws them. */
function cursorKind(bgw: FlagWord): SceneCell['flags']['cursorKind'] {
  if (bgw.TUT_CURSOR) return 'tutorial'
  if (bgw.CURSOR1) return 'cursor1'
  if (bgw.CURSOR2) return 'cursor2'
  if (bgw.CURSOR3) return 'cursor3'
  return undefined
}

function threatRank(t: Billboard['threat']): number {
  switch (t) {
    case 'nasty':
      return 4
    case 'tough':
      return 3
    case 'invisible':
      return 3
    case 'easy':
      return 2
    case 'trivial':
      return 1
    default:
      return 0
  }
}

function dist(scene: Scene, b: Billboard): number {
  return Math.max(Math.abs(b.x - scene.player.x), Math.abs(b.y - scene.player.y))
}

function buildCell(mc: MapCell, gd: Gamedata): SceneCell | undefined {
  const t = mc.t
  const r = gd.ranges
  const MF = serverEnums(gd).mf
  const bgw = gd.bg(t?.bg)
  const bgIdx = bgw.value
  const cloud = word(t?.cloud) & 0xffff
  const flags = {
    water: !!bgw.WATER || mc.mf === MF.WATER || mc.mf === MF.DEEP_WATER,
    lava: mc.mf === MF.LAVA,
    excluded: !!bgw.TRAV_EXCL || !!bgw.EXCL_CTR || mc.mf === MF.EXCL || mc.mf === MF.EXCL_ROOT,
    travelTrail: !!(t?.travel_trail && t.travel_trail & 0xff),
    newStair: !!bgw.NEW_STAIR,
    cursor: !!(bgw.TUT_CURSOR || bgw.CURSOR1 || bgw.CURSOR2 || bgw.CURSOR3),
    cursorKind: cursorKind(bgw),
    outOfRange: !!bgw.OOR,
    magicMapped: !!bgw.MM_UNSEEN,
  }
  const glyph = mc.g
  const base: SceneCell = {
    x: mc.x,
    y: mc.y,
    kind: 'unknown',
    visibility: 'unseen',
    occluder: true,
    floorTile: 0,
    flags,
    glyph,
    colour: mc.col,
    mf: mc.mf,
  }
  if (mc.flc) {
    const c = FLASH_COLOURS[mc.flc] || FLASH_COLOURS[0]
    base.flash = { r: c[0], g: c[1], b: c[2], a: mc.fla || c[3] }
  }
  if (!t || bgIdx === 0) {
    // no terrain knowledge: keep it as unknown (void). A magic-mapped floor
    // with mf but no tile still counts as unknown for rendering.
    if (mc.mf && mc.mf !== MF.UNSEEN && bgIdx === 0) {
      base.kind = 'unknown'
      base.label = 'unexplored'
    }
    return base
  }
  const visibility: Visibility = !bgw.UNSEEN && !bgw.MM_UNSEEN ? 'visible' : 'remembered'
  base.visibility = visibility
  const name = gd.dngn.baseName(bgIdx) || gd.dngn.name(bgIdx)
  const floorUnder = t.flv?.f ?? bgIdx
  const hasCloud = cloud > 0

  if (bgIdx < r.floorMax) {
    base.kind = 'floor'
    base.occluder = false
    base.floorTile = bgIdx
    base.label = flags.lava ? 'lava' : flags.water ? 'water' : 'floor'
    if (glyph === '#' && !hasCloud) {
      // glyph backstop: a vault wall using a floor-range tile
      base.kind = 'wall'
      base.occluder = true
      base.wallTile = bgIdx
      base.wallStyle = 'solid'
      base.label = 'wall'
    }
  } else if (bgIdx < r.firstTransparent) {
    base.kind = 'wall'
    base.occluder = true
    base.wallTile = bgIdx
    base.wallStyle = 'solid'
    base.floorTile = floorUnder
    base.label = (name || 'wall').replace(/^DNGN_/, '').replace(/^WALL_/, '').toLowerCase().replace(/_/g, ' ')
  } else if (bgIdx < r.wallMax) {
    base.floorTile = floorUnder
    if (glyph === '#' && !hasCloud) {
      base.kind = 'wall'
      base.occluder = true
      base.wallTile = bgIdx
      // glass and crystal walls are see-through; other art in this range is
      // drawn over floor for art reasons and is ordinary masonry
      base.wallStyle = /TRANSPARENT|CRYSTAL|GLASS/.test(name || '') ? 'transparent' : 'solid'
      base.label = (name || 'wall').replace(/^DNGN_/, '').replace(/^WALL_/, '').toLowerCase().replace(/_/g, ' ')
    } else {
      // transparent-range art that is not a wall: a decal or standing thing over floor
      base.kind = 'feature'
      base.occluder = false
      base.featureTile = bgIdx
      const f = classifyFeature(name, glyph, mc.mf, MF)
      base.feature = f
      base.stance = stanceFor(name, f)
      base.label = featureLabel(f, name)
    }
  } else {
    // feature range
    base.floorTile = floorUnder
    const f = classifyFeature(name, glyph, mc.mf, MF)
    if (glyph === '#' && !hasCloud && !f) {
      base.kind = 'wall'
      base.occluder = true
      base.wallTile = bgIdx
      base.wallStyle = 'solid'
      base.label = 'wall'
    } else if (f && f.type === 'door' && f.state !== 'open') {
      base.kind = 'door'
      base.occluder = true
      base.featureTile = bgIdx
      base.wallTile = bgIdx
      base.feature = f
      base.stance = 'upright'
      base.label = f.state === 'closed' ? 'closed door' : f.state + ' door'
    } else {
      base.kind = 'feature'
      base.occluder = false
      base.featureTile = bgIdx
      base.feature = f
      base.stance = stanceFor(name, f)
      base.beacon = beaconFor(f)
      base.label = featureLabel(f, name)
      // trees and statues block movement but not knowledge; treat as passable for rendering.
    }
  }
  decorate(base, t, bgw, gd)
  if (hasCloud) base.cloud = cloud
  return base
}

// ---------------------------------------------------------------------------
// Decorations. This follows the official client's draw_background and the
// icon pass of draw_foreground (cell_renderer.js) so that everything WebTiles
// paints on a cell has a place on the Scene: blood and mould, wall shadows and
// other server overlays, halos, sanctuary, silence, threat rings, travel
// exclusions, the travel trail, and the badges on monsters and items.

const DNGN_NAMES = [
  'DNGN_SHALLOW_WATER',
  'DNGN_WALL_SHADOW',
  'DNGN_WALL_SHADOW_DARK',
  'LIQUEFACTION',
  'BLOOD',
  'MOLD',
  'GLOWING_MOLD',
  'WALL_BLOOD_S',
  'RAY',
  'RAY_MULTI',
  'RAY_OUT_OF_RANGE',
  'KRAKEN_OVERLAY_NW',
  'KRAKEN_OVERLAY_NE',
  'KRAKEN_OVERLAY_SE',
  'KRAKEN_OVERLAY_SW',
  'ELDRITCH_OVERLAY_NW',
  'ELDRITCH_OVERLAY_NE',
  'ELDRITCH_OVERLAY_SE',
  'ELDRITCH_OVERLAY_SW',
  'SANCTUARY',
  'BLASPHEMY',
  'BLOOD_FOR_BLOOD',
  'SILENCED',
  'HALO_RANGE',
  'UMBRA',
  'ORB_GLOW',
  'QUAD_GLOW',
  'DISJUNCT',
  'HALO_FRIENDLY',
  'HALO_GD_NEUTRAL',
  'HALO_NEUTRAL',
  'HALO_SUMMONER',
  'THREAT_TRIVIAL',
  'THREAT_EASY',
  'THREAT_TOUGH',
  'THREAT_NASTY',
  'THREAT_UNUSUAL',
  'THREAT_GHOST_TRIVIAL',
  'THREAT_GHOST_EASY',
  'THREAT_GHOST_TOUGH',
  'THREAT_GHOST_NASTY',
  'TRAVEL_EXCLUSION_BG',
  'TRAVEL_EXCLUSION_CENTRE_BG',
  'REMEMBERED_INVIS',
] as const
const ICON_NAMES = [
  'BERSERK',
  'TRAP_NET',
  'TRAP_WEB',
  'ITEM_STACK_1',
  'ITEM_STACK_2',
  'ITEM_STACK_3',
  'SOMETHING_UNDER',
  'FRIENDLY',
  'GOOD_NEUTRAL',
  'NEUTRAL',
  'UNSEEN_INVIS_REMEMBERED',
  'PARALYSED',
  'STAB_BRAND',
  'UNAWARE',
  'FLEEING',
  'POISON',
  'MORE_POISON',
  'MAX_POISON',
  'RAMPAGE',
  'NEW_STAIR',
  'NEW_TRANSPORTER',
  'TRAVEL_EXCLUSION_FG',
  'TRAVEL_EXCLUSION_CENTRE_FG',
  'TUTORIAL_CURSOR',
  'CURSOR',
  'CURSOR2',
  'CURSOR3',
  'TRAVEL_PATH_FROM',
  'TRAVEL_PATH_TO',
  'MDAM_LIGHTLY_DAMAGED',
  'MDAM_MODERATELY_DAMAGED',
  'MDAM_HEAVILY_DAMAGED',
  'MDAM_SEVERELY_DAMAGED',
  'MDAM_ALMOST_DEAD',
  'DEMON_NUM1',
  'DEMON_NUM2',
  'DEMON_NUM3',
  'DEMON_NUM4',
  'DEMON_NUM5',
] as const
const MAIN_NAMES = ['PARCHMENT_LOW', 'PARCHMENT_HIGH'] as const

type DngnName = (typeof DNGN_NAMES)[number]
type IconName = (typeof ICON_NAMES)[number]
type MainName = (typeof MAIN_NAMES)[number]

interface Ids {
  d: Record<DngnName, number | undefined>
  i: Record<IconName, number | undefined>
  m: Record<MainName, number | undefined>
  /** Wall shadow tiles (tilecell.cc `_pack_wall_shadows`): `DNGN_WALL_SHADOW` and `_DARK`, each with its variants. */
  isWallShadow: (id: number) => boolean
  /** Shoreline tiles (tilecell.cc `_pack_default_waves` and `_pack_shoal_waves`): the `SHORE_*` and wave runs of dc-floor.txt. */
  isShoreline: (id: number) => boolean
}

const idCache = new WeakMap<Gamedata, Ids>()

/**
 * Names a server may legitimately not publish, because the decoration they
 * name is version-specific and the client has another way to draw it (or the
 * flag that would use it does not exist on that server either): the "something
 * under this square" badge is one icon up to 0.34 (`SOMETHING_UNDER`) and three
 * in master (`ITEM_STACK_1..3`), and the remembered-invisible marks arrived in
 * master with the flags that use them. Every other name should resolve on any
 * server; one that does not means the tile was renamed and the decoration has
 * silently stopped being drawn, so `missingTileNames` reports it.
 */
const OPTIONAL_NAMES: ReadonlySet<string> = new Set(['ITEM_STACK_1', 'ITEM_STACK_2', 'ITEM_STACK_3', 'SOMETHING_UNDER', 'UNSEEN_INVIS_REMEMBERED', 'REMEMBERED_INVIS'])

/**
 * Every tile the client draws by name, checked against what this server's
 * tileinfo modules publish. Empty on a server the client knows; a line per
 * name otherwise (the `enumMismatches` treatment for tiles).
 */
export function missingTileNames(gd: Gamedata): string[] {
  const out: string[] = []
  for (const n of DNGN_NAMES) if (!OPTIONAL_NAMES.has(n) && gd.dngn.id(n) === undefined) out.push(`tileinfo has no dungeon tile ${n}`)
  for (const n of ICON_NAMES) if (!OPTIONAL_NAMES.has(n) && gd.icons.id(n) === undefined) out.push(`tileinfo has no icon ${n}`)
  for (const n of MAIN_NAMES) if (!OPTIONAL_NAMES.has(n) && gd.main.id(n) === undefined) out.push(`tileinfo has no main tile ${n}`)
  // the "something under" badge under either name: without one of them the flag draws nothing
  if (gd.icons.id('ITEM_STACK_1') === undefined && gd.icons.id('SOMETHING_UNDER') === undefined) out.push('tileinfo has neither ITEM_STACK_1 nor SOMETHING_UNDER')
  return out
}

/** Tile ids by name, resolved once per gamedata. A name the server does not publish stays undefined and that decoration is simply not drawn. */
function idsFor(gd: Gamedata): Ids {
  let ids = idCache.get(gd)
  if (ids) return ids
  const d = {} as Ids['d']
  const i = {} as Ids['i']
  const m = {} as Ids['m']
  for (const n of DNGN_NAMES) d[n] = gd.dngn.id(n)
  for (const n of ICON_NAMES) i[n] = gd.icons.id(n)
  for (const n of MAIN_NAMES) m[n] = gd.main.id(n)
  const shadowRanges: [number, number][] = []
  for (const n of ['DNGN_WALL_SHADOW', 'DNGN_WALL_SHADOW_DARK'] as const) {
    const first = d[n]
    if (first !== undefined) shadowRanges.push([first, first + gd.tileCount(first)])
  }
  const isWallShadow = (id: number) => shadowRanges.some(([a, b]) => id >= a && id < b)
  // Shorelines come in runs of neighbouring tiles in dc-floor.txt: the five
  // `SHORE_*`, then the shallow-water borders with their colour variations
  // through the murky set, then the deep, shallow and ink waves. A run is
  // taken from its first named tile to the end of its last, so the unnamed
  // variations between them are covered too.
  const shoreRanges: [number, number][] = []
  for (const [first, last] of [
    ['SHORE_N', 'SHORE_NE'],
    ['DNGN_WAVE_N', 'MURKY_WAVE_NW'],
    ['WAVE_DEEP_CORNER_NE', 'WAVE_INK_FULL'],
  ] as const) {
    const a = gd.dngn.id(first)
    if (a === undefined) continue
    const z = gd.dngn.id(last) ?? a
    shoreRanges.push([a, Math.max(a, z) + gd.tileCount(Math.max(a, z))])
  }
  const isShoreline = (id: number) => shoreRanges.some(([a, b]) => id >= a && id < b)
  ids = { d, i, m, isWallShadow, isShoreline }
  idCache.set(gd, ids)
  serverEnums(gd)
  const missing = missingTileNames(gd)
  if (missing.length) console.warn('[orbrun] tiles the client draws by name that this server does not publish:\n' + missing.join('\n'))
  return ids
}

/** Variation of an animated/varied tile chosen by the cell's special flavour, as the official client does. */
function variant(gd: Gamedata, base: number | undefined, seed: number): number | undefined {
  if (base === undefined) return undefined
  return base + (seed % gd.tileCount(base))
}

function bloodTile(gd: Gamedata, ids: Ids, t: CellTiles, onWall: boolean): number | undefined {
  const seed = t.flv?.s ?? 0
  if (t.liquefied && !onWall) return variant(gd, ids.d.LIQUEFACTION, seed)
  if (t.bloody) {
    if (!onWall) return variant(gd, ids.d.BLOOD, seed)
    const b = ids.d.WALL_BLOOD_S
    if (b === undefined) return undefined
    return variant(gd, b + gd.tileCount(b) * (t.blood_rotation || 0), seed)
  }
  if (t.moldy) return variant(gd, ids.d.MOLD, seed)
  if (t.glowing_mold) return variant(gd, ids.d.GLOWING_MOLD, seed)
  return undefined
}

function decorate(cell: SceneCell, t: CellTiles, bgw: FlagWord, gd: Gamedata) {
  const r = gd.ranges
  const ids = idsFor(gd)
  const D = ids.d
  const I = ids.i
  const bgIdx = bgw.value
  const onWall = cell.kind === 'wall' || cell.kind === 'door'
  const under: number[] = []
  const over: number[] = []
  const wall: number[] = []
  const icons: number[] = []
  const shadows: number[] = []
  const shores: number[] = []
  const translucent: number[] = []
  // decals on the bg tile itself: on the wall face for walls, over the floor otherwise
  const push = (id: number | undefined) => {
    if (id !== undefined && id > 0) {
      ;(onWall ? wall : over).push(id)
      if (!onWall && ids.isWallShadow(id)) shadows.push(id)
      if (!onWall && ids.isShoreline(id)) shores.push(id)
      if (id === D.TRAVEL_EXCLUSION_BG || id === D.TRAVEL_EXCLUSION_CENTRE_BG) translucent.push(id)
    }
  }
  const ov = t.ov || []

  if (t.mangrove_water && bgIdx > 0) {
    // a mangrove stands in shallow water
    if (D.DNGN_SHALLOW_WATER !== undefined) cell.floorTile = D.DNGN_SHALLOW_WATER
  } else if (bgIdx >= r.firstTransparent) {
    // floor patterns beneath a transparent feature
    for (const o of ov) if (o > 0 && o < r.floorMax) under.push(o)
  }
  // blood beneath a feature tile
  if (bgIdx >= r.wallMax) {
    const b = bloodTile(gd, ids, t, false)
    if (b !== undefined) under.push(b)
  }
  if (bgIdx > 0) {
    // blood on top of floor and wall tiles
    if (bgIdx < r.wallMax) push(bloodTile(gd, ids, t, bgIdx >= r.floorMax))
    // server overlays: beams last, main-range ones (zaps) are billboards
    let ray: number | undefined
    for (const o of ov) {
      if (o <= 0 || o >= r.featMax) continue
      if (o === D.RAY || o === D.RAY_MULTI || o === D.RAY_OUT_OF_RANGE) ray = o
      else if (bgIdx < r.firstTransparent || o >= r.floorMax) push(o)
    }
    if (ray !== undefined) push(ray)
    if (!bgw.UNSEEN) {
      if (bgw.KRAKEN_NW) push(D.KRAKEN_OVERLAY_NW)
      else if (bgw.ELDRITCH_NW) push(D.ELDRITCH_OVERLAY_NW)
      if (bgw.KRAKEN_NE) push(D.KRAKEN_OVERLAY_NE)
      else if (bgw.ELDRITCH_NE) push(D.ELDRITCH_OVERLAY_NE)
      if (bgw.KRAKEN_SE) push(D.KRAKEN_OVERLAY_SE)
      else if (bgw.ELDRITCH_SE) push(D.ELDRITCH_OVERLAY_SE)
      if (bgw.KRAKEN_SW) push(D.KRAKEN_OVERLAY_SW)
      else if (bgw.ELDRITCH_SW) push(D.ELDRITCH_OVERLAY_SW)

      if (t.sanctuary) push(D.SANCTUARY)
      if (t.blasphemy) push(D.BLASPHEMY)
      if (t.has_bfb_corpse) push(D.BLOOD_FOR_BLOOD)
      if (t.silenced) push(D.SILENCED)
      const HALO = serverEnums(gd).halo
      const halo = t.halo || 0
      if (halo === HALO.RANGE) push(D.HALO_RANGE)
      if (halo >= HALO.UMBRA_FIRST && halo <= HALO.UMBRA_LAST && D.UMBRA !== undefined) push(D.UMBRA + halo - HALO.UMBRA_FIRST)
      if (t.orb_glow && D.ORB_GLOW !== undefined) push(D.ORB_GLOW + t.orb_glow - 1)
      if (t.quad_glow) push(D.QUAD_GLOW)
      if (t.disjunct && D.DISJUNCT !== undefined) push(D.DISJUNCT + t.disjunct - 1)
      if (t.awakened_forest) push(I.BERSERK)

      const fgw = gd.fg(t.fg)
      if (fgw.value || t.fg) {
        if (fgw.PET) push(D.HALO_FRIENDLY)
        else if (fgw.GD_NEUTRAL) push(D.HALO_GD_NEUTRAL)
        else if (fgw.NEUTRAL) push(D.HALO_NEUTRAL)
        // monster threat; ghosts get their own ring
        if (fgw.GHOST) {
          if (fgw.TRIVIAL) push(D.THREAT_GHOST_TRIVIAL)
          else if (fgw.EASY) push(D.THREAT_GHOST_EASY)
          else if (fgw.TOUGH) push(D.THREAT_GHOST_TOUGH)
          else if (fgw.NASTY) push(D.THREAT_GHOST_NASTY)
          else if (fgw.UNUSUAL) push(D.THREAT_UNUSUAL)
        } else {
          if (fgw.TRIVIAL) push(D.THREAT_TRIVIAL)
          else if (fgw.EASY) push(D.THREAT_EASY)
          else if (fgw.TOUGH) push(D.THREAT_TOUGH)
          else if (fgw.NASTY) push(D.THREAT_NASTY)
          else if (fgw.UNUSUAL) push(D.THREAT_UNUSUAL)
        }
        if (t.highlighted_summoner) push(D.HALO_SUMMONER)
      }
      // travel exclusion under the foreground while visible; a badge when unseen
      if (bgw.EXCL_CTR) push(D.TRAVEL_EXCLUSION_CENTRE_BG)
      else if (bgw.TRAV_EXCL) push(D.TRAVEL_EXCLUSION_BG)
    }
    if (bgw.REMEMBERED_INVIS) push(D.REMEMBERED_INVIS)
  }

  // badges drawn above everything at the cell
  if (bgw.RAMPAGE && I.RAMPAGE !== undefined) icons.push(I.RAMPAGE)
  if (bgw.UNSEEN) {
    if (bgw.EXCL_CTR && I.TRAVEL_EXCLUSION_CENTRE_FG !== undefined) icons.push(I.TRAVEL_EXCLUSION_CENTRE_FG)
    else if (bgw.TRAV_EXCL && I.TRAVEL_EXCLUSION_FG !== undefined) icons.push(I.TRAVEL_EXCLUSION_FG)
  }
  // cursors: the tutorial cursor takes precedence over the others
  const ck = cell.flags.cursorKind
  if (ck) {
    const cid = ck === 'tutorial' ? I.TUTORIAL_CURSOR : ck === 'cursor1' ? I.CURSOR : ck === 'cursor2' ? I.CURSOR2 : I.CURSOR3
    if (cid !== undefined) icons.push(cid)
  }
  // travel trail: the step that led here and the step that leaves, as arrows
  const trail = t.travel_trail || 0
  if (trail & 0xf && I.TRAVEL_PATH_FROM !== undefined) icons.push(I.TRAVEL_PATH_FROM + (trail & 0xf) - 1)
  if (trail & 0xf0 && I.TRAVEL_PATH_TO !== undefined) icons.push(I.TRAVEL_PATH_TO + ((trail & 0xf0) >> 4) - 1)

  // as headings of travel. Crawl's index is the delta from the other cell to
  // this one, counted 1 S, 2 SW, 3 W, 4 NW, 5 N, 6 NE, 7 E, 8 SE (tileview.cc
  // _get_direction_index); Dir8 counts 0 N clockwise, so index + 3 mod 8.
  const trailFrom = trail & 0xf
  const trailTo = (trail & 0xf0) >> 4
  if (trailFrom || trailTo) {
    cell.trail = {}
    // "from": delta = cell - previous, which is the way the walk came in
    if (trailFrom) cell.trail.from = ((trailFrom + 3) % 8) as Dir8
    // "to": delta = cell - next, the opposite of the way the walk went on
    if (trailTo) cell.trail.to = ((trailTo + 7) % 8) as Dir8
  }

  if (under.length) cell.underlays = under
  if (over.length) cell.overlays = over
  if (shadows.length) cell.wallShadows = shadows
  if (shores.length) cell.shorelines = shores
  if (wall.length) cell.wallOverlays = wall
  if (translucent.length) cell.translucent = translucent
  if (icons.length) cell.icons = icons
}

interface StatusRow {
  icons: NonNullable<Billboard['statusIcons']>
  /** How far the shifting row has moved (cell_renderer.js status_shift). */
  shift: number
}

/**
 * Status badges for the thing in the foreground, laid out as the official
 * client's draw_foreground does: fixed-position marks first, then a row of
 * status icons that shifts left as it fills. Server `icons` use the
 * server's own status-icon-sizes table: -1 not drawn, 0 fixed, n shifts.
 */
function statusIcons(t: CellTiles, fgw: FlagWord, bgw: FlagWord, gd: Gamedata, state: GameState): StatusRow {
  const I = idsFor(gd).i
  const out: StatusRow['icons'] = []
  const add = (id: number | undefined, ox = 0, oy = 0, at?: 'top') => {
    if (id !== undefined) out.push(at ? { tile: id, ox, oy, at } : { tile: id, ox, oy })
  }
  // a mark about the square rather than the thing on it (Billboard.statusIcons `square`)
  const under = (id: number | undefined) => {
    if (id !== undefined) out.push({ tile: id, ox: 0, oy: 0, square: true })
  }
  // the net and the web cover the whole cell (Billboard.statusIcons `full`)
  const full = (id: number | undefined) => {
    if (id !== undefined) out.push({ tile: id, ox: 0, oy: 0, full: true })
  }
  if (fgw.NET) full(I.TRAP_NET)
  if (fgw.WEB) full(I.TRAP_WEB)
  // "something under this square": one icon (SOMETHING_UNDER) up to 0.34, three
  // by what lies there (ITEM_STACK_1..3) in master, where the flag also split
  // into S_UNDER / _GOOD / _ARTEFACT. Fall back so both servers get the badge.
  if (fgw.S_UNDER) under(I.ITEM_STACK_1 ?? I.SOMETHING_UNDER)
  else if (fgw.S_UNDER_GOOD) under(I.ITEM_STACK_2 ?? I.SOMETHING_UNDER)
  else if (fgw.S_UNDER_ARTEFACT) under(I.ITEM_STACK_3 ?? I.SOMETHING_UNDER)
  if (fgw.PET) add(I.FRIENDLY)
  else if (fgw.GD_NEUTRAL) add(I.GOOD_NEUTRAL)
  else if (fgw.NEUTRAL) add(I.NEUTRAL)
  if (bgw.REMEMBERED_INVIS) add(I.UNSEEN_INVIS_REMEMBERED)
  let shift = 0
  if (fgw.PARALYSED) (add(I.PARALYSED), (shift += 12))
  else if (fgw.STAB) (add(I.STAB_BRAND), (shift += 12))
  else if (fgw.MAY_STAB) (add(I.UNAWARE), (shift += 7))
  else if (fgw.FLEEING) (add(I.FLEEING), (shift += 3))
  if (fgw.POISON) (add(I.POISON, -shift), (shift += 5))
  else if (fgw.MORE_POISON) (add(I.MORE_POISON, -shift), (shift += 5))
  else if (fgw.MAX_POISON) (add(I.MAX_POISON, -shift), (shift += 5))
  for (const id of t.icons || []) {
    if (typeof id !== 'number') continue
    const size = gd.statusIconSize(id)
    if (size < 0) continue
    if (size === 0) add(id)
    else {
      add(id, -shift)
      shift += size
    }
  }
  // the damage bar: the icon paints it across the sprite's feet (rows 30-31);
  // Orbrun pins it to the top of the frame, over the head, where the player's
  // own bars sit (scene bars.ts), so every health bar in view reads the same way
  if (fgw.MDAM_LIGHT) add(I.MDAM_LIGHTLY_DAMAGED, 0, 0, 'top')
  else if (fgw.MDAM_MOD) add(I.MDAM_MODERATELY_DAMAGED, 0, 0, 'top')
  else if (fgw.MDAM_HEAVY) add(I.MDAM_HEAVILY_DAMAGED, 0, 0, 'top')
  else if (fgw.MDAM_SEV) add(I.MDAM_SEVERELY_DAMAGED, 0, 0, 'top')
  else if (fgw.MDAM_ADEAD) add(I.MDAM_ALMOST_DEAD, 0, 0, 'top')
  if (state.options.tile_show_demon_tier === true) {
    if (fgw.DEMON_1) add(I.DEMON_NUM1)
    else if (fgw.DEMON_2) add(I.DEMON_NUM2)
    else if (fgw.DEMON_3) add(I.DEMON_NUM3)
    else if (fgw.DEMON_4) add(I.DEMON_NUM4)
    else if (fgw.DEMON_5) add(I.DEMON_NUM5)
  }
  return { icons: out, shift }
}

/**
 * The "new stairs" / "new transporter" badge, drawn unless the shifting
 * status row has moved (cell_renderer.js: `bg.NEW_STAIR && status_shift == 0`).
 * Fixed-position marks (nets, pet marks, damage) do not suppress it.
 */
function newFeatureBadge(cell: SceneCell, bgw: FlagWord, gd: Gamedata, statusShift: number) {
  if (statusShift !== 0) return
  const I = idsFor(gd).i
  const id = bgw.NEW_STAIR ? I.NEW_STAIR : bgw.NEW_TRANSPORTER ? I.NEW_TRANSPORTER : undefined
  if (id === undefined) return
  cell.icons = [...(cell.icons || []), id]
}

/**
 * What kind of shop the tile is (tilepick.cc `tileidx_shop`: TILE_SHOP_WEAPONS
 * for both weapon shops, TILE_SHOP_POTIONS for a distillery, ...), as its
 * wares read: "weapon shop", "book shop". The shopkeeper's own name
 * (shopping.cc `shop_name`, "Fizz's Antique Weapon Boutique") is never sent
 * per square — the client only ever hears it in a message ("Found ...") or in
 * the shop menu's own title — so the kind is as close as a label can get.
 */
function shopLabel(name: string | undefined): string {
  const m = /^SHOP_(.+)$/.exec(name || '')
  if (!m) return 'shop'
  return m[1].toLowerCase().replace(/_/g, ' ').replace(/s$/, '') + ' shop'
}

function featureLabel(f: Feature | undefined, name: string | undefined): string {
  if (f) {
    switch (f.type) {
      case 'stairs':
        return f.exit ? 'exit from the dungeon' : f.branch ? 'branch entrance' : f.dir === 'down' ? 'stairs down' : 'stairs up'
      case 'hatch':
        return f.dir === 'down' ? 'hatch down' : 'hatch up'
      case 'door':
        return f.state + ' door'
      case 'altar':
        return f.god ? 'altar of ' + f.god : 'altar'
      case 'shop':
        return shopLabel(name)
      case 'fountain':
        return f.kind.replace(/_/g, ' ')
      case 'portal':
        return 'portal'
      case 'transporter':
        return 'transporter'
      case 'trap':
        return f.kind ? f.kind.replace(/_/g, ' ') + ' trap' : 'trap'
      case 'other':
        return f.name.replace(/_/g, ' ')
    }
  }
  return (name || 'feature').replace(/^DNGN_/, '').toLowerCase().replace(/_/g, ' ')
}

function addBillboards(scene: Scene, mc: MapCell, cell: SceneCell, gd: Gamedata, state: GameState) {
  const t = mc.t
  if (!t) return
  const r = gd.ranges
  const fgw = gd.fg(t.fg)
  const bgw = gd.bg(t.bg)
  const fgIdx = fgw.value
  const isPlayerCell = scene.playerOnLevel && mc.x === state.player.pos.x && mc.y === state.player.pos.y
  const alpha = t.trans ? 0.55 : undefined
  if (cell.cloud) {
    scene.billboards.push({ x: mc.x, y: mc.y, tile: cell.cloud, kind: 'cloud', height: 0.9 })
  }
  // main-range server overlays are beams and zaps in flight
  for (const o of t.ov || []) {
    if (o >= r.featMax && o < r.mainMax) scene.billboards.push({ x: mc.x, y: mc.y, tile: o, kind: 'projectile', height: 0.5 })
  }
  const row = statusIcons(t, fgw, bgw, gd, state)
  const badges = row.icons
  const M = idsFor(gd).m
  const parchment = M.PARCHMENT_LOW !== undefined && M.PARCHMENT_HIGH !== undefined && fgIdx >= M.PARCHMENT_LOW && fgIdx <= M.PARCHMENT_HIGH
  if (isPlayerCell) {
    // the player is the camera; still expose the doll so a 2D renderer can draw it
    if (t.doll && t.doll.length) {
      scene.billboards.push({
        x: mc.x,
        y: mc.y,
        tile: t.doll[0][0],
        kind: 'player',
        height: 0.7,
        layers: dollLayers(t),
        statusIcons: badges.length ? badges : undefined,
        alpha,
      })
    }
    newFeatureBadge(cell, bgw, gd, row.shift)
    return
  }
  if (!fgIdx) {
    newFeatureBadge(cell, bgw, gd, row.shift)
    if (badges.length) cell.icons = [...(cell.icons || []), ...badges.map((b) => b.tile)]
    return
  }
  const mon = mc.mon
  // Monsters go on the scene whenever the server still reports one on the
  // cell, visible or remembered (sensed, detected), as the 2D client draws
  // them. Renderers dim remembered cells; the sidebar filters on visibility.
  if (mon) {
    const bb: Billboard = {
      x: mc.x,
      y: mc.y,
      tile: fgIdx,
      kind: 'monster',
      height: monsterHeight(mon, fgIdx, gd),
      name: mon.name,
      scenery: isScenery(mon.name) || undefined,
      attitude: ATTITUDE[mon.att] || 'hostile',
      threat: THREAT[mon.threat ?? 0],
      damage: damageLevel(fgw),
      ref: mon,
      alpha,
    }
    if (fgIdx >= r.mainMax && t.doll && t.doll.length) {
      bb.layers = dollLayers(t)
    } else if (fgIdx >= r.mcacheStart && t.mcache && t.mcache.length) {
      bb.layers = t.mcache.filter((m) => Array.isArray(m)).map((m) => ({ tile: m[0], ox: m[1], oy: m[2] }))
    } else {
      // a plain main-range sprite, possibly over a base tile (mimics, submerged things)
      const layers: { tile: number }[] = []
      if (t.base) layers.push({ tile: t.base })
      layers.push({ tile: fgIdx })
      if (parchment) {
        if (t.overlay1) layers.push({ tile: t.overlay1 })
        if (t.overlay2) layers.push({ tile: t.overlay2 })
      }
      if (layers.length > 1) bb.layers = layers
    }
    if (badges.length) bb.statusIcons = badges
    scene.billboards.push(bb)
    newFeatureBadge(cell, bgw, gd, row.shift)
    return
  }
  if (fgIdx < r.mainMax && fgIdx >= r.featMax) {
    // an item
    const name = gd.main.baseName(fgIdx) || ''
    const isTree = /TREE|MANGROVE|PLANT|BUSH/.test(name)
    const layers: { tile: number }[] = []
    if (t.base) layers.push({ tile: t.base })
    layers.push({ tile: fgIdx })
    if (parchment) {
      if (t.overlay1) layers.push({ tile: t.overlay1 })
      if (t.overlay2) layers.push({ tile: t.overlay2 })
    }
    scene.billboards.push({
      x: mc.x,
      y: mc.y,
      tile: fgIdx,
      kind: 'item',
      height: isTree ? 0.95 : 0.4,
      scenery: isTree || undefined,
      layers: layers.length > 1 ? layers : undefined,
      statusIcons: badges.length ? badges : undefined,
      alpha,
      name: itemTileName(name) || undefined,
    })
    newFeatureBadge(cell, bgw, gd, row.shift)
  } else newFeatureBadge(cell, bgw, gd, row.shift)
}

/**
 * What a map cell's item tile says the top item is, in words. The server
 * sends a cell no item name, only its tile (tileweb.cc `_send_cell`: `fg`,
 * and `base` from `tileidx_known_base_item`), so this is the picture read
 * back: the tile's base name (variations collapsed by the gamedata's own
 * basetile table) with the sprite-set affixes dropped (`WPN_`, `ARM_`,
 * `MI_`, `FOOD_`, `MISC_`, `UNSEEN_`, `_MAGIC`, `_RANDART`, `_OFFSET_n`,
 * trailing digits) and the typed classes joined with "of" (WAND_FLAME "wand
 * of flame", SCR_IDENTIFY "scroll of identify", POTION_OFFSET_3 "potion",
 * CORPSE_BAT "bat corpse", MI_ARROW_STEEL "steel arrow"). The item's own
 * name, with its enchantment and count, is only ever printed by the server
 * once the player stands on it (`floorItemsLabel`). "" when the tile has no
 * name.
 */
export function itemTileName(tile: string | undefined): string {
  if (!tile) return ''
  let n = tile.replace(/^(UNSEEN|WPN|ARM|MI|FOOD|MISC)_/, '')
  n = n.replace(/_(NORMAL|RANDART)?_?OFFSET(_\d+)?$/, '').replace(/_?\d+$/, '').replace(/_(MAGIC|RANDART|INERT)$/, '').replace(/_?\d+$/, '')
  if (/^PARCHMENT_/.test(n)) return 'parchment'
  if (/^(BOOK|GEM|TALISMAN)(_|$)/.test(n)) return RegExp.$1.toLowerCase()
  const corpse = /^CORPSE_(.+)$/.exec(n)
  if (corpse) return corpse[1].toLowerCase().replace(/_/g, ' ') + ' corpse'
  const m = /^(WAND|RING|AMU|AMULET|POT|POTION|SCR|SCROLL|STAFF)(?:_(.+))?$/.exec(n)
  if (m) {
    const cls = { AMU: 'amulet', POT: 'potion', SCR: 'scroll' }[m[1]] ?? m[1].toLowerCase()
    return m[2] ? cls + ' of ' + m[2].toLowerCase().replace(/_/g, ' ') : cls
  }
  // a missile's material or coating is a suffix on the tile and an adjective in the name
  const adj = /^(.+)_(STEEL|SILVER|POISONED|CURARE|BLINDING|FRENZY)$/.exec(n)
  if (adj) n = adj[2] + '_' + adj[1]
  return n.toLowerCase().replace(/_/g, ' ')
}

/**
 * Doll parts with the mcache offsets the official client applies
 * (cell_renderer.js draw_dolls): each part whose tile has an mcache entry is
 * drawn at that entry's x/y offset. Used for the player and for monsters
 * drawn from dolls.
 */
function dollLayers(t: CellTiles): { tile: number; ox?: number; oy?: number; ymax?: number }[] {
  const mcache = new Map<number, [number, number, number]>()
  if (Array.isArray(t.mcache)) for (const m of t.mcache) if (Array.isArray(m)) mcache.set(m[0], m)
  return (t.doll || [])
    .filter((d): d is [number, number] => Array.isArray(d) && typeof d[0] === 'number')
    .map((d) => {
      const mc2 = mcache.get(d[0])
      return { tile: d[0], ox: mc2?.[1] || 0, oy: mc2?.[2] || 0, ymax: d[1] }
    })
}

/** Monsters that are stationary vegetation, drawn as fixtures rather than actors. */
const VEGETATION = /tree|mangrove|plant|bush|fungus|oklob|lotus/i
export function isVegetation(name: string | undefined): boolean {
  return VEGETATION.test(name || '')
}

/**
 * Stationary non-living monsters that are really terrain: piles of debris
 * (0.34), briar patches, pillars of salt, blocks of ice. Like vegetation they
 * are fixtures: a monster behind one opens a sight window in it instead of
 * being painted over.
 */
const RUBBLE = /pile of debris|briar patch|pillar of salt|block of ice/i
export function isScenery(name: string | undefined): boolean {
  return isVegetation(name) || RUBBLE.test(name || '')
}

function monsterHeight(mon: Monster, tile: number, gd: Gamedata): number {
  const hp = mon.typedata?.avghp ?? 20
  const name = mon.name || ''
  if (isVegetation(name)) return 0.95
  // low piles: an actor behind one should show over its top
  if (RUBBLE.test(name)) return 0.5
  let h = 0.55
  if (hp >= 200) h = 0.95
  else if (hp >= 100) h = 0.85
  else if (hp >= 50) h = 0.72
  else if (hp >= 20) h = 0.62
  else if (hp >= 8) h = 0.5
  else h = 0.4
  const rect = gd.tile(tile)
  if (rect) {
    // tiny sprites (rats, bats) stay small even if hp says otherwise
    const px = rect.h / 32
    h = Math.min(h, Math.max(0.3, px * 0.95))
  }
  return h
}

/** monster_list.js: the wound classes the glyph-mode health box takes, from the MDAM flags. */
function damageLevel(fgw: FlagWord): Billboard['damage'] {
  if (fgw.MDAM_LIGHT) return 'lightly_damaged'
  if (fgw.MDAM_MOD) return 'moderately_damaged'
  if (fgw.MDAM_HEAVY) return 'heavily_damaged'
  if (fgw.MDAM_SEV) return 'severely_damaged'
  if (fgw.MDAM_ADEAD) return 'almost_dead'
  return 'uninjured'
}

/** monster_list.js `is_excluded`: no-experience monsters stay out of the list, bar the two the official client keeps. */
export function isExcludedFromList(m: Monster): boolean {
  return !!m.typedata?.no_exp && !(m.name === 'active ballistomycete' || /tentacle$/.test(m.name || ''))
}

/**
 * monster_list.js `monster_sort`, a port of `monster_info::less_than`:
 * attitude, then average hit points (descending), then type (descending),
 * named monsters (by client id) after unnamed of the same kind, then name.
 * Two monsters that compare equal share a row.
 */
export function monsterSort(m1: Monster, m2: Monster): number {
  if (m1.att < m2.att) return -1
  if (m1.att > m2.att) return 1
  const hp1 = m1.typedata?.avghp ?? 0
  const hp2 = m2.typedata?.avghp ?? 0
  if (hp1 > hp2) return -1
  if (hp1 < hp2) return 1
  const t1 = m1.type ?? 0
  const t2 = m2.type ?? 0
  if (t1 < t2) return 1
  if (t1 > t2) return -1
  // don't sort two same-name monsters together
  const named1 = Object.prototype.hasOwnProperty.call(m1, 'clientid')
  const named2 = Object.prototype.hasOwnProperty.call(m2, 'clientid')
  if (named1 || named2) {
    if (!named2) return -1
    if (!named1) return 1
    if ((m1.clientid as number) < (m2.clientid as number)) return -1
    return 1
  }
  if (m1.name < m2.name) return 1
  if (m1.name > m2.name) return -1
  return 0
}

/** Visible monsters in sidebar order, with the raw record. */
export function visibleMonsters(scene: Scene): Billboard[] {
  return scene.billboards
    .filter((b) => {
      if (b.kind !== 'monster' || !b.ref) return false
      if (scene.cells.get(cellKey(b.x, b.y))?.visibility !== 'visible') return false
      return !isExcludedFromList(b.ref as Monster)
    })
    .sort((a, b) => monsterSort(a.ref as Monster, b.ref as Monster))
}

/**
 * monster_list.js `group_monsters`: the visible monsters sorted, then runs
 * of monsters that compare equal combined into one group. Each group is a
 * row of the sidebar: up to six sprites and either the name or
 * "<count> <plural>".
 */
export function monsterGroups(scene: Scene): Billboard[][] {
  const groups: Billboard[][] = []
  let last: Billboard[] | null = null
  for (const b of visibleMonsters(scene)) {
    if (last && monsterSort(last[0].ref as Monster, b.ref as Monster) === 0) last.push(b)
    else {
      last = [b]
      groups.push(last)
    }
  }
  return groups
}

// ---------------------------------------------------------------------------
// Viewmodel

/**
 * The player's hands. `weapon_index` in the `player` message is the wielded
 * item's inventory slot, -1 when unarmed; `offhand_index` is an off-hand
 * *weapon* (a Coglin's second weapon), -1 otherwise. Neither the inventory
 * nor the player message says which armour is worn, so a shield or orb comes
 * from the paperdoll on the player's cell: the doll part whose player-tile
 * name is `HAND2_*` is what the off hand holds, drawn from the player
 * texture. With no gamedata, or no such part, the off hand is empty. The
 * item's own `tile` list is the icon, in either wire shape: plain main-range
 * ids (0.34 and earlier) or `{t, tex, ymax}` records naming the texture.
 */
export function viewmodelFor(state: GameState, gd?: Gamedata): Viewmodel {
  const p = state.player
  return { weapon: handItem(p.inv[p.weapon_index]), offhand: handItem(p.inv[p.offhand_index]) ?? (gd ? dollOffhand(state, gd) : null) }
}

/** The paperdoll's off-hand part (`HAND2_*`: shields, orbs) on the player's cell, if any. */
function dollOffhand(state: GameState, gd: Gamedata): HandItem | null {
  if (!state.map.playerOnLevel) return null
  const doll = state.map.cells.get(mapKey(state.player.pos.x, state.player.pos.y))?.t?.doll
  if (!Array.isArray(doll)) return null
  const tex = gd.enums.texture?.PLAYER
  for (const d of doll) {
    if (!Array.isArray(d) || typeof d[0] !== 'number') continue
    const name = gd.player.name(d[0])
    if (!name || !name.startsWith('HAND2_')) continue
    return { layers: [{ tile: d[0], layer: tex !== undefined ? String(tex) : 'player', ymax: typeof d[1] === 'number' ? d[1] : undefined }], name }
  }
  return null
}

function handItem(item: InvItem | undefined): HandItem | null {
  if (!item || !Array.isArray(item.tile)) return null
  const layers: HandItem['layers'] = []
  for (const t of item.tile as unknown[]) {
    if (typeof t === 'number') layers.push({ tile: t })
    else if (t && typeof t === 'object' && typeof (t as { t?: unknown }).t === 'number') {
      const r = t as { t: number; tex?: number; ymax?: number }
      layers.push({ tile: r.t, layer: typeof r.tex === 'number' ? String(r.tex) : undefined, ymax: typeof r.ymax === 'number' ? r.ymax : undefined })
    }
  }
  if (!layers.length) return null
  return { layers, name: item.name }
}
