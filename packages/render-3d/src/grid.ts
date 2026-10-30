import type { CellKey, Rect, Scene, SceneCell } from '@orbrun/scene'
import { CLASS_NAME, VOID, WALL, bodyRect, cellClass, framedDoors, insetFootprint, occupiedFeatures, type BodyRect, type ClassAt, type Footprint, type FootprintOptions } from '@orbrun/world'

export { framedDoors, occupiedFeatures }

/**
 * The level as a dense grid, read off a `Scene` once per build: a class byte
 * per cell over the scene's bounds grown by one (so the void columns bordering
 * known space exist), the cell objects by index, and what the footprint rule
 * needs beside the cells: the doors hanging in a doorway, and the
 * upright features something stands on, which lie flat.
 *
 * The footprints themselves are memoised by neighbourhood (`footprintAt`): a
 * cell's body and faces depend on the floor/solid pattern of the twenty cells
 * the rule reads (its eight neighbours, and the eight round each orthogonal
 * neighbour), so a level of thousands of cells asks for a few hundred distinct
 * patterns and the rest are lookups.
 */

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
  /** The doors hanging in a doorway, open or closed, and the heading each stands at (`framedDoors`). */
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
    this.framed = framedDoors(scene)
    for (const c of scene.cells.values()) {
      const i = this.index(c.x, c.y)
      if (i < 0) continue
      this.cells[i] = c
      this.cls[i] = cellClass(c, this.framed)
    }
    this.occupied = occupiedFeatures(scene, this.framed)
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

/** Whether two sets hold the same keys. */
export function sameKeys(a: ReadonlySet<CellKey>, b: ReadonlySet<CellKey>): boolean {
  if (a.size !== b.size) return false
  for (const k of a) if (!b.has(k)) return false
  return true
}
