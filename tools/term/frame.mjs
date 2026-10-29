/**
 * Pictures as terminal cells. A picture is drawn in the glyphs the terminal
 * draws pictures in (`MOSAICS`): each cell the glyph and the foreground and
 * background colours that fit its samples best (`mosaicEncoder`); text can be
 * laid over it as real characters.
 *
 * `Screen` keeps what the terminal shows and writes only the cells that
 * change.
 */

import { deflateSync } from 'node:zlib'

const QUADS = ' ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█'

/**
 * The block characters that split a cell into a grid of dots, by how many
 * across and down: quadrants (2x2), sextants (2x3, Unicode 13) and octants
 * (2x4, Unicode 16). A glyph's dots are numbered across then down, as
 * Unicode names them; each kind's characters run in that order, less the
 * patterns an older block already has, which are those older blocks.
 */
const BLOCKS = {
  quadrant: { sx: 2, sy: 2, glyph: [...QUADS] },
  sextant: {
    sx: 2,
    sy: 3,
    glyph: Array.from({ length: 64 }, (_, b) =>
      b === 0 ? ' ' : b === 63 ? '█' : b === 21 ? '▌' : b === 42 ? '▐' : String.fromCodePoint(0x1fb00 + b - 1 - (b > 21 ? 1 : 0) - (b > 42 ? 1 : 0)),
    ),
  },
  octant: { sx: 2, sy: 4, glyph: octants() },
}

function octants() {
  // the patterns Unicode's octants leave out (UnicodeData.txt), as the characters that have them
  const older = {
    0x00: ' ', 0xff: '█', 0x55: '▌', 0xaa: '▐', 0x0f: '▀', 0xf0: '▄', 0x05: '▘', 0x0a: '▝', 0x50: '▖', 0xa0: '▗',
    0x5a: '▞', 0xa5: '▚', 0x5f: '▛', 0xaf: '▜', 0xf5: '▙', 0xfa: '▟', 0x03: '\u{1FB82}', 0x3f: '\u{1FB85}', 0xc0: '▂',
    0xfc: '▆', 0x01: '\u{1CEA8}', 0x02: '\u{1CEAB}', 0x40: '\u{1CEA3}', 0x80: '\u{1CEA0}', 0x14: '\u{1FBE6}', 0x28: '\u{1FBE7}',
  }
  const out = []
  let next = 0x1cd00
  for (let b = 0; b < 256; b++) out.push(older[b] ?? String.fromCodePoint(next++))
  return out
}

/**
 * The glyphs a terminal draws a picture in, by how it draws them, for
 * `mosaicCells`: a glyph is a shape over its cell, inked in the foreground,
 * the rest in the background, and any of them may be chosen for a cell.
 *
 *  - `octant`: everything of Unicode's for pictures, drawn exactly, as
 *    Ghostty, Rex and kitty draw them themselves: the blocks and their
 *    eighths, quadrants, sextants, octants, and the wedges (smooth mosaics)
 *    that cut a cell along a slant.
 *  - `sextant`: the same less the octants, which iTerm2 does not have (and
 *    two wedges it draws off their shape).
 *  - `block`: the blocks and quadrants drawn from the font, as Terminal.app
 *    draws them: in a box short of the cell's top, a little of its right
 *    and of its foot (`mosaicGlyphs`' `box`), where the background shows.
 *    Its other glyphs are the font's, not cell-shaped.
 *  - `quadrant`: the blocks and quadrants drawn exactly, for a terminal
 *    unknown.
 */
export const MOSAICS = ['octant', 'sextant', 'block', 'quadrant']

/** a glyph that fills its cell */
const NO_BOX = { top: 0, right: 0, bottom: 0 }

/** the wedges U+1FB3C..1FB51, each the cell cut along a line between points of the sextants' grid (x0, y0, x1, y1, y down) and inked on the side of the corner it names; U+1FB52..1FB67 are the same lines, inked on the other side */
const T3 = 1 / 3, U3 = 2 / 3
const WEDGES = [
  [0, U3, 0.5, 1, 0, 1], [0, U3, 1, 1, 0, 1], [0, T3, 0.5, 1, 0, 1], [0, T3, 1, 1, 0, 1], [0, 0, 0.5, 1, 0, 1],
  [0, T3, 0.5, 0, 1, 1], [0, T3, 1, 0, 1, 1], [0, U3, 0.5, 0, 1, 1], [0, U3, 1, 0, 1, 1], [0, 1, 0.5, 0, 1, 1], [0, U3, 1, T3, 1, 1],
  [0.5, 1, 1, U3, 1, 1], [0, 1, 1, U3, 1, 1], [0.5, 1, 1, T3, 1, 1], [0, 1, 1, T3, 1, 1], [0.5, 1, 1, 0, 1, 1],
  [0.5, 0, 1, T3, 0, 1], [0, 0, 1, T3, 0, 1], [0.5, 0, 1, U3, 0, 1], [0, 0, 1, U3, 0, 1], [0.5, 0, 1, 1, 0, 1], [0, T3, 1, U3, 0, 1],
]
/** the wedges iTerm2 draws other than their names say */
const ITERM_OFF = new Set(['\u{1FB45}', '\u{1FB5B}'])

