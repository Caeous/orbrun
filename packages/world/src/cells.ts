import { cellKey, type CellKey, type Scene, type SceneCell, type TileId } from '@orbrun/scene'
import type { BodyRect, CellClass, ClassAt, Pt } from './footprint.js'
import type { FeatureStance } from './doors.js'

/**
 * What a cell is to the rules that stand the level up: its class for the
 * footprint rule, what its floor shows, which tile each face of a wall wears,
 * and what floors the strips a wall's body leaves of its cell.
 */

/** Cell classes as a byte, for a dense grid. */
export const VOID = 0
export const FLOOR = 1
export const WALL = 2
export const CLASS_NAME: CellClass[] = ['void', 'floor', 'wall']

/**
 * A cell's class for the footprint rule: never-seen space is void, an
 * occluder is wall, the rest floor; and a door in its doorway (`framed`) is
 * floor, open or closed: a closed one is a board as an open one is, and the
 * walls either side stand back from an opening.
 */
export function cellClass(c: SceneCell | undefined, framed: ReadonlyMap<CellKey, number>): number {
  if (!c || c.kind === 'unknown') return VOID
  if (c.occluder && !framed.has(cellKey(c.x, c.y))) return WALL
  return FLOOR
}

/** `cellClass` over a scene. */
export function levelClassAt(scene: Scene, framed: ReadonlyMap<CellKey, number>): ClassAt {
  return (x, z) => CLASS_NAME[cellClass(scene.cells.get(cellKey(x, z)), framed)]
}

/** What lies on a cell's floor over its tile, bottom first: under the feature, the feature where it is painted there, and over it. */
export interface FloorLayers {
  under: readonly TileId[]
  feature: TileId | undefined
  over: readonly TileId[]
}

const NONE: readonly TileId[] = []

/**
 * A cell's floor layers: its underlays, its feature where it is painted on
 * the floor (`featureStance` `floor`), and its overlays. Crawl's wall shadows
 * and shorelines are left out unless `shadows`: where walls stand back from
 * the floor, a line on the floor's edge reads as a seam, not a shadow.
 */
export function floorLayers(c: SceneCell, stance: FeatureStance | null, shadows = false): FloorLayers {
  const o = c.overlays
  const over = !o ? NONE : shadows || (!c.wallShadows?.length && !c.shorelines?.length) ? o : o.filter((id) => !c.wallShadows?.includes(id) && !c.shorelines?.includes(id))
  return { under: c.underlays ?? NONE, feature: stance === 'floor' ? c.featureTile : undefined, over }
}

export type Side = 'n' | 's' | 'w' | 'e'

/** The tile a wall's face toward `side` wears: its own for that side where crawl gives one (a gate's piece), else the wall's. */
export function faceTile(c: SceneCell | undefined, side: Side): TileId | undefined {
  return c?.faceTiles?.[side] ?? c?.wallTile
}

/** A part of a wall's cell its body leaves, and the open cell beside it whose floor and lid reach there, by its offset. */
export interface InsetStrip {
  pts: Pt[]
  dx: number
  dz: number
}

/**
 * What a wall's body (`bodyRect`) leaves of its cell, floored and roofed
 * with the open cell beside each part: the strip along each open side
 * (`open`: north, south, west, east), north and south the cell's whole width
 * and west and east between them, then each corner cut, from the diagonal
 * across it. Each a quad in cell-local coordinates, wound as the floor is.
 */
export function insetStrips(b: BodyRect, open: readonly [boolean, boolean, boolean, boolean]): InsetStrip[] {
  const { x0, x1, z0, z1, t } = b
  const out: InsetStrip[] = []
  if (open[0]) out.push({ pts: [[0, z0], [1, z0], [1, 0], [0, 0]], dx: 0, dz: -1 })
  if (open[1]) out.push({ pts: [[0, 1], [1, 1], [1, z1], [0, z1]], dx: 0, dz: 1 })
  if (open[2]) out.push({ pts: [[0, z1], [x0, z1], [x0, z0], [0, z0]], dx: -1, dz: 0 })
  if (open[3]) out.push({ pts: [[x1, z1], [1, z1], [1, z0], [x1, z0]], dx: 1, dz: 0 })
  if (b.cut[0]) out.push({ pts: [[0, t], [t, t], [t, 0], [0, 0]], dx: -1, dz: -1 })
  if (b.cut[1]) out.push({ pts: [[1 - t, t], [1, t], [1, 0], [1 - t, 0]], dx: 1, dz: -1 })
  if (b.cut[2]) out.push({ pts: [[0, 1], [t, 1], [t, 1 - t], [0, 1 - t]], dx: -1, dz: 1 })
  if (b.cut[3]) out.push({ pts: [[1 - t, 1], [1, 1], [1, 1 - t], [1 - t, 1 - t]], dx: 1, dz: 1 })
  return out
}

/**
 * The open cell whose floor and lid reach the point (lx, lz) of a wall's
 * cell, as an offset from it: the strip it is in, as `insetStrips` lays them,
 * or the corner cut; null inside the body.
 */
const N: readonly [number, number] = [0, -1], S: readonly [number, number] = [0, 1], W: readonly [number, number] = [-1, 0], E: readonly [number, number] = [1, 0]
const NW: readonly [number, number] = [-1, -1], NE: readonly [number, number] = [1, -1], SW: readonly [number, number] = [-1, 1], SE: readonly [number, number] = [1, 1]

export function stripAt(b: BodyRect, lx: number, lz: number): readonly [number, number] | null {
  if (b.z0 > 0 && lz < b.z0) return N
  if (b.z1 < 1 && lz >= b.z1) return S
  if (b.x0 > 0 && lx < b.x0) return W
  if (b.x1 < 1 && lx >= b.x1) return E
  const t = b.t, w = lx < t, e = lx >= 1 - t, n = lz < t, s = lz >= 1 - t
  if (b.cut[0] && w && n) return NW
  if (b.cut[1] && e && n) return NE
  if (b.cut[2] && w && s) return SW
  if (b.cut[3] && e && s) return SE
  return null
}
