/**
 * Wall footprints (rendering-3d.md II.1 "Inset walls").
 *
 * The wall surface is defined as the offset of the floor: grow every open
 * cell by `inset` in Chebyshev distance (a square kernel, so faces stay
 * axis-aligned) and the wall body is whatever solid space is left. A level
 * set of a distance field has no seams, so two adjacent wall cells always
 * meet flush, whatever their neighbours: a straight run is one plane, a
 * concave corner loses a square from the diagonal cell, a one-thick wall
 * keeps a core of 1 - 2·inset, a pillar becomes a post.
 *
 * `insetFootprint` evaluates that definition locally, from a cell's eight
 * neighbours, and returns the body polygon and its exposed vertical faces.
 * The test suite checks the local rule against the literal definition.
 *
 * Coordinates are cell-local: x to the east in [0, 1], z to the south in
 * [0, 1], matching the renderer's world mapping (cell (x, y) -> world (x, 0, y)).
 */

import { cellKey, type Scene } from '@orbrun/scene'

export type CellClass = 'floor' | 'wall' | 'void'
export type ClassAt = (x: number, z: number) => CellClass

export interface FootprintOptions {
  /** How far the wall surface stands back from the floor, in cells. Below 0.5 or one-thick walls vanish. Void steps back the same way. */
  inset: number
}

export type Pt = [number, number]

/** One exposed vertical face of a body: a segment in local coordinates with its outward normal. */
export interface FootprintFace {
  a: Pt
  b: Pt
  nx: number
  nz: number
  /**
   * A boundary segment the neighbour's body covers. Not part of the surface;
   * reported so a renderer can still draw it from a lower neighbour's height
   * (a wall standing on a plinth's edge).
   */
  covered?: boolean
}

/** A solid cell's body rectangle before corner cuts, its inset, and which corners (nw, ne, sw, se) a diagonal floor cell cuts. */
export interface BodyRect {
  x0: number
  x1: number
  z0: number
  z1: number
  t: number
  cut: [boolean, boolean, boolean, boolean]
}

export interface Footprint {
  /** Body outline, clockwise on the map (x east, z south). Empty when nothing is left. */
  poly: Pt[]
  faces: FootprintFace[]
}

const EPS = 1e-9

/**
 * The body rectangle and corner cuts of a solid cell before chamfering.
 * Returns null for an open cell or a body squeezed to nothing.
 */
export function bodyRect(at: ClassAt, x: number, z: number, o: FootprintOptions): BodyRect | null {
  const cls = at(x, z)
  if (cls === 'floor') return null
  const t = o.inset
  const open = (dx: number, dz: number) => at(x + dx, z + dz) === 'floor'
  const oN = open(0, -1), oS = open(0, 1), oW = open(-1, 0), oE = open(1, 0)
  const x0 = oW ? t : 0, x1 = oE ? 1 - t : 1
  const z0 = oN ? t : 0, z1 = oS ? 1 - t : 1
  if (x1 - x0 <= EPS || z1 - z0 <= EPS) return null
  // Corner cuts: the diagonal is open and both orthogonals are solid, so the
  // grown diagonal cell eats a t×t square the rectangle did not already lose.
  // Indexed nw, ne, sw, se.
  const cut: [boolean, boolean, boolean, boolean] = [
    t > 0 && open(-1, -1) && !oN && !oW,
    t > 0 && open(1, -1) && !oN && !oE,
    t > 0 && open(-1, 1) && !oS && !oW,
    t > 0 && open(1, 1) && !oS && !oE,
  ]
  return { x0, x1, z0, z1, cut, t }
}

/**
 * Where a solid cell's body touches one of its cell edges, as intervals along
 * that edge (x for n/s, z for w/e). Used to hide the part of a neighbour's
 * boundary face that this body covers.
 */
function coverage(at: ClassAt, x: number, z: number, side: 'n' | 's' | 'w' | 'e', o: FootprintOptions): [number, number][] {
  const b = bodyRect(at, x, z, o)
  if (!b) return []
  const { x0, x1, z0, z1, cut, t } = b
  let lo: number, hi: number
  let cA: boolean, cB: boolean
  switch (side) {
    case 'n': if (z0 > EPS) return []; lo = x0; hi = x1; cA = cut[0]; cB = cut[1]; break
    case 's': if (z1 < 1 - EPS) return []; lo = x0; hi = x1; cA = cut[2]; cB = cut[3]; break
    case 'w': if (x0 > EPS) return []; lo = z0; hi = z1; cA = cut[0]; cB = cut[2]; break
    case 'e': if (x1 < 1 - EPS) return []; lo = z0; hi = z1; cA = cut[1]; cB = cut[3]; break
  }
  if (cA) lo = Math.max(lo, t)
  if (cB) hi = Math.min(hi, 1 - t)
  return hi - lo > EPS ? [[lo, hi]] : []
}

