import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { TOUCH_GRID, barLabels, NO_ACTION, touchCell, touchLabels, touchShot } from '../src/bindings'
import { PHONE_COLS, PHONE_ROWS, fitPx } from '../src/grid/host'
import type { Context, MenuContext } from '../src/context'
import { STAT_WIDTH, STRIP_ROWS, TOUCH_SIDE_PX, fitGrid, gameSplit, isPortrait, levelMapCanvas, levelMapSplit, touchBeside, touchColumn } from '../src/grid/console'
import { GamepadInput, isPadActivity, type PadEvent } from '../src/gamepad'

const ctx = (over: Partial<Context>): Context => ({
  mode: 'command',
  layer: 'micro',
  ahead: { kind: 'none', label: '' },
  under: { kind: 'none', label: '' },
  hostilesInView: 0,
  monstersInView: 0,
  ...over,
})

describe('the touch bar has every button the screen has, by its word', () => {
  it('on the map: the commands, the arrows, Escape and L3, without Start and Select (the stats pane and the minimap open theirs), a do-nothing A, or R3 (a hold on the view is R3)', () => {
    const c = ctx({})
    const labels = touchLabels(barLabels(c), c)
    const buttons = labels.map((l) => l.button)
    expect(buttons).toEqual(expect.arrayContaining(['X', 'Y', 'LB', 'RB', 'LT', 'RT', 'DU', 'DL', 'DD', 'DR', 'B', 'L3']))
    for (const b of ['START', 'SELECT', 'R3']) expect(buttons).not.toContain(b)
    expect(labels.some((l) => l.label === NO_ACTION)).toBe(false)
    expect(labels.find((l) => l.button === 'LT')?.label).toBe('Explore')
    // a finger holds as a thumb does: Wait, hold for Rest
    expect(labels.find((l) => l.button === 'LB')?.hold).toBeTruthy()
  })
  it('stairs underfoot put A on the bar, named for them', () => {
    const c = ctx({ under: { kind: 'feature', feature: { type: 'stairs', dir: 'down' }, label: 'stairs' } })
    expect(touchLabels(barLabels(c), c).find((l) => l.button === 'A')?.label).toBe('Descend')
  })
  it('B stands on every screen: a panel of ours up over the map, and the map itself', () => {
    const c = ctx({})
    const back = { button: 'B' as const, label: 'Back', action: { kind: 'keys' as const, label: 'Back', seq: [] }, contextual: false }
    expect(touchLabels([back], c, true).find((l) => l.cell === 'B')?.label).toBe('Back')
    expect(touchLabels([back], c).find((l) => l.cell === 'B')?.label).toBe('Back')
  })
  it('Start and Select come back off the map: on a panel of ours over it, and on the level map', () => {
    const start = { button: 'START' as const, label: 'Close', action: { kind: 'keys' as const, label: 'Close', seq: [] }, contextual: false }
    expect(touchLabels([start], ctx({}), true).some((l) => l.cell === 'START')).toBe(true)
    const c = ctx({ mode: 'levelmap' })
    expect(touchLabels(barLabels(c), c).map((l) => l.button)).toEqual(expect.arrayContaining(['SELECT', 'B']))
  })
  it('a spectator has B and Start, the Orbrun menu with Stop watching on it: the one way out on a phone', () => {
    const c = ctx({ mode: 'spectating' })
    const labels = touchLabels(barLabels(c), c)
    for (const b of ['B', 'START']) expect(labels.find((l) => l.button === b)?.action).toEqual({ kind: 'ui', op: 'system' })
  })
  it('a --more-- has its own A, and no arrows', () => {
    const c = ctx({ mode: 'more' })
    const labels = touchLabels(barLabels(c), c)
    expect(labels.find((l) => l.button === 'A')?.label).toBe('--more--')
    expect(labels.some((l) => l.cell.startsWith('D'))).toBe(false)
  })
})

