import { describe, it, expect } from 'vitest'
import { extrudeFaces, rectangles, runs } from '../src/mesh.js'

/**
 * The merged faces are the per-texel faces, joined: the same texels covered,
 * each exactly once, every face in the same plane with the same winding.
 * Pinned by rasterizing the merged faces back onto the texel grid and
 * comparing with the one-quad-per-texel build for a spread of masks.
 */
function mask(seed: number, w: number, h: number, fill: number): (tx: number, ty: number) => boolean {
  const on = new Uint8Array(w * h)
  let s = seed
  for (let i = 0; i < on.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    on[i] = s / 0x7fffffff < fill ? 1 : 0
  }
  return (tx, ty) => tx >= 0 && ty >= 0 && tx < w && ty < h && on[ty * w + tx] === 1
}

/** The unit squares a quad covers in its own plane, as `x,y` texel keys, and the plane it lies in. */
function cover(f: number[]): { plane: string; cells: string[] } {
  const xs = [f[0], f[3], f[6], f[9]], ys = [f[1], f[4], f[7], f[10]], zs = [f[2], f[5], f[8], f[11]]
  const span = (v: number[]) => [Math.min(...v), Math.max(...v)]
  const [x0, x1] = span(xs), [y0, y1] = span(ys), [z0, z1] = span(zs)
  const cells: string[] = []
  if (z0 === z1) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) cells.push(`z${z0}:${x},${y}`)
    return { plane: `z${z0}`, cells }
  }
  if (y0 === y1) {
    for (let x = x0; x < x1; x++) cells.push(`y${y0}:${x}`)
    return { plane: `y${y0}`, cells }
  }
  for (let y = y0; y < y1; y++) cells.push(`x${x0}:${y}`)
  return { plane: `x${x0}`, cells }
}

/** Winding: the quad's normal, from its first three points. */
function normal(f: number[]): string {
  const ax = f[3] - f[0], ay = f[4] - f[1], az = f[5] - f[2]
  const bx = f[6] - f[0], by = f[7] - f[1], bz = f[8] - f[2]
  const n = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx].map((v) => Math.sign(v))
  return n.join(',')
}

/** One quad per texel, as `hullTemplate` built them before the merge. */
function perTexel(on: (tx: number, ty: number) => boolean, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, ends: { back: boolean; front: boolean }): number[][] {
  const out: number[][] = []
  for (let ty = y0; ty < y1; ty++)
    for (let tx = x0; tx < x1; tx++) {
      if (!on(tx, ty)) continue
      const fx0 = tx, fx1 = tx + 1, fy1 = -ty, fy0 = fy1 - 1
      if (ends.back) out.push([fx1, fy0, z0, fx0, fy0, z0, fx0, fy1, z0, fx1, fy1, z0])
      if (ends.front) out.push([fx0, fy0, z1, fx1, fy0, z1, fx1, fy1, z1, fx0, fy1, z1])
      if (!on(tx, ty - 1)) out.push([fx0, fy1, z1, fx1, fy1, z1, fx1, fy1, z0, fx0, fy1, z0])
      if (!on(tx, ty + 1)) out.push([fx0, fy0, z0, fx1, fy0, z0, fx1, fy0, z1, fx0, fy0, z1])
      if (!on(tx - 1, ty)) out.push([fx0, fy0, z0, fx0, fy0, z1, fx0, fy1, z1, fx0, fy1, z0])
      if (!on(tx + 1, ty)) out.push([fx1, fy0, z1, fx1, fy0, z0, fx1, fy1, z0, fx1, fy1, z1])
    }
  return out
}

/** Every (plane, texel, winding) a set of faces covers, counted. */
function coverage(faces: number[][]): Map<string, number> {
  const m = new Map<string, number>()
  for (const f of faces) {
    const { cells } = cover(f)
    const n = normal(f)
    for (const c of cells) m.set(`${c}|${n}`, (m.get(`${c}|${n}`) || 0) + 1)
  }
  return m
}

describe('exact face merging', () => {
  it('covers the filled texels exactly once with rectangles', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const on = mask(seed, 13, 9, 0.6)
      const rects = rectangles(on, -1, 14, -1, 10)
      const hits = new Map<string, number>()
      for (const r of rects) for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) hits.set(`${x},${y}`, (hits.get(`${x},${y}`) || 0) + 1)
      for (let y = -1; y < 10; y++) for (let x = -1; x < 14; x++) expect(hits.get(`${x},${y}`) || 0).toBe(on(x, y) ? 1 : 0)
      expect(rects.length).toBeLessThan([...hits.keys()].length || 1)
    }
  })

  it('splits a line into its runs', () => {
    const on = [1, 1, 0, 1, 0, 0, 1, 1, 1]
    expect(runs((t) => on[t] === 1, 0, on.length)).toEqual([[0, 2], [3, 4], [6, 9]])
    expect(runs(() => false, 0, 5)).toEqual([])
    expect(runs(() => true, 2, 5)).toEqual([[2, 5]])
  })

  it('builds the same planes, texels and windings as one quad per texel, in fewer faces', () => {
    for (let seed = 1; seed <= 20; seed++) {
      for (const ends of [{ back: true, front: false }, { back: true, front: true }, { back: false, front: true }]) {
        const on = mask(seed, 12, 10, seed % 3 ? 0.55 : 0.9)
        const naive = perTexel(on, -1, 13, -1, 11, -1, 0, ends)
        const merged = extrudeFaces(on, -1, 13, -1, 11, -1, 0, ends)
        expect(coverage(merged)).toEqual(coverage(naive))
        for (const c of coverage(merged).values()) expect(c).toBe(1)
        expect(merged.length).toBeLessThanOrEqual(naive.length)
        if (naive.length > 8) expect(merged.length).toBeLessThan(naive.length)
      }
    }
  })

  it('leaves the sides out of a flat ring', () => {
    const on = (tx: number, ty: number) => tx >= 0 && ty >= 0 && tx < 3 && ty < 3 && !(tx === 1 && ty === 1)
    const faces = extrudeFaces(on, 0, 3, 0, 3, 0, 0, { back: false, front: true }, false)
    for (const f of faces) for (let i = 2; i < 12; i += 3) expect(f[i]).toBe(0)
    expect(coverage(faces)).toEqual(coverage(perTexel(on, 0, 3, 0, 3, 0, 0, { back: false, front: true }).filter((f) => f.every((_, i) => i % 3 !== 2 || f[i] === 0))))
  })
})