/** Interval [lo, hi] minus a list of intervals. */
function subtract(lo: number, hi: number, holes: [number, number][]): [number, number][] {
  let out: [number, number][] = [[lo, hi]]
  for (const [a, b] of holes) {
    const next: [number, number][] = []
    for (const [p, q] of out) {
      if (b <= p + EPS || a >= q - EPS) { next.push([p, q]); continue }
      if (a > p + EPS) next.push([p, a])
      if (b < q - EPS) next.push([b, q])
    }
    out = next
  }
  return out
}

/** The footprint of the solid cell at (x, z), or an empty one for an open cell or a vanished body. */
export function insetFootprint(at: ClassAt, x: number, z: number, o: FootprintOptions): Footprint {
  const b = bodyRect(at, x, z, o)
  if (!b) return { poly: [], faces: [] }
  const { x0, x1, z0, z1, cut, t } = b
  // outline, clockwise on the map: nw, ne, se, sw
  const poly: Pt[] = []
  if (cut[0]) poly.push([x0, t], [t, t], [t, z0]); else poly.push([x0, z0])
  if (cut[1]) poly.push([1 - t, z0], [1 - t, t], [x1, t]); else poly.push([x1, z0])
  if (cut[3]) poly.push([x1, 1 - t], [1 - t, 1 - t], [1 - t, z1]); else poly.push([x1, z1])
  if (cut[2]) poly.push([t, z1], [t, 1 - t], [x0, 1 - t]); else poly.push([x0, z1])

  // Exposed part of every edge. An edge on the cell boundary is hidden where
  // the neighbour's body covers it; every other edge faces grown floor.
  type Seg = { a: Pt; b: Pt; nx: number; nz: number }
  const coveredSegs: Seg[] = []
  const segs: Seg[][] = poly.map((p, i) => {
    const q = poly[(i + 1) % poly.length]
    const dx = q[0] - p[0], dz = q[1] - p[1]
    const len = Math.hypot(dx, dz)
    const nx = dz / len, nz = -dx / len
    const horizontal = Math.abs(dz) < EPS
    const lo = horizontal ? Math.min(p[0], q[0]) : Math.min(p[1], q[1])
    const hi = horizontal ? Math.max(p[0], q[0]) : Math.max(p[1], q[1])
    let holes: [number, number][] = []
    if (horizontal && p[1] < EPS) holes = coverage(at, x, z - 1, 's', o)
    else if (horizontal && p[1] > 1 - EPS) holes = coverage(at, x, z + 1, 'n', o)
    else if (!horizontal && p[0] < EPS) holes = coverage(at, x - 1, z, 'e', o)
    else if (!horizontal && p[0] > 1 - EPS) holes = coverage(at, x + 1, z, 'w', o)
    const fwd = horizontal ? dx > 0 : dz > 0
    const seg = ([s, e]: [number, number]): Seg => {
      const [u, v] = fwd ? [s, e] : [e, s]
      const a: Pt = horizontal ? [u, p[1]] : [p[0], u]
      const bb: Pt = horizontal ? [v, p[1]] : [p[0], v]
      return { a, b: bb, nx, nz }
    }
    for (const [ha, hb] of holes) {
      const s = Math.max(lo, ha), e = Math.min(hi, hb)
      if (e - s > EPS) coveredSegs.push(seg([s, e]))
    }
    const parts = subtract(lo, hi, holes)
    if (!fwd) parts.reverse()
    return parts.map(seg)
  })

  const faces: FootprintFace[] = []
  for (const list of segs) for (const s of list) faces.push(s)
  for (const s of coveredSegs) faces.push({ ...s, covered: true })
  return { poly, faces }
}

/** Classify a Scene's cells for the footprint rule: never-seen space is void, occluders are walls, the rest is floor. */
export function sceneClassAt(scene: Scene): ClassAt {
  return (x, z) => {
    const c = scene.cells.get(cellKey(x, z))
    if (!c || c.kind === 'unknown') return 'void'
    return c.occluder ? 'wall' : 'floor'
  }
}

/** Parse an ASCII map: `#` wall, `.` floor, space void. Cells outside the rows are void. */
export function asciiClassAt(rows: string[]): ClassAt {
  return (x, z) => {
    const ch = rows[z]?.[x]
    if (ch === undefined || ch === ' ') return 'void'
    return ch === '#' ? 'wall' : 'floor'
  }
}

/**
 * The literal definition, for checking: is the local point (fx, fz) of cell
 * (x, z) inside the body? True when the cell is solid and no open cell lies
 * within `inset` (Chebyshev) of the point.
 */
export function insetOracle(at: ClassAt, x: number, z: number, fx: number, fz: number, o: FootprintOptions): boolean {
  if (at(x, z) === 'floor') return false
  const t = o.inset
  if (t <= 0) return true
  const px = x + fx, pz = z + fz
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue
      if (at(x + dx, z + dz) !== 'floor') continue
      const cx = x + dx, cz = z + dz
      const ex = Math.max(cx - px, 0, px - (cx + 1))
      const ez = Math.max(cz - pz, 0, pz - (cz + 1))
      if (Math.max(ex, ez) < t - EPS) return false
    }
  }
  return true
}

/** Point in (possibly non-convex) polygon, local coordinates. */
export function inPoly(poly: Pt[], px: number, pz: number): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j]
    if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}
