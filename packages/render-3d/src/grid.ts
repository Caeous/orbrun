import { cellKey, keyToXY, type CellKey, type Rect, type Scene, type SceneCell } from '@orbrun/scene'
import { bodyRect, insetFootprint, type BodyRect, type CellClass, type ClassAt, type Footprint, type FootprintOptions } from './footprint.js'

/**
 * The level as a dense grid, read off a `Scene` once per build: a class byte
 * per cell over the scene's bounds grown by one (so the void columns bordering
 * known space exist), the cell objects by index, and what the footprint rule
 * needs beside the cells — the framed doors that count as wall for it, and the
 * upright features something stands on, which lie flat.
 *
 * The footprints themselves are memoised by neighbourhood (`footprintAt`): a
 * cell's body and faces depend on the floor/solid pattern of the twenty cells
 * the rule reads (its eight neighbours, and the eight round each orthogonal
 * neighbour), so a level of thousands of cells asks for a few hundred distinct
 * patterns and the rest are lookups.
 */

/** Cell classes as the grid stores them. */
export const VOID = 0
export const FLOOR = 1
export const WALL = 2
/** A floor cell with an open door standing in a wall run: wall for the footprint rule, floor for everything else. */
export const FRAMED = 3

const CLASS_NAME: CellClass[] = ['void', 'floor', 'wall', 'wall']

/** The plus-shaped neighbourhood the footprint rule reads, as offsets: the 5x5 less its corners, less the cell itself. */
const REACH: [number, number][] = []
for (let dz = -2; dz <= 2; dz++)
  for (let dx = -2; dx <= 2; dx++) {
    if ((dx === 0 && dz === 0) || (Math.abs(dx) === 2 && Math.abs(dz) === 2) || (Math.abs(dx) === 2 && Math.abs(dz) === 1) || (Math.abs(dx) === 1 && Math.abs(dz) === 2)) continue
    REACH.push([dx, dz])
  }

export interface FootprintEntry {
  fp: Footprint
  rect: BodyRect | null
}

export class LevelGrid {
  readonly range: Rect
  readonly w: number
  readonly h: number
  readonly cls: Uint8Array
  readonly cells: (SceneCell | undefined)[]
  /** The open doors hanging in a doorway, and the heading each stands at (`framedDoors`). */
  readonly framed: Map<CellKey, number>
  /** The cells whose upright feature something stands on (`occupiedFeatures`). */
  readonly occupied: Set<CellKey>
  readonly classAt: ClassAt

  constructor(readonly scene: Scene) {
    const b = scene.bounds
    this.range = { left: b.left - 1, top: b.top - 1, right: b.right + 1, bottom: b.bottom + 1 }
    this.w = Math.max(0, this.range.right - this.range.left + 1)
    this.h = Math.max(0, this.range.bottom - this.range.top + 1)
    this.cls = new Uint8Array(this.w * this.h)
    this.cells = new Array(this.w * this.h)
    for (const c of scene.cells.values()) {
      const i = this.index(c.x, c.y)
      if (i < 0) continue
      this.cells[i] = c
      this.cls[i] = c.kind === 'unknown' ? VOID : c.occluder ? WALL : FLOOR
    }
    this.framed = framedDoors(scene)
    for (const k of this.framed.keys()) {
      const { x, y } = keyToXY(k)
      const i = this.index(x, y)
      if (i >= 0) this.cls[i] = FRAMED
    }
    this.occupied = occupiedFeatures(scene)
    this.classAt = (x, z) => {
      const i = this.index(x, z)
      return i < 0 ? 'void' : CLASS_NAME[this.cls[i]]
    }
  }

  /** The array index of cell (x, z), or -1 outside the range. */
  index(x: number, z: number): number {
    const ix = x - this.range.left, iz = z - this.range.top
    if (ix < 0 || iz < 0 || ix >= this.w || iz >= this.h) return -1
    return iz * this.w + ix
  }

  cell(x: number, z: number): SceneCell | undefined {
    const i = this.index(x, z)
    return i < 0 ? undefined : this.cells[i]
  }

