// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { initialState, reduce, MouseMode, Keys, type ClientMessage, type GameState } from '@orbrun/webtiles'
import { Overlays } from '../src/overlays'
import { deriveContext, type Context } from '../src/context'
import { actionLabel, buttonAction, resolve, screenKey } from '../src/bindings'
import useItem from './fixtures/menus/menu-use_item-1.json'
import pickup from './fixtures/menus/menu-pickup-1.json'
import inventory from './fixtures/menus/menu-inventory-1.json'
import travel from './fixtures/menus/menu-travel-1.json'
import ability from './fixtures/menus/menu-ability-1.json'

/**
 * Keyboard keys in server menus and popups go through the overlays as the
 * official client's menu.js and ui-layouts.js handle them: the hover and the
 * scroll move on the client (`menu_hover`, `menu_scroll`,
 * `formatted_scroller_scroll` tell the server), and no arrow, PgUp / PgDn,
 * Home or End is ever sent as a key while one is up. Pinned to menus recorded
 * from crawl.dcss.io (0.35-a0, 2026-09-05).
 */

const scene = { player: { x: 0, y: 0 }, cells: new Map(), billboards: [], playerOnLevel: false } as never
const cam = { facing: 0 } as never

type Fixture = { msgs: Record<string, unknown>[] }

function setup() {
  const sent: ClientMessage[] = []
  const host = document.createElement('div')
  document.body.append(host)
  const ov = new Overlays(host, {
    send: (m) => sent.push(m),
    gamedata: () => null,
    watching: () => false,
    onClientOverlayChange: () => {},
    onSystemAction: () => {},
    settingsPanel: () => ({ el: document.createElement('div'), rows: [] }),
  })
  const st = initialState()
  st.phase = 'playing' as GameState['phase']
  st.inputMode = MouseMode.COMMAND
  const frame = (): Context => {
    ov.update(st)
    const ctx = deriveContext(st, scene, cam, 'micro')
    ov.updatePrompt(ctx.mode, ctx.prompt)
    ov.syncFocus(ctx)
    return ctx
  }
  /** replay a recorded menu up to (not including) its close */
  const open = (f: Fixture) => {
    for (const m of f.msgs) {
      if (m.msg === 'close_menu' || m.msg === 'close_all_menus') break
      reduce(st, m as never)
    }
  }
  const k = (key: string, over: Partial<KeyboardEvent> = {}) => ({ key, code: '', shiftKey: false, ctrlKey: false, altKey: false, ...over })
  const hovered = () => Array.from(host.querySelectorAll('li')).findIndex((li) => li.classList.contains('hovered'))
  /**
   * A key as the game screen takes it: Enter, Escape, Space and the arrows are the pad's buttons and
   * d-pad (bindings.ts screenKey), down the pad's path; the rest go to the menu's own keys (menuKey).
   * True when the key was taken.
   */
  const key = (name: string, over: Partial<KeyboardEvent> = {}): boolean => {
    const ctx = deriveContext(st, scene, cam, 'micro')
    const plain = !over.shiftKey && !over.ctrlKey && !over.altKey
    const sk = plain ? screenKey(name, ctx) : null
    if (!sk) return ov.menuKey(st, k(name, over))
    const a = 'button' in sk ? buttonAction(sk.button, ctx) : resolve({ type: 'dir', dir: sk.dir, source: 'dpad' }, ctx)
    if (a?.kind === 'menu') ov.menuOp(st, a.op)
    else if (a?.kind === 'keys') for (const x of a.seq) sent.push('key' in x ? { msg: 'key', keycode: x.key } : { msg: 'input', text: x.text })
    return true
  }
  return { ov, st, sent, host, frame, open, k, hovered, key }
}

beforeEach(() => {
  document.body.innerHTML = ''
})

/**
 * A shop as crawl.dcss.io sends one: ShopMenu (shopping.cc) opens on its first
 * row (MF_INIT_HOVER) with MF_MULTISELECT but no MF_ARROWS_SELECT, and prints
 * its switches in the more line (ShopMenu::update_help).
 */
