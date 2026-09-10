import { describe, it, expect } from 'vitest'
import { MenuFlag, type MenuState } from '@orbrun/webtiles'
import {
  itemSelectable,
  lineDownTarget,
  lineUpTarget,
  menuHasCustomDash,
  menuKeyIntent,
  nextHoverableItem,
  parseMoreSwitches,
  rawArrowKeys,
  relativeHover,
  relativeHoverTarget,
  scrollKeyIntent,
  snapHoverTarget,
  SCROLLER_POPUPS,
  type NavKeyLike,
} from '../src/menu-nav'
import useItem from './fixtures/menus/menu-use_item-1.json'
import pickup from './fixtures/menus/menu-pickup-1.json'
import travel from './fixtures/menus/menu-travel-1.json'
import inventory from './fixtures/menus/menu-inventory-1.json'

/**
 * The official client's menu.js navigation (`next_hoverable_item`, `paging`,
 * `line_up` / `line_down`, `menu_keydown_handler`, `menu_keypress_handler`)
 * and ui-layouts.js `scroller_handle_key`, pinned against menus recorded from
 * crawl.dcss.io (0.35-a0, 2026-09-05) in test/fixtures/menus.
 */

type Fixture = { msgs: Record<string, unknown>[] }
const menuOf = (f: Fixture): MenuState => f.msgs[0] as unknown as MenuState

const key = (k: string, over: Partial<NavKeyLike> = {}): NavKeyLike => ({ key: k, code: '', shiftKey: false, ctrlKey: false, altKey: false, ...over })

describe('item_selectable', () => {
  it('a level-2 row with a hotkey; headers never', () => {
    const m = menuOf(pickup)
    expect(itemSelectable(m, 0)).toBe(false) // "Hand Weapons" header
    expect(itemSelectable(m, 1)).toBe(true) // a - a +0 war axe
    expect(itemSelectable(m, 3)).toBe(false) // "Armour" header
  })
  it('the use_item menu: every level-2 row, hotkey or not (relettering)', () => {
    const m = menuOf(useItem)
    expect(itemSelectable(m, 0)).toBe(false) // "Wands" header
    expect(itemSelectable({ tag: 'use_item', items: [{ text: 'x', level: 2 }] }, 0)).toBe(true)
    expect(itemSelectable({ tag: 'inventory', items: [{ text: 'x', level: 2 }] }, 0)).toBe(false)
  })
})

describe('next_hoverable_item', () => {
  it('skips headers going down and stops at the end without WRAP', () => {
    const m = menuOf(pickup) // no WRAP flag
    expect(m.flags & MenuFlag.WRAP).toBe(0)
    expect(nextHoverableItem(m, false, -1)).toBe(1)
    expect(nextHoverableItem(m, false, 2)).toBe(4) // over the Armour header
    expect(nextHoverableItem({ ...m, last_hovered: 6 }, false, 6)).toBe(-1)
  })
  it('up arrow on no hover does nothing; down from no hover takes the first row under the header', () => {
    const m = menuOf(inventory) // opens with no hover (last_hovered -1)
    expect(m.last_hovered).toBe(-1)
    expect(nextHoverableItem(m, true, -1)).toBe(-1)
    expect(nextHoverableItem(m, false, -1)).toBe(1)
  })
  it('up from the first row stays without WRAP and comes round with it', () => {
    const m = { ...menuOf(pickup), last_hovered: 1 }
    expect(nextHoverableItem(m, true, 1)).toBe(-1)
    const wrap = { ...m, flags: m.flags | MenuFlag.WRAP }
    // the goblin corpse (row 6) prints no hotkey, so the last hoverable row is `c` at 4
    expect(nextHoverableItem(wrap, true, 1)).toBe(4)
    expect(nextHoverableItem(wrap, false, 4)).toBe(1)
  })
  it('start_at_starting_point considers the starting row first', () => {
    const m = menuOf(pickup)
    expect(nextHoverableItem(m, false, 0, true)).toBe(1) // header 0 → first row under it
    expect(nextHoverableItem(m, false, 4, true)).toBe(4)
    expect(nextHoverableItem({ ...m, last_hovered: 6 }, true, 6, true)).toBe(4) // the corpse has no hotkey
    expect(nextHoverableItem(m, true, 6, true)).toBe(-1) // no hover: at most the starting row is tried
  })
})

