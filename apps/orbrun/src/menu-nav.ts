import { MenuFlag, type MenuState } from '@orbrun/webtiles'

/**
 * Keyboard navigation of a server menu, ported from the official client's
 * menu.js (`menu_keydown_handler`, `menu_keypress_handler`,
 * `next_hoverable_item`, `paging`, `line_up`, `line_down`, `snap_hover_in_page`,
 * `get_relative_hover`, `set_relative_hover`). The official client never sends
 * arrows, PgUp / PgDn, Home or End to the server while a menu is up: it moves
 * the hover and the scroll itself and tells the server with `menu_hover` and
 * `menu_scroll`. (The server would move its own hover on a raw arrow and reply
 * with a non-forced `menu_scroll`, which both clients ignore, so a raw arrow
 * moves nothing on screen.)
 *
 * Everything here is pure: the caller measures what is visible and applies
 * the scrolls; the decisions are made from the menu's items, flags and tag.
 */

/** The rows the caller can see in full: `menu.first_visible` / `menu.last_visible`. */
export interface Visible {
  first: number
  last: number
}

export type MenuNavKey = 'up' | 'down' | 'pageUp' | 'pageDown' | 'home' | 'end' | 'lineUp' | 'lineDown'

/** The subset of a keydown the intent needs; plain objects work for tests. */
export interface NavKeyLike {
  key: string
  code: string
  shiftKey: boolean
  ctrlKey: boolean
  altKey: boolean
}

/** menu.js `item_selectable`: a level-2 row with a hotkey, or any row of the use_item menu (relettering). */
export function itemSelectable(menu: Pick<MenuState, 'tag' | 'items'>, index: number): boolean {
  const it = menu.items[index]
  if (!it) return false
  return (it.level ?? 2) === 2 && (menu.tag === 'use_item' || !!(it.hotkeys && it.hotkeys.length))
}

/**
 * menu.js `next_hoverable_item`: the next selectable row from `start` in the
 * given direction, wrapping only with the WRAP flag; -1 when there is none
 * ("up arrow on no hover does nothing").
 */
export function nextHoverableItem(menu: Pick<MenuState, 'tag' | 'items' | 'flags' | 'last_hovered'>, reverse: boolean, start: number, startAtStart = false): number {
  const n = menu.items.length
  const wrap = !!(menu.flags & MenuFlag.WRAP)
  let max: number
  if (wrap) max = n
  else if (reverse) max = menu.last_hovered
  else max = n - Math.max(start, 0)
  if (startAtStart && n > 0) max = Math.max(max, 1)
  if (max <= 0) return -1
  let hover = start
  if (reverse && hover < 0) hover = 0
  if (!startAtStart) hover += reverse ? -1 : 1
  let tried = 0
  while (tried < max) {
    tried++
    if (wrap) hover = ((hover % n) + n) % n
    hover = Math.max(0, Math.min(hover, n - 1))
    if (itemSelectable(menu, hover)) return hover
    hover += reverse ? -1 : 1
  }
  return -1
}

/** menu.cc `get_header_block`: the run of headers (level below 2) leading into `index`, and the row it heads. */
function headerBlock(items: Pick<MenuState, 'items'>['items'], index: number): { first: number; last: number } {
  const isHeader = (i: number) => (items[i]?.level ?? 2) < 2
  let first = index
  let last = index
  while (first >= 1 && isHeader(first - 1)) first--
  while (last + 1 < items.length && isHeader(last)) last++
  return { first, last }
}

/** menu.cc `next_block_from` with `wrap`: the first row of the block after (or before) the one holding `index`. */
function nextBlockFrom(items: Pick<MenuState, 'items'>['items'], index: number, forward: boolean): number {
  const n = items.length
  const cur = headerBlock(items, index)
  const next = forward ? cur.last + 1 : cur.first - 1
  return headerBlock(items, ((next % n) + n) % n).first
}

/** Whether a menu has sections at all: a header (title or subtitle row) somewhere in its rows. */
export function menuHasSections(menu: Pick<MenuState, 'items'>): boolean {
  return menu.items.some((it) => (it?.level ?? 2) < 2)
}

