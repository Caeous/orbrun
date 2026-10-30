/**
 * The view's pixels as terminal cells: for each cell a glyph and the two
 * colours, foreground and background, that show its pixels best.
 */
import type { Cell, Raster } from './render'
import { coverage, OCTANTS, SEXTANTS, SHAPES, type Shape } from './shapes'

const enc = (v: number) => {
  const c = v <= 0 ? 0 : v >= 1 ? 1 : v
  return Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055))
}
/** Encoded sRGB, by linear value in 4096 steps. */
export const ENC = new Uint8Array(4097).map((_, i) => enc(i / 4096))
export const q = (v: number) => ENC[v <= 0 ? 0 : v >= 1 ? 4096 : (v * 4096) | 0]

export interface Encoder {
  /** pixels a cell, across and down */
  SX: number
  SY: number
  /** the blocks of pixels the background may be drawn in, being only as fine as the dots */
  coarse?: number
  encode(r: Raster, cols: number, rows: number): Cell[]
  /** the same cells packed into `out` (`pack`), three numbers a cell */
  encodeInto(r: Raster, cols: number, rows: number, out: Int32Array): void
}

/**
 * A cell packed into `out` at cell `i`: its glyph's code point, then its
 * foreground and background as 0xRRGGBB, each channel rounded. Cells are
 * kept so (three numbers each, in memory threads can share) rather than as
 * `Cell`s, which are made only where asked for (`unpack`).
 */
export function pack(out: Int32Array, i: number, cp: number, f0: number, f1: number, f2: number, b0: number, b1: number, b2: number) {
  out[i * 3] = cp
  out[i * 3 + 1] = (Math.round(f0) << 16) | (Math.round(f1) << 8) | Math.round(f2)
  out[i * 3 + 2] = (Math.round(b0) << 16) | (Math.round(b1) << 8) | Math.round(b2)
}
const SPACE = 32

/** packed cells as `Cell`s */
export function unpack(cells: Int32Array): Cell[] {
  const out: Cell[] = new Array(cells.length / 3)
  for (let i = 0; i < out.length; i++) {
    const f = cells[i * 3 + 1], b = cells[i * 3 + 2]
    out[i] = { ch: String.fromCodePoint(cells[i * 3]), fg: [f >> 16, (f >> 8) & 255, f & 255], bg: [b >> 16, (b >> 8) & 255, b & 255] }
  }
  return out
}

/** an encoder of packed cells, with `encode` for them as `Cell`s */
const withCells = (e: Omit<Encoder, 'encode'>): Encoder => ({
  ...e,
  encode(r, cols, rows) {
    const out = new Int32Array(cols * rows * 3)
    e.encodeInto(r, cols, rows, out)
    return unpack(out)
  },
})

export type EncoderName = keyof typeof encoders
export type Mosaic = 'octant' | 'sextant'

export interface FitOptions {
  /** pixels a cell, across and down */
  SX?: number
  SY?: number
  /** how much what is wrong of each block of 2x2 samples counts, beside sample by sample: an edge's shape seen from a step back */
  blur?: number
  /** where the slanted glyphs may be used: anywhere, only on the edge of something standing, or nowhere */
  wedges?: 'all' | 'edges' | 'none'
  /** leave out the glyphs a slim line of a cell (an eighth across or down), which draw a stray line where an edge falls near one */
  slim?: boolean
  /** fit only the cells something standing is in, at its pixels; the rest as `dots` do, the background drawn only as fine as the dots */
  hybrid?: boolean
  /** how many glyphs, those nearest the cell's own split in two, are tried for it; 0 for all */
  tries?: number
  /** each colour the pixel of its side nearest the side's mean, so a cell keeps the art's own colours, never a muddy mix */
  medoid?: boolean
}

