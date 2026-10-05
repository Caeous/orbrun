import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { TOUCH_ANCHORS, TOUCH_CELLS, barLabels, NO_ACTION, touchLabels, touchShot, type BindingLabel, type TouchCell, type TouchLabel } from '../src/bindings'
import { TOUCH_GLYPHS } from '../src/touch-glyphs'
import { PHONE_COLS, PHONE_ROWS, fitPx } from '../src/grid/host'
import type { Context, MenuContext } from '../src/context'
import { STAT_WIDTH, TOUCH_SIDE_PX, fitGrid, gameSplit, isPortrait, levelMapCanvas, levelMapSplit, touchBeside, touchColumn } from '../src/grid/console'
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

const stairs = ctx({ under: { kind: 'feature', feature: { type: 'stairs', dir: 'down' }, label: 'stairs' } })
const menu = (over: Partial<MenuContext>, tag = 'pickup'): Context =>
  ctx({ mode: 'menu', menu: { menu: { tag, items: [], flags: 0 }, hoverable: [], ...over } as unknown as MenuContext })

/** the touch bar as the user draws it: what `pick` says of the button in each cell, '·' for none; a button two cells wide is in both */
function drawn(c: Context, pick: (l: TouchLabel) => string = (l) => l.button, labels: readonly BindingLabel[] = barLabels(c), panel = false): string[][] {
  const by = new Map<TouchCell, TouchLabel>()
  for (const l of touchLabels(labels, c, panel)) {
    const row: readonly TouchCell[] = TOUCH_CELLS.find((r) => (r as readonly TouchCell[]).includes(l.cell))!
    for (let k = 0; k < (l.span ?? 1); k++) by.set(row[row.indexOf(l.cell) + k], l)
  }
  return TOUCH_CELLS.map((row) => row.map((cell) => (by.has(cell) ? pick(by.get(cell)!) : '·')))
}
const words = (c: Context) => drawn(c, (l) => l.label)
const cellOf = (c: Context, button: string) => touchLabels(barLabels(c), c).find((l) => l.button === button)?.cell

describe('the touch bar: every screen one keypad', () => {
  it('Esc and the verb in the bottom corners, the arrows an upturned T: the anchors, on every screen; Examine in the middle of the top where something examines', () => {
    expect(TOUCH_CELLS[2][0]).toBe('esc')
    expect([TOUCH_CELLS[1][2], ...TOUCH_CELLS[2].slice(1, 4)]).toEqual(['up', 'left', 'down', 'right'])
    expect([TOUCH_CELLS[0][2], TOUCH_CELLS[2][4]]).toEqual(['examine', 'select'])
    expect(Object.keys(TOUCH_ANCHORS).sort()).toEqual(['down', 'esc', 'left', 'right', 'select', 'up'])
  })
  const screens: [string, Context][] = [
    ['the map', ctx({})],
    ['stairs underfoot', stairs],
    ['a --more--', ctx({ mode: 'more', moreText: '--more--' })],
    ['an aim', ctx({ mode: 'targeting', hostilesInView: 2, aimQuiver: true })],
    ['look mode', ctx({ mode: 'targeting', examining: { label: 'goblin' } as Context['examining'], monstersInView: 2 })],
    ['the level map', ctx({ mode: 'levelmap' })],
    ['the level map on you', ctx({ mode: 'levelmap', mapCursorHome: true })],
    ['a popup', ctx({ mode: 'popup', pageable: true })],
    ['a yes/no', ctx({ mode: 'yesno' })],
    ['typing', ctx({ mode: 'text' })],
    ['a spectator', ctx({ mode: 'spectating' })],
    ['a multiselect menu', menu({ multiselect: true, anyMarked: true })],
    ['a menu with nothing marked', menu({ multiselect: true, anyMarked: false })],
    ['the pack', ctx({ ...menu({ sections: true }, 'inventory'), pageable: true })],
    ['the shop', menu({ shop: { canBuy: true, anyMarked: true, anyListed: false, mode: 'buy' } } as unknown as Partial<MenuContext>, 'shop')],
  ]
  for (const [name, c] of screens) {
    it(name + ': one button a cell, and Esc and the arrows where the finger knows them', () => {
      const labels = touchLabels(barLabels(c), c)
      const flat = drawn(c).flat().filter((b) => b !== '·')
      // a button two cells wide is the one button
      expect(new Set(labels.map((l) => l.cell)).size).toBe(labels.length)
      expect(flat.length).toBe(labels.reduce((n, l) => n + (l.span ?? 1), 0))
      const anchors: Record<string, TouchCell> = { B: 'esc', DU: 'up', DL: 'left', DD: 'down', DR: 'right' }
      for (const l of labels) if (anchors[l.button]) expect(l.cell).toBe(anchors[l.button])
      expect(labels.some((l) => l.label === NO_ACTION)).toBe(false)
    })
  }
})

