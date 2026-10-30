/**
 * The glyphs a terminal draws pictures in, each as the shape it inks over
 * its cell: `inside(u, v)`, u across and v down, 0..1. The terminals that
 * draw these themselves (Ghostty, kitty, WezTerm, Rex) draw them exactly so,
 * cell-shaped, whatever the font.
 */

export interface Shape {
  ch: string
  inside: (u: number, v: number) => boolean
  /** the set it belongs to, for choosing which a terminal is asked to draw */
  set: 'block' | 'quadrant' | 'sextant' | 'octant' | 'wedge' | 'eighth'
}

/** Unicode's octants by their dots, numbered across then down: bit (row * 2 + col). */
export const OCTANTS: string[] = (() => {
  // the patterns an older block already has, as those blocks
  const older: Record<number, string> = {
    0x00: ' ', 0xff: '█', 0x55: '▌', 0xaa: '▐', 0x0f: '▀', 0xf0: '▄', 0x05: '▘', 0x0a: '▝', 0x50: '▖', 0xa0: '▗',
    0x5a: '▞', 0xa5: '▚', 0x5f: '▛', 0xaf: '▜', 0xf5: '▙', 0xfa: '▟', 0x03: '\u{1FB82}', 0x3f: '\u{1FB85}', 0xc0: '▂',
    0xfc: '▆', 0x01: '\u{1CEA8}', 0x02: '\u{1CEAB}', 0x40: '\u{1CEA3}', 0x80: '\u{1CEA0}', 0x14: '\u{1FBE6}', 0x28: '\u{1FBE7}',
  }
  const out: string[] = []
  let next = 0x1cd00
  for (let b = 0; b < 256; b++) out.push(older[b] ?? String.fromCodePoint(next++))
  return out
})()

/** Unicode's sextants by their dots, numbered across then down: bit (row * 2 + col). */
export const SEXTANTS: string[] = Array.from({ length: 64 }, (_, b) =>
  b === 0 ? ' ' : b === 63 ? '█' : b === 21 ? '▌' : b === 42 ? '▐' : String.fromCodePoint(0x1fb00 + b - 1 - (b > 21 ? 1 : 0) - (b > 42 ? 1 : 0)),
)

const QUADS = ' ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█'

/** the wedges U+1FB3C..1FB51, each the cell cut along a line between points of the sextants' grid (x0, y0, x1, y1, y down) and inked on the side of the corner it names; U+1FB52..1FB67 are the same lines, inked on the other side */
const T3 = 1 / 3, U3 = 2 / 3
const WEDGES = [
  [0, U3, 0.5, 1, 0, 1], [0, U3, 1, 1, 0, 1], [0, T3, 0.5, 1, 0, 1], [0, T3, 1, 1, 0, 1], [0, 0, 0.5, 1, 0, 1],
  [0, T3, 0.5, 0, 1, 1], [0, T3, 1, 0, 1, 1], [0, U3, 0.5, 0, 1, 1], [0, U3, 1, 0, 1, 1], [0, 1, 0.5, 0, 1, 1], [0, U3, 1, T3, 1, 1],
  [0.5, 1, 1, U3, 1, 1], [0, 1, 1, U3, 1, 1], [0.5, 1, 1, T3, 1, 1], [0, 1, 1, T3, 1, 1], [0.5, 1, 1, 0, 1, 1],
  [0.5, 0, 1, T3, 0, 1], [0, 0, 1, T3, 0, 1], [0.5, 0, 1, U3, 0, 1], [0, 0, 1, U3, 0, 1], [0.5, 0, 1, 1, 0, 1], [0, T3, 1, U3, 0, 1],
]

const grid = (sx: number, sy: number, bits: number) => (u: number, v: number) =>
  ((bits >> (Math.min(sy - 1, Math.floor(v * sy)) * sx + Math.min(sx - 1, Math.floor(u * sx)))) & 1) === 1