/**
 * Each glyph of a mosaic `kind` with its shape: how much of each of `w` x
 * `h` samples over the cell it inks, 0..1, across then down. `box`, for a
 * font's blocks, is how far short of the cell's top, right and bottom they
 * stop, as shares of the cell.
 */
export function mosaicGlyphs(kind, w, h, box = NO_BOX) {
  const { top = 0, right = 0, bottom = 0 } = box
  const SS = 8
  const out = []
  const add = (ch, inside) => {
    const m = new Float32Array(w * h)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let n = 0
        for (let j = 0; j < SS; j++)
          for (let i = 0; i < SS; i++) {
            let u = (x + (i + 0.5) / SS) / w
            let v = (y + (j + 0.5) / SS) / h
            // a font's box: the shape squeezed into the cell less its margins
            if (top || right || bottom) {
              if (v < top || v >= 1 - bottom || u >= 1 - right) continue
              u /= 1 - right
              v = (v - top) / (1 - top - bottom)
            }
            if (inside(u, v)) n++
          }
        m[y * w + x] = n / (SS * SS)
      }
    out.push({ ch, mask: m })
  }
  // the blocks: halves, eighths up from the foot and in from the left, the top and right eighths; and, in a box, the
  // whole of it, which leaves its margins
  if (top || right || bottom) add('█', () => true)
  add('▀', (u, v) => v < 0.5)
  for (let k = 1; k <= 7; k++) add(String.fromCodePoint(0x2580 + k), (u, v) => v >= 1 - k / 8)
  add('▄', (u, v) => v >= 0.5)
  for (let k = 1; k <= 7; k++) add(String.fromCodePoint(0x2590 - k), (u) => u < k / 8)
  add('▐', (u) => u >= 0.5)
  add('▔', (u, v) => v < 1 / 8)
  add('▕', (u) => u >= 7 / 8)
  const grid = (k) => {
    const { sx, sy, glyph } = BLOCKS[k]
    glyph.forEach((g, bits) => {
      if (bits === 0 || bits === (1 << (sx * sy)) - 1 || out.some((o) => o.ch === g)) return
      add(g, (u, v) => (bits >> (Math.min(sy - 1, Math.floor(v * sy)) * sx + Math.min(sx - 1, Math.floor(u * sx)))) & 1)
    })
  }
  grid('quadrant')
  if (kind === 'block' || kind === 'quadrant') return out
  grid('sextant')
  WEDGES.forEach(([x0, y0, x1, y1, cx, cy], i) => {
    const side = (u, v) => (x1 - x0) * (v - y0) - (y1 - y0) * (u - x0)
    const inked = side(cx, cy) > 0
    for (const [cp, on] of [[0x1fb3c + i, inked], [0x1fb52 + i, !inked]]) {
      const ch = String.fromCodePoint(cp)
      if (kind === 'sextant' && ITERM_OFF.has(ch)) continue
      add(ch, (u, v) => side(u, v) > 0 === on)
    }
  })
  // the triangles to the middle (left, upper, right, lower) and the cell less each
  const tri = (k, u, v) => (k === 0 ? u < v && u < 1 - v : k === 1 ? v < u && v < 1 - u : k === 2 ? u > v && u > 1 - v : v > u && v > 1 - u)
  for (let k = 0; k < 4; k++) {
    add(String.fromCodePoint(0x1fb68 + k), (u, v) => !tri(k, u, v))
    add(String.fromCodePoint(0x1fb6c + k), (u, v) => tri(k, u, v))
  }
  if (kind === 'octant') grid('octant')
  return out
}

/** samples a cell `mosaicCells` takes: four across, eight down */
export const MOSAIC_SX = 4
export const MOSAIC_SY = 8
/**
 * How much what a glyph leaves wrong in blocks of 2x2 samples counts, beside
 * what it leaves wrong sample by sample: more where a font's blocks stop
 * short of the cell, whose gaps, row after row, make stripes of an edge.
 */
