/**
 * @orbrun/scene
 *
 * A description of a grid world that has already been classified, plus the
 * contracts renderers implement and consume. No dependencies, no knowledge of
 * DCSS or WebTiles. Everything here can be built by hand from any source.
 */

// ---------------------------------------------------------------------------
// Basic geometry

export type TileId = number

export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

import type { WoundLevel } from './bars.js'

export * from './bars.js'

/** 8 compass headings, clockwise from north. North is -y. */
export type Dir8 = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7

export const DIR8_DX = [0, 1, 1, 1, 0, -1, -1, -1] as const
export const DIR8_DY = [-1, -1, 0, 1, 1, 1, 0, -1] as const

export function dirFromDelta(dx: number, dy: number): Dir8 | null {
  const sx = Math.sign(dx)
  const sy = Math.sign(dy)
  for (let i = 0; i < 8; i++) if (DIR8_DX[i] === sx && DIR8_DY[i] === sy) return i as Dir8
  return null
}

export function rotateDir(d: Dir8, by: number): Dir8 {
  return (((d + by) % 8) + 8) % 8 as Dir8
}

export function dirToYaw(d: Dir8): number {
  return (d * Math.PI) / 4
}

export function yawToDir(yaw: number): Dir8 {
  const q = Math.round(yaw / (Math.PI / 4))
  return ((q % 8) + 8) % 8 as Dir8
}

export function normalizeYaw(yaw: number): number {
  const two = Math.PI * 2
  let y = yaw % two
  if (y < 0) y += two
  return y
}

/** Signed shortest angular distance from a to b. */
export function yawDelta(a: number, b: number): number {
  const two = Math.PI * 2
  let d = (b - a) % two
  if (d > Math.PI) d -= two
  if (d < -Math.PI) d += two
  return d
}

// ---------------------------------------------------------------------------
// Cells

export type CellKey = number

/** Coordinates in [-512, 512) pack into one integer key. */
export function cellKey(x: number, y: number): CellKey {
  return ((y + 512) << 10) | (x + 512)
}

export function keyToXY(key: CellKey): { x: number; y: number } {
  return { x: (key & 1023) - 512, y: (key >> 10) - 512 }
}

export type CellKind = 'unknown' | 'floor' | 'wall' | 'door' | 'feature'
export type Visibility = 'visible' | 'remembered' | 'unseen'

export type Feature =
  /**
   * `branch`: the stair into a branch (name says entrance, minimap says
   * branch stair). `exit`: crawl's `DNGN_EXIT_DUNGEON`, the up staircase the
   * game starts on (feature-data.h: glyph `<`, minimap `MF_STAIR_UP`); `<`
   * there ends the game, so it is not an ascent to prompt as one.
   */
  | { type: 'stairs'; dir: 'up' | 'down'; branch?: boolean; exit?: boolean }
  | { type: 'hatch'; dir: 'up' | 'down' }
  | { type: 'door'; state: 'open' | 'closed' | 'runed' | 'sealed' }
  | { type: 'altar'; god?: string }
  | { type: 'shop' }
  | { type: 'fountain'; kind: string }
  | { type: 'portal' }
  | { type: 'transporter' }
  | { type: 'trap'; kind?: string }
  | { type: 'other'; name: string }

