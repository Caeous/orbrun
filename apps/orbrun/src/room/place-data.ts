import { cellKey, type Billboard, type Scene, type SceneCell, type TileId } from '@orbrun/scene'

/**
 * A place the front end stands in: a moment of a real game, the level as
 * the player knew it then, frozen to a file (public/room/places/<id>.json)
 * with the few tiles it is drawn from packed beside it (<id>.png). Written
 * by the film bed (testbed/film.ts `place`, on the film-record branch);
 * read back here into the `Scene` the game's own renderer draws.
 *
 * The file keeps what the renderer draws and nothing about whose game it
 * was: the game's marks are off before it is written (film-lib.ts
 * `cleanScene`), the builder's handle on each monster is dropped, and a
 * cell's flags keep only the ones that are set. Nor its glyph, colour and
 * label: only the 3D view draws a place.
 */
export interface PlaceFile {
  /** the format; a reader refuses one it does not know */
  format: 1
  id: string
  /** where the game stood, as crawl names it (`Lair:3`) */
  place: string
  source: { host: string; version: string; recording: string; at: number }
  license: string
  /** the eye: the player's cell, and the way it faces (camera radians, 0 north, clockwise) */
  eye: { x: number; y: number; yaw: number }
  atlas: PlaceAtlas
  scene: PlaceScene
}

export interface PlaceAtlas {
  cell: number
  width: number
  height: number
  /** tile id -> where it is in the packed image, with the offsets the game's gamedata gave it, and the game atlas it came from */
  tiles: Record<string, { from: string; sx: number; sy: number; w: number; h: number; ox: number; oy: number }>
}

export interface PlaceScene {
  bounds: Scene['bounds']
  player: Scene['player']
  level: Scene['level']
  cells: PlaceCell[]
  billboards: Billboard[]
}

/** a cell as written: its flags only where set */
export type PlaceCell = Omit<SceneCell, 'flags'> & { flags?: Partial<SceneCell['flags']> }

const NO_FLAGS: SceneCell['flags'] = {
  water: false,
  lava: false,
  excluded: false,
  travelTrail: false,
  newStair: false,
  cursor: false,
  outOfRange: false,
  magicMapped: false,
}

/** The scene as a place file keeps it. */
export function writeScene(scene: Scene): PlaceScene {
  const cells: PlaceCell[] = []
  for (const c of scene.cells.values()) {
    if (c.kind === 'unknown') continue
    // the text a 2D view or a reticle would fall back on is no use to a room nobody targets in
    const { flags, label: _label, glyph: _glyph, colour: _colour, mf: _mf, ...rest } = c
    const set = Object.fromEntries(Object.entries(flags).filter(([, v]) => v !== false && v !== undefined))
    cells.push(prune(Object.keys(set).length ? { ...rest, flags: set } : rest))
  }
  const billboards = scene.billboards.filter((b) => b.kind !== 'player').map(({ ref: _ref, ...b }) => prune(b) as Billboard)
  return { bounds: scene.bounds, player: scene.player, level: scene.level, cells, billboards }
}

/** A place file's scene as the renderer takes it. */
export function readScene(p: PlaceScene): Scene {
  const cells: Scene['cells'] = new Map()
  for (const c of p.cells) cells.set(cellKey(c.x, c.y), { ...c, flags: { ...NO_FLAGS, ...c.flags } })
  return { bounds: p.bounds, player: p.player, playerOnLevel: true, level: p.level, cells, billboards: p.billboards, revision: 1, layoutRevision: 1 }
}

/** Every tile the scene names: what a place's atlas must hold. */
export function sceneTileIds(scene: Scene): Set<TileId> {
  const out = new Set<TileId>()
  // a tile the builder could not name comes through as NaN, which the renderer draws as nothing
  const add = (id: TileId | null | undefined) => {
    if (Number.isInteger(id)) out.add(id!)
  }
  const all = (ids: TileId[] | undefined) => ids?.forEach(add)
  add(scene.level.ceilingTile)
  for (const c of scene.cells.values()) {
    add(c.floorTile)
    add(c.wallTile)
    add(c.ceilingTile)
    add(c.featureTile)
    add(c.cloud)
    Object.values(c.faceTiles ?? {}).forEach(add)
    all(c.underlays)
    all(c.overlays)
    all(c.wallShadows)
    all(c.shorelines)
    all(c.wallOverlays)
    all(c.translucent)
    all(c.icons)
  }
  for (const b of scene.billboards) {
    add(b.tile)
    b.layers?.forEach((l) => add(l.tile))
    b.statusIcons?.forEach((s) => add(s.tile))
  }
  return out
}

/** `o` without its unset fields, so the file holds only what was said */
function prune<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
}
