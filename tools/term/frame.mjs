/**
 * Pictures as terminal cells. A picture is drawn with the quadrant blocks:
 * each cell is four quarters, split into the two colours that fit them best,
 * so a cell carries 2x2 of detail with one foreground and one background
 * colour; text can be laid over it as real characters.
 *
 * `Screen` keeps what the terminal shows and writes only the cells that
 * change.
 */

import { deflateSync } from 'node:zlib'

const QUADS = ' ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█'

/**
 * The picture's cells from an RGB(A) buffer of `w` x `h` pixels, `channels`
 * a pixel: per cell a quadrant glyph index and its two colours.
 */
export function quadCells(px, w, h, channels, cols, rows) {
  const qw = cols * 2
  const qh = rows * 2
  // the quarters: the picture itself when it is one pixel a quarter, else the mean of the pixels each covers
  let quarter
  if (w === qw && h === qh && channels === 3) quarter = px
  else {
    const sum = new Float64Array(qw * qh * 3)
    const count = new Uint32Array(qw * qh)
    const sx = qw / w
    const sy = qh / h
    for (let y = 0; y < h; y++) {
      const qy = Math.min(qh - 1, (y * sy) | 0)
      for (let x = 0; x < w; x++) {
        const qx = Math.min(qw - 1, (x * sx) | 0)
        const q = qy * qw + qx
        const i = (y * w + x) * channels
        sum[q * 3] += px[i]
        sum[q * 3 + 1] += px[i + 1]
        sum[q * 3 + 2] += px[i + 2]
        count[q]++
      }
    }
    quarter = new Float64Array(qw * qh * 3)
    for (let q = 0; q < qw * qh; q++) {
      const n = count[q] || 1
      quarter[q * 3] = sum[q * 3] / n
      quarter[q * 3 + 1] = sum[q * 3 + 1] / n
      quarter[q * 3 + 2] = sum[q * 3 + 2] / n
    }
  }
  const glyph = new Uint8Array(cols * rows)
  const fg = new Uint8Array(cols * rows * 3)
  const bg = new Uint8Array(cols * rows * 3)
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      // TL TR BL BR, the bit order of QUADS
      const i0 = ((r * 2) * qw + c * 2) * 3, i1 = i0 + 3, i2 = i0 + qw * 3, i3 = i2 + 3
      const r0 = quarter[i0], g0 = quarter[i0 + 1], b0 = quarter[i0 + 2]
      const r1 = quarter[i1], g1 = quarter[i1 + 1], b1 = quarter[i1 + 2]
      const r2 = quarter[i2], g2 = quarter[i2 + 1], b2 = quarter[i2 + 2]
      const r3 = quarter[i3], g3 = quarter[i3 + 1], b3 = quarter[i3 + 2]
      const tr = r0 + r1 + r2 + r3, tg = g0 + g1 + g2 + g3, tb = b0 + b1 + b2 + b3
      // the split into two colours that leaves the least error is the one whose groups' sums, squared over
      // their sizes, add up most; one split of each pair of mirror images (BR always the background), and none
      let best = 15
      let bestScore = (tr * tr + tg * tg + tb * tb) / 4 + 1e-6
      let br = 0, bgc = 0, bb = 0, n = 4
      for (let p = 1; p < 8; p++) {
        let ar = 0, ag = 0, ab = 0, na = 0
        if (p & 1) { ar += r0; ag += g0; ab += b0; na++ }
        if (p & 2) { ar += r1; ag += g1; ab += b1; na++ }
        if (p & 4) { ar += r2; ag += g2; ab += b2; na++ }
        const zr = tr - ar, zg = tg - ag, zb = tb - ab, nz = 4 - na
        const score = (ar * ar + ag * ag + ab * ab) / na + (zr * zr + zg * zg + zb * zb) / nz
        if (score > bestScore) {
          bestScore = score
          best = p
          br = ar; bgc = ag; bb = ab; n = na
        }
      }
      const o = (r * cols + c) * 3
      glyph[r * cols + c] = best
      if (best === 15) {
        fg[o] = bg[o] = tr / 4
        fg[o + 1] = bg[o + 1] = tg / 4
        fg[o + 2] = bg[o + 2] = tb / 4
      } else {
        fg[o] = br / n
        fg[o + 1] = bgc / n
        fg[o + 2] = bb / n
        bg[o] = (tr - br) / (4 - n)
        bg[o + 1] = (tg - bgc) / (4 - n)
        bg[o + 2] = (tb - bb) / (4 - n)
      }
    }
  return { glyph, fg, bg }
}

