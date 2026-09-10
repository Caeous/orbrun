import {
  cellKey,
  dirToYaw,
  emptyScene,
  makeCamera,
  type Billboard,
  type Camera,
  type Dir8,
  type Scene,
  type SceneCell,
  type TileId,
} from '@orbrun/scene'
import { classifyFeature, isVegetation, stanceFor } from '@orbrun/scene-webtiles'

/**
 * @orbrun/vault
 *
 * A supported subset of DCSS's `.des` vault syntax, compiled to a Scene the
 * renderers draw exactly as they draw a live level. Written for the front
 * end's room (apps/orbrun room/antechamber.des): a place authored by hand
 * from the game's own tiles, with nothing made up.
 *
 * This is a subset, not the vault language. What is accepted:
 *
 *   NAME: <name>                 the vault's name
 *   MAP … ENDMAP                 the map, one row per line; ' ' is void
 *   TILE:  <glyph> = <tile>      the glyph is masonry drawn with this wall tile
 *   FTILE: <glyph> = <tile>      the floor tile under cells of this glyph
 *                                (FTILE: . = … is the floor everywhere else);
 *                                a glyph with only an FTILE is open floor of
 *                                that tile: a pool of water, a patch of moss
 *   KFEAT: <glyph> = <tile>      a dungeon feature: stairs, door, altar,
 *                                fountain, statue, tree, arch, trap
 *   KITEM: <glyph> = <tile>      an item lying on the floor
 *   KMONS: <glyph> = <tile>      a monster standing on the floor (a plant,
 *                                a bush, a lotus on a pool: the room has no
 *                                actors)
 *   EYE:   <glyph> [<heading>]   Orbrun's own: where the camera stands and
 *                                the way it faces (N NE E SE S SW W NW, N by
 *                                default); the glyph is floor
 *   LIGHT: <glyph>               Orbrun's own: where the light is, when it
 *                                is not the eye; the glyph is floor
 *   # …                          a comment, outside the map
 *
 * Tile names are the ones the server's tileinfo publishes (`DNGN_STONE_STAIRS_DOWN`,
 * `WALL_CRYSTAL_BOOKCASE`, `MONS_PLANT`), in either case. Every other
 * directive of the vault language (SUBST, NSUBST, SHUFFLE, MARKER, KPROP,
 * COLOUR, TAGS, WEIGHT, ORIENT, Lua) is refused with its line number rather
 * than passed over: a line that does nothing here would be a lie in the file.
 */

export type LegendKind = 'wall' | 'floor' | 'feat' | 'item' | 'mons'

export interface LegendEntry {
  glyph: string
  kind: LegendKind
  /** the tile's name, upper case as tileinfo publishes it */
  tile: string
  line: number
}

export interface Vault {
  name: string
  width: number
  height: number
  /** the map, every row padded to `width` with void */
  map: string[]
  legend: LegendEntry[]
  eye: { x: number; y: number; facing: Dir8 }
  light: { x: number; y: number }
}

export class DesError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`line ${line}: ${message}`)
    this.name = 'DesError'
  }
}

export const DIRECTIVES = ['NAME', 'TILE', 'FTILE', 'KFEAT', 'KITEM', 'KMONS', 'EYE', 'LIGHT', 'MAP', 'ENDMAP'] as const

const HEADINGS: Record<string, Dir8> = { N: 0, NE: 1, E: 2, SE: 3, S: 4, SW: 5, W: 6, NW: 7 }

const LEGEND_KIND: Record<string, LegendKind> = { TILE: 'wall', FTILE: 'floor', KFEAT: 'feat', KITEM: 'item', KMONS: 'mons' }