function openShop(st: GameState) {
  const more =
    '<yellow>You have 100 gold pieces.</yellow>\n' +
    '[<w>Esc</w>] exit          [<w>!</w>] <w>buy</w>|examine items    a-c mark item for purchase   \n' +
    '[<w>/</w>] sort (default)         [<w>Enter</w>] buy marked items   A-C put item on shopping list'
  const row = (letter: string, name: string) => ({ text: `<lightgreen>${letter} - </lightgreen><lightgrey>  30 gold   ${name}</lightgrey>`, hotkeys: [letter.charCodeAt(0)], level: 2 })
  reduce(st, {
    msg: 'menu',
    tag: 'shop',
    flags: 0x0004,
    last_hovered: 0,
    title: { text: '<white>Welcome to Bob\'s General Store!' },
    more,
    alt_more: more,
    total_items: 3,
    items: [row('a', 'a potion of curing'), row('b', 'a scroll of fear'), row('c', 'a wand of flame')],
  } as never)
}

const hoveredRow = (host: HTMLElement) => Array.from(host.querySelectorAll('li')).findIndex((li) => li.classList.contains('hovered'))

describe('a server menu on the keyboard', () => {
  it('down and up move the hover through the selectable rows and tell the server with menu_hover, never with a key', async () => {
    const { ov, st, sent, frame, open, k, hovered, host, key } = setup()
    open(useItem)
    const ctx = frame()
    expect(ctx.mode).toBe('menu')
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    expect(hovered()).toBe(1) // the server opened it on `a`
    expect(key('ArrowDown')).toBe(true)
    expect(hovered()).toBe(2)
    expect(sent).toEqual([{ msg: 'menu_hover', hover: 2, mouse: false }])
    sent.length = 0
    expect(key('ArrowUp')).toBe(true)
    expect(hovered()).toBe(1)
    // up from the first row: onto the more line's bottom line, its first switch, the tail of the ring
    // ([<w>!</w>] read|quaff|evoke and [<w>?</w>] describe selected, UseItemMenu's help, on one line)
    expect(key('ArrowUp')).toBe(true)
    expect(hovered()).toBe(-1)
    expect(Array.from(host.querySelectorAll('.more .more-hot')).findIndex((e) => e.classList.contains('hovered'))).toBe(0)
    expect(sent).toEqual([{ msg: 'menu_hover', hover: 1, mouse: false }])
    expect(sent.some((m) => m.msg === 'key')).toBe(false)
  })
  it('Home and End hover the first and last selectable row', () => {
    const { ov, st, sent, frame, open, k, hovered, key } = setup()
    open(useItem)
    frame()
    ov.menuKey(st, k('End'))
    expect(hovered()).toBe(5)
    ov.menuKey(st, k('Home'))
    expect(hovered()).toBe(1) // the header at 0 cannot take the hover
    expect(sent.map((m) => m.msg)).toEqual(['menu_hover', 'menu_hover'])
  })
  it('the keys the official client leaves to the server reach it as the same keys, down the pad\'s path', () => {
    const { ov, st, sent, frame, open, k, key } = setup()
    open(useItem)
    frame()
    // left and right are the server's on the rows (invent.cc cycle_page, cycle_mode), as the d-pad's are
    expect(key('ArrowLeft')).toBe(true)
    expect(key('ArrowRight')).toBe(true)
    // Enter takes the hovered row, as crawl's own Enter does on an arrows menu; Escape leaves
    expect(key('Enter')).toBe(true)
    expect(key('Escape')).toBe(true)
    expect(sent).toEqual([
      { msg: 'key', keycode: Keys.CK_LEFT },
      { msg: 'key', keycode: Keys.CK_RIGHT },
      { msg: 'key', keycode: Keys.ENTER },
      { msg: 'key', keycode: Keys.ESC },
    ])
    // letters and anything with Ctrl are crawl's own
    expect(ov.menuKey(st, k('a'))).toBe(false)
    expect(ov.menuKey(st, k('-'))).toBe(false) // use_item: `-` unwields
    expect(key('ArrowDown', { ctrlKey: true })).toBe(false)
  })
  it('space in a multiselect menu marks the hovered row, as A does; the paging keys still page', () => {
    const { ov, st, sent, frame, open, k, key } = setup()
    open(pickup)
    frame()
    expect(key(' ')).toBe(true)
    expect(sent.at(-1)).toEqual({ msg: 'key', keycode: Keys.SPACE })
    expect(ov.menuKey(st, k('PageDown'))).toBe(true)
  })
  it('the pad pages on the client too, and select on a hovered row sends Enter in an arrows menu', () => {
    const { ov, st, sent, frame, open } = setup()
    open(useItem)
    frame()
    ov.menuOp(st, 'pageNext')
    ov.menuOp(st, 'pagePrev')
    expect(sent.some((m) => m.msg === 'key')).toBe(false)
    ov.menuOp(st, 'select')
    expect(sent.at(-1)).toEqual({ msg: 'key', keycode: Keys.ENTER })
  })
  it('a single-select arrows menu that opens with nothing hovered (the inventory) seats the cursor on its first row, so A opens that item', () => {
    // invent.cc display_inventory: MF_SINGLESELECT | MF_ARROWS_SELECT without MF_INIT_HOVER, so it opens with
    // last_hovered -1, where Enter is a no-op on the server (menu.cc CMD_MENU_SELECT: process_selection keeps the
    // menu for an empty selection); the recorded menu-inventory-1 opens the same way before its menu_scroll
    const { ov, st, sent, frame } = setup()
    reduce(st, inventory.msgs[0] as never)
    const ctx = frame()
    // row 0 is the Hand Weapons header: the first item is row 1, and the server is told
    expect(st.menus[0]!.last_hovered).toBe(1)
    expect(sent).toContainEqual(expect.objectContaining({ msg: 'menu_hover', hover: 1 }))
    expect(actionLabel({ kind: 'menu', op: 'select' }, ctx)).toBe('select')
    ov.menuOp(st, 'select')
    expect(sent.at(-1)).toEqual({ msg: 'key', keycode: Keys.ENTER })
  })
  it('a multiselect arrows menu that opens with nothing hovered (pickup) seats the cursor too, so A toggles the first row', () => {
    const { ov, st, sent, frame } = setup()
    reduce(st, pickup.msgs[0] as never)
    frame()
    expect(st.menus[0]!.last_hovered).toBeGreaterThanOrEqual(0) // pickup: MF_MULTISELECT | MF_ARROWS_SELECT, no MF_INIT_HOVER
    ov.menuOp(st, 'select')
    expect(sent.at(-1)).toEqual({ msg: 'key', keycode: 32 })
  })
  it('the pad\'s bumpers jump between sections, as menu.cc cycle_headers does for `,`, in both directions and round the ends', () => {
    // menu-inventory-1: Hand Weapons (0), Missiles (7), Armour (11), Jewellery (15), Talismans (20) head 22 rows
    const { ov, st, sent, frame, open, hovered } = setup()
    open(inventory)
    frame()
    expect(hovered()).toBe(6) // the recorded menu_scroll (forced) left the hover on the last hand weapon
    ov.menuOp(st, 'sectionNext')
    expect(hovered()).toBe(8) // the first row under Missiles
    ov.menuOp(st, 'sectionNext')
    expect(hovered()).toBe(12) // Armour
    ov.menuOp(st, 'sectionPrev')
    expect(hovered()).toBe(8)
    ov.menuOp(st, 'sectionPrev')
    expect(hovered()).toBe(1) // Hand Weapons
    ov.menuOp(st, 'sectionPrev')
    expect(hovered()).toBe(21) // wraps round to Talismans
    ov.menuOp(st, 'sectionNext')
    expect(hovered()).toBe(1)
    expect(sent.filter((m) => m.msg === 'menu_hover').map((m) => (m as { hover: number }).hover)).toEqual([8, 12, 8, 1, 21, 1])
    expect(sent.some((m) => m.msg === 'key')).toBe(false)
  })
  it('the pad\'s left and right are the keyboard\'s: raw to the server, which switches the inventory\'s category page', () => {
    // invent.cc InvMenu::process_command: CMD_MENU_LEFT / RIGHT cycle_page in a paged inventory
    // ("Left/Right/Tab to switch category" in its title); the hover does not move on the client
    const { ov, st, sent, frame, open, hovered } = setup()
    open(inventory)
    frame()
    ov.menuOp(st, 'sectionNext')
    sent.length = 0
    ov.menuOp(st, 'right')
    ov.menuOp(st, 'left')
    expect(sent).toEqual([
      { msg: 'key', keycode: Keys.CK_RIGHT },
      { msg: 'key', keycode: Keys.CK_LEFT },
    ])
    expect(hovered()).toBe(8)
  })
  it('the bumpers page in a menu without sections', () => {
    const { ov, st, sent, frame, open } = setup()
    open(travel)
    frame()
    ov.menuOp(st, 'sectionNext')
    ov.menuOp(st, 'sectionPrev')
    expect(sent.some((m) => m.msg === 'key')).toBe(false)
  })
  it('every menu prints its more line as switches on the ring, not only the shop', async () => {
    // the pickup menu's help line is [Up|Down] select  [Esc] exit  [.|Space] toggle
    // selected: only [Esc] names a single key, so it alone is a switch, and it is the tail
    // of the ring, so up from the first row reaches it ([XXX], the scroll position, is not one)
    const { ov, st, frame, open, k, host, key } = setup()
    open(pickup)
    frame()
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    const switches = () => Array.from(host.querySelectorAll('.more .more-hot')) as HTMLElement[]
    expect(switches().map((e) => e.textContent)).toEqual(['[Esc] exit'])
    ov.menuKey(st, k('Home'))
    expect(hoveredRow(host)).toBeGreaterThanOrEqual(0)
    expect(key('ArrowUp')).toBe(true)
    expect(hoveredRow(host)).toBe(-1)
    expect(switches()[0].classList.contains('hovered')).toBe(true)
  })
  it('a menu the server left without ARROWS_SELECT still walks its rows, and space or Enter fires the hovered one', () => {
    // most menus carry MF_ARROWS_SELECT now, but not all (the shop, and anything older):
    // the cursor is Orbrun's there, so space and Enter must fire the row it sits on
    const { ov, st, sent, frame, k, host, key } = setup()
    const row = (letter: string, text: string) => ({ text: `${letter} - ${text}`, hotkeys: [letter.charCodeAt(0)], level: 2 })
    reduce(st, {
      msg: 'menu',
      tag: 'stash',
      flags: 0,
      last_hovered: 0,
      title: { text: 'Stash search' },
      more: '[<w>Esc</w>] exit',
      alt_more: '[<w>Esc</w>] exit',
      items: [row('a', 'a bread ration'), row('b', 'a scroll')],
      total_items: 2,
    } as never)
    frame()
    expect(hoveredRow(host)).toBe(0)
    expect(key('ArrowDown')).toBe(true)
    expect(hoveredRow(host)).toBe(1)
    sent.length = 0
    expect(key(' ')).toBe(true)
    expect(sent).toEqual([{ msg: 'key', keycode: 'b'.charCodeAt(0) }])
    sent.length = 0
    // Enter fires it too, as A does; only a menu of marks keeps Enter for taking what is marked
    expect(key('Enter')).toBe(true)
    expect(sent).toEqual([{ msg: 'key', keycode: 'b'.charCodeAt(0) }])
  })
  it('the shop hovers rows with up and down, though the server set no ARROWS_SELECT, and space fires the hovered row', () => {
    // shopping.cc ShopMenu: MF_MULTISELECT | MF_QUIET_SELECT | MF_ALLOW_FORMATTING | MF_INIT_HOVER,
    // so the official client only scrolls on the arrows and every row must be typed by letter
    const { ov, st, sent, frame, k, hovered, key } = setup()
    openShop(st)
    frame()
    expect(hovered()).toBe(0)
    expect(key('ArrowDown')).toBe(true)
    expect(hovered()).toBe(1)
    expect(sent).toEqual([{ msg: 'menu_hover', hover: 1, mouse: false }])
    sent.length = 0
    // space marks the hovered row: the letter the row printed, as the pad's A sends it
    expect(key(' ')).toBe(true)
    expect(sent).toEqual([{ msg: 'key', keycode: 'b'.charCodeAt(0) }])
    sent.length = 0
    // Enter is the shop's buy (Start: it takes what is marked); with nothing marked there is nothing to buy
    expect(key('Enter')).toBe(true)
    expect(sent).toEqual([])
    expect(key('ArrowUp')).toBe(true)
    expect(hovered()).toBe(0)
    expect(sent).toEqual([{ msg: 'menu_hover', hover: 0, mouse: false }])
  })
    it('the cursor walks off the last row onto the more line\'s switches, and space fires the one it sits on', async () => {
    // ShopMenu::update_help prints [Esc] exit, [!] buy|examine items, [/] sort and [Enter] buy marked items
    const { ov, st, sent, frame, k, host, key } = setup()
    openShop(st)
    frame()
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    const switches = () => Array.from(host.querySelectorAll('.more .more-hot')) as HTMLElement[]
    const marked = () => switches().findIndex((e) => e.classList.contains('hovered'))
    expect(switches().map((e) => e.textContent)).toEqual(['[Esc] exit', '[!] buy|examine items', '[/] sort (default)', '[Enter] buy marked items'])
    // down through the rows, then off the last one onto the first switch
    key('ArrowDown')
    key('ArrowDown')
    expect(marked()).toBe(-1)
    sent.length = 0
    expect(key('ArrowDown')).toBe(true)
    expect(marked()).toBe(0)
    expect(Array.from(host.querySelectorAll('li.hovered'))).toHaveLength(0)
    expect(sent).toEqual([]) // nothing to tell the server: the switches are the client's
    // the switches are walked as they are drawn: two lines of columns
    //   [Esc] exit          [!] buy|examine items
    //   [/] sort (default)         [Enter] buy marked items
    // right goes along the line
    key('ArrowRight')
    expect(marked()).toBe(1)
    // Space (A) fires the lit switch; on a shop Enter is the buy, whatever is lit
    expect(key(' ')).toBe(true)
    expect(sent).toEqual([{ msg: 'input', text: '!' }])
    sent.length = 0
    // down to the line below, nearest column: [Enter] under [!]; left along it to [/]; up over it to [Esc]
    key('ArrowDown')
    expect(marked()).toBe(3)
    key('ArrowLeft')
    expect(marked()).toBe(2)
    // no column further left: sideways goes nowhere
    key('ArrowLeft')
    expect(marked()).toBe(2)
    key('ArrowUp')
    expect(marked()).toBe(0)
    // Esc and Enter switches send the key they name, not a character
    expect(key(' ')).toBe(true)
    expect(sent).toEqual([{ msg: 'key', keycode: 27 }])
    sent.length = 0
    // up from the top line goes back to the last row
    expect(key('ArrowUp')).toBe(true)
    expect(marked()).toBe(-1)
    expect(hoveredRow(host)).toBe(2)
    // the server's hover never left that row while the cursor was on the more line, so it is told nothing
    expect(sent).toEqual([])
  })
  it('past the end of a line, sideways crosses into the next column, on whatever line holds it', async () => {
    const { st, frame, host, key } = setup()
    // the shop in the screenshot: [/] sort alone on the bottom line, under [Esc] exit, with [!] buy|examine items to the right
    const row = (letter: string) => ({ text: `<lightgreen>${letter} - </lightgreen>  450 gold   a ring`, hotkeys: [letter.charCodeAt(0)], level: 2 })
    const more = '<yellow>You have 198 gold pieces.</yellow>\n[<w>Esc</w>] exit              [<w>!</w>] buy|examine items        [a-h] mark item for purchase\n[<w>/</w>] sort (type)                                    [A-H] put item on shopping list'
    reduce(st, { msg: 'menu', tag: 'shop', flags: 0x0004, last_hovered: 0, title: { text: 'Welcome' }, more, alt_more: more, total_items: 2, items: [row('a'), row('b')] } as never)
    frame()
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    const switches = () => Array.from(host.querySelectorAll('.more .more-hot')) as HTMLElement[]
    const lit = () => switches().find((e) => e.classList.contains('hovered'))?.textContent ?? null
    // the letter ranges are not switches: one key each, or none
    expect(switches().map((e) => e.textContent)).toEqual(['[Esc] exit', '[!] buy|examine items', '[/] sort (type)'])
    // up from the first row: the bottom line's first switch
    key('ArrowUp')
    expect(lit()).toBe('[/] sort (type)')
    // nothing to its right on its own line: right goes on into the next column, up a line
    key('ArrowRight')
    expect(lit()).toBe('[!] buy|examine items')
    // and back left along the top line
    key('ArrowLeft')
    expect(lit()).toBe('[Esc] exit')
  })
  it('rows and switches are one ring: down off the bottom line comes back to the top, up from the first row to the bottom line', async () => {
    const { ov, st, frame, k, host, key } = setup()
    openShop(st)
    frame()
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    const marked = () => Array.from(host.querySelectorAll('.more .more-hot')).findIndex((e) => e.classList.contains('hovered'))
    // up from the first row lands on the bottom line's first switch, [/] sort
    expect(hoveredRow(host)).toBe(0)
    key('ArrowUp')
    expect(marked()).toBe(2)
    // and down off it comes round to the first row
    key('ArrowDown')
    expect(marked()).toBe(-1)
    expect(hoveredRow(host)).toBe(0)
  })
    it('the skills screen is not a menu here: its keys are the focus layer\'s', () => {
    const { ov, st, frame, k } = setup()
    reduce(st, { msg: 'menu', type: 'crt', tag: 'skills', flags: 0, items: [], total_items: 0, title: { text: '' }, more: '', alt_more: '', last_hovered: -1 })
    frame()
    expect(ov.menuKey(st, k('ArrowDown'))).toBe(false)
  })
})