describe('paging helpers', () => {
  const m = menuOf(pickup) // header, a, b, header, c, header, d
  it('relative hover counts rows in the page, headers skipped, -1 on the last visible row', () => {
    expect(relativeHover({ ...m, last_hovered: -1 }, { first: 0, last: 6 })).toBe(0)
    expect(relativeHover({ ...m, last_hovered: 2 }, { first: 0, last: 6 })).toBe(1) // header 0 skipped
    expect(relativeHover({ ...m, last_hovered: 4 }, { first: 0, last: 6 })).toBe(2)
    expect(relativeHover({ ...m, last_hovered: 6 }, { first: 0, last: 6 })).toBe(-1)
  })
  it('set_relative_hover puts the hover back at that place in the new page', () => {
    expect(relativeHoverTarget(m, { first: 0, last: 6 }, 0)).toBe(1)
    expect(relativeHoverTarget(m, { first: 0, last: 6 }, 1)).toBe(2)
    expect(relativeHoverTarget(m, { first: 3, last: 6 }, 0)).toBe(4)
    expect(relativeHoverTarget(m, { first: 0, last: 6 }, -1)).toBe(-1) // the last row (a corpse) takes no hover, and nothing follows it
    expect(relativeHoverTarget(m, { first: 0, last: 4 }, -1)).toBe(4)
    // clamped to the page
    expect(relativeHoverTarget(m, { first: 0, last: 2 }, 5)).toBe(2)
  })
  it('line_down treats a header and the row under it as one line; line_up is one row', () => {
    expect(lineDownTarget(m, { first: 0, last: 3 })).toBe(2)
    expect(lineDownTarget(m, { first: 1, last: 3 })).toBe(2)
    expect(lineDownTarget(m, { first: 6, last: 6 })).toBe(6)
    expect(lineUpTarget({ first: 0, last: 3 })).toBe(0)
    expect(lineUpTarget({ first: 4, last: 6 })).toBe(3)
  })
  it('snap_hover_in_page moves a hover that fell off the page to its nearest edge', () => {
    expect(snapHoverTarget({ last_hovered: -1 }, { first: 2, last: 5 })).toBe(-1)
    expect(snapHoverTarget({ last_hovered: 3 }, { first: 2, last: 5 })).toBe(-1)
    expect(snapHoverTarget({ last_hovered: 1 }, { first: 2, last: 5 })).toBe(2)
    expect(snapHoverTarget({ last_hovered: 6 }, { first: 2, last: 5 })).toBe(5)
  })
})