/** Parse the subset. Throws DesError, naming the line, on anything outside it. */
export function parseDes(text: string): Vault {
  const lines = text.split(/\r?\n/)
  let name = ''
  const map: string[] = []
  const legend: LegendEntry[] = []
  const seen = new Map<string, number>()
  let eyeGlyph: string | null = null
  let eyeFacing: Dir8 = 0
  let lightGlyph: string | null = null
  let inMap = false
  let sawMap = false
  let mapLine = 0
  for (let i = 0; i < lines.length; i++) {
    const n = i + 1
    const raw = lines[i]
    if (inMap) {
      if (raw.trim() === 'ENDMAP') {
        inMap = false
        continue
      }
      map.push(raw.replace(/\s+$/, ''))
      continue
    }
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    if (line === 'MAP') {
      if (sawMap) throw new DesError('a second MAP; one map per vault', n)
      inMap = true
      sawMap = true
      mapLine = n
      continue
    }
    if (line === 'ENDMAP') throw new DesError('ENDMAP without MAP', n)
    const m = /^([A-Z]+):\s*(.*)$/.exec(line)
    if (!m) throw new DesError(`not a directive: ${line}`, n)
    const [, key, rest] = m
    if (!(DIRECTIVES as readonly string[]).includes(key)) throw new DesError(`${key} is not in the supported subset (accepted: ${DIRECTIVES.join(', ')})`, n)
    if (key === 'NAME') {
      name = rest.trim()
      continue
    }
    if (key === 'EYE' || key === 'LIGHT') {
      const parts = rest.trim().split(/\s+/)
      const glyph = parts[0]
      if (!glyph || glyph.length !== 1) throw new DesError(`${key} needs one glyph`, n)
      if (key === 'EYE') {
        if (eyeGlyph !== null) throw new DesError('a second EYE', n)
        eyeGlyph = glyph
        if (parts[1] !== undefined) {
          const f = HEADINGS[parts[1].toUpperCase()]
          if (f === undefined) throw new DesError(`EYE heading ${parts[1]} is not one of ${Object.keys(HEADINGS).join(' ')}`, n)
          eyeFacing = f
        }
        if (parts.length > 2) throw new DesError('EYE takes a glyph and a heading, nothing more', n)
      } else {
        if (lightGlyph !== null) throw new DesError('a second LIGHT', n)
        if (parts.length > 1) throw new DesError('LIGHT takes one glyph', n)
        lightGlyph = glyph
      }
      continue
    }
    const lm = /^(\S)\s*=\s*(\S+)$/.exec(rest.trim())
    if (!lm) throw new DesError(`${key} reads "${key}: <glyph> = <tile>"`, n)
    const glyph = lm[1]
    const tile = lm[2].toUpperCase()
    if (glyph === ' ' || (glyph === '.' && key !== 'FTILE')) throw new DesError(`${key}: "${glyph}" cannot carry a ${key} entry${glyph === '.' ? ' (only FTILE: . = …)' : ''}`, n)
    if (!/^[A-Z0-9_]+$/.test(tile)) throw new DesError(`${tile} is not a tile name`, n)
    const kind = LEGEND_KIND[key]
    const dupe = seen.get(kind === 'floor' ? 'F' + glyph : glyph)
    if (dupe !== undefined) throw new DesError(`"${glyph}" is already defined on line ${dupe}`, n)
    seen.set(kind === 'floor' ? 'F' + glyph : glyph, n)
    legend.push({ glyph, kind, tile, line: n })
  }
  if (inMap) throw new DesError('MAP without ENDMAP', mapLine)
  if (!sawMap) throw new DesError('no MAP', lines.length)
  while (map.length && !map[map.length - 1].trim()) map.pop()
  while (map.length && !map[0].trim()) map.shift()
  if (!map.length) throw new DesError('the map is empty', mapLine)
  const width = Math.max(...map.map((r) => r.length))
  const rows = map.map((r) => r.padEnd(width, ' '))
  // the floor under everything
  if (!legend.some((e) => e.kind === 'floor' && e.glyph === '.')) throw new DesError('no floor: add "FTILE: . = <tile>"', mapLine)
  // every glyph in the map is spoken for
  const known = new Set<string>([' ', '.', ...legend.map((e) => e.glyph)])
  if (eyeGlyph !== null) known.add(eyeGlyph)
  if (lightGlyph !== null) known.add(lightGlyph)
  let eye: Vault['eye'] | null = null
  let light: Vault['light'] | null = null
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < width; x++) {
      const g = rows[y][x]
      if (!known.has(g)) throw new DesError(`"${g}" at ${x},${y} of the map has no legend entry`, mapLine + 1 + y)
      if (g === eyeGlyph) {
        if (eye) throw new DesError(`a second "${g}" (the eye) at ${x},${y}`, mapLine + 1 + y)
        eye = { x, y, facing: eyeFacing }
      }
      if (g === lightGlyph) {
        if (light) throw new DesError(`a second "${g}" (the light) at ${x},${y}`, mapLine + 1 + y)
        light = { x, y }
      }
    }
  }
  if (eyeGlyph === null) throw new DesError('no EYE: say where the camera stands', lines.length)
  if (!eye) throw new DesError(`the eye's glyph "${eyeGlyph}" is not on the map`, mapLine)
  if (lightGlyph !== null && !light) throw new DesError(`the light's glyph "${lightGlyph}" is not on the map`, mapLine)
  // the eye and the light stand on floor: a glyph of theirs must not also be a wall or a feature
  for (const g of [eyeGlyph, lightGlyph]) {
    const e = legend.find((l) => l.glyph === g && l.kind !== 'floor')
    if (e) throw new DesError(`"${g}" is the ${g === eyeGlyph ? 'eye' : 'light'} and cannot also be a ${e.kind}`, e.line)
  }
  return { name, width, height: rows.length, map: rows, legend, eye, light: light ?? { x: eye.x, y: eye.y } }
}