const BLOCK_WEIGHT = 2
const BLOCK_WEIGHT_BOXED = 6
/** how much less error than the best block a wedge must leave to be taken for a cell */
const WEDGE_BIAS = 0.3
/** how much less a glyph must leave wrong than the one the cell had last frame to take its place: else, as the view moves, cells flicker between two near alike */
const STICK = 0.1
/** how many glyphs nearest a cell's split into two colours are tried for it */
const MOSAIC_TRIES = 6

const popcount = (v) => {
  v = v - ((v >>> 1) & 0x55555555)
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333)
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

/**
 * An encoder of pictures into the glyphs of mosaic `kind`, as chafa picks
 * its symbols: a picture of MOSAIC_SX x MOSAIC_SY samples a cell in, each
 * cell out as the glyph and two colours that leave the least squared error,
 * each glyph with the two colours best for its shape (least squares, its
 * coverage partial where it cuts a sample). Only the few glyphs whose shape
 * is nearest the cell's own split into two colours are tried, either way
 * round; the nearest for a split, once found, are kept. `box`: as
 * `mosaicGlyphs`'.
 *
 * A picture may come with a weight for each sample (`render`'s `weights`):
 * each sample's error then counts that many times over, so a sample that
 * stands out (a goblin's eye) can win a colour of its cell from the many
 * that do not.
 *
 * `rate`: what a colour escape costs, in squared error, for terminals whose
 * time goes on each change of colour rather than on bytes. A cell may then
 * keep the colours the cell before it left set, one or both, where what
 * that leaves wrong costs less than the escape: so a frame changes colour
 * only where the picture asks for it.
 */