describe('menu_keydown_handler / menu_keypress_handler', () => {
  const arrows = menuOf(useItem) // ARROWS_SELECT, single select
  const multi = menuOf(pickup) // ARROWS_SELECT | MULTISELECT
  const plain = { ...arrows, tag: 'help', flags: arrows.flags & ~MenuFlag.ARROWS_SELECT }
  it('the fixtures carry the flags the rules turn on', () => {
    expect(arrows.flags & MenuFlag.ARROWS_SELECT).toBeTruthy()
    expect(multi.flags & MenuFlag.MULTISELECT).toBeTruthy()
    expect(menuOf(travel).tag).toBe('travel')
  })
  it('up / down cycle the cursor on every menu, arrows-select or not, and scroll a line with Shift', () => {
    // Orbrun hovers every menu itself (menu-nav menuClientHover), so a menu the
    // server left without ARROWS_SELECT walks its rows too; Shift still scrolls
    expect(menuKeyIntent(arrows, key('ArrowUp'))).toBe('up')
    expect(menuKeyIntent(arrows, key('ArrowDown'))).toBe('down')
    expect(menuKeyIntent(arrows, key('ArrowDown', { shiftKey: true }))).toBe('lineDown')
    expect(menuKeyIntent(plain, key('ArrowUp'))).toBe('up')
    expect(menuKeyIntent(plain, key('ArrowDown'))).toBe('down')
    expect(menuKeyIntent(plain, key('ArrowUp', { shiftKey: true }))).toBe('lineUp')
    expect(menuKeyIntent(plain, key('ArrowDown', { shiftKey: true }))).toBe('lineDown')
  })
  it('plain left / right are the server\'s; with Shift they scroll a line', () => {
    expect(menuKeyIntent(arrows, key('ArrowLeft'))).toBeNull()
    expect(menuKeyIntent(arrows, key('ArrowRight'))).toBeNull()
    expect(menuKeyIntent(arrows, key('ArrowLeft', { shiftKey: true }))).toBe('lineUp')
    expect(menuKeyIntent(arrows, key('ArrowRight', { shiftKey: true }))).toBe('lineDown')
  })
  it('paging keys', () => {
    expect(menuKeyIntent(arrows, key('PageUp'))).toBe('pageUp')
    expect(menuKeyIntent(arrows, key('PageDown'))).toBe('pageDown')
    expect(menuKeyIntent(arrows, key('Home'))).toBe('home')
    expect(menuKeyIntent(arrows, key('End'))).toBe('end')
    expect(menuKeyIntent(plain, key('+', { code: 'NumpadAdd' }))).toBe('pageDown')
    expect(menuKeyIntent(plain, key('-', { code: 'NumpadSubtract' }))).toBe('pageUp')
  })
  it('Alt and Ctrl combinations are never the menu\'s', () => {
    expect(menuKeyIntent(arrows, key('ArrowDown', { ctrlKey: true }))).toBeNull()
    expect(menuKeyIntent(arrows, key('ArrowDown', { altKey: true }))).toBeNull()
    expect(menuKeyIntent(arrows, key('PageDown', { ctrlKey: true }))).toBeNull()
  })
  it('the paging characters, with the menus that use them for something else', () => {
    expect(menuKeyIntent(plain, key(' '))).toBe('pageDown')
    expect(menuKeyIntent(plain, key('+'))).toBe('pageDown')
    expect(menuKeyIntent(plain, key('>'))).toBe('pageDown')
    expect(menuKeyIntent(plain, key('-'))).toBe('pageUp')
    expect(menuKeyIntent(plain, key('<'))).toBe('pageUp')
    expect(menuKeyIntent(plain, key(';'))).toBe('pageUp')
    // a multiselect arrows menu: space toggles the hovered row (sent as a key)
    expect(menuKeyIntent(multi, key(' '))).toBeNull()
    expect(menuKeyIntent(arrows, key(' '))).toBe('pageDown')
    // menus with a custom dash: `-` is theirs
    for (const tag of ['inventory', 'stash', 'actions', 'macros', 'macro_mapping', 'use_item']) expect(menuHasCustomDash({ tag })).toBe(true)
    expect(menuKeyIntent(arrows, key('-'))).toBeNull() // use_item
    expect(menuKeyIntent(arrows, key('-', { code: 'NumpadSubtract' }))).toBeNull()
    // the travel menu: `<` and `>` pick stairs
    expect(menuKeyIntent(menuOf(travel), key('<'))).toBeNull()
    expect(menuKeyIntent(menuOf(travel), key('>'))).toBeNull()
    expect(menuKeyIntent(menuOf(travel), key(';'))).toBe('pageUp')
    // letters and the rest stay raw
    expect(menuKeyIntent(arrows, key('a'))).toBeNull()
    expect(menuKeyIntent(arrows, key('Enter'))).toBeNull()
    expect(menuKeyIntent(arrows, key('Escape'))).toBeNull()
  })
  it('the macro editor reads keys raw while it waits for one or has no rows', () => {
    const macro = { ...arrows, tag: 'macro_mapping', titlePrompt: { prompt: 'Input trigger key:', raw: true } }
    expect(rawArrowKeys(macro)).toBe(true)
    expect(menuKeyIntent(macro, key('ArrowDown'))).toBeNull()
    expect(menuKeyIntent(macro, key('PageDown'))).toBeNull()
    expect(menuKeyIntent(macro, key(' '))).toBeNull()
    const listing = { ...arrows, tag: 'macro_mapping', titlePrompt: null }
    expect(rawArrowKeys(listing)).toBe(false)
    expect(menuKeyIntent(listing, key('ArrowDown'))).toBe('down')
    expect(menuKeyIntent(listing, key(' '))).toBeNull() // keypress handler returns for macro_mapping
    expect(rawArrowKeys({ ...listing, items: [] })).toBe(true)
  })
})

