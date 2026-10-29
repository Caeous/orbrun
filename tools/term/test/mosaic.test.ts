import { describe, it, expect } from 'vitest'
// @ts-expect-error: plain JS, shared with the browser bridge
import { MOSAIC_SX, MOSAIC_SY, Screen, mosaicEncoder, mosaicGlyphs } from '../frame.mjs'

type RGB = [number, number, number]
const RED: RGB = [200, 30, 30]
const BLUE: RGB = [20, 40, 220]

/** one cell's samples, each the colour `at` gives its middle (u across, v down, 0..1) */
function cell(at: (u: number, v: number) => RGB): Uint8Array {
  const px = new Uint8Array(MOSAIC_SX * MOSAIC_SY * 3)
  for (let j = 0; j < MOSAIC_SY; j++) for (let i = 0; i < MOSAIC_SX; i++) px.set(at((i + 0.5) / MOSAIC_SX, (j + 0.5) / MOSAIC_SY), (j * MOSAIC_SX + i) * 3)
  return px
}
const encode = (kind: string, px: Uint8Array, box?: object) => mosaicEncoder(kind, box)(px, 1, 1)
const colours = (c: { fg: Uint8Array; bg: Uint8Array }) => [[...c.fg], [...c.bg]]

describe('mosaic glyphs', () => {
  const chars = (kind: string) => new Set(mosaicGlyphs(kind, 4, 8).map((g: { ch: string }) => g.ch))
  it('gives each terminal the glyphs it draws', () => {
    expect(chars('octant').has('\u{1CD00}')).toBe(true)
    expect(chars('octant').has('\u{1FB3C}')).toBe(true)
    // iTerm2: no octants, and not the wedges it draws off their shape
    expect(chars('sextant').has('\u{1CD00}')).toBe(false)
    expect(chars('sextant').has('\u{1FB00}')).toBe(true)
    expect(chars('sextant').has('\u{1FB45}')).toBe(false)
    expect(chars('quadrant').has('\u{1FB00}')).toBe(false)
    expect(chars('quadrant').has('▚')).toBe(true)
  })

  it('stands a font block in its box: nothing over the gap at the top', () => {
    const lower = mosaicGlyphs('block', 4, 8, { top: 0.25, right: 0, bottom: 0 }).find((g: { ch: string }) => g.ch === '█' || g.ch === '▇')
    expect([...lower.mask.slice(0, 8)].every((v: number) => v === 0)).toBe(true)
  })
})

describe('mosaic encoder', () => {
  it('draws a cell of one colour as a space', () => {
    const c = encode('octant', cell(() => RED))
    expect(c.char[0]).toBe(' ')
    expect([...c.bg]).toEqual(RED)
  })

  it('splits a cell down the middle with a half block, in its own two colours', () => {
    const c = encode('quadrant', cell((u) => (u < 0.5 ? RED : BLUE)))
    expect(['▌', '▐']).toContain(c.char[0])
    expect(colours(c)).toEqual(c.char[0] === '▌' ? [RED, BLUE] : [BLUE, RED])
  })

  it('cuts a slant with a wedge where the terminal draws them, and not where it does not', () => {
    // the line from the lower middle left to the lower right: U+1FB3D's, inked below it, or U+1FB53's, above
    const px = cell((u, v) => (v - 2 / 3 > u / 3 ? RED : BLUE))
    expect(['\u{1FB3D}', '\u{1FB53}']).toContain(encode('octant', px).char[0])
    const cp = encode('quadrant', px).char[0].codePointAt(0)!
    expect(cp >= 0x1fb3c && cp <= 0x1fb6f).toBe(false)
  })

  it('takes a font box short of the top into account: a light top row over dark is drawn with the dark inked', () => {
    // in a box a quarter short of the top, the background shows there: so the light goes in the background
    const c = encode('block', cell((u, v) => (v < 0.25 ? RED : BLUE)), { top: 0.25, right: 0, bottom: 0 })
    expect(c.char[0]).not.toBe('▀')
    expect([...c.bg]).toEqual(RED)
  })

  it('with a rate, keeps the colours the cell before set where the difference costs less than an escape', () => {
    // two cells, each one colour, a little apart
    const near: RGB = [RED[0] + 3, RED[1] + 2, RED[2] - 3]
    const px = new Uint8Array(2 * MOSAIC_SX * MOSAIC_SY * 3)
    for (let j = 0; j < MOSAIC_SY; j++) for (let i = 0; i < 2 * MOSAIC_SX; i++) px.set(i < MOSAIC_SX ? RED : near, (j * 2 * MOSAIC_SX + i) * 3)
    const bgs = (rate: number) => [...mosaicEncoder('octant', undefined, rate)(px, 2, 1).bg]
    expect(bgs(0)).toEqual([...RED, ...near])
    expect(bgs(10000)).toEqual([...RED, ...RED])
    // and a cell far from it still gets its own
    const far = cell((u) => (u < 0.5 ? RED : BLUE))
    expect(colours(mosaicEncoder('octant', undefined, 10000)(far, 1, 1))).toEqual(colours(encode('octant', far)))
  })

  it('keeps the glyph a cell had when another is no better', () => {
    const enc = mosaicEncoder('octant')
    const px = cell((u) => (u < 0.5 ? RED : BLUE))
    const first = enc(px, 1, 1).char[0]
    const other = first === '▌' ? '▐' : '▌'
    expect(enc(px, 1, 1, undefined, 0, 1, Uint32Array.of(other.codePointAt(0)!)).char[0]).toBe(other)
  })

  it('keeps a sample that stands out, weighted, where the many beside it would drown it', () => {
    // a goblin's face: red over black, and one yellow eye
    const YELLOW: RGB = [240, 200, 40]
    const px = cell((u, v) => (u > 0.5 && u < 0.75 && v > 0.25 && v < 0.375 ? YELLOW : v < 0.5 ? RED : [10, 5, 5]))
    const eye = 2 * MOSAIC_SX + 2
    const wt = new Uint8Array(MOSAIC_SX * MOSAIC_SY).fill(1)
    wt[eye] = 255
    const greenest = (c: { fg: Uint8Array; bg: Uint8Array }) => Math.max(c.fg[1], c.bg[1])
    expect(greenest(encode('octant', px))).toBeLessThan(100)
    expect(greenest(mosaicEncoder('octant')(px, 1, 1, undefined, 0, 1, null, wt))).toBeGreaterThan(150)
  })
})

describe('screen', () => {
  const cells = (char: string[], fg: number[][], bg: number[][]) => ({ char, fg: Uint8Array.from(fg.flat()), bg: Uint8Array.from(bg.flat()) })
  it('trusts a mosaic glyph to be one cell wide, so the next cell needs no cursor of its own', () => {
    const out = new Screen(2, 1, 0).update(cells(['\u{1CD00}', '\u{1FB3C}'], [RED, BLUE], [BLUE, RED]))
    expect(out.match(/\x1b\[\d+;\d+H/g)).toHaveLength(1)
  })

  it('draws a colour near the one set already in that one, with no escape of its own', () => {
    const near: RGB = [RED[0] + 2, RED[1] - 1, RED[2]]
    const exact = new Screen(2, 1, 0).update(cells([' ', ' '], [RED, RED], [RED, near]))
    const reused = new Screen(2, 1, 0, 2).update(cells([' ', ' '], [RED, RED], [RED, near]))
    expect(exact.match(/48;2/g)).toHaveLength(2)
    expect(reused.match(/48;2/g)).toHaveLength(1)
  })
})