export function mosaicEncoder(kind, box = NO_BOX, rate = 0) {
  const SX = MOSAIC_SX, SY = MOSAIC_SY, N = SX * SY, K = MOSAIC_TRIES
  const blockWeight = box.top || box.right || box.bottom ? BLOCK_WEIGHT_BOXED : BLOCK_WEIGHT
  // the blocks of 2x2 samples, each sample's
  const NB = (SX / 2) * (SY / 2)
  const blockOf = Uint8Array.from({ length: N }, (_, i) => ((i / SX / 2) | 0) * (SX / 2) + (((i % SX) / 2) | 0))
  const syms = []
  for (const { ch, mask } of mosaicGlyphs(kind, SX, SY, box)) {
    let bits = 0, A = 0, B = 0, C = 0
    for (let i = 0; i < N; i++) {
      if (mask[i] >= 0.5) bits |= 1 << i
      A += mask[i] * mask[i]
      B += mask[i] * (1 - mask[i])
      C += (1 - mask[i]) * (1 - mask[i])
    }
    const det = A * C - B * B
    if (det < 1e-3 || bits === 0 || bits >>> 0 === 0xffffffff) continue
    // a shape another glyph has already is left out
    if (syms.some((o) => o.mask.every((v, i) => Math.abs(v - mask[i]) < 0.03))) continue
    // a slant drawn over texture reads as a shard: a wedge must beat the blocks by WEDGE_BIAS to be taken
    const cp = ch.codePointAt(0)
    const bias = cp >= 0x1fb3c && cp <= 0x1fb6f ? 1 + WEDGE_BIAS : 1
    // how much it inks of each block of 2x2 samples
    const blk = new Float32Array(NB)
    for (let i = 0; i < N; i++) blk[blockOf[i]] += mask[i]
    syms.push({ ch, cp, mask, bits: bits >>> 0, A, B, C, det, bias, blk })
  }
  const dist = new Int32Array(syms.length)
  const best = new Int32Array(K)
  const near = new Map()
  const p = new Float32Array(N * 3)
  // each sample's weight, and for a cell with any but 1, each glyph's sums of its coverage under them
  const pw = new Float32Array(N)
  let weighed = false
  const sums = (S) => {
    if (!weighed) return S
    let A = 0, B = 0, C = 0
    const m = S.mask
    for (let i = 0; i < N; i++) {
      const w = pw[i], v = m[i]
      A += w * v * v
      B += w * v * (1 - v)
      C += w * (1 - v) * (1 - v)
    }
    return { A, B, C, det: A * C - B * B }
  }
  const bs = new Float32Array(NB * 3)
  // each glyph by its code point, for the one a cell had before
  const symOf = new Map(syms.map((S, i) => [S.ch.codePointAt(0), i]))
  /**
   * What glyph `S` in colours F and B leaves wrong of a cell (its sums: of
   * squares, and of each channel over the glyph and off it), sample by sample
   * and seen from a little way off, in blocks of 2x2 (`bs`): a shape the cell
   * does not have shows as a pattern, row after row, though it leaves no more
   * error sample by sample.
   */
  const wrong = (S, M, sq, s10, s11, s12, s00, s01, s02, F0, F1, F2, B0, B1, B2) => {
    const err =
      sq -
      2 * (F0 * s10 + B0 * s00 + F1 * s11 + B1 * s01 + F2 * s12 + B2 * s02) +
      M.A * (F0 * F0 + F1 * F1 + F2 * F2) +
      2 * M.B * (F0 * B0 + F1 * B1 + F2 * B2) +
      M.C * (B0 * B0 + B1 * B1 + B2 * B2)
    let off = 0
    for (let b = 0; b < NB; b++) {
      const w = S.blk[b]
      const e0 = bs[b * 3] - F0 * w - B0 * (4 - w), e1 = bs[b * 3 + 1] - F1 * w - B1 * (4 - w), e2 = bs[b * 3 + 2] - F2 * w - B2 * (4 - w)
      off += e0 * e0 + e1 * e1 + e2 * e2
    }
    return err + (blockWeight * off) / 4
  }
  // the best for the cell so far: its cost, glyph and colours
  let bestErr = 0, bestCh = ' ', f0 = 0, f1 = 0, f2 = 0, g0 = 0, g1 = 0, g2 = 0
  const consider = (S, was, cost, F0, F1, F2, B0, B1, B2) => {
    if (cost > bestErr || (cost === bestErr && S.cp !== was)) return
    bestErr = cost
    bestCh = S.ch
    f0 = F0
    f1 = F1
    f2 = F2
    g0 = B0
    g1 = B1
    g2 = B2
  }
  /**
   * `px`: the picture; `out`: the cells, rows `r0` up to `r1` of them
   * written; `prev`: each cell's glyph last frame, as a code point (0 for
   * none), which it keeps unless another is better by STICK; `wt`: each
   * sample's weight, or null for all alike.
   */
  return (px, cols, rows, out = { char: new Array(cols * rows), fg: new Uint8Array(cols * rows * 3), bg: new Uint8Array(cols * rows * 3) }, r0 = 0, r1 = rows, prev = null, wt = null) => {
    const W = cols * SX
    const { char, fg, bg } = out
    // the colours set when the terminal comes to a cell: the last foreground a glyph used and the last background
    let hasF = false, hasB = false, cF0 = 0, cF1 = 0, cF2 = 0, cB0 = 0, cB1 = 0, cB2 = 0
    for (let r = r0; r < r1; r++)
      for (let c = 0; c < cols; c++) {
        if (c === 0) hasF = hasB = false
        // the sums weighted; what is seen from a step back (bs) is not
        let t0 = 0, t1 = 0, t2 = 0, sq = 0, NW = 0
        let lo0 = 255, lo1 = 255, lo2 = 255, hi0 = 0, hi1 = 0, hi2 = 0
        weighed = false
        for (let j = 0; j < SY; j++)
          for (let i = 0; i < SX; i++) {
            const s = ((r * SY + j) * W + c * SX + i) * 3, d = (j * SX + i) * 3
            const v0 = px[s], v1 = px[s + 1], v2 = px[s + 2]
            const w = wt ? wt[s / 3] : 1
            if (w !== 1) weighed = true
            pw[d / 3] = w
            p[d] = v0
            p[d + 1] = v1
            p[d + 2] = v2
            t0 += w * v0
            t1 += w * v1
            t2 += w * v2
            NW += w
            sq += w * (v0 * v0 + v1 * v1 + v2 * v2)
            if (v0 < lo0) lo0 = v0
            if (v0 > hi0) hi0 = v0
            if (v1 < lo1) lo1 = v1
            if (v1 > hi1) hi1 = v1
            if (v2 < lo2) lo2 = v2
            if (v2 > hi2) hi2 = v2
          }
        const o = (r * cols + c) * 3
        const flat = sq - (t0 * t0 + t1 * t1 + t2 * t2) / NW
        const r0_ = hi0 - lo0, r1_ = hi1 - lo1, r2_ = hi2 - lo2
        // near enough one colour: a space
        bestErr = flat
        bestCh = ' '
        f0 = t0 / NW
        f1 = t1 / NW
        f2 = t2 / NW
        g0 = f0
        g1 = f1
        g2 = f2
        const was = prev ? prev[r * cols + c] : 0
        // a space in the background set already, instead of its own: what it leaves wrong besides
        const keepB = hasB ? ((f0 - cB0) ** 2 + (f1 - cB1) ** 2 + (f2 - cB2) ** 2) * (NW + 4 * blockWeight * NB) : Infinity
        if (!(flat >= NW * 4 && Math.max(r0_, r1_, r2_) >= 6)) {
          if (keepB < rate) {
            g0 = cB0
            g1 = cB1
            g2 = cB2
          }
        } else {
          // the split into two colours: at the middle of the channel that varies most, then each sample to the nearer mean
          const chn = r0_ >= r1_ && r0_ >= r2_ ? 0 : r1_ >= r2_ ? 1 : 2
          const mid = chn === 0 ? (lo0 + hi0) / 2 : chn === 1 ? (lo1 + hi1) / 2 : (lo2 + hi2) / 2
          let bits = 0
          for (let i = 0; i < N; i++) if (p[i * 3 + chn] > mid) bits |= 1 << i
          // where a sample stands out, the split rather between it and the rest
          if (weighed) {
            let top = 0
            for (let i = 1; i < N; i++) if (pw[i] > pw[top]) top = i
            const e0 = p[top * 3] - f0, e1 = p[top * 3 + 1] - f1, e2 = p[top * 3 + 2] - f2
            const far = e0 * e0 + e1 * e1 + e2 * e2
            if (pw[top] > 1 && far > 0) {
              bits = 0
              for (let i = 0; i < N; i++) if ((p[i * 3] - f0) * e0 + (p[i * 3 + 1] - f1) * e1 + (p[i * 3 + 2] - f2) * e2 > far / 2) bits |= 1 << i
            }
          }
          for (let pass = 0; pass < 2; pass++) {
            let a0 = 0, a1 = 0, a2 = 0, na = 0, ca = 0
            for (let i = 0; i < N; i++)
              if (bits & (1 << i)) {
                const w = pw[i]
                a0 += w * p[i * 3]
                a1 += w * p[i * 3 + 1]
                a2 += w * p[i * 3 + 2]
                na += w
                ca++
              }
            if (!ca || ca === N) break
            const b0 = (t0 - a0) / (NW - na), b1 = (t1 - a1) / (NW - na), b2 = (t2 - a2) / (NW - na)
            a0 /= na
            a1 /= na
            a2 /= na
            let next = 0
            for (let i = 0; i < N; i++) {
              const ea = (p[i * 3] - a0) ** 2 + (p[i * 3 + 1] - a1) ** 2 + (p[i * 3 + 2] - a2) ** 2
              const eb = (p[i * 3] - b0) ** 2 + (p[i * 3 + 1] - b1) ** 2 + (p[i * 3 + 2] - b2) ** 2
              if (ea < eb) next |= 1 << i
            }
            if (next === bits) break
            bits = next
          }
          bits >>>= 0
          bs.fill(0)
          for (let i = 0; i < N; i++) {
            const b = blockOf[i] * 3
            bs[b] += p[i * 3]
            bs[b + 1] += p[i * 3 + 1]
            bs[b + 2] += p[i * 3 + 2]
          }
          // a space, its one colour, as far off
          let offFlat = 0
          for (let b = 0; b < NB; b++) offFlat += (bs[b * 3] - 4 * f0) ** 2 + (bs[b * 3 + 1] - 4 * f1) ** 2 + (bs[b * 3 + 2] - 4 * f2) ** 2
          const keepSpace = was === 32 ? 1 - STICK : 1
          bestErr = (flat + (blockWeight * offFlat) / 4) * keepSpace + rate
          if (rate && (flat + (blockWeight * offFlat) / 4 + keepB) * keepSpace < bestErr) {
            bestErr = (flat + (blockWeight * offFlat) / 4 + keepB) * keepSpace
            g0 = cB0
            g1 = cB1
            g2 = cB2
          }
          // the glyphs nearest the split, either way round
          let tries = near.get(bits)
          if (!tries) {
            for (let s = 0; s < syms.length; s++) {
              const d = popcount((bits ^ syms[s].bits) >>> 0)
              dist[s] = d < N - d ? d : N - d
            }
            best.fill(-1)
            for (let s = 0; s < syms.length; s++) {
              const d = dist[s]
              let k = K
              while (k > 0 && (best[k - 1] < 0 || dist[best[k - 1]] > d)) k--
              if (k >= K) continue
              for (let m = K - 1; m > k; m--) best[m] = best[m - 1]
              best[k] = s
            }
            tries = best.slice()
            if (near.size >= 1 << 16) near.clear()
            near.set(bits, tries)
          }
          // and the glyph the cell had, if it is not among them
          let had = was ? (symOf.get(was) ?? -1) : -1
          for (let k = 0; k < K && had >= 0; k++) if (tries[k] === had) had = -1
          for (let k = 0; k <= K; k++) {
            const s = k < K ? tries[k] : had
            if (s < 0) {
              if (k < K) k = K - 1
              continue
            }
            const S = syms[s], m = S.mask, M = sums(S)
            let s10 = 0, s11 = 0, s12 = 0
            for (let i = 0; i < N; i++) {
              const w = m[i] * pw[i]
              if (w === 0) continue
              s10 += w * p[i * 3]
              s11 += w * p[i * 3 + 1]
              s12 += w * p[i * 3 + 2]
            }
            const s00 = t0 - s10, s01 = t1 - s11, s02 = t2 - s12
            const keep = S.bias * (S.cp === was ? 1 - STICK : 1)
            // in its own two colours, both sent
            const F0 = clamp255((M.C * s10 - M.B * s00) / M.det), B0 = clamp255((M.A * s00 - M.B * s10) / M.det)
            const F1 = clamp255((M.C * s11 - M.B * s01) / M.det), B1 = clamp255((M.A * s01 - M.B * s11) / M.det)
            const F2 = clamp255((M.C * s12 - M.B * s02) / M.det), B2 = clamp255((M.A * s02 - M.B * s12) / M.det)
            consider(S, was, wrong(S, M, sq, s10, s11, s12, s00, s01, s02, F0, F1, F2, B0, B1, B2) * keep + 2 * rate, F0, F1, F2, B0, B1, B2)
            if (!rate) continue
            // in the colours set already, or one of them and the other best beside it
            if (hasF && hasB) consider(S, was, wrong(S, M, sq, s10, s11, s12, s00, s01, s02, cF0, cF1, cF2, cB0, cB1, cB2) * keep, cF0, cF1, cF2, cB0, cB1, cB2)
            if (hasB) {
              const F0 = clamp255((s10 - M.B * cB0) / M.A), F1 = clamp255((s11 - M.B * cB1) / M.A), F2 = clamp255((s12 - M.B * cB2) / M.A)
              consider(S, was, wrong(S, M, sq, s10, s11, s12, s00, s01, s02, F0, F1, F2, cB0, cB1, cB2) * keep + rate, F0, F1, F2, cB0, cB1, cB2)
            }
            if (hasF) {
              const B0 = clamp255((s00 - M.B * cF0) / M.C), B1 = clamp255((s01 - M.B * cF1) / M.C), B2 = clamp255((s02 - M.B * cF2) / M.C)
              consider(S, was, wrong(S, M, sq, s10, s11, s12, s00, s01, s02, cF0, cF1, cF2, B0, B1, B2) * keep + rate, cF0, cF1, cF2, B0, B1, B2)
            }
          }
        }
        char[r * cols + c] = bestCh
        fg[o] = f0
        fg[o + 1] = f1
        fg[o + 2] = f2
        bg[o] = g0
        bg[o + 1] = g1
        bg[o + 2] = g2
        // as the terminal will have them, whole numbers
        if (bestCh !== ' ') {
          hasF = true
          cF0 = fg[o]
          cF1 = fg[o + 1]
          cF2 = fg[o + 2]
        }
        hasB = true
        cB0 = bg[o]
        cB1 = bg[o + 1]
        cB2 = bg[o + 2]
      }
    return out
  }
}

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v)