export interface SceneCell {
  x: number
  y: number
  kind: CellKind
  visibility: Visibility
  /** Stands full height: wall, closed door, void. */
  occluder: boolean
  floorTile: TileId
  wallTile?: TileId
  wallStyle?: 'solid' | 'transparent'
  /**
   * Ceiling over this open cell when it differs from the level's: the base
   * tile of the walls nearest it, so a vault built of other masonry keeps its
   * own lid. Unset means `SceneLevel.ceilingTile`.
   */
  ceilingTile?: TileId
  featureTile?: TileId
  feature?: Feature
  stance?: 'upright' | 'decal'
  beacon?: 'down' | 'up' | 'portal'
  /** Ground decals under the feature tile: floor patterns and blood beneath stairs, altars and the like. */
  underlays?: TileId[]
  /**
   * Ground decals over the floor and feature, in draw order: blood and mould,
   * wall shadows and other server overlays, halos and sanctuary, threat rings,
   * travel exclusions. Under anything standing in the cell.
   */
  overlays?: TileId[]
  /**
   * The wall shadows among `overlays`: crawl's `DNGN_WALL_SHADOW*` tiles
   * (tilecell.cc `_pack_wall_shadows`), a dark gradient the server lays on a
   * floor cell along each edge that touches a wall so the top-down view reads
   * as lit from above. 2D paints them with the other overlays, in place. 3D
   * skips them: its walls are geometry, and a floor decal at the cell edge
   * beside an inset wall reads as a grout line, not a shadow.
   */
  wallShadows?: TileId[]
  /**
   * The shorelines among `overlays`: crawl's `SHORE_*` and `*WAVE_*` tiles
   * (tilecell.cc `_pack_default_waves`), a one-texel line the server lays
   * along the edge where water meets land, shallow water or deep. 2D paints
   * them with the other overlays. 3D skips them: laid flat and seen from eye
   * height a one-texel line is a scratch on the floor rather than a wave.
   */
  shorelines?: TileId[]
  /** Decals on a wall or closed door face (blood splatter, silence). */
  wallOverlays?: TileId[]
  /**
   * The translucent marks among `overlays` and `wallOverlays`: crawl's
   * travel-exclusion X, a tile whose every texel is see-through (a black body
   * at two-thirds alpha, red edges at under half). 2D blends it. 3D draws it
   * blended too, over its floor or wall face: under the level's opaque alpha
   * test the red edges vanish and the body prints as solid black.
   */
  translucent?: TileId[]
  /**
   * Cell markers drawn above everything at the cell: travel-trail arrows, the
   * "new stairs" badge, exclusion marks on unseen cells, rampage hints.
   */
  icons?: TileId[]
  cloud?: TileId
  /**
   * The travel trail through this cell (`show_travel_trail`): the heading the
   * walk arrived on and the heading it left on, as directions of travel. The
   * player's own cell carries `from` for the last step made; the cell behind
   * carries the matching `to`.
   */
  trail?: { from?: Dir8; to?: Dir8 }
  flags: {
    water: boolean
    lava: boolean
    excluded: boolean
    travelTrail: boolean
    newStair: boolean
    cursor: boolean
    /**
     * Which cursor flag the server set on the cell, in WebTiles' precedence:
     * the tutorial cursor wins over CURSOR1 (mouse), CURSOR2, CURSOR3.
     */
    cursorKind?: 'tutorial' | 'cursor1' | 'cursor2' | 'cursor3'
    /** Out of range for the current targeting prompt. */
    outOfRange: boolean
    /** Known through magic mapping only, never seen. */
    magicMapped: boolean
  }
  /** Flash colour as rgba 0..255, when the game flashes this cell. */
  flash?: { r: number; g: number; b: number; a: number }
  /** Glyph and colour fallback, so a renderer without tiles can still draw. */
  glyph?: string
  colour?: number
  /** Opaque description used for the reticle label. */
  label?: string
  /** The server's minimap feature category for the cell (`map-feature.h`), for the `tile_*_col` palette. */
  mf?: number
}

export type BillboardKind = 'monster' | 'item' | 'cloud' | 'doll' | 'projectile' | 'player'

export interface Billboard {
  x: number
  y: number
  tile: TileId
  kind: BillboardKind
  /** Fraction of wall height, already resolved by the builder. */
  height: number
  /** Doll / mcache composition, bottom to top. Each entry may carry an offset. */
  layers?: { tile: TileId; ox?: number; oy?: number; ymax?: number }[]
  /**
   * Status badges laid out as WebTiles does: each carries an offset in
   * texels of a 32-texel cell from the cell's top-left corner.
   */
  statusIcons?: {
    tile: TileId
    ox: number
    oy: number
    /**
     * `'top'` pins the badge's opaque texels to the top edge of the frame
     * instead of where the tile paints them. The damage bar is drawn on rows
     * 30 and 31 of its icon (the sprite's feet); Orbrun lifts it over the
     * head, where the player's own bars go (bars.ts).
     */
    at?: 'top'
  }[]
  /** Opacity 0..1 when the thing is translucent (submerged, invisible-but-known). */
  alpha?: number
  /** Attitude of an actor, for tinting rings and lists (WebTiles monster_list.js names). */
  attitude?: 'hostile' | 'neutral' | 'good_neutral' | 'friendly'
  /** Threat class as WebTiles' monster list names it; `invisible` is the fifth server level. */
  threat?: 'trivial' | 'easy' | 'tough' | 'nasty' | 'invisible'
  name?: string
  /**
   * A monster that is really scenery: plants, bushes, fungi, trees, piles of
   * debris; or an item-range tile that is a tree. Renderers treat it as a
   * fixture (sight windows open in it, it does not thin near the player)
   * rather than an actor, and the HUD's edge pips leave it out.
   */
  scenery?: boolean
  /** Wound level from the server's MDAM flags, in monster_list.js' class names (`uninjured` when unhurt). */
  damage?: WoundLevel
  /** Opaque handle set by the builder (Orbrun stores the raw monster here). */
  ref?: unknown
}