/** Every glyph shape there is, each once (the first set to have it names it). */
export const SHAPES: Shape[] = (() => {
  const out: Shape[] = []
  const seen = new Set<string>()
  const add = (ch: string, set: Shape['set'], inside: Shape['inside']) => {
    if (seen.has(ch)) return
    seen.add(ch)
    out.push({ ch, set, inside })
  }
  add(' ', 'block', () => false)
  add('█', 'block', () => true)
  add('▀', 'block', (_, v) => v < 0.5)
  add('▄', 'block', (_, v) => v >= 0.5)
  add('▌', 'block', (u) => u < 0.5)
  add('▐', 'block', (u) => u >= 0.5)
  for (let b = 1; b < 15; b++) add(QUADS[b], 'quadrant', grid(2, 2, b))
  for (let k = 1; k <= 7; k++) add(String.fromCodePoint(0x2580 + k), 'eighth', (_, v) => v >= 1 - k / 8)
  for (let k = 1; k <= 7; k++) add(String.fromCodePoint(0x2590 - k), 'eighth', (u) => u < k / 8)
  add('▔', 'eighth', (_, v) => v < 1 / 8)
  add('▕', 'eighth', (u) => u >= 7 / 8)
  for (let b = 1; b < 63; b++) add(SEXTANTS[b], 'sextant', grid(2, 3, b))
  WEDGES.forEach(([x0, y0, x1, y1, cx, cy], i) => {
    const side = (u: number, v: number) => (x1 - x0) * (v - y0) - (y1 - y0) * (u - x0)
    const inked = side(cx, cy) > 0
    add(String.fromCodePoint(0x1fb3c + i), 'wedge', (u, v) => side(u, v) > 0 === inked)
    add(String.fromCodePoint(0x1fb52 + i), 'wedge', (u, v) => side(u, v) > 0 !== inked)
  })
  // the triangles to the middle (left, upper, right, lower) and the cell less each
  const tri = (k: number, u: number, v: number) => (k === 0 ? u < v && u < 1 - v : k === 1 ? v < u && v < 1 - u : k === 2 ? u > v && u > 1 - v : v > u && v > 1 - u)
  for (let k = 0; k < 4; k++) {
    add(String.fromCodePoint(0x1fb68 + k), 'wedge', (u, v) => !tri(k, u, v))
    add(String.fromCodePoint(0x1fb6c + k), 'wedge', (u, v) => tri(k, u, v))
  }
  for (let b = 1; b < 255; b++) add(OCTANTS[b], 'octant', grid(2, 4, b))
  return out
})()

export const SHAPE_OF = new Map(SHAPES.map((s) => [s.ch, s]))

/**
 * Each glyph's inverse, by code point: the glyph inking what it leaves (a
 * space a full block). Drawn in its colours the other way round, it is the
 * same cell, which output may pick to keep the colours the terminal has.
 */
export const INVERSE: Map<number, number> = (() => {
  const N = 24
  // points off the lines a glyph is cut along, so each is plainly in or out
  const pts: [number, number][] = []
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) pts.push([(i + 0.37) / N, (j + 0.61) / N])
  const byMask = new Map<string, number>()
  const masks = SHAPES.map((sh) => pts.map(([u, v]) => (sh.inside(u, v) ? '1' : '0')).join(''))
  SHAPES.forEach((sh, i) => byMask.set(masks[i], sh.ch.codePointAt(0)!))
  const out = new Map<number, number>()
  SHAPES.forEach((sh, i) => {
    const inv = byMask.get(masks[i].replace(/[01]/g, (c) => (c === '1' ? '0' : '1')))
    if (inv !== undefined) out.set(sh.ch.codePointAt(0)!, inv)
  })
  return out
})()

/**
 * How much of each of `w` x `h` samples over the cell a shape inks, 0..1,
 * across then down, from 8x8 points a sample.
 */
export function coverage(shape: Shape, w: number, h: number): Float32Array {
  const SS = 8
  const m = new Float32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let n = 0
      for (let j = 0; j < SS; j++)
        for (let i = 0; i < SS; i++) if (shape.inside((x + (i + 0.5) / SS) / w, (y + (j + 0.5) / SS) / h)) n++
      m[y * w + x] = n / (SS * SS)
    }
  return m
}
