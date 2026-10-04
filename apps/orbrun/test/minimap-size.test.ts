// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { Hud, minimapFit, MINIMAP_CELL_DEFAULT, MINIMAP_CELL_LEAST, MINIMAP_CELL_LEAST_PHONE, MINIMAP_CELL_MOST, MINIMAP_REF_SHORT, MINIMAP_SHARE, MINIMAP_SHARE_PHONE, MINIMAP_TILES_DEFAULT, MINIMAP_TILES_LEAST } from '../src/hud'
import { MINIMAP_AUTO, MINIMAP_CELLS, MINIMAP_TILES_MAX } from '../src/settings-rows'
import { GridHost } from '../src/grid/host'
import { STRIP_ROWS, gameSplit, isPortrait, touchBeside, touchColumn } from '../src/grid/console'

// a 1280x720 screen with a 42-cell, 336px sidebar column (game.js stat_width at a 8px cell): the room hud.ts layout gives
// the map there is half the screen across and 0.7 of the column down
const ROOM = { w: 640, h: 504 }
const SHORT = 720
// a room too big for any cap to bite
const ANY = { w: 20000, h: 20000 }

describe('minimapFit: the "Minimap size" setting, in tiles across the disc', () => {
  it('Auto on a 1080-tall screen is 19 tiles of 20px, a map a little wider than the reference column', () => {
    expect(MINIMAP_CELL_DEFAULT).toBe(20)
    expect(MINIMAP_TILES_DEFAULT).toBe(19)
    expect(minimapFit(ANY, 1080)).toEqual({ w: 380, h: 380, cell: 20, tiles: 19 })
    expect(380).toBeGreaterThan(336)
  })

  it('is square: the map is cut to the disc inscribed in it, so the count is its diameter', () => {
    for (const tiles of [15, 19, 21, 25]) {
      const { w, h, cell } = minimapFit(ROOM, 1080, tiles)
      expect(w).toBe(h)
      expect(cell).toBe(MINIMAP_CELL_DEFAULT)
      expect(w / cell).toBe(tiles)
    }
  })

  it('an even count takes the odd one above it, so the player is on the centre tile', () => {
    expect(minimapFit(ROOM, 1080, 20).tiles).toBe(21)
  })

  it('a count asked for stops at the room, on whole odd tiles: the default cell is already the least, so the count gives way', () => {
    // 41 tiles is 820px; 504px holds 25 of 20px
    const { w, cell, tiles } = minimapFit(ROOM, 1080, 41)
    expect(cell).toBe(MINIMAP_CELL_DEFAULT)
    expect(tiles).toBe(25)
    expect(w).toBeLessThanOrEqual(ROOM.h)
    // a room big enough lets it through whole
    expect(minimapFit({ w: 1280, h: 980 }, 1080, 41).tiles).toBe(41)
  })

  it('out of room, a bigger cell shrinks to keep the count, but never under the least: past that the count gives way', () => {
    expect(MINIMAP_CELL_LEAST).toBe(20)
    // 25 tiles of 32px is 800px; 504px holds them at 20px
    expect(minimapFit(ROOM, 1080, 25, 32)).toMatchObject({ cell: 20, tiles: 25 })
    // 31 would be 16px: under the least, so 25 of 20px
    expect(minimapFit(ROOM, 1080, 31, 32)).toMatchObject({ cell: MINIMAP_CELL_LEAST, tiles: 25 })
  })

  it('draws the same tiles at the "Minimap tile size" setting\'s cell', () => {
    expect(minimapFit(ROOM, 1080, 21, 8)).toMatchObject({ w: 21 * 8, cell: 8, tiles: 21 })
    // 21 * 32 = 672px, over the 504px room: the 21 tiles are drawn at 24px to fit
    expect(minimapFit(ROOM, 1080, 21, 32)).toMatchObject({ cell: 24, tiles: 21 })
  })

  it('never shows more of the level than WebTiles does: the whole map at once is minimap.js fit_to, and no setting reaches it', () => {
    // enums.js: the level is gxm 80 by gym 70, and minimap.js `fit_to` draws all of it in the column at once
    const GXM = 80
    expect(MINIMAP_TILES_MAX).toBeLessThan(GXM)
    for (const cell of MINIMAP_CELLS.filter((c) => c !== MINIMAP_AUTO)) expect(minimapFit(ANY, 1080, MINIMAP_TILES_MAX, cell).tiles).toBeLessThanOrEqual(MINIMAP_TILES_MAX)
  })

  it('draws nothing with no room, and a bad count or cell is Auto', () => {
    expect(minimapFit({ w: 0, h: 500 }, 1080)).toMatchObject({ w: 0, h: 0 })
    expect(minimapFit(ROOM, SHORT, NaN)).toEqual(minimapFit(ROOM, SHORT, MINIMAP_AUTO))
    expect(minimapFit(ROOM, SHORT, 21, NaN)).toEqual(minimapFit(ROOM, SHORT, 21, MINIMAP_AUTO))
  })
})