export interface SceneLevel {
  ceilingTile: TileId | null
  sky: 'none' | 'open' | 'dark'
  /** Ambient light tint, 0..1 each. */
  tint: { r: number; g: number; b: number }
}

export interface Scene {
  bounds: Rect
  cells: Map<CellKey, SceneCell>
  player: { x: number; y: number }
  /** Whether the player is on this level at all (false while viewing a remote level). */
  playerOnLevel: boolean
  billboards: Billboard[]
  level: SceneLevel
  /** Increments whenever the scene is rebuilt. */
  revision: number
  /**
   * The revision at which the level's layout last changed: anything a level
   * mesh is built from (`cellLayoutEquals`), the bounds, the level's lid and
   * sky, or where the player stands. Lighting, billboards and cursors change
   * without moving it, so a renderer keeps its geometry across those builds
   * (rendering-3d.md Part IV).
   */
  layoutRevision: number
}

export function emptyScene(): Scene {
  return {
    bounds: { left: 0, top: 0, right: -1, bottom: -1 },
    cells: new Map(),
    player: { x: 0, y: 0 },
    playerOnLevel: false,
    billboards: [],
    level: { ceilingTile: null, sky: 'none', tint: { r: 1, g: 1, b: 1 } },
    revision: 0,
    layoutRevision: 0,
  }
}