/**
 * Lay text over the picture (`mosaicEncoder`'s). `texts` are lines of [row, from, to, r, g, b,
 * words]: `from`..`to` the cells the line clears, each word [col, text]. A
 * text cell keeps the one of its picture's two colours that stands furthest
 * from the text as its background.
 */
export function cellsWithText(pic, texts, cols, rows) {
  const n = cols * rows
  const char = new Array(n)
  const fg = new Uint8Array(n * 3)
  const bg = new Uint8Array(n * 3)
  for (let i = 0; i < n; i++) {
    char[i] = pic.char[i]
    for (let ch = 0; ch < 3; ch++) {
      fg[i * 3 + ch] = pic.fg[i * 3 + ch]
      bg[i * 3 + ch] = pic.bg[i * 3 + ch]
    }
  }
  // a cell under text keeps the one of its picture's colours furthest from the text, darkened when light text would not read on it
  const ground = (i, tr, tg, tb) => {
    const df = (pic.fg[i * 3] - tr) ** 2 + (pic.fg[i * 3 + 1] - tg) ** 2 + (pic.fg[i * 3 + 2] - tb) ** 2
    const db = (pic.bg[i * 3] - tr) ** 2 + (pic.bg[i * 3 + 1] - tg) ** 2 + (pic.bg[i * 3 + 2] - tb) ** 2
    const src = df > db ? pic.fg : pic.bg
    const lum = 0.3 * src[i * 3] + 0.59 * src[i * 3 + 1] + 0.11 * src[i * 3 + 2]
    const tl = 0.3 * tr + 0.59 * tg + 0.11 * tb
    for (let ch = 0; ch < 3; ch++) {
      const v = src[i * 3 + ch]
      bg[i * 3 + ch] = Math.abs(lum - tl) >= 90 || tl < lum ? v : v * 0.35
    }
  }
  // the width the page draws each line at is cleared first, so its pixels do not show as blocks beside the
  // characters, and no line's clearing wipes another's characters
  for (const [row, from, to, tr, tg, tb] of texts) {
    if (row < 0 || row >= rows) continue
    for (let c = Math.max(0, from); c < Math.min(cols, to); c++) {
      const i = row * cols + c
      ground(i, tr, tg, tb)
      char[i] = ' '
    }
  }
  for (const [row, from, to, tr, tg, tb, words] of texts) {
    if (row < 0 || row >= rows) continue
    for (const [col, text] of words)
      for (let k = 0; k < text.length; k++) {
        const c = col + k
        if (c < 0 || c >= cols) continue
        const i = row * cols + c
        if (c < from || c >= to) ground(i, tr, tg, tb)
        fg[i * 3] = tr
        fg[i * 3 + 1] = tg
        fg[i * 3 + 2] = tb
        char[i] = text[k]
      }
  }
  return { char, fg, bg }
}