describe('the screens drawn cell by cell', () => {
  it('the map, as the user drew it: Wait over Explore, the shot over Fight, Spells and Gear over the verb', () => {
    expect(drawn(stairs)).toEqual([
      ['·', 'LB', 'L3', 'RB', 'X'],
      ['·', 'LT', 'DU', 'RT', 'Y'],
      ['B', 'DL', 'DD', 'DR', 'A'],
    ])
    expect(words(stairs)).toEqual([
      ['·', 'Wait', 'Examine', 'Fire', 'Spells'],
      ['·', 'Explore', '↑', 'Fight', 'Gear'],
      ['Esc', '←', '↓', '→', 'Descend'],
    ])
    // a finger holds as a thumb does: Wait, hold for Rest
    expect(touchLabels(barLabels(stairs), stairs).find((l) => l.button === 'LB')?.hold).toBe('Rest')
  })
  it('on the map with nothing to act on, the verb\'s cell is left to its anchor; Start, Select and R3 have none (the stats pane, the minimap, a hold on the view)', () => {
    const labels = touchLabels(barLabels(ctx({})), ctx({}))
    expect(drawn(ctx({}))[2][4]).toBe('·')
    for (const b of ['A', 'START', 'SELECT', 'R3']) expect(labels.some((l) => l.button === b)).toBe(false)
  })
  it('an aim keeps the map\'s shape: Fire stands in the shot\'s cell, so the shot tapped twice is f f, and in Select\'s', () => {
    const aim = ctx({ mode: 'targeting', hostilesInView: 2, aimQuiver: true, readiedAction: 'Throw: 23 darts', readiedTile: 7 })
    expect(drawn(aim)).toEqual([
      ['·', '·', 'X', 'RB', '·'],
      ['·', 'LB', 'DU', 'Y', '·'],
      ['B', 'DL', 'DD', 'DR', 'A'],
    ])
    expect(cellOf(aim, 'RB')).toBe(cellOf(ctx({}), 'RB'))
    // the darts drawn as on the map's button, under the aim's own word
    expect(touchLabels(barLabels(aim), aim).find((l) => l.button === 'RB')).toMatchObject({ label: 'Fire', item: 7, count: 23 })
    // a spell's aim has no shot to draw, nor one to cycle
    const spell = ctx({ mode: 'targeting', hostilesInView: 1, readiedAction: 'Throw: 23 darts', readiedTile: 7 })
    expect(drawn(spell)[1]).toEqual(['·', '·', 'DU', '·', '·'])
    expect(touchLabels(barLabels(spell), spell).find((l) => l.button === 'RB')?.item).toBeUndefined()
  })
  it('look mode: Examine, tapped again, describes what the cursor rests on; travel there is the verb; the next item and monster flank the up arrow', () => {
    const look = ctx({ mode: 'targeting', examining: { label: 'goblin' } as Context['examining'], monstersInView: 2 })
    expect(drawn(look)).toEqual([
      ['·', '·', 'A', '·', '·'],
      ['·', 'RT', 'DU', 'RB', '·'],
      ['B', 'DL', 'DD', 'DR', 'X'],
    ])
    expect(cellOf(look, 'A')).toBe(cellOf(ctx({}), 'L3'))
  })
  it('the level map, as the user drew it: zoom down the left, the stairs down the right, the search and travel at the edge', () => {
    const map = ctx({ mode: 'levelmap' })
    expect(drawn(map)).toEqual([
      ['·', 'RT', 'X', 'LB', 'L3'],
      ['·', 'LT', 'DU', 'RB', 'Y'],
      ['B', 'DL', 'DD', 'DR', 'A'],
    ])
    expect(words(map)[0].slice(0, 4)).toEqual(['·', 'Zoom in', 'Describe', 'Up stairs'])
    expect(words(map)[2][4]).toBe('Travel here')
    expect(words(map)[1]).toEqual(['·', 'Zoom out', '↑', 'Down stairs', 'Find you'])
    // on you there is nowhere to travel to here, and Y travels further
    const home = ctx({ mode: 'levelmap', mapCursorHome: true })
    expect(drawn(home)[2][4]).toBe('·')
    expect(words(home)[1][4]).toBe('Travel to…')
  })
  it('what goes on by itself, turn after turn, is marked: explore, fight and travel', () => {
    const auto = (c: Context) => touchLabels(barLabels(c), c).filter((l) => l.auto).map((l) => l.button).sort()
    expect(auto(stairs)).toEqual(['LT', 'RT'])
    expect(auto(ctx({ mode: 'levelmap' }))).toEqual(['A'])
    expect(auto(ctx({ mode: 'levelmap', mapCursorHome: true }))).toEqual(['Y'])
    expect(auto(ctx({ mode: 'targeting', examining: { label: 'goblin' } as Context['examining'] }))).toEqual(['X'])
    expect(auto(ctx({ mode: 'targeting', hostilesInView: 2 }))).toEqual([])
  })
})