describe('the touch bar wears crawl’s command icons where a button always means one command', () => {
  const icons = (c: Context, panel = false) => Object.fromEntries(touchLabels(barLabels(c), c, panel).map((l) => [l.cell, l.icon]))
  // the GUI atlas's names, as the server's tileinfo-gui.js lists them
  const gui = readFileSync(new URL('../../../packages/scene-webtiles/test/fixtures/gamedata/acd3d60e20f899c1c8a546953d6ffa0f6c7fe0c8/tileinfo-gui.js', import.meta.url), 'utf8')
  const inAtlas = (name: string) => gui.includes('exports.' + name + ' = ')

  it('on the map: explore, fight, wait, examine, and the tab X and Y open on', () => {
    expect(icons(ctx({}))).toMatchObject({ LT: 'CMD_EXPLORE', RT: 'CMD_AUTOFIGHT', LB: 'CMD_WAIT', L3: 'CMD_LOOKUP_HELP', X: 'CMD_CAST_SPELL', Y: 'CMD_DISPLAY_INVENTORY' })
  })
  it('on the map, what changes with the situation has none: A, and the arrows (drawn by the bar itself)', () => {
    const c = ctx({ under: { kind: 'feature', feature: { type: 'stairs', dir: 'down' }, label: 'stairs' } })
    for (const b of ['A', 'B', 'DU']) expect(icons(c)[b]).toBeUndefined()
  })
  it('the shot on RB wears what is quivered: an item by its verb and count, a spell by its name', () => {
    const c = ctx({ readiedAction: 'Drink: 3 potions of curing', readiedTile: [1234] })
    expect(touchLabels(barLabels(c), c).find((l) => l.cell === 'RB')).toMatchObject({ label: 'Drink', item: [1234], count: 3 })
    expect(touchShot('Throw: a boomerang', 7)).toEqual({ label: 'Throw', item: 7 })
    expect(touchShot('Cast: Magic Dart', undefined)).toEqual({ label: 'Magic Dart', icon: 'CMD_CAST_SPELL' })
    expect(touchShot('Fire', undefined)).toEqual({ label: 'Fire' })
  })
  it('on the level map: the stairs, finding yourself, travel, search and the overview', () => {
    expect(icons(ctx({ mode: 'levelmap', mapCursorHome: true }))).toMatchObject({ LB: 'CMD_MAP_FIND_UPSTAIR', RB: 'CMD_MAP_FIND_DOWNSTAIR', Y: 'CMD_INTERLEVEL_TRAVEL', L3: 'CMD_SEARCH_STASHES' })
    expect(icons(ctx({ mode: 'levelmap' }))).toMatchObject({ A: 'CMD_MAP_GOTO_TARGET', Y: 'CMD_MAP_FIND_YOU' })
  })
  it('menus, prompts and panels of ours have none', () => {
    for (const c of [ctx({ mode: 'more' }), ctx({ mode: 'yesno' }), ctx({ mode: 'targeting', hostilesInView: 1 })]) expect(Object.values(icons(c)).filter(Boolean)).toEqual([])
    expect(Object.values(icons(ctx({}), true)).filter(Boolean)).toEqual([])
  })
  it('every icon is one crawl’s GUI atlas has', () => {
    const all = [ctx({}), ctx({ mode: 'levelmap' }), ctx({ mode: 'levelmap', mapCursorHome: true })].flatMap((c) => Object.values(icons(c)).filter((x): x is string => !!x))
    for (const name of all) expect(inAtlas(name), name).toBe(true)
  })
})

describe('every touch button has one cell, on every screen', () => {
  const menu = (over: Partial<MenuContext>): Context => ctx({ mode: 'menu', menu: { menu: { tag: 'pickup', items: [], flags: 0 }, hoverable: [], multiselect: true, anyMarked: true, ...over } as unknown as MenuContext })
  const screens: [string, Context][] = [
    ['the map', ctx({})],
    ['stairs underfoot', ctx({ under: { kind: 'feature', feature: { type: 'stairs', dir: 'down' }, label: 'stairs' } })],
    ['a --more--', ctx({ mode: 'more' })],
    ['an aim', ctx({ mode: 'targeting', hostilesInView: 2 })],
    ['look mode', ctx({ mode: 'targeting', examining: { label: 'goblin' } as Context['examining'] })],
    ['the level map', ctx({ mode: 'levelmap' })],
    ['a popup', ctx({ mode: 'popup' })],
    ['a yes/no', ctx({ mode: 'yesno' })],
    ['typing', ctx({ mode: 'text' })],
    ['a multiselect menu', menu({})],
    ['a menu with nothing marked', menu({ anyMarked: false })],
  ]
  for (const [name, c] of screens) {
    it(name + ': each button in its own cell (TOUCH_GRID), no two in one', () => {
      const labels = touchLabels(barLabels(c), c)
      const cells = labels.map((l) => l.cell)
      expect(new Set(cells).size).toBe(cells.length)
      for (const l of labels) {
        expect(touchCell(l.cell)).not.toBeNull()
        expect(l.cell).toBe(l.button)
      }
    })
  }
  it('in a menu where Start takes what is marked, Start keeps its own cell, and A its own', () => {
    const labels = touchLabels(barLabels(menu({})), menu({}))
    expect(labels.find((l) => l.cell === 'START')?.button).toBe('START')
    expect(labels.find((l) => l.cell === 'A')?.button).toBe('A')
  })
  it('the top row reads A, B, LB, RB after Start; Start, Select and L3 down the left', () => {
    expect(TOUCH_GRID[0]).toEqual(['START', 'A', 'B', 'LB', 'RB'])
    expect(['START', 'SELECT', 'L3'].map((b) => touchCell(b as never))).toEqual([{ row: 0, col: 0 }, { row: 1, col: 0 }, { row: 2, col: 0 }])
  })
  it('the grid is fifteen cells, each button once', () => {
    const all = TOUCH_GRID.flat()
    expect(all).toHaveLength(15)
    expect(new Set(all).size).toBe(15)
  })
})