describe('scroller_handle_key', () => {
  it('only the layouts that scroll on the client', () => {
    for (const t of ['describe-item', 'describe-monster', 'describe-god', 'describe-generic', 'describe-feature-wide', 'describe-spell', 'describe-cards', 'version', 'game-over', 'formatted-scroller'])
      expect(SCROLLER_POPUPS.has(t)).toBe(true)
    for (const t of ['newgame-choice', 'seed-selection', 'progress-bar', 'msgwin-get-line', 'newgame-random-combo']) expect(scrollKeyIntent(t, key('ArrowDown'))).toBeNull()
  })
  it('lines, pages and ends; Shift is not looked at, Alt and Ctrl are', () => {
    expect(scrollKeyIntent('describe-item', key('ArrowUp'))).toBe('lineUp')
    expect(scrollKeyIntent('describe-item', key('ArrowDown'))).toBe('lineDown')
    expect(scrollKeyIntent('describe-item', key('ArrowDown', { shiftKey: true }))).toBe('lineDown')
    expect(scrollKeyIntent('describe-item', key('PageUp'))).toBe('pageUp')
    expect(scrollKeyIntent('describe-item', key('PageDown'))).toBe('pageDown')
    expect(scrollKeyIntent('describe-item', key('Home'))).toBe('home')
    expect(scrollKeyIntent('describe-item', key('End'))).toBe('end')
    expect(scrollKeyIntent('describe-item', key('ArrowDown', { ctrlKey: true }))).toBeNull()
    expect(scrollKeyIntent('describe-item', key('ArrowDown', { altKey: true }))).toBeNull()
    expect(scrollKeyIntent('describe-item', key('ArrowLeft'))).toBeNull()
    expect(scrollKeyIntent('describe-item', key('Enter'))).toBeNull()
    expect(scrollKeyIntent('describe-item', key('Escape'))).toBeNull()
  })
  it('the paging characters and the layouts that keep some for themselves', () => {
    for (const c of [' ', '>', '+', "'"]) expect(scrollKeyIntent('formatted-scroller', key(c))).toBe('pageDown')
    for (const c of ['-', '<', ';']) expect(scrollKeyIntent('formatted-scroller', key(c))).toBe('pageUp')
    expect(scrollKeyIntent('formatted-scroller', key('d'))).toBeNull()
    // describe_feature_wide: `<` and `>` are not passed to the scroller
    expect(scrollKeyIntent('describe-feature-wide', key('<'))).toBeNull()
    expect(scrollKeyIntent('describe-feature-wide', key('>'))).toBeNull()
    expect(scrollKeyIntent('describe-feature-wide', key(' '))).toBe('pageDown')
    // describe_god / describe_monster: Enter and space return before the scroller
    expect(scrollKeyIntent('describe-god', key(' '))).toBeNull()
    expect(scrollKeyIntent('describe-monster', key(' '))).toBeNull()
    expect(scrollKeyIntent('describe-monster', key('-'))).toBe('pageUp')
  })
})

describe('the switches a more line prints', () => {
  it('reads each bracketed key and the label beside it, and passes over the scroll marker', () => {
    // ShopMenu::update_help, with menu.js's XXX already replaced by the scroll position
    const shop =
      'You have 100 gold pieces.\n' +
      '[Esc] exit          [!] buy|examine items    a-c mark item for purchase   \n' +
      '[/] sort (default)         [Enter] buy marked items   A-C put item on shopping list'
    expect(parseMoreSwitches(shop).map((s) => s.key + '=' + s.label)).toEqual(['Esc=exit', '!=buy|examine items', '/=sort (default)', 'Enter=buy marked items'])
    // the label ends at the line, never running into the next one
    expect(shop.slice(parseMoreSwitches(shop)[1].start, parseMoreSwitches(shop)[1].end)).toBe('[!] buy|examine items')
    expect(parseMoreSwitches('[Up|Down] select  [ 42%]').map((s) => s.key)).toEqual([])
  })
})