/**
 * menu.cc `Menu::cycle_headers` (bound to `,`, CMD_MENU_CYCLE_HEADERS, forward
 * only there; the pad's bumpers take both directions): from the block of the
 * hover (or of the first visible row without one), the header of the next
 * block in the given direction, wrapping round the menu; -1 when the menu
 * has no other header. The server has no client-side port of this
 * (`cycle_headers doesn't currently have a client-side implementation`), so
 * Orbrun runs it on its own hover and reports it with `menu_hover`.
 */
export function cycleHeadersTarget(menu: Pick<MenuState, 'items' | 'flags' | 'last_hovered'>, forward: boolean, vis: Visible): number {
  const items = menu.items
  if (!items.length) return -1
  const arrows = !!(menu.flags & MenuFlag.ARROWS_SELECT)
  const start = headerBlock(items, arrows ? Math.max(menu.last_hovered, 0) : vis.first).first
  let cur = nextBlockFrom(items, start, forward)
  while (cur !== start) {
    if ((items[cur]?.level ?? 2) < 2) return cur
    cur = nextBlockFrom(items, cur, forward)
  }
  return -1
}

/** menu.js `get_relative_hover`: the hover's place in the page, headers skipped; negative counts from the end, 0 with no hover. */
export function relativeHover(menu: Pick<MenuState, 'items' | 'last_hovered'>, vis: Visible): number {
  if (menu.last_hovered < 0 || menu.items.length === 0) return 0
  if (vis.last === menu.last_hovered) return -1
  let rel = menu.last_hovered - vis.first
  let headers = 0
  for (let i = 0; i <= rel; i++) if ((menu.items[vis.first + i]?.level ?? 2) < 2) headers++
  return Math.max(0, rel - headers)
}

/** menu.js `set_relative_hover`: the row to hover for a place in the (new) page, or -1. */
export function relativeHoverTarget(menu: Pick<MenuState, 'tag' | 'items' | 'flags' | 'last_hovered'>, vis: Visible, rel: number): number {
  let target: number
  if (rel >= 0) {
    // headers in the page do not count toward the relative position
    for (let i = 0; i <= rel && vis.first + i < menu.items.length; i++) if ((menu.items[vis.first + i]?.level ?? 2) < 2) rel++
    target = vis.first + rel
  } else target = vis.last + rel + 1
  if (target > vis.last) target = vis.last
  else if (target < vis.first) target = vis.first
  return nextHoverableItem(menu, false, target, true)
}

/** menu.js `line_down`: the row to put at the top; a header and the row under it count as one. */
export function lineDownTarget(menu: Pick<MenuState, 'items'>, vis: Visible): number {
  let next = vis.first + 1
  if ((menu.items[vis.first]?.level ?? 2) < 2) next++
  return Math.min(next, menu.items.length - 1)
}

/** menu.js `line_up` */
export function lineUpTarget(vis: Visible): number {
  return Math.max(0, vis.first - 1)
}

/** menu.js `snap_hover_in_page`: where the hover must move to stay on the page, or -1 to leave it. */
export function snapHoverTarget(menu: Pick<MenuState, 'last_hovered'>, vis: Visible): number {
  if (menu.last_hovered < 0) return -1
  if (menu.last_hovered < vis.first) return vis.first
  if (menu.last_hovered > vis.last) return vis.last
  return -1
}

/**
 * menu.js `raw_arrow_keys`: the macro editor takes arrows raw while it is
 * reading a key (the `.raw_input_mode` field is up) or has no rows yet (a new
 * binding is being typed).
 */
export function rawArrowKeys(menu: Pick<MenuState, 'tag' | 'items' | 'titlePrompt'>): boolean {
  if (menu.tag !== 'macro_mapping') return false
  const tp = menu.titlePrompt as { raw?: boolean } | null | undefined
  return !!(tp && tp.raw) || menu.items.length === 0
}

/** menu.js `menu_has_custom_dash`: menus where `-` means something of its own, so it is not "page up". */
export function menuHasCustomDash(menu: Pick<MenuState, 'tag'>): boolean {
  return menu.tag === 'inventory' || menu.tag === 'stash' || menu.tag === 'actions' || menu.tag === 'macros' || menu.tag === 'macro_mapping' || menu.tag === 'use_item'
}