describe('a finger on the touch bar presses the pad’s button without choosing the pad', () => {
  it('press and release reach the listeners, marked as touch', () => {
    const pad = new GamepadInput()
    const seen: PadEvent[] = []
    pad.on((e) => seen.push(e))
    pad.virtualDown('LB', 0, true)
    expect(pad.isHeld('LB')).toBe(true)
    pad.virtualUp('LB', 500, true)
    expect(seen).toEqual([
      { type: 'press', button: 'LB', t: 0, touch: true },
      { type: 'release', button: 'LB', t: 500, held: 500, touch: true },
    ])
    expect(isPadActivity(seen[0])).toBe(false)
  })
  it('the arrows move the d-pad, marked as touch', () => {
    const pad = new GamepadInput()
    const seen: PadEvent[] = []
    pad.on((e) => seen.push(e))
    pad.virtualDown('DU', 0, true)
    const dir = seen.find((e) => e.type === 'dir')
    expect(dir).toEqual({ type: 'dir', source: 'dpad', dir: 0, touch: true })
    expect(isPadActivity(dir!)).toBe(false)
    pad.virtualUp('DU', 100, true)
    expect(seen.at(-1)).toEqual({ type: 'dir', source: 'dpad', dir: null })
  })
  it('a key standing in for the pad still counts as the pad', () => {
    expect(isPadActivity({ type: 'press', button: 'A', t: 0 })).toBe(true)
  })
})