describe('a screen with no layout of its own keeps its few buttons together', () => {
  it('a --more--: Continue in the verb\'s cell, Skip (Esc) in Esc\'s, and nothing else', () => {
    const c = ctx({ mode: 'more', moreText: '--more--' })
    expect(words(c)).toEqual([
      ['·', '·', '·', '·', '·'],
      ['·', '·', '·', '·', '·'],
      ['Esc', '·', '·', '·', 'Continue'],
    ])
  })
  it('a yes/no: Yes in the verb\'s cell, No (Esc) in Esc\'s, Always under Yes', () => {
    const c = ctx({ mode: 'yesno', prompt: { text: 'Really?', yesno: true, options: [{ hotkey: 'Y', label: 'Yes' }, { hotkey: 'N', label: 'No' }, { hotkey: 'A', label: 'Always' }] } as Context['prompt'] })
    expect(words(c)).toEqual([
      ['·', '·', '·', '·', '·'],
      ['·', '·', '·', '·', 'Always'],
      ['Esc', '·', '·', '·', 'Yes'],
    ])
  })
  it('a multiselect menu: A marks the lit row, accepting stands under it, then the rest down the edge', () => {
    expect(drawn(menu({ multiselect: true, anyMarked: true }))).toEqual([
      ['·', '·', 'X', '·', 'R3'],
      ['·', 'LT', 'DU', '·', 'START'],
      ['B', 'DL', 'DD', 'DR', 'A'],
    ])
  })
  it('a button that comes and goes keeps its cell while away: nothing else moves', () => {
    const shop = (s: object) => menu({ shop: { canBuy: true, anyMarked: false, anyListed: false, mode: 'buy', sortOrder: 'type', ...s } } as unknown as Partial<MenuContext>, 'shop')
    const full = drawn(shop({ anyMarked: true }))
    expect(full).toEqual([
      ['·', 'R3', '·', '·', 'Y'],
      ['·', 'LT', 'DU', 'X', 'START'],
      ['B', 'DL', 'DD', 'DR', 'A'],
    ])
    for (const s of [{}, { anyListed: true }, { mode: 'examine' }]) {
      drawn(shop(s)).forEach((row, r) => row.forEach((b, c) => expect([full[r][c], '·']).toContain(b)))
    }
    // a menu's accept, before anything is marked
    expect(drawn(menu({ multiselect: true, anyMarked: false }))).toEqual([
      ['·', '·', 'X', '·', 'R3'],
      ['·', 'LT', 'DU', '·', '·'],
      ['B', 'DL', 'DD', 'DR', 'A'],
    ])
  })
  it('a menu’s more-line switches: a button each along the top row, in place of the buttons that sent it', () => {
    // as the overlays hand them over (Overlays.menuSwitches): the caption as the footer prints it, and the words
    const sw = (key: string, word: string) => ({ key, label: `[${key}] ${word}`, word })
    const use = { ...menu({}, 'use_item'), switches: [sw('!', 'read|quaff|evoke'), sw('?', 'describe selected')] }
    expect(drawn(use)[0]).toEqual(['key:!', 'key:?', 'X', '·', '·'])
    expect(drawn(use)[2][4]).toBe('A')
    // the bracketed key is the picture, the words alone the caption
    expect(drawn(use, (l) => l.keycap ?? l.glyph ?? l.icon ?? '·')[0].slice(0, 2)).toEqual(['!', '?'])
    expect(words(use)[0].slice(0, 2)).toEqual(['read|quaff|evoke', 'describe selected'])
    // the shop's flip and sort were X and R3: the footer's own switches stand for them, Esc and Enter stay the anchors'
    const shop = { ...menu({ shop: { canBuy: true, anyMarked: true, anyListed: false, mode: 'buy', sortOrder: 'type' } } as unknown as Partial<MenuContext>, 'shop'), switches: [sw('Esc', 'exit'), sw('!', 'buy|examine items'), sw('/', 'sort (type)'), sw('Enter', 'buy marked items')] }
    expect(drawn(shop)).toEqual([
      ['key:!', 'key:/', '·', '·', 'Y'],
      ['·', 'LT', 'DU', '·', 'START'],
      ['B', 'DL', 'DD', 'DR', 'A'],
    ])
    expect(touchLabels(barLabels(shop), shop).find((l) => l.button === 'key:/')?.action).toEqual({ kind: 'keys', label: 'sort (type)', seq: [{ text: '/' }] })
    // a named key in whatever case the menu prints it (the wear menu's `[tab]`) sends its keycode
    const wear = { ...menu({}, 'use_item'), switches: [sw('?', 'describe selected'), sw('!', 'equip|wield|wear'), sw('tab', 'equip|unequip')] }
    expect(drawn(wear)[0]).toEqual(['key:?', 'key:!', 'X', 'key:tab', '·'])
    expect(touchLabels(barLabels(wear), wear).find((l) => l.button === 'key:tab')?.action).toEqual({ kind: 'keys', label: 'equip|unequip', seq: [{ key: 9 }] })
    // a trailing full stop is the sentence's, not the button's
    expect(words({ ...menu({}, 'ability'), switches: [sw('?', 'toggle between ability selection and description.')] })[0][0]).toBe('toggle between ability selection and description')
  })
  it('a describe popup’s verbs: a button each, all five along the top row where nothing examines, in place of X’s first verb', () => {
    // as the overlays hand them over (Overlays.popupSwitches): the caption as the actions line prints it, and the words
    const verbs = [['u', '(u)nwield', 'unwield'], ['d', '(d)rop', 'drop'], ['=', '(=)adjust', 'adjust'], ['s', '(s)kill target', 'skill target'], ['i', '(i)nscribe', 'inscribe']].map(([key, label, word]) => ({ key, label, word }))
    const c = ctx({ mode: 'popup', popupActions: verbs.map(({ key, label }) => ({ key, label })), switches: verbs, focus: { label: '(u)nwield', index: 0 } as Context['focus'] })
    expect(barLabels(c).some((l) => l.button === 'X')).toBe(true)
    const cells = drawn(c)
    expect(cells[0]).toEqual(['key:u', 'key:d', 'key:=', 'key:s', 'key:i'])
    expect(cells[2][4]).toBe('A')
    expect(cells.flat()).not.toContain('X')
    // the captions keep the key as printed, so each reads as one of the popup's options
    expect(drawn(c, (l) => l.label)[0]).toEqual(['(u)nwield', '(d)rop', '(=)adjust', '(s)kill target', '(i)nscribe'])
    // crawl's art where it has the verb, ours where not, the item for what uses it (and the pack's art without one)
    expect(drawn(c, (l) => l.glyph ?? l.icon ?? '·')[0]).toEqual(['CMD_DISPLAY_INVENTORY', 'CMD_DROP', 'cycle', 'target', 'inscribe'])
    const rapier = [{ t: 7, tex: 1 }]
    expect(touchLabels(barLabels(c), { ...c, switches: verbs.map((v) => ({ ...v, item: rapier })) }).find((l) => l.button === 'key:u')?.item).toEqual(rapier)
    // a word we know nothing of keeps its key, on a key cap
    expect(touchLabels(barLabels(c), { ...c, switches: [{ key: 'z', label: '(z)orble', word: 'zorble' }] }).find((l) => l.button === 'key:z')?.keycap).toBe('z')
  })
  it('more switches than the top row holds: the next over Esc', () => {
    const sw = (key: string, word: string) => ({ key, label: `[${key}] ${word}`, word })
    // the skills screen's six
    const skills = { ...ctx({ mode: 'menu', menu: { menu: { tag: 'skills', type: 'crt', items: [], flags: 0 }, hoverable: [] } as unknown as MenuContext }), switches: [sw('?', 'Help'), sw('=', 'set a skill target'), sw('/', 'auto|manual mode'), sw('*', 'useful|all skills'), sw('_', 'enhanced|base level'), sw('!', 'training|cost|targets')] }
    const cells = drawn(skills)
    expect(cells[0]).toEqual(['key:?', 'key:=', 'key:/', 'key:*', 'key:_'])
    expect(cells[1][0]).toBe('key:!')
  })
  it('the pack: describing the lit row is Examine; the bumpers that turn its pages are off, a finger taps the tabs', () => {
    const pack = ctx({ ...menu({ sections: true }, 'inventory'), pageable: true })
    expect(barLabels(pack).some((l) => l.button === 'LB' || l.button === 'RB')).toBe(true)
    expect(drawn(pack)[0]).toEqual(['·', '·', 'X', '·', '·'])
    expect(drawn(pack)[2][4]).toBe('A')
    expect(drawn(pack).flat()).not.toContain('LB')
  })
  it('a keyboard: Shift and Space either side of Examine, Done under the key, Backspace under that; one Done and one Cancel', () => {
    expect(words(ctx({ mode: 'text' }))).toEqual([
      ['·', 'Shift', '·', 'Space', 'Backspace'],
      ['·', '·', '↑', '·', 'Done'],
      ['Esc', '←', '↓', '→', 'Type'],
    ])
  })
  it('the bumpers stand nowhere else: menus, tabs and popups turn by a tap', () => {
    for (const c of [menu({ sections: true } as Partial<MenuContext>, 'inventory'), menu({ pack: { next: 1 } } as unknown as Partial<MenuContext>, 'inventory'), menu({ actions: true } as unknown as Partial<MenuContext>, 'inventory'), ctx({ mode: 'popup', pageable: true })]) {
      expect(touchLabels(barLabels({ ...c, pageable: true }), { ...c, pageable: true }).some((l) => l.button === 'LB' || l.button === 'RB')).toBe(false)
    }
  })
  it('a spectator: Esc opens the Orbrun menu, Stop watching on it, the one way out on a phone', () => {
    const c = ctx({ mode: 'spectating' })
    const labels = touchLabels(barLabels(c), c)
    expect(labels.find((l) => l.cell === 'esc')?.action).toEqual({ kind: 'ui', op: 'system' })
    // Start opens the same: once is enough
    expect(labels.filter((l) => l.action.kind === 'ui' && l.action.op === 'system')).toHaveLength(1)
  })
  it('a panel of ours over the map is no map: its own buttons by the same rule, Esc in Esc\'s cell, its tabs a tap', () => {
    const lab = (button: BindingLabel['button'], label: string): BindingLabel => ({ button, label, action: { kind: 'keys', label, seq: [] }, contextual: false })
    const panel = [lab('A', 'Save'), lab('B', 'Back'), lab('RB', 'Next tab'), lab('START', 'Close')]
    expect(drawn(ctx({}), (l) => l.label, panel, true)).toEqual([
      ['·', '·', '·', '·', '·'],
      ['·', '·', '↑', '·', 'Close'],
      ['Esc', '←', '↓', '→', 'Save'],
    ])
  })
})

