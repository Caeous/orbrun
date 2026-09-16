/**
 * Exact face merging for texel-built geometry (`hullTemplate`, `ringTemplate`,
 * the hands' ink). A face built one quad per texel is a partition of a plane
 * region into unit squares; the same region as fewer, larger rectangles is
 * the same plane, the same edges, the same winding and the same coverage —
 * the rasterizer fills a union of coplanar rectangles exactly as it fills the
 * unit squares that tile it — so only faces of one colour are merged here.
 * Textured faces keep their own texel's uv and are never merged.
 */

export interface TexelRect {
  x0: number
  y0: number
  /** Exclusive. */
  x1: number
  y1: number
}

/**
 * An exact cover of the texels `on` fills within [x0, x1) × [y0, y1), as
 * rectangles that never overlap: greedy, each grown as wide as its row
 * allows and then as deep as every row below stays filled. The rectangles
 * are listed in row-major order of their top-left texel.
 */
export function rectangles(on: (tx: number, ty: number) => boolean, x0: number, x1: number, y0: number, y1: number): TexelRect[] {
  const w = x1 - x0, h = y1 - y0
  const out: TexelRect[] = []
  if (w <= 0 || h <= 0) return out
  const seen = new Uint8Array(w * h)
  const free = (tx: number, ty: number) => tx < x1 && ty < y1 && !seen[(ty - y0) * w + (tx - x0)] && on(tx, ty)
  for (let ty = y0; ty < y1; ty++) {
    for (let tx = x0; tx < x1; tx++) {
      if (!free(tx, ty)) continue
      let rx = tx + 1
      while (free(rx, ty)) rx++
      let ry = ty + 1
      rows: while (ry < y1) {
        for (let x = tx; x < rx; x++) if (!free(x, ry)) break rows
        ry++
      }
      for (let y = ty; y < ry; y++) for (let x = tx; x < rx; x++) seen[(y - y0) * w + (x - x0)] = 1
      out.push({ x0: tx, y0: ty, x1: rx, y1: ry })
    }
  }
  return out
}

/**
 * Runs of consecutive texels along a row (`along` 'x': ty fixed, tx running)
 * or a column ('y') for which `on` holds, within [a0, a1): each run is one
 * face where there was one per texel. Returned as [start, end) pairs.
 */
export function runs(on: (t: number) => boolean, a0: number, a1: number): [number, number][] {
  const out: [number, number][] = []
  let start = -1
  for (let t = a0; t <= a1; t++) {
    const hit = t < a1 && on(t)
    if (hit && start < 0) start = t
    else if (!hit && start >= 0) {
      out.push([start, t])
      start = -1
    }
  }
  return out
}

/**
 * The faces of an extrusion of the texels `on` fills within [x0, x1) × [y0, y1),
 * as quads in texel units (x right, y up: texel row ty spans y ∈ [-ty-1, -ty]),
 * every face wound outward, merged exactly (`rectangles`, `runs`). `back` and
 * `front` are the depths of the two end faces (z0 the back, z1 the front),
 * either left out when undefined; the four sides are always built, one per
 * run of exposed texel edges. This is the hull (`hullTemplate`) and the hands'
 * ink; a flat ring is `front` alone at 0.
 */
export function extrudeFaces(
  on: (tx: number, ty: number) => boolean,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
  ends: { back: boolean; front: boolean },
  sides = true,
): number[][] {
  const faces: number[][] = []
  for (const r of rectangles(on, x0, x1, y0, y1)) {
    const fx0 = r.x0, fx1 = r.x1
    const fy1 = -r.y0, fy0 = -r.y1
    if (ends.back) faces.push([fx1, fy0, z0, fx0, fy0, z0, fx0, fy1, z0, fx1, fy1, z0])
    if (ends.front) faces.push([fx0, fy0, z1, fx1, fy0, z1, fx1, fy1, z1, fx0, fy1, z1])
  }
  if (!sides) return faces
  for (let ty = y0; ty < y1; ty++) {
    const fy1 = -ty, fy0 = fy1 - 1
    // the top edge of a texel row, wherever the row above is empty; the bottom, wherever the row below is
    for (const [a, b] of runs((tx) => on(tx, ty) && !on(tx, ty - 1), x0, x1)) faces.push([a, fy1, z1, b, fy1, z1, b, fy1, z0, a, fy1, z0])
    for (const [a, b] of runs((tx) => on(tx, ty) && !on(tx, ty + 1), x0, x1)) faces.push([a, fy0, z0, b, fy0, z0, b, fy0, z1, a, fy0, z1])
  }
  for (let tx = x0; tx < x1; tx++) {
    const fx0 = tx, fx1 = tx + 1
    // the left edge of a texel column, wherever the column to the left is empty; the right likewise
    for (const [a, b] of runs((ty) => on(tx, ty) && !on(tx - 1, ty), y0, y1)) faces.push([fx0, -b, z0, fx0, -b, z1, fx0, -a, z1, fx0, -a, z0])
    for (const [a, b] of runs((ty) => on(tx, ty) && !on(tx + 1, ty), y0, y1)) faces.push([fx1, -b, z1, fx1, -b, z0, fx1, -a, z0, fx1, -a, z1])
  }
  return faces
}