/**
 * The block characters a cell can be drawn with, by how many dots across and
 * down: whole cells (1x1, coloured spaces, for terminals that draw blocks
 * from a font shorter than the line, where any block leaves a sliver of its
 * background showing), halves (2x1), quadrants (2x2), sextants (2x3, Unicode
 * 13) and octants (2x4,
 * Unicode 16, square dots in a cell twice as tall as it is wide). A glyph's
 * dots are numbered across then down, as Unicode names them; each kind's
 * characters run in that order, less the patterns an older block already
 * has, which are those older blocks.
 */
export const BLOCKS = {
  cell: { sx: 1, sy: 1, glyph: [' ', '█'] },
  half: { sx: 2, sy: 1, glyph: [' ', '▌', '▐', '█'] },
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
 * The picture as cells of `kind` (`BLOCKS`): per cell a character and its two
 * colours. Quadrants are fitted exactly (`quadCells`); a cell of more dots
 * is split at the middle of the colour channel that varies most across it,
 * then each dot moved to whichever of the two colours is nearer.
 */
export function blockCells(px, w, h, channels, cols, rows, kind = 'quadrant') {
  const k = BLOCKS[kind]
  if (kind === 'quadrant') {
    const q = quadCells(px, w, h, channels, cols, rows)
    return { char: Array.from(q.glyph, (g) => k.glyph[g]), fg: q.fg, bg: q.bg }
  }
  const { sx, sy } = k
  const dw = cols * sx, dh = rows * sy
  // the dots: the picture itself when it is one pixel a dot, else the mean of the pixels each covers
  let dot = px
  if (w !== dw || h !== dh || channels !== 3) {
    const sum = new Float64Array(dw * dh * 3)
    const count = new Uint32Array(dw * dh)
    for (let y = 0; y < h; y++) {
      const dy = Math.min(dh - 1, ((y * dh) / h) | 0)
      for (let x = 0; x < w; x++) {
        const d = dy * dw + Math.min(dw - 1, ((x * dw) / w) | 0)
        const i = (y * w + x) * channels
        sum[d * 3] += px[i]
        sum[d * 3 + 1] += px[i + 1]
        sum[d * 3 + 2] += px[i + 2]
        count[d]++
      }
    }
    dot = new Float64Array(dw * dh * 3)
    for (let d = 0; d < dw * dh; d++) for (let ch = 0; ch < 3; ch++) dot[d * 3 + ch] = sum[d * 3 + ch] / (count[d] || 1)
  }
  const n = sx * sy
  const char = new Array(cols * rows)
  const fg = new Uint8Array(cols * rows * 3)
  const bg = new Uint8Array(cols * rows * 3)
  const at = new Int32Array(n)
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      let lo0 = 255, lo1 = 255, lo2 = 255, hi0 = 0, hi1 = 0, hi2 = 0
      for (let j = 0; j < sy; j++)
        for (let i = 0; i < sx; i++) {
          const d = ((r * sy + j) * dw + c * sx + i) * 3
          at[j * sx + i] = d
          const v0 = dot[d], v1 = dot[d + 1], v2 = dot[d + 2]
          if (v0 < lo0) lo0 = v0
          if (v0 > hi0) hi0 = v0
          if (v1 < lo1) lo1 = v1
          if (v1 > hi1) hi1 = v1
          if (v2 < lo2) lo2 = v2
          if (v2 > hi2) hi2 = v2
        }
      const o = (r * cols + c) * 3
      const r0 = hi0 - lo0, r1 = hi1 - lo1, r2 = hi2 - lo2
      const ch = r0 >= r1 && r0 >= r2 ? 0 : r1 >= r2 ? 1 : 2
      const mid = ch === 0 ? (lo0 + hi0) / 2 : ch === 1 ? (lo1 + hi1) / 2 : (lo2 + hi2) / 2
      let bits = 0
      for (let t = 0; t < n; t++) if (dot[at[t] + ch] > mid) bits |= 1 << t
      // the two colours, then each dot to the nearer, then the colours again
      for (let pass = 0; pass < 2; pass++) {
        let a0 = 0, a1 = 0, a2 = 0, na = 0, b0 = 0, b1 = 0, b2 = 0, nb = 0
        for (let t = 0; t < n; t++) {
          const d = at[t]
          if (bits & (1 << t)) { a0 += dot[d]; a1 += dot[d + 1]; a2 += dot[d + 2]; na++ }
          else { b0 += dot[d]; b1 += dot[d + 1]; b2 += dot[d + 2]; nb++ }
        }
        if (na) { a0 /= na; a1 /= na; a2 /= na }
        if (nb) { b0 /= nb; b1 /= nb; b2 /= nb }
        if (!na) { a0 = b0; a1 = b1; a2 = b2 }
        if (!nb) { b0 = a0; b1 = a1; b2 = a2 }
        fg[o] = a0; fg[o + 1] = a1; fg[o + 2] = a2
        bg[o] = b0; bg[o + 1] = b1; bg[o + 2] = b2
        if (pass === 1 || !na || !nb) break
        let next = 0
        for (let t = 0; t < n; t++) {
          const d = at[t]
          const ea = (dot[d] - a0) ** 2 + (dot[d + 1] - a1) ** 2 + (dot[d + 2] - a2) ** 2
          const eb = (dot[d] - b0) ** 2 + (dot[d + 1] - b1) ** 2 + (dot[d + 2] - b2) ** 2
          if (ea < eb) next |= 1 << t
        }
        if (next === bits) break
        bits = next
      }
      char[r * cols + c] = k.glyph[bits]
    }
  return { char, fg, bg }
}