/**
 * How tall, in cells, a monster's or an item's tile may stand before it is
 * art enough to know (`RenderTerm.render`'s `glyphBelow`, in samples):
 * smaller, crawl's glyph is laid over its middle.
 */
export const GLYPH_CELLS = 2

/**
 * Crawl's glyphs over the picture (`mosaicEncoder`'s), at the cells their dots
 * fall in, `sx` x `sy` dots a cell: `glyphs` are `RenderTerm`'s, `palette`
 * crawl's sixteen colours. Each keeps a ground as text does
 * (`cellsWithText`), but one seen through the level, as a ghost is, lies on
 * the picture as it is, faint, with no ground cut out of the wall; one out of
 * sight is darker; the nearer of two in a cell wins; the one the cursor is
 * on is drawn the other way round, its colour behind it.
 */
export function cellsWithGlyphs(pic, glyphs, cols, rows, sx, sy, palette) {
  if (!glyphs.length) return pic
  const at = [...glyphs].sort((a, b) => b.depth - a.depth).map((g) => {
    const c = Math.floor(g.x / sx), r = Math.floor(g.y / sy)
    const [cr, cg, cb] = palette[g.colour].map((v) => (g.dim || g.behind ? v * DIM_GLYPH : v))
    return { c, r, cr, cg, cb, g }
  })
  const out = cellsWithText(pic, at.map(({ c, r, cr, cg, cb, g }) => [r, c, c + 1, cr, cg, cb, [[c, g.char]]]), cols, rows)
  // the nearest in each cell, the one that shows
  const shown = new Map(at.map((e) => [e.r * cols + e.c, e]))
  for (const { c, r, cr, cg, cb, g } of shown.values()) {
    if (c < 0 || r < 0 || c >= cols || r >= rows) continue
    const i = (r * cols + c) * 3
    if (g.selected) {
      out.fg.set([0, 0, 0], i)
      out.bg.set([cr, cg, cb], i)
    } else if (g.behind) for (let ch = 0; ch < 3; ch++) out.bg[i + ch] = (pic.fg[i + ch] + pic.bg[i + ch]) / 2
  }
  return out
}