export const encoders = {
  /** a pixel a dot of the cell's mosaic, the dots split in two */
  dots: (mosaic: Mosaic): Encoder => {
    const DY = mosaic === 'sextant' ? 3 : 4
    return withCells({ SX: 2, SY: DY, encodeInto: (r, cols, rows, out) => encodeCells(r.pix, r.weight, r.W, cols, rows, 2, DY, DY === 4 ? OCTANT_CPS : SEXTANT_CPS, out) })
  },
  /** finer pixels than the dots, each glyph tried for the cell in its best two colours, as chafa does */
  fit: (mosaic: Mosaic, opts: FitOptions = {}): Encoder => fitEncoder(mosaic, opts.SX ?? 4, opts.SY ?? (mosaic === 'sextant' ? 6 : 8), opts),
}

interface Sym {
  ch: string
  cp: number
  wedge: boolean
  mask: Float32Array
  A: number
  B: number
  C: number
  /** how much it inks of each block of 2x2 samples */
  blk: Float32Array
  /** the samples it mostly inks, one a bit, where there are 32 or fewer */
  bits: number
  /** where it inks each sample whole or not at all, the samples it inks, and those it does not; else null */
  on: Int32Array | null
  off: Int32Array | null
}

/** the mosaics' glyphs as code points */
const OCTANT_CPS = Int32Array.from(OCTANTS, (c) => c.codePointAt(0)!)
const SEXTANT_CPS = Int32Array.from(SEXTANTS, (c) => c.codePointAt(0)!)

const fitCache = new Map<string, Sym[]>()
/** an eighth of a cell, or all but one, across or down */
const SLIM = new Set(['▁', '▇', '▏', '▉', '▔', '▕'])
function symbols(mosaic: Mosaic, SX: number, SY: number, slim = true): Sym[] {
  const key = `${mosaic}:${SX}x${SY}:${slim}`
  let syms = fitCache.get(key)
  if (syms) return syms
  syms = []
  const sets: Shape['set'][] = ['block', 'quadrant', 'eighth', 'sextant', 'wedge', ...(mosaic === 'octant' ? (['octant'] as const) : [])]
  const NB = Math.ceil(SX / 2) * Math.ceil(SY / 2)
  for (const sh of SHAPES) {
    if (!sets.includes(sh.set) || sh.ch === ' ' || sh.ch === '█') continue
    if (!slim && SLIM.has(sh.ch)) continue
    const mask = coverage(sh, SX, SY)
    let A = 0, B = 0, C = 0
    for (const m of mask) {
      A += m * m
      B += m * (1 - m)
      C += (1 - m) * (1 - m)
    }
    if (A * C - B * B < 1e-3) continue
    // a shape another glyph has already, or its inverse, is left out
    if (syms.some((o) => o.mask.every((v, i) => Math.abs(v - mask[i]) < 0.03) || o.mask.every((v, i) => Math.abs(1 - v - mask[i]) < 0.03))) continue
    const blk = new Float32Array(NB)
    for (let y = 0; y < SY; y++) for (let x = 0; x < SX; x++) blk[(y >> 1) * Math.ceil(SX / 2) + (x >> 1)] += mask[y * SX + x]
    let bits = 0
    if (mask.length <= 32) for (let k = 0; k < mask.length; k++) if (mask[k] >= 0.5) bits |= 1 << k
    const whole = mask.every((m) => m === 0 || m === 1)
    const on = whole ? Int32Array.from(mask.keys()).filter((k) => mask[k] === 1) : null
    const off = whole ? Int32Array.from(mask.keys()).filter((k) => mask[k] === 0) : null
    syms.push({ ch: sh.ch, cp: sh.ch.codePointAt(0)!, wedge: sh.set === 'wedge', mask, A, B, C, blk, bits: bits >>> 0, on, off })
  }
  fitCache.set(key, syms)
  return syms
}

const popcount = (v: number) => {
  v = v - ((v >>> 1) & 0x55555555)
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333)
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