describe('the layout on a phone', () => {
  // an iPhone 14 held upright, a landscape laptop: 390x844 and 1440x900 css px in 9.6x19 cells
  const phone = { ...fitGrid(390, 844, 9.6, 19), phone: true }
  const laptop = fitGrid(1440, 900, 9.6, 19)

  it('upright, the panes stack: the stats strip across the top, the minimap column under it at the right, messages the whole width', () => {
    expect(isPortrait(phone)).toBe(true)
    const l = gameSplit(phone, 5, undefined, 0, 0, undefined, 20)
    expect(l.stats).toEqual({ x: 0, y: 0, w: phone.cols, h: STRIP_ROWS })
    // the map's column is as wide as it is given (hud.ts portraitMapCols), at the right edge, under the strip
    expect(l.sidebar).toMatchObject({ x: phone.cols - 20, y: STRIP_ROWS, w: 20 })
    expect(l.sidebar.y + l.sidebar.h).toBe(l.messages.y)
    // what no pane covers: under the strip, left of the column, above the messages
    expect(l.clear).toEqual({ x: 0, y: STRIP_ROWS, w: phone.cols - 20, h: l.sidebar.h })
    expect(l.messages.w).toBe(phone.cols)
    expect(l.view).toEqual({ x: 0, y: 0, w: phone.cols, h: phone.rows })
  })
  it('a desktop window of the same shape keeps its panes side by side: the stack is a phone\'s', () => {
    const narrow = fitGrid(390, 844, 9.6, 19)
    expect(isPortrait(narrow)).toBe(false)
    const l = gameSplit(narrow, 5)
    expect(l.stats.w).toBeLessThan(narrow.cols)
    expect(l.sidebar.y).toBe(0)
    expect(l.messages.w).toBe(l.clear.w)
  })
  it('upright, the level map takes the whole width, with no band where the minimap column was', () => {
    const l = gameSplit(phone, 5)
    expect(levelMapSplit(phone, l, {}).w).toBe(phone.cols)
    const wide = gameSplit(laptop, 5)
    expect(levelMapSplit(laptop, wide, {}).w).toBe(wide.clear.w)
  })
  it('the touch bar keeps its rows at the foot: the messages end above them, the view runs on under the buttons', () => {
    const l = gameSplit(phone, 5, undefined, 8)
    expect(l.messages.y + l.messages.h).toBe(phone.rows - 8)
    expect(l.view.h).toBe(phone.rows)
  })
  it('the level map grown over the messages runs on under the touch bar, its edges kept above it', () => {
    const l = gameSplit(phone, 5, undefined, 8)
    const map = levelMapSplit(phone, l, { hideMessages: true })
    expect(map.h).toBe(phone.rows - 8)
    expect(levelMapCanvas(l, map, false)).toEqual({ x: 0, y: 0, w: phone.cols, h: phone.rows })
    // with the messages between, the map stops above them, as it was
    const above = levelMapSplit(phone, l, {})
    expect(levelMapCanvas(l, above, false)).toEqual(above)
    // no bar: the official layout
    const wide = gameSplit(laptop, 5)
    expect(levelMapCanvas(wide, levelMapSplit(laptop, wide, { hideMessages: true }), false)).toEqual({ x: 0, y: 0, w: wide.clear.w, h: laptop.rows })
  })
  it('on its side, the level map runs on under the touch bar\'s column', () => {
    const side = fitGrid(844, 390, 13.2, 17)
    const l = gameSplit(side, 5, undefined, 0, 6)
    const map = levelMapSplit(side, l, { hideMessages: true })
    expect(map.w).toBe(l.clear.w)
    expect(levelMapCanvas(l, map, true)).toEqual({ x: 0, y: 0, w: side.cols, h: side.rows })
    expect(levelMapCanvas(l, levelMapSplit(side, l, {}), true)).toEqual(levelMapSplit(side, l, {}))
  })
  it('on its side, the touch bar stands at the right column\'s foot and the view keeps its height', () => {
    // an iPhone 14 on its side at a phone's text size (host.ts PHONE_COLS)
    const side = fitGrid(844, 390, 13.2, 17)
    expect(touchBeside(side)).toBe(true)
    expect(touchBeside(phone)).toBe(false)
    const l = gameSplit(side, 5, undefined, 0, 6)
    expect(l.view.h).toBe(side.rows)
    expect(l.messages.y + l.messages.h).toBe(side.rows)
    expect(l.sidebar.h).toBe(side.rows - 6)
  })
  it('on its side, the column under the touch bar is wide enough for five buttons a word fits, the stats pane stays its own width', () => {
    // an iPhone 14 on its side at a phone's text size: the sidebar's 42 cells are under 300px there
    const side = fitGrid(844, 390, 6.6, 13)
    expect(STAT_WIDTH * side.cw).toBeLessThan(TOUCH_SIDE_PX)
    const l = gameSplit(side, 5, undefined, 0, 6, touchColumn(side))
    expect(l.sidebar.w * side.cw).toBeGreaterThanOrEqual(TOUCH_SIDE_PX)
    expect(l.stats.w).toBe(STAT_WIDTH)
    expect(l.messages.w).toBe(side.cols - l.sidebar.w)
    // where the sidebar is wide enough already, it is the sidebar
    expect(touchColumn(laptop)).toBe(STAT_WIDTH)
  })
  it('a landscape screen keeps the official layout, foot or none', () => {
    expect(isPortrait(laptop)).toBe(false)
    const l = gameSplit(laptop, 5)
    expect(l.sidebar.w).toBe(42)
    expect(l.messages.y + l.messages.h).toBe(laptop.rows)
    expect(gameSplit(laptop, 5, undefined, 4).messages.y + gameSplit(laptop, 5, undefined, 4).messages.h).toBe(laptop.rows - 4)
  })
})

describe('on a phone the text comes down to a phone-sized console', () => {
  const adv = 0.6
  it('upright, wide enough for the narrow stats pane beside the minimap', () => {
    const px = fitPx(390, 844, adv, 16, PHONE_COLS, PHONE_ROWS)
    expect(px).toBeLessThan(13)
    expect(Math.floor(390 / (px * adv))).toBeGreaterThanOrEqual(PHONE_COLS)
  })
  it('on its side, tall enough for the panes over the touch bar', () => {
    const px = fitPx(844, 390, adv, 16, PHONE_COLS, PHONE_ROWS)
    expect(px).toBeLessThan(13)
    expect(Math.floor(390 / Math.round(px * 1.2))).toBeGreaterThanOrEqual(PHONE_ROWS)
  })
  it('a big screen keeps its size', () => {
    expect(fitPx(1280, 800, adv, 16, PHONE_COLS, PHONE_ROWS)).toBe(16)
  })
})