/** The tile names a vault uses, each once, in legend order. */
export function vaultTileNames(v: Vault): string[] {
  return [...new Set(v.legend.map((e) => e.tile))]
}

// ---------------------------------------------------------------------------
// Compiling to a Scene

/** What a Scene needs of a tile set: an id per name, and how many variants stand behind an id. */
export interface TileNames {
  id(name: string): number | undefined
  /** variants of a base tile (tileinfo `tile_count`); 1 when unknown */
  tileCount?(id: number): number
}

/**
 * Which variant of a tile a cell gets: the server hands every floor and wall
 * cell one of its variants at level build, and the vault does the same by
 * position, so a room reads the same every time it is built.
 */
export function variantAt(base: TileId, count: number, x: number, y: number): TileId {
  if (count <= 1) return base
  let h = (x * 73856093) ^ (y * 19349663) ^ (base * 83492791)
  h = (h ^ (h >>> 13)) >>> 0
  return base + (h % count)
}

function heightOf(kind: 'item' | 'mons', name: string): number {
  if (kind === 'item') return 0.4
  return isVegetation(name) ? 0.95 : 0.6
}

const NO_FLAGS = { water: false, lava: false, excluded: false, travelTrail: false, newStair: false, cursor: false, outOfRange: false, magicMapped: false } as const

/**
 * The vault as a Scene: every cell seen, the light where the vault says,
 * revisions set once so a renderer never rebuilds the geometry. Throws
 * DesError when a tile name is not in `names`, the eye or the light stand in
 * a wall, or an open cell touches void (the room must be closed; a tree may
 * stand at the edge of the void, the dark showing between the trunks).
 */
