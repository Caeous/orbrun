/**
 * Crawl's glyphs drawn large, for what stands close: each glyph is set once
 * in a real font (sharp, through SVG), cut to its ink, and shrunk to the
 * dots of the octants (2x4 a cell) it is drawn in.
 */
export { OCTANTS, SEXTANTS } from './shapes'

interface Ink {
  w: number
  h: number
  a: Float32Array
}

const RES = 160
const inks = new Map<string, Ink>()
const sized = new Map<string, Mask | null>()

export interface Mask {
  w: number
  h: number
  at(x: number, y: number): boolean
}

/** Sets each glyph in the font once, before any frame needs it. */
export async function warmGlyphs(glyphs: Iterable<string>) {
  // sharp only here, so a worker that is handed the inks (`setInks`) never loads it
  const { default: sharp } = await import('sharp')
  for (const g of new Set(glyphs)) {
    if (inks.has(g)) continue
    const esc = g.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${RES * 2}" height="${RES * 2}"><text x="${RES}" y="${RES * 1.45}" font-family="Menlo, DejaVu Sans Mono, monospace" font-weight="bold" font-size="${RES * 1.3}" text-anchor="middle" fill="#fff">${esc}</text></svg>`
    const { data, info } = await sharp(Buffer.from(svg)).greyscale().raw().toBuffer({ resolveWithObject: true })
    let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1
    for (let y = 0; y < info.height; y++)
      for (let x = 0; x < info.width; x++)
        if (data[y * info.width + x] > 100) {
          if (x < x0) x0 = x
          if (x > x1) x1 = x
          if (y < y0) y0 = y
          if (y > y1) y1 = y
        }
    if (x1 < 0) continue
    const w = x1 - x0 + 1
    const h = y1 - y0 + 1
    const a = new Float32Array(w * h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = data[(y + y0) * info.width + x + x0] / 255
    inks.set(g, { w, h, a })
  }
}

/** Each glyph set so far, as its ink: for another thread's `setInks`. */
export const glyphInks = () => [...inks]
export function setInks(all: [string, Ink][]) {
  for (const [g, ink] of all) inks.set(g, ink)
}

/** The glyph `hDots` dots tall, its width kept true for a cell `aspect` times as tall as it is wide. */
export function bigGlyph(g: string, hDots: number, aspect: number): Mask | null {
  const key = `${g}\0${hDots}\0${aspect}`
  if (sized.has(key)) return sized.get(key)!
  const ink = inks.get(g)
  let mask: Mask | null = null
  if (ink && hDots >= 2) {
    // a dot is half a cell wide and a quarter of it tall
    const dotAspect = aspect / 2
    const h = hDots
    const w = Math.max(1, Math.round((ink.w / ink.h) * h * dotAspect))
    const bits = new Uint8Array(w * h)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        // the ink's cover over the dot
        const sx0 = Math.floor((x / w) * ink.w), sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) / w) * ink.w))
        const sy0 = Math.floor((y / h) * ink.h), sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) / h) * ink.h))
        let sum = 0
        for (let yy = sy0; yy < sy1; yy++) for (let xx = sx0; xx < sx1; xx++) sum += ink.a[yy * ink.w + xx]
        bits[y * w + x] = sum / ((sx1 - sx0) * (sy1 - sy0)) > 0.42 ? 1 : 0
      }
    mask = { w, h, at: (x, y) => x >= 0 && y >= 0 && x < w && y < h && bits[y * w + x] === 1 }
  }
  sized.set(key, mask)
  return mask
}