describe('minimapFit on Auto: 19 tiles of 20px in proportion to the screen, never more than a share of it', () => {
  it('a taller screen draws the same 19 tiles larger, so the map is the same share of a 1440p or a 4K monitor as of 1080p', () => {
    expect(MINIMAP_REF_SHORT).toBe(1080)
    expect(minimapFit(ANY, 1440)).toMatchObject({ cell: 27, tiles: 19 })
    expect(minimapFit(ANY, 2160)).toMatchObject({ cell: 40, tiles: 19 })
    const share = (short: number) => minimapFit(ANY, short).w / short
    for (const short of [1440, 2160]) expect(Math.abs(share(short) - share(1080))).toBeLessThan(0.02)
  })

  it('never past MINIMAP_CELL_MOST, however big the screen', () => {
    expect(minimapFit(ANY, 4320).cell).toBe(MINIMAP_CELL_MOST)
  })

  it(`keeps to ${MINIMAP_SHARE * 100}% of the short side: a smaller screen shows fewer tiles at the least cell, two at a time`, () => {
    // a 1080p browser window, 960 tall: 19 of 20px is 40%
    expect(minimapFit(ANY, 960)).toMatchObject({ cell: 20, tiles: 19 })
    // a Steam Deck, 800 tall: 19 would be 48%, 17 is 43%
    expect(minimapFit(ANY, 800)).toMatchObject({ cell: 20, tiles: 17 })
    for (const short of [960, 800]) expect(minimapFit(ANY, short).w).toBeLessThanOrEqual(MINIMAP_SHARE * short)
  })

  it('past the line of sight the share gives way, not the least cell nor the count: a laptop\'s short window still shows 15 of 20px', () => {
    // 1366x768 with the browser's bars, 650 tall: 15 of 20px is 46%
    expect(minimapFit(ANY, 650)).toEqual({ w: 300, h: 300, cell: 20, tiles: MINIMAP_TILES_LEAST })
  })

  it('a setting on either row is the player\'s: the share leaves it alone', () => {
    expect(minimapFit(ANY, 1080, MINIMAP_AUTO, 32)).toMatchObject({ cell: 32, tiles: 19 })
    expect(minimapFit(ANY, 800, 19)).toMatchObject({ cell: 20, tiles: 19 })
  })

  it('a shorter screen scales a big setting down, but never under the least; a setting already under it stays as it is', () => {
    expect(minimapFit(ANY, 800, 19, 32).cell).toBe(24)
    expect(minimapFit(ANY, 390, 19, 32).cell).toBe(MINIMAP_CELL_LEAST)
    expect(minimapFit(ANY, 390, 19, 8).cell).toBe(8)
  })

  it('never shows under crawl\'s line of sight, 7 cells every way: a room too small for 15 tiles at the least draws them smaller', () => {
    expect(MINIMAP_TILES_LEAST).toBe(15)
    // a 150px room: 15 tiles of 10px rather than 7 of 20px
    expect(minimapFit({ w: 150, h: 400 }, 600)).toMatchObject({ cell: 10, tiles: 15 })
    // an old setting under it (the stops once went down to 9) shows 15 too
    expect(minimapFit(ROOM, 1080, 9).tiles).toBe(15)
  })

  it('a missing screen draws the setting as it stands', () => {
    expect(minimapFit(ANY, 0)).toMatchObject({ cell: MINIMAP_CELL_DEFAULT, tiles: 19 })
  })
})