/** how bright a glyph out of sight or behind the level is */
const DIM_GLYPH = 0.55

/**
 * How far a cell's colour may drift, in any channel, before it is sent again:
 * the frames come as JPEG, whose noise would otherwise resend most of the
 * picture every frame.
 */
const DRIFT = 12

/**
 * Whether every terminal draws `ch` one cell wide: ASCII, the box drawing and
 * the block elements; and the mosaics' glyphs (`MOSAICS`), sent only to
 * terminals that draw them, and so know them.
 */
function narrow(ch) {
  if (ch <= '~' || (ch >= '\u2500' && ch <= '\u259f')) return true
  const cp = ch.codePointAt(0)
  return (cp >= 0x1fb00 && cp <= 0x1fbaf) || (cp >= 0x1cd00 && cp <= 0x1cde5) || (cp >= 0x1cea0 && cp <= 0x1ceab) || cp === 0x1fbe6 || cp === 0x1fbe7
}

/** What the terminal shows, and the escapes that bring it up to date. */
export class Screen {
  /**
   * `drift`: how far a colour may move before the cell is sent again; 0 for
   * frames that are exact, not JPEG. `reuse`: how far, in any channel, a
   * cell's colour may be from the one the cell before it left set for it to
   * be drawn in that one instead, which then needs no escape of its own.
   */
  constructor(cols, rows, drift = DRIFT, reuse = 0) {
    this.drift = drift
    this.reuse = reuse
    this.resize(cols, rows)
  }