  /** Whether the cell stands full height: wall, closed door, void, unknown. */
  isSolid(x: number, z: number): boolean {
    const i = this.index(x, z)
    return i < 0 || this.cls[i] === VOID || this.cls[i] === WALL
  }

  isVoid(x: number, z: number): boolean {
    const i = this.index(x, z)
    return i < 0 || this.cls[i] === VOID
  }

  /** The floor/solid pattern of the cells the footprint rule reads round (x, z), as one integer. */
  private code(x: number, z: number): number {
    let code = 0
    for (let i = 0; i < REACH.length; i++) {
      const [dx, dz] = REACH[i]
      if (this.classAt(x + dx, z + dz) === 'floor') code |= 1 << i
    }
    return code
  }

  /** The footprint and body rectangle of the solid cell at (x, z), from the memo. */
  footprintAt(x: number, z: number, fo: FootprintOptions, memo: Map<number, FootprintEntry>): FootprintEntry {
    const code = this.code(x, z)
    let e = memo.get(code)
    if (!e) {
      // evaluated on a stand-in grid carrying the pattern alone, so the entry is the pattern's and not the cell's
      const at: ClassAt = (px, pz) => {
        if (px === x && pz === z) return 'wall'
        const i = REACH.findIndex(([dx, dz]) => dx === px - x && dz === pz - z)
        if (i < 0) return 'wall'
        return code & (1 << i) ? 'floor' : 'wall'
      }
      e = { fp: insetFootprint(at, x, z, fo), rect: bodyRect(at, x, z, fo) }
      memo.set(code, e)
    }
    return e
  }
}

/**
 * The open doors that hang in a doorway, and the heading each stands at.
 *
 * A door is a hole in a wall run, and the run tells the door which way it
 * faces: walls east and west of it and the doorway faces north/south (yaw 0,
 * the heading a billboard stands at when the camera looks down -z), walls
 * north and south and it faces east/west. A door with no run to read — a
 * corner, an opening broken through on both axes — has no plane to stand in
 * and is left to face the eye like any other fixture.
 *
 * A closed door is a solid cell and is built as one; only the open ones are
 * here, as their cell is floor with the door tile standing on it.
 */
export function framedDoors(scene: Scene): Map<CellKey, number> {
  const solid = (x: number, y: number) => {
    const c = scene.cells.get(cellKey(x, y))
    return !c || c.kind === 'unknown' || c.occluder
  }
  const out = new Map<CellKey, number>()
  for (const c of scene.cells.values()) {
    if (c.feature?.type !== 'door' || c.kind === 'unknown' || c.occluder) continue
    const alongX = solid(c.x - 1, c.y) && solid(c.x + 1, c.y)
    const alongZ = solid(c.x, c.y - 1) && solid(c.x, c.y + 1)
    if (alongX === alongZ) continue
    out.set(cellKey(c.x, c.y), alongX ? 0 : Math.PI / 2)
  }
  return out
}

/**
 * The cells with an upright feature that something stands on. A board in
 * such a cell is a board through whoever stands there, so those features lie
 * back down on the floor instead, and what the player sees is 2D's own order,
 * the feature under the actor. Clouds and things in flight pass over a cell
 * rather than stand on it, and leave its feature standing. The cell underfoot
 * counts too: the camera sits in the middle of that sprite.
 */
export function occupiedFeatures(scene: Scene): Set<CellKey> {
  const out = new Set<CellKey>()
  const upright = (k: CellKey) => {
    const c = scene.cells.get(k)
    return c?.stance === 'upright' && c.featureTile !== undefined
  }
  for (const b of scene.billboards) {
    if (b.kind === 'cloud' || b.kind === 'projectile') continue
    const k = cellKey(b.x, b.y)
    if (upright(k)) out.add(k)
  }
  if (scene.playerOnLevel) {
    const k = cellKey(scene.player.x, scene.player.y)
    if (upright(k)) out.add(k)
  }
  return out
}

/** Whether two sets hold the same keys. */
export function sameKeys(a: ReadonlySet<CellKey>, b: ReadonlySet<CellKey>): boolean {
  if (a.size !== b.size) return false
  for (const k of a) if (!b.has(k)) return false
  return true
}