describe('minimapFit on a phone: tiles of at least 15px, up to 60% of the short side', () => {
  it(`draws the tiles at no less than ${MINIMAP_CELL_LEAST_PHONE}px, and takes up to ${MINIMAP_SHARE_PHONE * 100}% of the short side`, () => {
    // an iPhone 14: 60% of 390 is 234, 15 tiles of 15px
    expect(minimapFit(ANY, 390, 0, 0, true)).toEqual({ w: 225, h: 225, cell: 15, tiles: 15 })
    // a Pixel 7: the 15 tiles take what is left, 16px
    expect(minimapFit(ANY, 412, 0, 0, true)).toMatchObject({ cell: 16, tiles: 15 })
    // an iPhone Pro Max: room for two more tiles at 15px
    expect(minimapFit(ANY, 430, 0, 0, true)).toMatchObject({ cell: 15, tiles: 17 })
  })

  it('the smallest phones go over the share rather than under 15px, where the room lets them', () => {
    expect(minimapFit(ANY, 360, 0, 0, true)).toMatchObject({ cell: 15, tiles: 15 })
    // and under 15px only where it does not
    expect(minimapFit({ w: 400, h: 208 }, 360, 0, 0, true)).toMatchObject({ cell: 13, tiles: 15 })
  })
})

describe('a phone\'s map in the layout', () => {
  /** the HUD laid out as game.ts relayout lays it out on a phone `w`×`h`, the touch bar showing or not; the map's size */
  function phoneMap(w: number, h: number, bar: boolean): { map: number; column: number; top: number; cw: number } {
    const host = document.createElement('div')
    Object.defineProperty(host, 'clientWidth', { value: w })
    Object.defineProperty(host, 'clientHeight', { value: h })
    document.body.append(host)
    const hud = new Hud(host, { onSelectMonster() {}, onBarAction() {}, onMinimapClick() {}, onPanelItem() {}, onPanelShow() {} } as unknown as ConstructorParameters<typeof Hud>[1])
    const grid = new GridHost(host, 16)
    grid.setLeast(true)
    const g = grid.grid
    const priv = hud as unknown as { touchbar: HTMLElement; minimapCanvas: HTMLCanvasElement }
    priv.touchbar.hidden = !bar
    const beside = touchBeside(g)
    hud.touchBeside = beside
    // the bar's rows: about what the foot's three rows of buttons take
    const barRows = bar ? Math.ceil(170 / g.ch) : 0
    const split = (mapCols?: number) => gameSplit(g, 5, undefined, beside ? 0 : barRows, beside ? barRows : 0, beside && barRows ? touchColumn(g) : undefined, mapCols)
    let cells = split()
    if (isPortrait(g)) cells = split(hud.portraitMapCols(grid, cells.sidebar.h * g.ch))
    hud.layout(grid, cells, cells.clear, { stats: false, sidebar: false, messages: false })
    return { map: Number.parseFloat(priv.minimapCanvas.style.width), column: cells.sidebar.w * g.cw, top: cells.sidebar.y, cw: g.cw }
  }

  it('is the same size whichever way the phone is held, the buttons showing or not', () => {
    const upright = phoneMap(390, 844, true)
    expect(upright.map).toBe(225)
    expect(phoneMap(390, 844, false).map).toBe(225)
    expect(phoneMap(844, 390, true).map).toBe(225)
    expect(phoneMap(844, 390, false).map).toBe(225)
  })

  it('upright, the map stands under the stats strip in a column as wide as it, on every phone at 15px tiles or more', () => {
    for (const w of [360, 375, 390, 412, 430]) {
      const p = phoneMap(w, 844, true)
      expect(p.top).toBe(STRIP_ROWS)
      expect(p.column).toBeGreaterThanOrEqual(p.map)
      expect(p.column - p.map).toBeLessThan(p.cw)
      expect(p.map).toBeGreaterThanOrEqual(15 * MINIMAP_CELL_LEAST_PHONE)
    }
  })
})