function fitEncoder(mosaic: Mosaic, SX: number, SY: number, opts: FitOptions): Encoder {
  const near = new Map<number, Sym[]>()
  const syms = symbols(mosaic, SX, SY, opts.slim ?? true)
  const N = SX * SY
  const BX = Math.ceil(SX / 2)
  const NB = BX * Math.ceil(SY / 2)
  const blur = opts.blur ?? 0
  const p = new Float32Array(N * 3)
  /** each sample's squared length, a whole number */
  const psq = new Float64Array(N)
  const w = new Float32Array(N)
  const bs = new Float32Array(NB * 3)
  const bn = new Float32Array(NB)
  const hybrid = opts.hybrid && SX % 2 === 0 && SY % 2 === 0
  const dotGlyphs = SY === 8 ? OCTANT_CPS : SEXTANT_CPS
  return withCells({
    SX,
    SY,
    coarse: hybrid ? 2 : 1,
    encodeInto(r, cols, rows, out) {
      const { pix, weight, thing, W } = r
      // the cells something standing is in, fitted; the rest, the background, as the dots' own two means, which hold steadier on a texture as the view turns than its own colours
      const fitted = new Uint8Array(cols * rows)
      if (hybrid && r.standing && r.SX === SX && r.SY === SY) for (let c = 0; c < cols * rows; c++) fitted[c] = r.standing[c] === 1 ? 1 : 0
      else if (hybrid) for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) fitted[cy * cols + cx] = standing(thing, W, cx * SX, cy * SY, SX, SY) ? 1 : 0
      // the rest, the background, as the dots' own two means, straight into `out`
      if (hybrid) encodeCells(r.pix, r.weight, r.W, cols, rows, SX / 2, SY / 2, dotGlyphs, out, 2, fitted)
      const wedges = opts.wedges ?? 'all'
      const K = N <= 32 ? (opts.tries ?? 12) : 0
      const best = new Int32Array(K)
      const dist = new Int32Array(syms.length)
      /** the glyphs to try for the cell in p: those nearest its split into two colours, either way round */
      const candidates = (): Sym[] => {
        if (!K) return syms
        // the split: across the channel that varies most, at its middle, then each sample to the nearer side's mean
        let lo0 = 255, lo1 = 255, lo2 = 255, hi0 = 0, hi1 = 0, hi2 = 0
        for (let k = 0; k < N; k++) {
          const v0 = p[k * 3], v1 = p[k * 3 + 1], v2 = p[k * 3 + 2]
          if (v0 < lo0) lo0 = v0
          if (v0 > hi0) hi0 = v0
          if (v1 < lo1) lo1 = v1
          if (v1 > hi1) hi1 = v1
          if (v2 < lo2) lo2 = v2
          if (v2 > hi2) hi2 = v2
        }
        const chn = hi0 - lo0 >= hi1 - lo1 && hi0 - lo0 >= hi2 - lo2 ? 0 : hi1 - lo1 >= hi2 - lo2 ? 1 : 2
        const mid = chn === 0 ? (lo0 + hi0) / 2 : chn === 1 ? (lo1 + hi1) / 2 : (lo2 + hi2) / 2
        let bits = 0
        for (let k = 0; k < N; k++) if (p[k * 3 + chn] > mid) bits |= 1 << k
        for (let pass = 0; pass < 2; pass++) {
          let a0 = 0, a1 = 0, a2 = 0, na = 0, b0 = 0, b1 = 0, b2 = 0, nb = 0
          for (let k = 0; k < N; k++) {
            const wk = w[k]
            if (bits & (1 << k)) (a0 += wk * p[k * 3]), (a1 += wk * p[k * 3 + 1]), (a2 += wk * p[k * 3 + 2]), (na += wk)
            else (b0 += wk * p[k * 3]), (b1 += wk * p[k * 3 + 1]), (b2 += wk * p[k * 3 + 2]), (nb += wk)
          }
          if (!na || !nb) break
          a0 /= na, a1 /= na, a2 /= na, b0 /= nb, b1 /= nb, b2 /= nb
          let next = 0
          for (let k = 0; k < N; k++) {
            const ea = (p[k * 3] - a0) ** 2 + (p[k * 3 + 1] - a1) ** 2 + (p[k * 3 + 2] - a2) ** 2
            const eb = (p[k * 3] - b0) ** 2 + (p[k * 3 + 1] - b1) ** 2 + (p[k * 3 + 2] - b2) ** 2
            if (ea < eb) next |= 1 << k
          }
          if (next === bits) break
          bits = next
        }
        bits >>>= 0
        let got = near.get(bits)
        if (!got) {
          // the K nearest, kept in order as each is seen
          best.fill(-1)
          for (let i = 0; i < syms.length; i++) {
            const d0 = popcount((bits ^ syms[i].bits) >>> 0)
            const d = d0 < N - d0 ? d0 : N - d0
            dist[i] = d
            let k = K
            while (k > 0 && (best[k - 1] < 0 || dist[best[k - 1]] > d)) k--
            if (k >= K) continue
            for (let m = K - 1; m > k; m--) best[m] = best[m - 1]
            best[k] = i
          }
          got = []
          for (let k = 0; k < K; k++) if (best[k] >= 0) got.push(syms[best[k]])
          if (near.size > 1 << 16) near.clear()
          near.set(bits, got)
        }
        return got
      }
      for (let cy = 0; cy < rows; cy++)
        for (let cx = 0; cx < cols; cx++) {
          if (hybrid && !fitted[cy * cols + cx]) continue
          let t0 = 0, t1 = 0, t2 = 0, sq = 0, NW = 0, uniform = true, inThing = 0
          if (blur) bs.fill(0), bn.fill(0)
          for (let j = 0; j < SY; j++)
            for (let i = 0; i < SX; i++) {
              const k = j * SX + i
              const pi = (cy * SY + j) * W + cx * SX + i
              const x0 = pix[pi * 3], x1 = pix[pi * 3 + 1], x2 = pix[pi * 3 + 2]
              const v0 = ENC[x0 <= 0 ? 0 : x0 >= 1 ? 4096 : (x0 * 4096) | 0]
              const v1 = ENC[x1 <= 0 ? 0 : x1 >= 1 ? 4096 : (x1 * 4096) | 0]
              const v2 = ENC[x2 <= 0 ? 0 : x2 >= 1 ? 4096 : (x2 * 4096) | 0]
              const wk = weight[pi]
              if (wk !== 1) uniform = false
              if (thing[pi] >= 0.5) inThing++
              p[k * 3] = v0
              p[k * 3 + 1] = v1
              p[k * 3 + 2] = v2
              w[k] = wk
              t0 += wk * v0
              t1 += wk * v1
              t2 += wk * v2
              psq[k] = v0 * v0 + v1 * v1 + v2 * v2
              sq += wk * psq[k]
              NW += wk
              if (!blur) continue
              const b = (j >> 1) * BX + (i >> 1)
              bs[b * 3] += v0
              bs[b * 3 + 1] += v1
              bs[b * 3 + 2] += v2
              bn[b]++
            }
          const m0 = t0 / NW, m1 = t1 / NW, m2 = t2 / NW
          const flat = sq - (t0 * t0 + t1 * t1 + t2 * t2) / NW
          let bestErr = flat, bestCp = SPACE
          let F0 = m0, F1 = m1, F2 = m2, B0 = m0, B1 = m1, B2 = m2
          if (blur) {
            let off = 0
            for (let b = 0; b < NB; b++) off += (bs[b * 3] - bn[b] * m0) ** 2 + (bs[b * 3 + 1] - bn[b] * m1) ** 2 + (bs[b * 3 + 2] - bn[b] * m2) ** 2
            bestErr += (blur * off) / 4
          }
          if (flat > N * 9) {
            const edge = inThing > 0 && inThing < N
            for (const S of candidates()) {
              if (S.wedge && (wedges === 'none' || (wedges === 'edges' && !edge))) continue
              const m = S.mask
              let A = S.A, B = S.B, C = S.C
              let s10 = 0, s11 = 0, s12 = 0, sqOn = 0
              const on = S.on, off = S.off
              if (uniform && on) {
                // the samples' own values, whole numbers, summed where it inks: the same sums, the rest adding nothing
                for (let j = 0; j < on.length; j++) {
                  const k = on[j]
                  s10 += p[k * 3]
                  s11 += p[k * 3 + 1]
                  s12 += p[k * 3 + 2]
                  sqOn += psq[k]
                }
              } else if (uniform) {
                for (let k = 0; k < N; k++) {
                  s10 += m[k] * p[k * 3]
                  s11 += m[k] * p[k * 3 + 1]
                  s12 += m[k] * p[k * 3 + 2]
                }
              } else {
                A = B = C = 0
                for (let k = 0; k < N; k++) {
                  const mk = m[k], wk = w[k]
                  A += wk * mk * mk
                  B += wk * mk * (1 - mk)
                  C += wk * (1 - mk) * (1 - mk)
                  s10 += wk * mk * p[k * 3]
                  s11 += wk * mk * p[k * 3 + 1]
                  s12 += wk * mk * p[k * 3 + 2]
                }
              }
              // what is off the glyph: the rest of the sums, as (1 - m) weighs them
              const s00 = t0 - s10, s01 = t1 - s11, s02 = t2 - s12
              const det = A * C - B * B
              if (det < 1e-6) continue
              if (opts.medoid && !blur) {
                // the least error any two colours could give this glyph: the art's own two give no less, so a glyph that cannot win is not tried
                const g0 = (C * s10 - B * s00) / det, h0 = (A * s00 - B * s10) / det
                const g1 = (C * s11 - B * s01) / det, h1 = (A * s01 - B * s11) / det
                const g2 = (C * s12 - B * s02) / det, h2 = (A * s02 - B * s12) / det
                const least =
                  sq - 2 * (g0 * s10 + h0 * s00 + g1 * s11 + h1 * s01 + g2 * s12 + h2 * s02) +
                  A * (g0 * g0 + g1 * g1 + g2 * g2) + 2 * B * (g0 * h0 + g1 * h1 + g2 * h2) + C * (h0 * h0 + h1 * h1 + h2 * h2)
                if (least > bestErr * (1 + 1e-9) + 1e-3) continue
              }
              // least squares: [A B; B C] [f; b] = [s1; s0], a channel at a time, kept to what a colour can be
              const cl = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)
              let f0 = cl((C * s10 - B * s00) / det), b0 = cl((A * s00 - B * s10) / det)
              let f1 = cl((C * s11 - B * s01) / det), b1 = cl((A * s01 - B * s11) / det)
              let f2 = cl((C * s12 - B * s02) / det), b2 = cl((A * s02 - B * s12) / det)
              let err: number
              if (opts.medoid && uniform && on && off) {
                // each colour the art's own: the pixel on its side nearest it, the first of those as near
                let df = Infinity, db = Infinity, g0 = f0, g1 = f1, g2 = f2, h0 = b0, h1 = b1, h2 = b2
                for (let j = 0; j < on.length; j++) {
                  const k = on[j] * 3
                  const v0 = p[k], v1 = p[k + 1], v2 = p[k + 2]
                  const e0 = v0 - f0, e1 = v1 - f1, e2 = v2 - f2
                  const d = e0 * e0 + e1 * e1 + e2 * e2
                  if (d < df) (df = d), (g0 = v0), (g1 = v1), (g2 = v2)
                }
                for (let j = 0; j < off.length; j++) {
                  const k = off[j] * 3
                  const v0 = p[k], v1 = p[k + 1], v2 = p[k + 2]
                  const e0 = v0 - b0, e1 = v1 - b1, e2 = v2 - b2
                  const d = e0 * e0 + e1 * e1 + e2 * e2
                  if (d < db) (db = d), (h0 = v0), (h1 = v1), (h2 = v2)
                }
                f0 = g0, f1 = g1, f2 = g2, b0 = h0, b1 = h1, b2 = h2
                // what is wrong, from the sums: every sample and colour a whole number, the sum of each sample's error exactly
                err =
                  sqOn - 2 * (f0 * s10 + f1 * s11 + f2 * s12) + on.length * (f0 * f0 + f1 * f1 + f2 * f2) +
                  (sq - sqOn) - 2 * (b0 * s00 + b1 * s01 + b2 * s02) + off.length * (b0 * b0 + b1 * b1 + b2 * b2)
              } else if (opts.medoid) {
                // each colour the art's own: the pixel on its side nearest it
                let df = Infinity, db = Infinity, g0 = f0, g1 = f1, g2 = f2, h0 = b0, h1 = b1, h2 = b2
                for (let k = 0; k < N; k++) {
                  const v0 = p[k * 3], v1 = p[k * 3 + 1], v2 = p[k * 3 + 2]
                  if (m[k] >= 0.5) {
                    const e0 = v0 - f0, e1 = v1 - f1, e2 = v2 - f2
                    const d = e0 * e0 + e1 * e1 + e2 * e2
                    if (d < df) (df = d), (g0 = v0), (g1 = v1), (g2 = v2)
                  } else {
                    const e0 = v0 - b0, e1 = v1 - b1, e2 = v2 - b2
                    const d = e0 * e0 + e1 * e1 + e2 * e2
                    if (d < db) (db = d), (h0 = v0), (h1 = v1), (h2 = v2)
                  }
                }
                f0 = g0, f1 = g1, f2 = g2, b0 = h0, b1 = h1, b2 = h2
                // what is wrong, sample by sample, until it is more than the best's: then it cannot win
                err = 0
                if (on)
                  for (let k = 0; k < N && err < bestErr; k++) {
                    // inked whole or not at all: the sample less the one colour
                    const x0 = m[k] ? p[k * 3] - f0 : p[k * 3] - b0
                    const x1 = m[k] ? p[k * 3 + 1] - f1 : p[k * 3 + 1] - b1
                    const x2 = m[k] ? p[k * 3 + 2] - f2 : p[k * 3 + 2] - b2
                    err += w[k] * (x0 * x0 + x1 * x1 + x2 * x2)
                  }
                else
                  for (let k = 0; k < N && err < bestErr; k++) {
                    const mk = m[k]
                    const x0 = p[k * 3] - f0 * mk - b0 * (1 - mk), x1 = p[k * 3 + 1] - f1 * mk - b1 * (1 - mk), x2 = p[k * 3 + 2] - f2 * mk - b2 * (1 - mk)
                    err += w[k] * (x0 * x0 + x1 * x1 + x2 * x2)
                  }
              } else
                err =
                  sq - 2 * (f0 * s10 + b0 * s00 + f1 * s11 + b1 * s01 + f2 * s12 + b2 * s02) +
                  A * (f0 * f0 + f1 * f1 + f2 * f2) + 2 * B * (f0 * b0 + f1 * b1 + f2 * b2) + C * (b0 * b0 + b1 * b1 + b2 * b2)
              if (blur && err < bestErr) {
                let off = 0
                for (let b = 0; b < NB; b++) {
                  const wb = S.blk[b], rest = bn[b] - wb
                  off += (bs[b * 3] - f0 * wb - b0 * rest) ** 2 + (bs[b * 3 + 1] - f1 * wb - b1 * rest) ** 2 + (bs[b * 3 + 2] - f2 * wb - b2 * rest) ** 2
                }
                err += (blur * off) / 4
              }
              if (err < bestErr) {
                bestErr = err
                bestCp = S.cp
                ;(F0 = f0), (F1 = f1), (F2 = f2), (B0 = b0), (B1 = b1), (B2 = b2)
              }
            }
          }
          pack(out, cy * cols + cx, bestCp, F0, F1, F2, B0, B1, B2)
        }
    },
  })
}

