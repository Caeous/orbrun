import { describe, it, expect } from 'vitest'
import { peelInk } from '../src/index.js'

/**
 * The ink peel takes crawl's outline off sprite art. Crawl keeps floors in an
 * atlas of their own that is never peeled; an atlas that packs floors beside
 * sprites (the front room) says where the sprites are, and the floors keep
 * every dark texel — otherwise a floor's dark edge against the image border
 * or a gap goes clear and shows as a black line between cells.
 */
const W = 8, H = 8
/** an 8x8 image: a dark opaque floor tile filling the top-left 4x4 (touching the border), a sprite of ink round a body in the bottom-right 4x4, clear elsewhere */
function image(): Uint8ClampedArray {
  const d = new Uint8ClampedArray(W * H * 4)
  const set = (x: number, y: number, v: number) => d.set([v, v, v, 255], (y * W + x) * 4)
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) set(x, y, 10)
  for (let y = 4; y < 8; y++) for (let x = 4; x < 8; x++) set(x, y, x === 4 || x === 7 || y === 4 || y === 7 ? 0 : 200)
  return d
}
const alphaAt = (d: Uint8ClampedArray, x: number, y: number) => d[(y * W + x) * 4 + 3]

describe('peelInk', () => {
  it('peels the whole image when no sprite rects are given, as for one of crawl\'s own atlases', () => {
    const d = image()
    const mask = peelInk(d, W, H, 26)
    expect(alphaAt(d, 0, 0)).toBe(0)
    expect(alphaAt(d, 4, 4)).toBe(0)
    expect(alphaAt(d, 5, 5)).toBe(255)
    expect(mask[0]).toBe(0)
    expect(mask[5 * W + 5]).toBe(1)
  })
  it('leaves the floor alone when told where the sprites are', () => {
    const d = image()
    const mask = peelInk(d, W, H, 26, [{ sx: 4, sy: 4, w: 4, h: 4 }])
    // the floor keeps every texel, and is opaque in the mask
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      expect(alphaAt(d, x, y)).toBe(255)
      expect(mask[y * W + x]).toBe(1)
    }
    // the sprite's outline still comes off, its body stays
    expect(alphaAt(d, 4, 4)).toBe(0)
    expect(alphaAt(d, 7, 7)).toBe(0)
    expect(alphaAt(d, 5, 5)).toBe(255)
    expect(mask[4 * W + 4]).toBe(0)
    expect(mask[5 * W + 5]).toBe(1)
  })
  it('reaches ink at the edge of a sprite rect as at the edge of the image', () => {
    // a sprite of solid ink butted against the floor: its rect edge is reachable even though its neighbour is opaque
    const d = new Uint8ClampedArray(W * H * 4)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) d.set([0, 0, 0, 255], (y * W + x) * 4)
    peelInk(d, W, H, 26, [{ sx: 4, sy: 0, w: 4, h: 8 }])
    expect(alphaAt(d, 4, 3)).toBe(0)
    expect(alphaAt(d, 3, 3)).toBe(255)
  })
})