function sameIds(a: TileId[] | undefined, b: TileId[] | undefined): boolean {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/**
 * Whether two cells build the same level geometry: the same kind and height,
 * the same tiles on the floor, the walls, the lid and the feature, the same
 * decals and badges, the same flash. Visibility is not part of it: it only
 * shades what is built (`shadeOf`), so a cell coming into or out of sight
 * leaves the geometry standing.
 */
export function cellLayoutEquals(a: SceneCell, b: SceneCell): boolean {
  if (a === b) return true
  if (a.kind !== b.kind || a.occluder !== b.occluder || a.floorTile !== b.floorTile || a.wallTile !== b.wallTile || a.ceilingTile !== b.ceilingTile) return false
  if (a.featureTile !== b.featureTile || a.stance !== b.stance || a.wallStyle !== b.wallStyle) return false
  if (!sameIds(a.underlays, b.underlays) || !sameIds(a.overlays, b.overlays) || !sameIds(a.icons, b.icons)) return false
  if (!sameIds(a.wallOverlays, b.wallOverlays) || !sameIds(a.wallShadows, b.wallShadows) || !sameIds(a.shorelines, b.shorelines)) return false
  if (!sameIds(a.translucent, b.translucent)) return false
  if (a.trail?.from !== b.trail?.from || a.trail?.to !== b.trail?.to) return false
  const fa = a.flash, fb = b.flash
  if (fa !== fb && (!fa || !fb || fa.r !== fb.r || fa.g !== fb.g || fa.b !== fb.b || fa.a !== fb.a)) return false
  return true
}

/**
 * Whether `next` has the same layout as `prev`: the same bounds, lid, sky,
 * player cell and cell set, every cell `cellLayoutEquals` its counterpart.
 * The tint is not layout: it is a colour the renderer applies. A builder
 * uses this to carry `layoutRevision` over.
 */
export function sceneLayoutEquals(prev: Scene, next: Scene): boolean {
  const pb = prev.bounds, nb = next.bounds
  if (pb.left !== nb.left || pb.top !== nb.top || pb.right !== nb.right || pb.bottom !== nb.bottom) return false
  if (prev.level.ceilingTile !== next.level.ceilingTile || prev.level.sky !== next.level.sky) return false
  if (prev.playerOnLevel !== next.playerOnLevel || prev.player.x !== next.player.x || prev.player.y !== next.player.y) return false
  if (prev.cells.size !== next.cells.size) return false
  for (const [k, c] of next.cells) {
    const p = prev.cells.get(k)
    if (!p || !cellLayoutEquals(p, c)) return false
  }
  return true
}

/**
 * How bright a cell is drawn: dimmed out of sight, and falling off with the
 * distance from the player so the far end of a corridor reads as far. One
 * rule for every renderer that shades by cell; the 3D view keeps it in a
 * level-sized shade map so lighting changes never rebuild geometry.
 */
export const MEMORY_SHADE = 0.45
export function shadeOf(cell: SceneCell | undefined, scene: Scene): number {
  if (!cell) return 1
  let s = 1
  if (cell.visibility !== 'visible') s *= MEMORY_SHADE
  const d = Math.hypot(cell.x - scene.player.x, cell.y - scene.player.y)
  s *= 0.55 + 0.45 * Math.max(0, 1 - d / 9)
  return s
}

export function getCell(scene: Scene, x: number, y: number): SceneCell | undefined {
  return scene.cells.get(cellKey(x, y))
}

// ---------------------------------------------------------------------------
// Viewmodel: what the player holds

/**
 * One held thing drawn in a first-person hand: its item icon as tile layers
 * laid out in the 32-texel cell frame the icon was authored for, bottom to
 * top. `layer` names the tile module the id belongs to when the source says
 * so (the server's texture index as a string, or a module name); unset means
 * the id resolves by range.
 */
export interface HandItem {
  layers: { tile: TileId; layer?: string; ymax?: number }[]
  name?: string
}

/**
 * The player's hands: the wielded weapon and whatever the off hand holds (a
 * shield, an orb, a second weapon). `null` for an empty hand. Built by the
 * scene builder from the server's inventory; renderers draw it as a viewmodel.
 */
export interface Viewmodel {
  weapon: HandItem | null
  offhand: HandItem | null
}

// ---------------------------------------------------------------------------
// Tiles

export interface TileRect {
  atlas: string
  /** Source rect in texels. */
  sx: number
  sy: number
  w: number
  h: number
  /** Offset of the drawn rect within a 32x32 cell, in texels. */
  ox: number
  oy: number
  /** Nominal cell size the tile was authored for. */
  cell: number
}

/**
 * What a renderer needs from a tile provider. `@orbrun/gamedata`'s `Gamedata`
 * satisfies it structurally; this package does not depend on that one.
 */
export interface TileSource {
  tile(id: TileId, layer?: string): TileRect | undefined
  atlas(name: string): TexImageSource | undefined
  atlasNames(): string[]
}

// ---------------------------------------------------------------------------
// Camera

export interface Camera {
  x: number
  y: number
  /** Radians, continuous, 0 = north, clockwise. */
  yaw: number
  /** Radians, small glance range. */
  pitch: number
  /** yaw quantised to 8 compass headings. This is the turn goal. */
  facing: Dir8
}

/**
 * Default pitch: a touch under the horizon, so the floor ahead of the player
 * is in frame rather than the far wall alone. Negative looks down, positive
 * up. The player sets their own with the Camera angle row (settings-rows.ts);
 * this is the stop it starts on, and the pitch every other angle is measured
 * from.
 */
export const REST_PITCH = -(Math.PI / 180) * 5

export function makeCamera(x = 0, y = 0, facing: Dir8 = 0): Camera {
  return { x, y, yaw: dirToYaw(facing), pitch: REST_PITCH, facing }
}

export interface SceneCursor {
  x: number
  y: number
  mode: 'target' | 'examine' | 'map'
  /** The icon WebTiles draws for this cursor (`CURSOR`, `TUTORIAL_CURSOR`); an outline when the gamedata has none. */
  tile?: TileId
  /** Outline every known cell (where the cursor may go) in the 2D view; the minimap never draws it. */
  grid?: boolean
}

// ---------------------------------------------------------------------------
// Renderer contract

export interface MapRenderer {
  mount(target: HTMLCanvasElement | OffscreenCanvas): void
  setTiles(tiles: TileSource): void
  setScene(scene: Scene): void
  setCamera(cam: Camera): void
  setCursor(cursor: SceneCursor | null): void
  render(): void
  pick(px: number, py: number): CellKey | null
  resize(width: number, height: number, dpr: number): void
  destroy(): void
}

// ---------------------------------------------------------------------------
// Spatial queries

export function cellAhead(scene: Scene, facing: Dir8, from?: { x: number; y: number }): SceneCell | undefined {
  const p = from ?? scene.player
  return getCell(scene, p.x + DIR8_DX[facing], p.y + DIR8_DY[facing])
}

export function cellUnder(scene: Scene): SceneCell | undefined {
  return getCell(scene, scene.player.x, scene.player.y)
}

export function billboardsAt(scene: Scene, x: number, y: number): Billboard[] {
  return scene.billboards.filter((b) => b.x === x && b.y === y)
}

/** Every monster on a visible cell. Order is the builder's (threat, then distance). */
export function monstersInView(scene: Scene): Billboard[] {
  return scene.billboards.filter((b) => b.kind === 'monster' && scene.cells.get(cellKey(b.x, b.y))?.visibility === 'visible')
}

/**
 * Whether a monster is a threat: one autofight would attack. `l-autofight.cc`
 * `_is_candidate_for_autofight_attack` takes a hostile and rejects
 * `MB_FIREWOOD`, so a plant, bush or fungus is a hostile the server never
 * swings at, and the camera must not turn to it either. (The server does not
 * send that flag; `scenery` stands in for it, by name.)
 */
export function isThreat(b: Billboard): boolean {
  return b.kind === 'monster' && b.attitude === 'hostile' && !b.scenery
}

/**
 * The closest visible threat (`isThreat`): fewest king moves away, then
 * straight-line distance, then billboard order. This is the one worth
 * looking at.
 */
export function nearestHostile(scene: Scene): Billboard | null {
  return nearestOf(scene, monstersInView(scene).filter(isThreat))
}

/**
 * Whether a monster stops autoexplore and travel. `nearby-danger.cc`
 * `i_feel_safe` collects every visible monster `mons_is_safe` rejects: not
 * firewood, and not an attitude `mons_att_wont_attack` lists (friendly, good
 * neutral, marionette). So a plain neutral blocks the walk and a plant never
 * does, whatever its attitude. (A monster seen only through glass is exempt
 * on the server too; the scene cannot tell that case apart.)
 */
export function blocksExplore(b: Billboard): boolean {
  return b.kind === 'monster' && !b.scenery && (b.attitude === 'hostile' || b.attitude === 'neutral')
}

/**
 * The closest visible monster that blocks explore: the one the server means
 * by "X is nearby!" when there is one, and the one worth looking at when
 * there are several. A hostile outranks a neutral at the same distance.
 */
export function nearestBlocker(scene: Scene): Billboard | null {
  return nearestOf(scene, monstersInView(scene).filter(blocksExplore), (b) => (b.attitude === 'neutral' ? 1 : 0))
}

/**
 * The candidate closest to the player: fewest king moves, then `rank` (lower
 * first), then straight-line distance, then the candidates' own order.
 */
export function nearestOf(scene: Scene, candidates: readonly Billboard[], rank: (b: Billboard) => number = () => 0): Billboard | null {
  const px = scene.player.x
  const py = scene.player.y
  let best: Billboard | null = null
  let bestKey = Infinity
  for (const b of candidates) {
    const dx = b.x - px
    const dy = b.y - py
    const key = Math.max(Math.abs(dx), Math.abs(dy)) * 10000 + rank(b) * 1000 + dx * dx + dy * dy
    if (key < bestKey) {
      bestKey = key
      best = b
    }
  }
  return best
}

/** Passable for walking purposes: known ground that is not an occluder. */
export function isWalkable(cell: SceneCell | undefined): boolean {
  if (!cell) return false
  if (cell.kind === 'unknown') return false
  if (cell.occluder) return false
  if (cell.flags.lava) return false
  return true
}

/** Bearing from the player to a cell, as a compass direction. */
export function bearingTo(scene: Scene, x: number, y: number): Dir8 | null {
  return dirFromDelta(x - scene.player.x, y - scene.player.y)
}

// ---------------------------------------------------------------------------
// Third-person shot (rendering-3d.md II.11)

/** Where the 3D camera stands: in the player's eyes, or on a cell behind them. */
export type ViewMode = 'first' | 'third'

/** How far behind the player the third-person camera rests, in cells. */
export const ORBIT_BACK = 2

export interface OrbitShot {
  /** The cell the camera stands in. */
  x: number
  y: number
  /** Cells back from the player along the facing line: ORBIT_BACK, or fewer when the far cells are never-seen. */
  back: number
  /** Occluders on the way to and under the camera; the renderer lowers them so the camera stands in a slot, not in rock. */
  cut: CellKey[]
}

/**
 * The third-person camera cell: `ORBIT_BACK` cells straight behind the
 * player, against `facing`. Walls behind the player are allowed (they are
 * cut down), but never-seen void is not: there is nothing known to stand in.
 * The camera comes in one cell at a time until it and every cell between it
 * and the player are known, and is null when even the cell right behind is
 * unknown, or the player is not on the level: then the view falls back to
 * first person.
 */
export function orbitShot(scene: Scene, facing: Dir8): OrbitShot | null {
  if (!scene.playerOnLevel) return null
  const dx = -DIR8_DX[facing]
  const dy = -DIR8_DY[facing]
  const known = (k: number) => {
    const c = getCell(scene, scene.player.x + dx * k, scene.player.y + dy * k)
    return !!c && c.kind !== 'unknown'
  }
  // every cell between the player and the camera must be known too: a void
  // cell in between would be a black column across the whole shot
  let back = 0
  while (back < ORBIT_BACK && known(back + 1)) back++
  if (back === 0) return null
  const cut: CellKey[] = []
  for (let k = 1; k <= back; k++) {
    const x = scene.player.x + dx * k
    const y = scene.player.y + dy * k
    if (getCell(scene, x, y)?.occluder) cut.push(cellKey(x, y))
  }
  return { x: scene.player.x + dx * back, y: scene.player.y + dy * back, back, cut }
}


// ---------------------------------------------------------------------------
// Third-person camera approach (rendering-3d.md II.11)

export interface CameraApproach {
  /** Distance behind the player the camera can actually stand, in cells: `back`, or less when the way there crosses never-seen void. */
  back: number
  /** Occluders the camera stands in, brushes against, or looks across on the way to the player; the renderer lowers them. */
  cut: CellKey[]
}

/**
 * Cells within this distance of the eye point count as stood in: an eye on a
 * cell boundary has the neighbour's wall face at zero distance, which fills
 * half the frame, so the neighbour comes down too.
 */
const CAMERA_MARGIN = 0.35

/**
 * Where the third-person camera really stands: `back` cells from the
 * player's cell centre against `yaw`, which mid-turn and after a free look is
 * not on the facing line `orbitShot` cut. The cells the eye stands in or
 * brushes (within CAMERA_MARGIN), and every cell the segment from the eye to
 * the player crosses, are cut if they occlude, so the camera never has rock
 * in its face. Never-seen void is not cut: there is nothing known to stand
 * in, so `back` shrinks toward `minBack` until the way is clear (and stays at
 * `minBack` if even that is void: the cell under the player is always known).
 */
export function cameraApproach(scene: Scene, yaw: number, back: number, minBack: number): CameraApproach {
  const px = scene.player.x + 0.5
  const py = scene.player.y + 0.5
  const fx = Math.sin(yaw)
  const fy = -Math.cos(yaw)
  const home = cellKey(scene.player.x, scene.player.y)
  for (let d = back; ; d = Math.max(minBack, d - 0.125)) {
    const ex = px - fx * d
    const ey = py - fy * d
    const keys = new Set<CellKey>()
    // the cell under the eye and any neighbour whose face is within the margin
    for (const ox of [-CAMERA_MARGIN, 0, CAMERA_MARGIN])
      for (const oy of [-CAMERA_MARGIN, 0, CAMERA_MARGIN]) keys.add(cellKey(Math.floor(ex + ox), Math.floor(ey + oy)))
    // the cells the line of sight to the doll crosses
    const steps = Math.ceil(d * 8)
    for (let i = 0; i < steps; i++) {
      const t = i / steps
      keys.add(cellKey(Math.floor(ex + (px - ex) * t), Math.floor(ey + (py - ey) * t)))
    }
    keys.delete(home)
    const cut: CellKey[] = []
    let void_ = false
    for (const k of keys) {
      const c = scene.cells.get(k)
      if (!c || c.kind === 'unknown') void_ = true
      else if (c.occluder) cut.push(k)
    }
    if (!void_ || d <= minBack) return { back: d, cut: cut.sort((a, b) => a - b) }
  }
}