  resize(cols, rows) {
    this.cols = cols
    this.rows = rows
    this.char = null
    this.fg = new Uint8Array(cols * rows * 3)
    this.bg = new Uint8Array(cols * rows * 3)
  }

  /** The escapes that turn what is shown into `cells`; everything, the first time or after a resize. */
  update(cells) {
    const { cols, rows } = this
    const all = !this.char
    if (all) this.char = new Array(cols * rows)
    const out = []
    let lastFg = ''
    let lastBg = ''
    // the colours last set, as numbers, for those near enough to be drawn in them
    const setFg = [-1, -1, -1], setBg = [-1, -1, -1]
    const near = (c, i, set) => Math.abs(c[i] - set[0]) <= this.reuse && Math.abs(c[i + 1] - set[1]) <= this.reuse && Math.abs(c[i + 2] - set[2]) <= this.reuse
    let cursor = -1
    const d = this.drift
    const drifted = (a, b, i) => Math.abs(a[i] - b[i]) > d || Math.abs(a[i + 1] - b[i + 1]) > d || Math.abs(a[i + 2] - b[i + 2]) > d
    for (let i = 0; i < cols * rows; i++) {
      const ch = cells.char[i]
      const j = i * 3
      // a space shows only its background
      if (!all && this.char[i] === ch && !(ch !== ' ' && drifted(cells.fg, this.fg, j)) && !drifted(cells.bg, this.bg, j)) continue
      this.char[i] = ch
      // a colour near the one set already is drawn in that one, and kept as it is shown
      const fgSrc = ch !== ' ' && this.reuse && near(cells.fg, j, setFg) ? setFg : null
      const bgSrc = this.reuse && near(cells.bg, j, setBg) ? setBg : null
      for (let k = 0; k < 3; k++) {
        this.fg[j + k] = fgSrc ? fgSrc[k] : cells.fg[j + k]
        this.bg[j + k] = bgSrc ? bgSrc[k] : cells.bg[j + k]
      }
      const sf = this.fg, sb = this.bg
      const f = `${sf[j]};${sf[j + 1]};${sf[j + 2]}`
      const b = `${sb[j]};${sb[j + 1]};${sb[j + 2]}`
      if (cursor !== i) out.push(`\x1b[${((i / cols) | 0) + 1};${(i % cols) + 1}H`)
      // the colours that change, in one escape
      const newFg = f !== lastFg && ch !== ' ', newBg = b !== lastBg
      if (newFg && newBg) out.push(`\x1b[38;2;${f};48;2;${b}m`)
      else if (newFg) out.push(`\x1b[38;2;${f}m`)
      else if (newBg) out.push(`\x1b[48;2;${b}m`)
      if (newFg) {
        lastFg = f
        for (let k = 0; k < 3; k++) setFg[k] = sf[j + k]
      }
      if (newBg) {
        lastBg = b
        for (let k = 0; k < 3; k++) setBg[k] = sb[j + k]
      }
      out.push(ch)
      cursor = i + 1
      // past the end of a row, or after a character a terminal may draw two cells wide, the cursor is put where the
      // next cell is rather than trusted
      if (cursor % cols === 0 || !narrow(ch)) cursor = -1
    }
    return out.length ? out.join('') + '\x1b[0m' : ''
  }
}

/**
 * A frame's escapes as one synchronized update (mode 2026): the terminal
 * holds what it shows until the whole frame is in, so it never paints one
 * half drawn. Terminals that do not know the mode ignore it.
 */
export function synced(out) {
  return out && `\x1b[?2026h${out}\x1b[?2026l`
}

/**
 * A kitty graphics image (RGBA, `w` x `h` pixels) sent and shown at the
 * cursor over `cols` x `rows` cells at z-index `z`, replacing the image `id` had: the
 * protocol's transmit-and-display, zlib-compressed, in chunks of 4096 base64 characters, the
 * cursor left where it was and no reply asked for.
 */
export function kittyImage(id, rgba, w, h, cols, rows, z = 0) {
  const b64 = deflateSync(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), { level: 1 }).toString('base64')
  const out = []
  for (let i = 0; i < b64.length; i += 4096) {
    const more = i + 4096 < b64.length ? 1 : 0
    const head = i === 0 ? `a=T,f=32,o=z,s=${w},v=${h},i=${id},p=1,c=${cols},r=${rows},z=${z},C=1,q=2,m=${more}` : `m=${more}`
    out.push(`\x1b_G${head};${b64.slice(i, i + 4096)}\x1b\\`)
  }
  return out.join('')
}