describe('a popup on the keyboard', () => {
  it('a describe popup scrolls on the client and sends nothing', () => {
    const { ov, st, sent, frame, k } = setup()
    reduce(st, { msg: 'ui-push', type: 'describe-item', title: 't', body: 'A long body.\n'.repeat(80) })
    frame()
    expect(ov.popupKey(st, k('ArrowDown'))).toBe(true)
    expect(ov.popupKey(st, k('PageDown'))).toBe(true)
    expect(ov.popupKey(st, k('End'))).toBe(true)
    expect(ov.popupKey(st, k(' '))).toBe(true)
    expect(sent).toEqual([])
    // its own keys stay raw
    expect(ov.popupKey(st, k('Escape'))).toBe(false)
    expect(ov.popupKey(st, k('d'))).toBe(false)
    expect(ov.popupKey(st, k('ArrowLeft'))).toBe(false)
  })
  it('a formatted scroller reports its top line, as update_server_scroll does', () => {
    const { ov, st, sent, frame, k } = setup()
    reduce(st, { msg: 'ui-push', type: 'formatted-scroller', title: 'Help', text: 'x\n'.repeat(200) })
    frame()
    expect(ov.popupKey(st, k('ArrowDown'))).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ msg: 'formatted_scroller_scroll' })
    expect(typeof (sent[0] as { scroll: number }).scroll).toBe('number')
  })
  it('a spectator scrolls but says nothing', () => {
    const sent: ClientMessage[] = []
    const host = document.createElement('div')
    document.body.append(host)
    const ov = new Overlays(host, { send: (m) => sent.push(m), gamedata: () => null, watching: () => true, onClientOverlayChange: () => {}, onSystemAction: () => {}, settingsPanel: () => ({ el: document.createElement('div'), rows: [] }) })
    const st = initialState()
    st.phase = 'watching' as GameState['phase']
    reduce(st, { msg: 'ui-push', type: 'formatted-scroller', title: 'Help', text: 'x' })
    ov.update(st)
    expect(ov.popupKey(st, { key: 'ArrowDown', code: '', shiftKey: false, ctrlKey: false, altKey: false })).toBe(true)
    expect(sent).toEqual([])
  })
  it('popups the official client does not scroll itself leave every key raw', () => {
    const { ov, st, frame, k } = setup()
    reduce(st, { msg: 'ui-push', type: 'seed-selection', title: 't', body: '', footer: '' })
    frame()
    expect(ov.popupKey(st, k('ArrowDown'))).toBe(false)
    expect(ov.popupKey(st, k(' '))).toBe(false)
  })
})