/** A switch the more line prints: `[<w>!</w>] buy|examine items`, in the plain text of the line. */
export interface MoreSwitch {
  /** what the brackets held: a character, or the name of a key (`Esc`, `Enter`) */
  key: string
  label: string
  /** offsets of the whole switch (bracket to end of label) in the text handed in */
  start: number
  end: number
}

/** Bracketed keys of a more line. `[XXX]` (the scroll position menu.js rewrites) holds no key, so it is not one. */
const MORE_SWITCH_RE = /\[([^\[\]\n]{1,5})\]/g

/**
 * The switches of a menu's more line, read from its plain text. The label is
 * what follows the brackets up to the next switch, a run of two spaces (the
 * more line is padded into columns by `pad_more_with`) or the end of the line;
 * a switch with no label of its own keeps its key as one.
 */
export function parseMoreSwitches(text: string): MoreSwitch[] {
  const out: MoreSwitch[] = []
  const hits: { key: string; start: number; end: number }[] = []
  for (const m of text.matchAll(MORE_SWITCH_RE)) hits.push({ key: m[1], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length })
  hits.forEach((hit, i) => {
    if (!moreSwitchKeycode(hit.key) && hit.key.length !== 1) return
    const limit = Math.min(i + 1 < hits.length ? hits[i + 1].start : text.length, (text.indexOf('\n', hit.end) + 1 || text.length + 1) - 1)
    const rest = text.slice(hit.end, limit)
    const stop = rest.search(/ {2,}/)
    const label = (stop < 0 ? rest : rest.slice(0, stop)).trim()
    out.push({ key: hit.key, label: label || hit.key, start: hit.start, end: hit.end + (stop < 0 ? rest.trimEnd().length : stop) })
  })
  return out
}

/** The keycode a named switch sends (`[Esc]`, `[Enter]`), or 0 when the switch is a plain character. */
export function moreSwitchKeycode(key: string): number {
  if (key === 'Esc') return 27
  if (key === 'Enter') return 13
  if (key === 'Space') return 32
  if (key === 'Tab') return 9
  return 0
}

/**
 * Every menu is walked with a cursor of Orbrun's own, whether or not the
 * server set ARROWS_SELECT. Without that flag the official client leaves the
 * arrows scrolling and offers no way to walk the rows: you must read each
 * letter off the screen and type it (the shop, shopping.cc `ShopMenu`:
 * MF_MULTISELECT | MF_QUIET_SELECT | MF_ALLOW_FORMATTING | MF_INIT_HOVER, is
 * the worst of them, but the inventory and the rest are the same). Orbrun
 * moves the hover with up / down on all of them, as the pad's d-pad already
 * did, and tells the server where it is with `menu_hover` — which is what the
 * official client sends when the mouse crosses a row, so no menu is surprised
 * by it. `menuHoverSelectKey` fires the row the cursor is on.
 *
 * The one thing this cannot do is take a flag away: on an ARROWS_SELECT menu
 * the server acts on its own hover, so space and Enter stay raw there.
 */
export function menuClientHover(menu: Pick<MenuState, 'tag' | 'flags'>): boolean {
  void menu
  return true
}

/**
 * The key that fires the hovered row on a menu whose hover is the client's
 * alone: space and Enter, both, since the server would do nothing with
 * either. The exceptions are ARROWS_SELECT menus, where the server selects on
 * its own hover and both keys must reach it raw, and the shop's Enter, which
 * its own help line binds to "buy marked items".
 */
export function menuHoverSelectKey(menu: Pick<MenuState, 'tag' | 'flags'>, ev: NavKeyLike): boolean {
  if (ev.altKey || ev.ctrlKey || ev.shiftKey) return false
  if (menu.flags & MenuFlag.ARROWS_SELECT) return false
  if (ev.key === ' ') return true
  return ev.key === 'Enter' && menu.tag !== 'shop'
}

/**
 * What a keydown means to the menu, or null when the key is the server's
 * (menu.js `menu_keydown_handler` and `menu_keypress_handler`, in one, since
 * Orbrun folds keypress into keydown). Alt and Ctrl combinations are never
 * the menu's. Plain left / right are the server's (they switch inventory
 * categories or the action mode); with Shift they scroll a line.
 */
