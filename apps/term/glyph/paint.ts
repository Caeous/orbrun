/**
 * Cells painted as a terminal paints them, `CW` x `CH` pixels a cell: block
 * glyphs exactly from their shapes, anything else set in Menlo (through
 * sharp's SVG), each glyph's ink once and then laid in its colours.
 */
import sharp from 'sharp'
import { SHAPE_OF } from './shapes'
import type { Cell } from './render'

const inks = new Map<string, Float32Array>()

/** Sets the letters among `cells` in the font before `paint` needs them. */
export async function warmText(cells: Cell[], CW: number, CH: number) {
  for (const o of cells) {
    const key = `${o.ch}\0${CW}x${CH}`
    if (inks.has(key) || SHAPE_OF.has(o.ch)) continue
    const esc = o.ch.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="${CH}"><rect width="${CW}" height="${CH}" fill="#000"/><text x="${CW / 2}" y="${CH * 0.76}" font-family="Menlo" font-size="${CH * 0.8}" text-anchor="middle" fill="#fff">${esc}</text></svg>`
    const { data } = await sharp(Buffer.from(svg)).greyscale().raw().toBuffer({ resolveWithObject: true })
    inks.set(key, Float32Array.from(data, (v) => v / 255))
  }
}

function inkOf(ch: string, CW: number, CH: number): Float32Array {
  const key = `${ch}\0${CW}x${CH}`
  let m = inks.get(key)
  if (m) return m
  const shape = SHAPE_OF.get(ch)
  m = new Float32Array(CW * CH)
  if (shape) {
    // 4x4 points a pixel, so a slant's edge is as smooth as the terminal draws it
    for (let y = 0; y < CH; y++)
      for (let x = 0; x < CW; x++) {
        let n = 0
        for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) if (shape.inside((x + (i + 0.5) / 4) / CW, (y + (j + 0.5) / 4) / CH)) n++
        m[y * CW + x] = n / 16
      }
  }
  inks.set(key, m)
  return m
}

/** The cells as RGB, `cols * CW` x `rows * CH`. Call `warmText` first where they hold letters. */
export function paint(cells: Cell[], cols: number, rows: number, CW = 8, CH = 16): Uint8Array {
  const W = cols * CW
  const out = new Uint8Array(W * rows * CH * 3)
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const o = cells[r * cols + c]
      const m = inkOf(o.ch, CW, CH)
      for (let y = 0; y < CH; y++)
        for (let x = 0; x < CW; x++) {
          const a = m[y * CW + x]
          const i = ((r * CH + y) * W + c * CW + x) * 3
          for (let k = 0; k < 3; k++) out[i + k] = Math.round(o.fg[k] * a + o.bg[k] * (1 - a))
        }
    }
  return out
}