export function vaultScene(v: Vault, names: TileNames): Scene {
  const missing = vaultTileNames(v).filter((n) => names.id(n) === undefined)
  if (missing.length) throw new DesError(`tiles not in this tile set: ${missing.join(', ')}`, v.legend.find((e) => e.tile === missing[0])?.line ?? 0)
  const count = (id: number) => names.tileCount?.(id) ?? 1
  const byGlyph = new Map<string, LegendEntry>()
  const floorByGlyph = new Map<string, LegendEntry>()
  for (const e of v.legend) (e.kind === 'floor' ? floorByGlyph : byGlyph).set(e.glyph, e)
  const floorTileAt = (g: string, x: number, y: number): TileId => {
    const e = floorByGlyph.get(g) ?? floorByGlyph.get('.')!
    const id = names.id(e.tile)!
    return variantAt(id, count(id), x, y)
  }
  const scene = emptyScene()
  scene.bounds = { left: 0, top: 0, right: v.width - 1, bottom: v.height - 1 }
  const wallBases = new Map<TileId, number>()
  for (let y = 0; y < v.height; y++) {
    for (let x = 0; x < v.width; x++) {
      const g = v.map[y][x]
      if (g === ' ') continue
      const cell: SceneCell = {
        x,
        y,
        kind: 'floor',
        visibility: 'visible',
        occluder: false,
        floorTile: floorTileAt(g, x, y),
        flags: { ...NO_FLAGS },
        glyph: g,
        label: 'floor',
      }
      const e = byGlyph.get(g)
      if (e && e.kind === 'wall') {
        const id = names.id(e.tile)!
        cell.kind = 'wall'
        cell.occluder = true
        cell.wallTile = variantAt(id, count(id), x, y)
        cell.wallStyle = /TRANSPARENT|CRYSTAL|GLASS/.test(e.tile) ? 'transparent' : 'solid'
        cell.label = e.tile.replace(/^WALL_/, '').toLowerCase().replace(/_/g, ' ')
        cell.glyph = '#'
        wallBases.set(id, (wallBases.get(id) ?? 0) + 1)
      } else if (e && e.kind === 'feat') {
        const id = names.id(e.tile)!
        const f = classifyFeature(e.tile, undefined, undefined)
        // trees take a variant by position as floors do (a wood is not one tree); a statue's variants are other statues, so it stays the one named
        cell.featureTile = isVegetation(e.tile) ? variantAt(id, count(id), x, y) : id
        cell.feature = f
        if (f && f.type === 'door' && f.state !== 'open') {
          cell.kind = 'door'
          cell.occluder = true
          cell.wallTile = id
          cell.stance = 'upright'
          cell.label = f.state === 'closed' ? 'closed door' : f.state + ' door'
        } else {
          cell.kind = 'feature'
          cell.stance = stanceFor(e.tile, f)
          if (f && (f.type === 'stairs' || f.type === 'hatch')) cell.beacon = f.dir
          else if (f && (f.type === 'portal' || f.type === 'transporter')) cell.beacon = 'portal'
          cell.label = e.tile.replace(/^DNGN_/, '').toLowerCase().replace(/_/g, ' ')
        }
      } else if (e) {
        const id = names.id(e.tile)!
        const name = e.tile.replace(/^MONS_/, '').toLowerCase().replace(/_/g, ' ')
        const b: Billboard = {
          x,
          y,
          tile: e.kind === 'mons' ? variantAt(id, count(id), x, y) : id,
          kind: e.kind === 'mons' ? 'monster' : 'item',
          height: heightOf(e.kind === 'mons' ? 'mons' : 'item', name),
          name,
        }
        if (e.kind === 'mons') {
          b.attitude = 'hostile'
          b.scenery = true
        }
        scene.billboards.push(b)
      }
      scene.cells.set(cellKey(x, y), cell)
    }
  }
  // closed: an open cell never touches void, so the eye never looks into
  // nothing; except a tree, which may stand at the edge of it: a wood is a
  // boundary too, and what shows between its trunks is the dark
  const isTree = (c: SceneCell) => c.kind === 'feature' && isVegetation(c.label)
  for (const c of scene.cells.values()) {
    if (c.occluder || isTree(c)) continue
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!scene.cells.has(cellKey(c.x + dx, c.y + dy))) throw new DesError(`the room is open at ${c.x + dx},${c.y + dy}: an open cell touches void`, 0)
      }
  }
  for (const [what, p] of [
    ['eye', v.eye],
    ['light', v.light],
  ] as const) {
    const c = scene.cells.get(cellKey(p.x, p.y))
    if (!c || c.occluder) throw new DesError(`the ${what} at ${p.x},${p.y} does not stand on open floor`, 0)
  }
  // the lid is the masonry most of the room is built of, as the game's levels take theirs
  let lid: TileId | null = null
  let most = 0
  for (const [id, n] of wallBases)
    if (n > most) {
      most = n
      lid = id
    }
  scene.level = { ceilingTile: lid, sky: 'none', tint: { r: 1, g: 1, b: 1 } }
  scene.player = { x: v.light.x, y: v.light.y }
  scene.playerOnLevel = true
  scene.revision = 1
  scene.layoutRevision = 1
  return scene
}

/** The camera where the vault's EYE stands, facing its heading. */
export function vaultCamera(v: Vault): Camera {
  const c = makeCamera(v.eye.x, v.eye.y, v.eye.facing)
  c.yaw = dirToYaw(v.eye.facing)
  return c
}