/**
 * Lay text over the picture (`quadCells`' or `blockCells`'). `texts` are lines of [row, from, to, r, g, b,
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
    char[i] = pic.char ? pic.char[i] : QUADS[pic.glyph[i]]
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
 * How far a cell's colour may drift, in any channel, before it is sent again:
 * the frames come as JPEG, whose noise would otherwise resend most of the
 * picture every frame.
 */
const DRIFT = 12

/** What the terminal shows, and the escapes that bring it up to date. */
export class Screen {
  /** `drift`: how far a colour may move before the cell is sent again; 0 for frames that are exact, not JPEG */
  constructor(cols, rows, drift = DRIFT) {
    this.drift = drift
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
    let cursor = -1
    const d = this.drift
    const drifted = (a, b, i) => Math.abs(a[i] - b[i]) > d || Math.abs(a[i + 1] - b[i + 1]) > d || Math.abs(a[i + 2] - b[i + 2]) > d
    for (let i = 0; i < cols * rows; i++) {
      const ch = cells.char[i]
      const j = i * 3
      // a space shows only its background, a full block only its foreground
      if (!all && this.char[i] === ch && !(ch !== ' ' && drifted(cells.fg, this.fg, j)) && !(ch !== '█' && drifted(cells.bg, this.bg, j))) continue
      this.char[i] = ch
      for (let k = 0; k < 3; k++) {
        this.fg[j + k] = cells.fg[j + k]
        this.bg[j + k] = cells.bg[j + k]
      }
      const f = `${cells.fg[j]};${cells.fg[j + 1]};${cells.fg[j + 2]}`
      // a full block goes out as a space in its colour: Terminal.app draws █ from the font, a line short of the
      // cell, and the background showed through as a stripe under every row
      const solid = ch === '█'
      const b = solid ? f : `${cells.bg[j]};${cells.bg[j + 1]};${cells.bg[j + 2]}`
      if (cursor !== i) out.push(`\x1b[${((i / cols) | 0) + 1};${(i % cols) + 1}H`)
      if (f !== lastFg && ch !== ' ' && !solid) {
        out.push(`\x1b[38;2;${f}m`)
        lastFg = f
      }
      if (b !== lastBg) {
        out.push(`\x1b[48;2;${b}m`)
        lastBg = b
      }
      out.push(solid ? ' ' : ch)
      cursor = i + 1
      // past the end of a row, or after a character a terminal may draw two cells wide (only ASCII, the box drawing
      // and the block elements are surely one), the cursor is put where the next cell is rather than trusted
      if (cursor % cols === 0 || (ch > '~' && (ch < '\u2500' || ch > '\u259f'))) cursor = -1
    }
    return out.length ? out.join('') + '\x1b[0m' : ''
  }
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