export function menuKeyIntent(menu: Pick<MenuState, 'tag' | 'items' | 'flags' | 'titlePrompt'>, ev: NavKeyLike): MenuNavKey | null {
  // menu_keydown_handler: `if (event.altKey || event.ctrlKey)` (Meta is not looked at)
  if (ev.altKey || ev.ctrlKey) return null
  const raw = rawArrowKeys(menu)
  // up / down move the cursor on every menu (menuClientHover); with Shift they scroll a line
  const arrows = menuClientHover(menu)
  // keycodes: the keydown block
  switch (ev.key) {
    case 'PageUp':
      return raw ? null : 'pageUp'
    case 'PageDown':
      return raw ? null : 'pageDown'
    case 'End':
      return raw ? null : 'end'
    case 'Home':
      return raw ? null : 'home'
    case 'ArrowUp':
      if (raw) return null
      return arrows && !ev.shiftKey ? 'up' : 'lineUp'
    case 'ArrowDown':
      if (raw) return null
      return arrows && !ev.shiftKey ? 'down' : 'lineDown'
    case 'ArrowLeft':
      return !raw && ev.shiftKey ? 'lineUp' : null
    case 'ArrowRight':
      return !raw && ev.shiftKey ? 'lineDown' : null
  }
  if (ev.code === 'NumpadSubtract') return raw || menuHasCustomDash(menu) ? null : 'pageUp'
  if (ev.code === 'NumpadAdd') return raw ? null : 'pageDown'
  // characters: the keypress block (raw input in the macro editor is the server's)
  if (menu.tag === 'macro_mapping') return null
  if (ev.key.length !== 1) return null
  let ch = ev.key
  // in a multiselect arrows menu, space is the toggle (sent as `.` by the official client, so it does not page)
  if (ch === ' ' && menu.flags & MenuFlag.MULTISELECT && arrows) ch = '.'
  switch (ch) {
    case '-':
      return menuHasCustomDash(menu) ? null : 'pageUp'
    case '<':
      return menu.tag === 'travel' ? null : 'pageUp'
    case ';':
      return 'pageUp'
    case '>':
      return menu.tag === 'travel' ? null : 'pageDown'
    case '+':
    case ' ':
      return 'pageDown'
  }
  return null
}

// ---------------------------------------------------------------------------
// popups: ui-layouts.js `scroller_handle_key`

export type ScrollKey = 'lineUp' | 'lineDown' | 'pageUp' | 'pageDown' | 'home' | 'end'

/**
 * Popup types whose text the official client scrolls itself
 * (ui-layouts.js: every layout that calls `scroller_handle_key`). The rest
 * (progress bar, seed selection, new game, message line) leave every key to
 * the server.
 */
export const SCROLLER_POPUPS = new Set([
  'describe-generic',
  'describe-feature-wide',
  'describe-item',
  'describe-spell',
  'describe-cards',
  'describe-god',
  'describe-monster',
  'version',
  'game-over',
  'formatted-scroller',
])

/**
 * What a key does to a popup's scroller, or null when the key is the
 * server's. Alt and Ctrl combinations are never the scroller's (Shift is not
 * looked at: `scroller_handle_key` tests `event.shiftkey`, which no browser
 * sets, so Shift+Up scrolls a line there too). The feature popup leaves `<`
 * and `>` alone (its own keys), and the god and monster popups leave space
 * (and Enter) to the server.
 */
export function scrollKeyIntent(popupType: string, ev: NavKeyLike): ScrollKey | null {
  if (!SCROLLER_POPUPS.has(popupType)) return null
  if (ev.altKey || ev.ctrlKey) return null
  switch (ev.key) {
    case 'PageUp':
      return 'pageUp'
    case 'PageDown':
      return 'pageDown'
    case 'End':
      return 'end'
    case 'Home':
      return 'home'
    case 'ArrowUp':
      return 'lineUp'
    case 'ArrowDown':
      return 'lineDown'
  }
  if (ev.key.length !== 1) return null
  if ((popupType === 'describe-god' || popupType === 'describe-monster') && ev.key === ' ') return null
  if (popupType === 'describe-feature-wide' && (ev.key === '<' || ev.key === '>')) return null
  switch (ev.key) {
    case ' ':
    case '>':
    case '+':
    case "'":
      return 'pageDown'
    case '-':
    case '<':
    case ';':
      return 'pageUp'
  }
  return null
}
