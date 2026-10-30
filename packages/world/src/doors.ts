import { cellKey, type CellKey, type Scene, type SceneCell, type TileId, type TileRect } from '@orbrun/scene'

/**
 * The doors that hang in a doorway, open or closed, and the heading each
 * stands at.
 *
 * A door is a hole in a wall run, and the run tells the door which way it
 * faces: walls east and west of it and the doorway faces north/south (yaw 0,
 * the heading a billboard stands at when the camera looks down -z), walls
 * north and south and it faces east/west. A door with neither reads on past
 * the doors beside it, the other leaves of a double door or a gate, to
 * the walls that end the opening. A door with no run to read — a corner, an
 * opening broken through on both axes — has no plane to stand in and is left
 * to face the eye like any other fixture.
 *
 * A closed door counts as wall for its neighbours' runs (it is one, to
 * crawl), but in its own run it is a door like an open one.
 */
export function framedDoors(scene: Scene): Map<CellKey, number> {
  const solid = (x: number, y: number) => {
    const c = scene.cells.get(cellKey(x, y))
    return !c || c.kind === 'unknown' || c.occluder
  }
  const door = (c: SceneCell | undefined) => c?.feature?.type === 'door' && c.kind !== 'unknown'
  // past the doors beside it, which are leaves of the same gate, to the cell that ends the run
  const end = (x: number, y: number, dx: number, dy: number) => {
    do {
      x += dx
      y += dy
    } while (door(scene.cells.get(cellKey(x, y))))
    return solid(x, y)
  }
  const out = new Map<CellKey, number>()
  for (const c of scene.cells.values()) {
    if (!door(c)) continue
    let alongX = solid(c.x - 1, c.y) && solid(c.x + 1, c.y)
    let alongZ = solid(c.x, c.y - 1) && solid(c.x, c.y + 1)
    if (!alongX && !alongZ) {
      alongX = end(c.x, c.y, -1, 0) && end(c.x, c.y, 1, 0)
      alongZ = end(c.x, c.y, 0, -1) && end(c.x, c.y, 0, 1)
    }
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
 * rather than stand on it, and leave its feature standing. A door in its
 * doorway (`framed`) stays up: whoever is on it stands in its open middle,
 * between the jambs, the player too. The cell underfoot counts for any other
 * feature: the camera sits in the middle of that sprite.
 */
export function occupiedFeatures(scene: Scene, framed?: ReadonlyMap<CellKey, number>): Set<CellKey> {
  const out = new Set<CellKey>()
  const upright = (k: CellKey) => {
    const c = scene.cells.get(k)
    return c?.stance === 'upright' && c.featureTile !== undefined
  }
  for (const b of scene.billboards) {
    if (b.kind === 'cloud' || b.kind === 'projectile') continue
    const k = cellKey(b.x, b.y)
    if (upright(k) && !framed?.has(k)) out.add(k)
  }
  if (scene.playerOnLevel) {
    const k = cellKey(scene.player.x, scene.player.y)
    if (upright(k) && !framed?.has(k)) out.add(k)
  }
  return out
}

/**
 * How a cell's feature stands: `upright` in its cell (a statue, a tree, an
 * altar), `framed` a door in its doorway (`doorBoard`), `lying` in its cell
 * as a corpse lies (a way down, a trap), `floor` painted on the floor (what
 * crawl draws flat, and an upright feature something stands on). Null where
 * there is none to draw, or it is a wall's and the wall is all there is.
 */
export type FeatureStance = 'upright' | 'framed' | 'lying' | 'floor'

export function featureStance(c: SceneCell, framed: ReadonlyMap<CellKey, number>, occupied: ReadonlySet<CellKey>): FeatureStance | null {
  if (c.featureTile === undefined || c.kind === 'unknown') return null
  const k = cellKey(c.x, c.y)
  const inDoorway = framed.has(k)
  if (c.occluder && !inDoorway) return null
  if (c.stance === 'lying') return 'lying'
  if (c.stance === 'upright' && !occupied.has(k)) return inDoorway ? 'framed' : 'upright'
  return 'floor'
}

/**
 * A door in its doorway as it stands: squared to its wall run, full height,
 * its art stretched to the walls either side. The walls stand `inset` back
 * from the doorway as from any opening, and the board reaches them; an end
 * facing the next leaf of a gate stays at the cell's edge. Only its middle
 * stretches: open, the leaves either side keep their size, as they would
 * parting to the walls, and the stretch is the doorway between them; closed,
 * the outer quarters keep theirs. Closed, it is a block the run's thickness,
 * its faces in the planes of the walls either side; open, a board in the
 * face of the run on the eye's side.
 *
 * Its art reads the same way from either side: its left at the run's west
 * end, or its south end for a run north–south, so crawl's gate pieces (left,
 * middle, right) meet with the posts at the gate's ends and not between its
 * leaves, and from behind it reads mirrored, as crawl's far face is. A gate
 * running north–south wears the horizontal piece its east face shows
 * (`SceneCell.faceTiles`), which then reads the right way round from the
 * east.
 */
export interface DoorBoard {
  /** the heading it stands at (`framedDoors`): 0 for a run east–west, else north–south */
  yaw: number
  closed: boolean
  tile: TileId
  art: TileRect
  /** how far the art reaches past the cell at its left end and its right, in the art's texels */
  left: number
  right: number
  /** the columns at either end of the art the stretch leaves as they are */
  native: number
  /** the run's thickness, in cells */
  run: number
}

export function doorBoard(cell: SceneCell, framed: ReadonlyMap<CellKey, number>, inset: number, tile: (id: TileId) => TileRect | undefined): DoorBoard | null {
  const yaw = framed.get(cellKey(cell.x, cell.y))
  if (yaw === undefined || cell.featureTile === undefined) return null
  const r = tile(cell.featureTile)
  if (!r) return null
  const east = yaw !== 0 ? cell.faceTiles?.e : undefined
  const eastArt = east !== undefined ? tile(east) : undefined
  const art = eastArt ?? r
  const push = inset * art.cell
  const [ax, az] = yaw === 0 ? [-1, 0] : [0, 1]
  const wall = (dx: number, dz: number) => (framed.has(cellKey(cell.x + dx, cell.y + dz)) ? 0 : push)
  const closed = !!cell.occluder
  return {
    yaw,
    closed,
    tile: eastArt ? east! : cell.featureTile,
    art,
    left: wall(ax, az),
    right: wall(-ax, -az),
    native: Math.floor((art.w * (closed ? 2 : 3)) / 8),
    run: Math.max(0, 1 - 2 * inset),
  }
}

/** How far along a door's board a point of its cell (lx, lz) is, in cells from the cell's edge at the art's left end. */
export function boardAlong(b: DoorBoard, lx: number, lz: number): number {
  return b.yaw === 0 ? lx : 1 - lz
}

/**
 * The art's column `s` cells along a door's board (`boardAlong`), in texels
 * of the art's cell as `TileRect.ox` counts them; NaN off the board. The
 * board is the art and its stretch: the `native` columns at either end as
 * they are, those between as wide as each other, taking up the difference.
 */
export function boardTexel(b: DoorBoard, s: number): number {
  const { art } = b
  const W = art.w
  const Wq = W + b.left + b.right
  const x = s * art.cell - (art.ox - b.left)
  if (!(x >= 0 && x < Wq)) return NaN
  if (Wq - W <= 1e-3) return art.ox + x
  const edge = Math.min(b.native, Math.floor(W / 2))
  const span = W - 2 * edge
  if (span <= 0) return art.ox + Math.min(W, (x * W) / Wq)
  const k = (span + Wq - W) / span
  const xb = edge + span * k
  return art.ox + (x <= edge ? x : x <= xb ? edge + (x - edge) / k : x - (xb - (W - edge)))
}