/**
 * X on a row: the row described where it stands, as menu.js
 * item_click_handler's right click does on an arrows-select row (`text_input`
 * `'`, CMD_MENU_EXAMINE in cmd-keys.h; menu.cc process_command examines
 * `last_hovered`). No `?` toggle goes first, and none comes after.
 */
describe('examining the hovered row', () => {
  it('an arrows-select menu sends the apostrophe alone: the server already holds the hover', () => {
    const { ov, st, sent, frame } = setup()
    open(ability as Fixture)
    frame()
    sent.length = 0
    ov.menuOp(st, 'examine')
    expect(sent).toEqual([{ msg: 'text_input', text: "'" }])
    // moving first tells the server the hover as usual, then the key
    ov.menuOp(st, 'next')
    ov.menuOp(st, 'examine')
    expect(sent.slice(1)).toEqual([{ msg: 'menu_hover', hover: 2, mouse: false }, { msg: 'text_input', text: "'" }])
    function open(f: Fixture) {
      for (const m of f.msgs) {
        if (m.msg === 'close_menu' || m.msg === 'close_all_menus') break
        reduce(st, m as never)
      }
    }
  })
  it('a menu without arrows-select forces the hover first: Menu::set_hovered drops a plain one', () => {
    const { ov, st, sent, frame } = setup()
    openShop(st)
    frame()
    sent.length = 0
    ov.menuOp(st, 'examine')
    expect(sent).toEqual([{ msg: 'menu_hover', hover: 0, mouse: true }, { msg: 'text_input', text: "'" }])
  })
  it('the more line\'s switches have nothing to describe', () => {
    const { ov, st, sent, frame } = setup()
    openShop(st)
    frame()
    // down past the last of the three rows lands on the footer's switches
    for (let i = 0; i < 3; i++) ov.menuOp(st, 'next')
    sent.length = 0
    ov.menuOp(st, 'examine')
    expect(sent).toEqual([])
  })
})
