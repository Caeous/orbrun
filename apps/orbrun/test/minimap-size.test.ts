// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { minimapBox, MINIMAP_CELL_DEFAULT, MINIMAP_TILES_DEFAULT } from '../src/hud'
import { MINIMAP_CELLS, MINIMAP_TILES_MAX } from '../src/settings-rows'

// a 1280px screen with a 42-cell, 336px sidebar column 720px tall (game.js stat_width at a 8px cell)
const SIDE_W = 336
const SIDE_H = 720
const GRID_W = 1280

describe('minimapBox: the "Minimap size" setting, in tiles across', () => {
  it('the default cell is 20 css px and the default 19 tiles, a map a little wider than the reference column', () => {
    expect(MINIMAP_CELL_DEFAULT).toBe(20)
    expect(MINIMAP_TILES_DEFAULT).toBe(19)
    const { w } = minimapBox(SIDE_W, SIDE_H, GRID_W, MINIMAP_TILES_DEFAULT)
    expect(w).toBe(19 * MINIMAP_CELL_DEFAULT)
    expect(w).toBeGreaterThan(SIDE_W)
  })

  it('is as many whole tiles across as asked and gym / gxm as many down, on an odd count so the player is centred', () => {
    const { w, h } = minimapBox(SIDE_W, SIDE_H, GRID_W, 21)
    expect(w / MINIMAP_CELL_DEFAULT).toBe(21)
    // 21 * 70 / 80 = 18.4 rows: the odd count within one, 19
    expect(h / MINIMAP_CELL_DEFAULT).toBe(19)
    const big = minimapBox(SIDE_W, SIDE_H, GRID_W, 27)
    expect(big.w / MINIMAP_CELL_DEFAULT).toBe(27)
    expect(big.h / MINIMAP_CELL_DEFAULT).toBe(23)
    const small = minimapBox(SIDE_W, SIDE_H, GRID_W, 15)
    expect(small.w / MINIMAP_CELL_DEFAULT).toBe(15)
    expect(small.h / MINIMAP_CELL_DEFAULT).toBe(13)
  })

  it('an even count takes the odd one above it', () => {
    expect(minimapBox(SIDE_W, SIDE_H, GRID_W, 20).w / MINIMAP_CELL_DEFAULT).toBe(21)
  })

  it('stops at half the screen across and seven tenths of the column down, on whole odd tiles', () => {
    // 41 tiles is 820px, over half of 1280: 640px holds 32 tiles, so 31
    const { w, h } = minimapBox(SIDE_W, SIDE_H, GRID_W, 41)
    expect(w / MINIMAP_CELL_DEFAULT).toBe(31)
    expect(w).toBeLessThanOrEqual(GRID_W * 0.5)
    // 31 * 70 / 80 = 27.1 rows would be 27 tiles, 540px, over 0.7 of 720 = 504px, which holds 25 tiles
    expect(h / MINIMAP_CELL_DEFAULT).toBe(25)
    expect(h).toBeLessThanOrEqual(SIDE_H * 0.7)
  })

  it('a wide screen lets a big count through whole', () => {
    const { w, h } = minimapBox(400, 1000, 2560, 41)
    expect(w / MINIMAP_CELL_DEFAULT).toBe(41)
    // 41 * 70 / 80 = 35.9 rows: the odd count within one, 35
    expect(h / MINIMAP_CELL_DEFAULT).toBe(35)
  })

  it('draws the same tiles at the "Minimap tile size" setting\'s cell', () => {
    const small = minimapBox(SIDE_W, SIDE_H, GRID_W, 21, 8)
    expect(small.w).toBe(21 * 8)
    expect(small.h).toBe(19 * 8)
    const big = minimapBox(SIDE_W, SIDE_H, GRID_W, 21, 32)
    // 21 * 32 = 672px, over half of 1280: 640px holds 20 tiles, so 19 across; 19 * 70 / 80 = 16.6 rows would be
    // 17 tiles, 544px, over 0.7 of 720 = 504px, which holds 15
    expect(big.w / 32).toBe(19)
    expect(big.h / 32).toBe(15)
    expect(big.h).toBeLessThanOrEqual(SIDE_H * 0.7)
  })

  it('never shows more of the level than WebTiles does: the whole map at once is minimap.js fit_to, and no setting reaches it', () => {
    // enums.js: the level is gxm 80 by gym 70, and minimap.js `fit_to` draws all of it in the column at once
    const GXM = 80
    const GYM = 70
    expect(MINIMAP_TILES_MAX).toBeLessThan(GXM)
    // the widest stop on a screen and column too big for either cap to bite, at every cell the setting offers
    for (const cell of MINIMAP_CELLS) {
      const { w, h } = minimapBox(4000, 4000, 20000, MINIMAP_TILES_MAX, cell)
      expect(w / cell).toBeLessThanOrEqual(MINIMAP_TILES_MAX)
      expect(w / cell).toBeLessThan(GXM)
      expect(h / cell).toBeLessThan(GYM)
    }
  })

  it('draws nothing on no column, and a bad count is the default', () => {
    expect(minimapBox(0, SIDE_H, GRID_W, 21)).toEqual({ w: 0, h: 0 })
    expect(minimapBox(SIDE_W, SIDE_H, GRID_W, 0)).toEqual(minimapBox(SIDE_W, SIDE_H, GRID_W, MINIMAP_TILES_DEFAULT))
    expect(minimapBox(SIDE_W, SIDE_H, GRID_W, NaN)).toEqual(minimapBox(SIDE_W, SIDE_H, GRID_W, MINIMAP_TILES_DEFAULT))
    // a bad cell is the default cell too
    expect(minimapBox(SIDE_W, SIDE_H, GRID_W, 21, 0)).toEqual(minimapBox(SIDE_W, SIDE_H, GRID_W, 21, MINIMAP_CELL_DEFAULT))
    expect(minimapBox(SIDE_W, SIDE_H, GRID_W, 21, NaN)).toEqual(minimapBox(SIDE_W, SIDE_H, GRID_W, 21, MINIMAP_CELL_DEFAULT))
  })
})