describe('every touch button has a picture: crawl’s art where it has one, a glyph of ours where not', () => {
  const icons = (c: Context, panel = false) => Object.fromEntries(touchLabels(barLabels(c), c, panel).map((l) => [l.button, l.icon ?? l.glyph]))
  // the atlases' names, as the server's tileinfo files list them
  const tileinfo = (atlas: string) => readFileSync(new URL(`../../../packages/scene-webtiles/test/fixtures/gamedata/acd3d60e20f899c1c8a546953d6ffa0f6c7fe0c8/tileinfo-${atlas}.js`, import.meta.url), 'utf8')
  const atlases = [tileinfo('gui'), tileinfo('main')]
  const inAtlas = (name: string) => atlases.some((src) => src.includes('exports.' + name + ' = '))
  const lab = (button: BindingLabel['button'], label: string, action: BindingLabel['action'] = { kind: 'keys', label, seq: [] }): BindingLabel => ({ button, label, action, contextual: false })
  const screens: [string, Context, boolean?][] = [
    ['the map', stairs],
    ['the map, nothing quivered', ctx({})],
    ['a --more--', ctx({ mode: 'more', moreText: '--more--' })],
    ['an aim', ctx({ mode: 'targeting', hostilesInView: 2, aimQuiver: true })],
    ['a spell\'s aim', ctx({ mode: 'targeting', hostilesInView: 2 })],
    ['look mode', ctx({ mode: 'targeting', examining: { label: 'goblin' } as Context['examining'], monstersInView: 2 })],
    ['the level map', ctx({ mode: 'levelmap' })],
    ['the level map on you', ctx({ mode: 'levelmap', mapCursorHome: true })],
    ['a popup', ctx({ mode: 'popup', popupActions: [{ key: '!', label: 'Description | Status | Quote' }] })],
    ['a popup with a verb', ctx({ mode: 'popup', popupActions: [{ key: 'u', label: '(u)nwield' }] })],
    ['a yes/no', ctx({ mode: 'yesno', prompt: { text: 'Really?', yesno: true, options: [{ hotkey: 'Y', label: 'Yes' }, { hotkey: 'N', label: 'No' }, { hotkey: 'A', label: 'Always' }] } as Context['prompt'] })],
    ['a prompt the parser made nothing of', ctx({ mode: 'prompt' })],
    ['the skills', ctx({ mode: 'crt', focus: { label: 'Fighting', altLabel: 'Set target' } as Context['focus'] })],
    ['new game', ctx({ mode: 'newgame' })],
    ['typing', ctx({ mode: 'text' })],
    ['a number', ctx({ mode: 'text', textTag: 'travel_depth' })],
    ['a spectator', ctx({ mode: 'spectating' })],
    ['a macro', ctx({ mode: 'macro' })],
    ['a multiselect menu', menu({ multiselect: true, anyMarked: true, filter: true })],
    ['the pack', ctx({ ...menu({ sections: true, helpKey: '_' }, 'inventory'), pageable: true })],
    ['the pack turning pages', ctx({ ...menu({ sections: true, pack: { next: 'Potions', prev: 'Scrolls' } } as unknown as Partial<MenuContext>, 'inventory'), pageable: true })],
    ['X\'s actions', menu({ actions: { next: 'Abilities', prev: 'Quiver' } } as unknown as Partial<MenuContext>, 'spell')],
    ['the shop', menu({ shop: { canBuy: true, anyMarked: true, anyListed: false, mode: 'buy', sortOrder: 'type' } } as unknown as Partial<MenuContext>, 'shop')],
    ['the shop, examining', menu({ shop: { canBuy: true, anyMarked: false, anyListed: false, mode: 'examine' } } as unknown as Partial<MenuContext>, 'shop')],
  ]
  for (const [name, c] of screens) {
    it(name + ': a picture on every button but the arrows, which the bar draws, and one this version of crawl has', () => {
      for (const l of touchLabels(barLabels(c), c)) {
        if (l.button.startsWith('D')) continue
        expect(l.icon ?? l.glyph ?? l.item, `${l.button} (${l.label})`).toBeDefined()
        if (l.icon) expect(inAtlas(l.icon), l.icon).toBe(true)
        if (l.glyph) expect(TOUCH_GLYPHS).toContain(l.glyph)
      }
    })
  }
  it('a panel of ours: its buttons have theirs too, Esc its cross', () => {
    const panel = [lab('A', 'select', { kind: 'focus', op: 'select' }), lab('Y', 'Swap weapons', { kind: 'keys', label: 'Swap weapons', seq: [{ key: 27 }, { text: "'" }] }), lab('B', 'Back')]
    const labels = touchLabels(panel, ctx({}), true)
    expect(Object.fromEntries(labels.filter((l) => !l.button.startsWith('D')).map((l) => [l.button, l.icon ?? l.glyph]))).toEqual({ A: 'PROMPT_YES', Y: 'swap', B: 'PROMPT_NO' })
  })
  it('B is Esc on every screen, whatever the screen calls it, under crawl’s cross', () => {
    for (const [, c] of screens) {
      const b = touchLabels(barLabels(c), c).find((l) => l.button === 'B')
      if (b) expect([b.label, b.icon], c.mode).toEqual(['Esc', 'PROMPT_NO'])
    }
    expect(TOUCH_ANCHORS.esc).toEqual({ label: 'Esc', icon: 'PROMPT_NO' })
  })
  it('on the map: explore, fight, wait, examine, the tab X and Y open on, and the verb crawl’s tick', () => {
    expect(icons(stairs)).toMatchObject({ A: 'PROMPT_YES', LT: 'CMD_EXPLORE', RT: 'CMD_AUTOFIGHT', LB: 'CMD_WAIT', L3: 'CMD_LOOKUP_HELP', X: 'CMD_CAST_SPELL', Y: 'CMD_DISPLAY_INVENTORY' })
  })
  it('the shot on RB wears what is quivered: an item by its verb and count, a spell by its name, the quiver’s own picture when nothing is', () => {
    const c = ctx({ readiedAction: 'Drink: 3 potions of curing', readiedTile: [1234] })
    expect(touchLabels(barLabels(c), c).find((l) => l.button === 'RB')).toMatchObject({ label: 'Drink', item: [1234], count: 3 })
    expect(touchShot('Throw: a boomerang', 7)).toEqual({ label: 'Throw', item: 7 })
    expect(touchShot('Cast: Magic Dart', undefined)).toEqual({ label: 'Magic Dart', icon: 'CMD_CAST_SPELL' })
    expect(touchShot('Fire', undefined)).toEqual({ label: 'Fire' })
    expect(icons(ctx({})).RB).toBe('MI_BOOMERANG')
    // an aim that is no quiver's fires at the cursor's target
    expect(icons(ctx({ mode: 'targeting', hostilesInView: 2 }))).toMatchObject({ RB: 'target', LB: 'cycle', X: 'CMD_LOOKUP_HELP' })
  })
  it('on the level map: the stairs, finding yourself, travel, search and zoom', () => {
    expect(icons(ctx({ mode: 'levelmap', mapCursorHome: true }))).toMatchObject({ LB: 'CMD_MAP_FIND_UPSTAIR', RB: 'CMD_MAP_FIND_DOWNSTAIR', Y: 'CMD_INTERLEVEL_TRAVEL', L3: 'CMD_SEARCH_STASHES', LT: 'zoom-out', RT: 'zoom-in' })
    expect(icons(ctx({ mode: 'levelmap' }))).toMatchObject({ A: 'CMD_MAP_GOTO_TARGET', Y: 'CMD_MAP_FIND_YOU' })
  })
  it('a key that means another thing on another screen wears that screen’s picture', () => {
    // `.` waits on the map and travels in look mode; `*` is the next item there and Random in a new game; Ctrl-F searches from the level map and filters a menu
    expect(icons(ctx({ mode: 'targeting', examining: { label: 'goblin' } as Context['examining'], monstersInView: 2 }))).toMatchObject({ A: 'CMD_LOOKUP_HELP', X: 'CMD_MAP_GOTO_TARGET', RT: 'CMD_MAP_FIND_STASH', RB: 'cycle' })
    expect(icons(ctx({ mode: 'newgame' }))).toMatchObject({ X: 'ERROR', Y: 'STARTUP_HINTS' })
    expect(icons(menu({ multiselect: true, filter: true }))).toMatchObject({ SELECT: 'filter', LT: 'toggle', R3: 'all' })
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

  it('upright, the panes stack: a band across the top with the stats pane left of the minimap, the monster list under the map, messages the whole width', () => {
    expect(isPortrait(phone)).toBe(true)
    const l = gameSplit(phone, 5, undefined, 0, 0, undefined, 10, 20)
    expect(l.band).toEqual({ x: 0, y: 0, w: phone.cols, h: 10 })
    // the stats pane left of the map's columns, a cell's gutter away
    expect(l.stats).toEqual({ x: 0, y: 0, w: phone.cols - 20 - 1, h: 10 })
    // the monster list's column under the map, as wide as it
    expect(l.sidebar).toEqual({ x: phone.cols - 20, y: 10, w: 20, h: l.messages.y - 10 })
    // what no pane covers: under the band, left of the column, above the messages
    expect(l.clear).toEqual({ x: 0, y: 10, w: phone.cols - 20, h: l.messages.y - 10 })
    expect(l.messages.w).toBe(phone.cols)
    // the view runs from under the band to the foot
    expect(l.view).toEqual({ x: 0, y: 10, w: phone.cols, h: phone.rows - 10 })
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
    const l = gameSplit(laptop, 5, undefined, 8)
    expect(l.messages.y + l.messages.h).toBe(laptop.rows - 8)
    expect(l.view.h).toBe(laptop.rows)
  })
  it('upright, the view runs from under the band on under the touch bar', () => {
    const l = gameSplit(phone, 5, undefined, 8, 0, undefined, 10, 20)
    expect(l.messages.y + l.messages.h).toBe(phone.rows - 8)
    expect(l.view).toEqual({ x: 0, y: 10, w: phone.cols, h: phone.rows - 10 })
  })
  it('upright, the level map takes the band too and reaches the messages, the stats pane over its corner', () => {
    const l = gameSplit(phone, 5, undefined, 8, 0, undefined, 10, 20)
    expect(levelMapSplit(phone, l, {})).toEqual({ x: 0, y: 0, w: phone.cols, h: l.messages.y })
  })
  it('the level map grown over the messages runs on under the touch bar, its edges kept above it', () => {
    const l = gameSplit(phone, 5, undefined, 8)
    const map = levelMapSplit(phone, l, { hideMessages: true })
    expect(map.h).toBe(phone.rows - 8)
    expect(levelMapCanvas(l, map, false, phone.rows)).toEqual({ x: 0, y: 0, w: phone.cols, h: phone.rows })
    // with the messages between, the map stops above them, as it was
    const above = levelMapSplit(phone, l, {})
    expect(levelMapCanvas(l, above, false, phone.rows)).toEqual(above)
    // no bar: the official layout
    const wide = gameSplit(laptop, 5)
    expect(levelMapCanvas(wide, levelMapSplit(laptop, wide, { hideMessages: true }), false, laptop.rows)).toEqual({ x: 0, y: 0, w: wide.clear.w, h: laptop.rows })
  })
  it('on its side, the level map runs on under the touch bar\'s column', () => {
    const side = fitGrid(844, 390, 13.2, 17)
    const l = gameSplit(side, 5, undefined, 0, 6)
    const map = levelMapSplit(side, l, { hideMessages: true })
    expect(map.w).toBe(l.clear.w)
    expect(levelMapCanvas(l, map, true, side.rows)).toEqual({ x: 0, y: 0, w: side.cols, h: side.rows })
    expect(levelMapCanvas(l, levelMapSplit(side, l, {}), true, side.rows)).toEqual(levelMapSplit(side, l, {}))
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