/** whether anything standing covers half a pixel of the block at x, y */
function standing(thing: Float32Array, W: number, x: number, y: number, w: number, h: number) {
  for (let j = 0; j < h; j++) {
    const o = (y + j) * W + x
    for (let i = 0; i < w; i++) if (thing[o + i] >= 0.5) return true
  }
  return false
}

/**
 * The pixels as mosaic cells (but those `skip` marks): each cell's DX x DY dots split in two, the
 * one group inked in the foreground and the other in the background. The
 * split runs across the line the cell's colours spread along most (not
 * their brightness alone, which takes a red face and a grey helmet for the
 * same), and is then settled as two means settle. A dot that stands out
 * counts for more (`weight`), so a cell keeps a goblin's eye rather than
 * averaging it away.
 */
function encodeCells(pix: Float32Array, weight: Float32Array, W: number, cols: number, rows: number, DX: number, DY: number, glyphs: Int32Array, out: Int32Array, by = 1, skip?: Uint8Array) {
  const n = DX * DY
  const r = new Float64Array(n), g = new Float64Array(n), b = new Float64Array(n), w = new Float64Array(n), t = new Float64Array(n)
  const order = new Int32Array(n)
  const side = new Uint8Array(n)
  // the sums of the dots up to each place along the axis, for every split at once
  const cr = new Float64Array(n + 1), cg = new Float64Array(n + 1), cb = new Float64Array(n + 1), cw = new Float64Array(n + 1), cq = new Float64Array(n + 1)
  const full = (1 << n) - 1
  for (let cy = 0; cy < rows; cy++)
    for (let cx = 0; cx < cols; cx++) {
      // a cell drawn otherwise, left empty
      if (skip?.[cy * cols + cx]) continue
      let mr = 0, mg = 0, mb = 0, sw = 0
      for (let j = 0, k = 0; j < DY; j++) {
        const row = (cy * DY + j) * by * W + cx * DX * by
        for (let i = 0; i < DX; i++, k++) {
          const at = row + i * by, pi = at * 3
          const v0 = pix[pi], v1 = pix[pi + 1], v2 = pix[pi + 2]
          const rk = (r[k] = ENC[v0 <= 0 ? 0 : v0 >= 1 ? 4096 : (v0 * 4096) | 0])
          const gk = (g[k] = ENC[v1 <= 0 ? 0 : v1 >= 1 ? 4096 : (v1 * 4096) | 0])
          const bk = (b[k] = ENC[v2 <= 0 ? 0 : v2 >= 1 ? 4096 : (v2 * 4096) | 0])
          const wk = (w[k] = weight[at])
          mr += rk * wk; mg += gk * wk; mb += bk * wk; sw += wk
        }
      }
      mr /= sw; mg /= sw; mb /= sw
      // the line the colours spread along most: the covariance's main axis, by a few power steps
      let crr = 0, cgg = 0, cbb = 0, crg = 0, crb = 0, cgb = 0
      for (let k = 0; k < n; k++) {
        const dr = r[k] - mr, dg = g[k] - mg, db = b[k] - mb, wk = w[k]
        crr += dr * dr * wk; cgg += dg * dg * wk; cbb += db * db * wk
        crg += dr * dg * wk; crb += dr * db * wk; cgb += dg * db * wk
      }
      if (crr + cgg + cbb < 4 * sw) {
        // as good as one colour
        pack(out, cy * cols + cx, SPACE, 0, 0, 0, mr, mg, mb)
        continue
      }
      let ar = 0.3, ag = 0.59, ab = 0.11
      for (let it = 0; it < 6; it++) {
        const nr = crr * ar + crg * ag + crb * ab
        const ng = crg * ar + cgg * ag + cgb * ab
        const nb = crb * ar + cgb * ag + cbb * ab
        const len = Math.sqrt(nr * nr + ng * ng + nb * nb) || 1
        ar = nr / len; ag = ng / len; ab = nb / len
      }
      // brighter along the axis is the foreground
      if (ar * 0.3 + ag * 0.59 + ab * 0.11 < 0) (ar = -ar), (ag = -ag), (ab = -ab)
      // the dots in order along the axis (a stable insertion sort: there are a few)
      for (let k = 0; k < n; k++) {
        const tk = (r[k] - mr) * ar + (g[k] - mg) * ag + (b[k] - mb) * ab
        t[k] = tk
        let m = k
        while (m > 0 && t[order[m - 1]] > tk) (order[m] = order[m - 1]), m--
        order[m] = k
      }
      // the best split along the axis: each side's spread, from the running sums
      let sr = 0, sg = 0, sb = 0, sw2 = 0, sq = 0
      for (let m = 0; m < n; m++) {
        const k = order[m], wk = w[k], rk = r[k], gk = g[k], bk = b[k]
        cr[m + 1] = sr = sr + rk * wk
        cg[m + 1] = sg = sg + gk * wk
        cb[m + 1] = sb = sb + bk * wk
        cw[m + 1] = sw2 = sw2 + wk
        cq[m + 1] = sq = sq + (rk * rk + gk * gk + bk * bk) * wk
      }
      let best = 1, bestErr = Infinity
      for (let sp = 1; sp < n; sp++) {
        const lr = cr[sp], lg = cg[sp], lb = cb[sp], lw = cw[sp]
        const hr = sr - lr, hg = sg - lg, hb = sb - lb, hw = sw2 - lw
        const err = cq[sp] - (lr * lr + lg * lg + lb * lb) / lw + (sq - cq[sp]) - (hr * hr + hg * hg + hb * hb) / hw
        if (err < bestErr) (bestErr = err), (best = sp)
      }
      for (let m = 0; m < n; m++) side[order[m]] = m < best ? 0 : 1
      // then settle: each dot to the nearer of the two means, twice; the means kept where a side is left with no dot
      let br = 0, bgr = 0, bb = 0, fr = 0, fgr = 0, fb = 0
      for (let it = 0; it < 3; it++) {
        if (it) {
          let moved = false
          for (let k = 0; k < n; k++) {
            const rk = r[k], gk = g[k], bk = b[k]
            const e0 = rk - br, e1 = gk - bgr, e2 = bk - bb, f0 = rk - fr, f1 = gk - fgr, f2 = bk - fb
            const want = f0 * f0 + f1 * f1 + f2 * f2 < e0 * e0 + e1 * e1 + e2 * e2 ? 1 : 0
            if (want !== side[k]) (side[k] = want), (moved = true)
          }
          if (!moved) {
            // the means as they were: a step that moves nothing settles them where they are
            break
          }
        }
        let r0 = 0, g0 = 0, b0 = 0, w0 = 0, r1 = 0, g1 = 0, b1 = 0, w1 = 0
        for (let k = 0; k < n; k++) {
          const wk = w[k]
          if (side[k]) (r1 += r[k] * wk), (g1 += g[k] * wk), (b1 += b[k] * wk), (w1 += wk)
          else (r0 += r[k] * wk), (g0 += g[k] * wk), (b0 += b[k] * wk), (w0 += wk)
        }
        if (!w0 || !w1) break
        br = r0 / w0, bgr = g0 / w0, bb = b0 / w0, fr = r1 / w1, fgr = g1 / w1, fb = b1 / w1
      }
      let bits = 0
      for (let k = 0; k < n; k++) if (side[k]) bits |= 1 << k
      if (bits === 0 || bits === full) {
        if (bits) pack(out, cy * cols + cx, SPACE, 0, 0, 0, fr, fgr, fb)
        else pack(out, cy * cols + cx, SPACE, 0, 0, 0, br, bgr, bb)
        continue
      }
      pack(out, cy * cols + cx, glyphs[bits], fr, fgr, fb, br, bgr, bb)
    }
}

/** linear rgb to OKLab, into out at o */
export function oklab(r: number, g: number, b: number, out: Float32Array, o: number) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  out[o] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  out[o + 1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  out[o + 2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
}
