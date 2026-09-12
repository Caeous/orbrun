import {
  cm,
  formattedStringToHtml,
  formattedStringToText,
  topMenu,
  topPopup,
  MenuFlag,
  Keys,
  type ClientMessage,
  type GameState,
  type MenuState,
  type Popup,
} from '@orbrun/webtiles'
import type { Gamedata } from '@orbrun/gamedata'
import type { Dir8 } from '@orbrun/scene'
import { controlsSheet } from './controls-sheet'
import { h, clear, escapeHtml } from './dom'
import { Osk, oskPrompts, type OskOp, type OskTarget } from './osk'
import commands from '../data/commands.json'
import { FocusNav, type Focusable, type FocusInfo, type FocusOp, type FocusOptions } from './focus'
import { scrapeCrt } from './crt-scrape'
import { focusFallback, promptButtons, type Action } from './bindings'
import { BATTLE_COMMANDS, COMMAND_GROUPS, GAMEPAD_COMMAND_KEYS, HELP_COMMAND, REPEAT_COMMAND, type CommandEntry, type CommandGroup } from './command-menu'
import { VIEW_OPTIONS } from './servers'
import { glyph, glyphName } from './glyphs'
import type { Button, PadKind } from './gamepad'
import { isFocusMode, promptLead, type Context, type Mode, type ParsedPrompt } from './context'
import type { InputDevice } from './game'
import {
  cycleHeadersTarget,
  itemSelectable,
  lineDownTarget,
  lineUpTarget,
  menuClientHover,
  menuHasSections,
  menuHoverSelectKey,
  menuKeyIntent,
  moreSwitchKeycode,
  parseMoreSwitches,
  nextHoverableItem,
  relativeHover,
  relativeHoverTarget,
  scrollKeyIntent,
  snapHoverTarget,
  SCROLLER_POPUPS,
  type MenuNavKey,
  type NavKeyLike,
  type ScrollKey,
  type Visible,
} from './menu-nav'

/**
 * The game menu (main.cc `GameMenu`, opened by Esc and by the action panel's
 * button): the one server menu Orbrun adds a row of its own to, since its
 * list is fixed on the server and Orbrun's settings belong on the screen that
 * already holds Save and Quit. The row reads like the server's own
 * (menu.cc `MenuEntry::_get_text_preface`: hotkey, " - ", label).
 */
const GAME_MENU_TAG = 'game_menu'
const GAME_MENU_ROW_KEY = 'o'
const GAME_MENU_ROW_TEXT = ` ${GAME_MENU_ROW_KEY} - Orbrun settings`

export interface OverlayHooks {
  /** the connected controller's family, for the glyphs on the controls sheet */
  padKind?(): PadKind
  send(msg: ClientMessage): void
  gamedata(): Gamedata | null
  watching(): boolean
  /** client-side overlay closed (palette, system menu) */
  onClientOverlayChange(): void
  onSystemAction(op: string): void
  settingsPanel(): HTMLElement
}

export interface TileRef {
  t: number
  /** the server's texture index; absent for a tile named by its global id (a monster's `fg_idx`, a doll part) */
  tex?: number
  ymax?: number
  /** offsets within the cell, as an mcache entry gives them */
  ox?: number
  oy?: number
}

/** An action a popup offers, in the order the pad's face buttons take them. */
export interface PopupAction {
  /** the key the official client would send for it */
  key: string
  label: string
  send(): void
}

/** Draw a list of tile refs into a canvas (menu icons, describe headers). */
function tileCanvas(gd: Gamedata | null, tiles: TileRef[], scale = 1): HTMLCanvasElement {
  const c = h('canvas', { class: 'tile', width: 32 * scale, height: 32 * scale })
  c.style.width = 32 * scale + 'px'
  c.style.height = 32 * scale + 'px'
  if (!gd) return c
  const ctx = c.getContext('2d')
  if (!ctx) return c
  ctx.imageSmoothingEnabled = false
  for (const t of tiles) {
    const rect = gd.tile(t.t, t.tex === undefined ? undefined : String(t.tex))
    if (!rect) continue
    const img = gd.atlas(rect.atlas)
    if (!img) continue
    let hh = rect.h
    if (t.ymax !== undefined && t.ymax < rect.oy + rect.h) hh = Math.max(0, t.ymax - rect.oy)
    if (hh <= 0) continue
    const x = (rect.ox + (t.ox || 0)) * scale
    const y = (rect.oy + (t.oy || 0)) * scale
    ctx.drawImage(img as CanvasImageSource, rect.sx, rect.sy, rect.w, hh, x, y, rect.w * scale, hh * scale)
  }
  return c
}

function fmtBody(txt: string): string {
  return txt
    .split('\n\n')
    .map((s) => '<pre>' + formattedStringToHtml(s) + '</pre>')
    .filter((s) => s !== '<pre></pre>')
    .join('')
    .split('\n')
    .join('<br>')
}

/**
 * A god describe popup's pane (ui-layouts.js describe_god). The overview is
 * the god's description, a Title/Favour table and the powers it grants, each
 * in the god's colour (a power the player cannot use yet comes through
 * darkgrey); the other panes are the powers text with its table, the wrath,
 * and whatever `extra` table the god adds.
 */
function godPane(d: Record<string, unknown>, pane: number): HTMLElement {
  const str = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : '')
  const colour = typeof d.colour === 'number' ? (d.colour as number) : 7
  const body = h('div', { class: 'body' })
  const tbl = (txt: string) => h('div', { class: 'tbl', html: formattedStringToHtml(txt) })
  if (pane === 1) {
    body.append(h('div', { html: fmtBody(str('powers')) }))
    if (str('info_table')) body.append(tbl(str('info_table')))
    return body
  }
  if (pane === 2) return h('div', { class: 'body', html: fmtBody(str('wrath')) })
  if (pane === 3) {
    body.append(tbl(str('extra')))
    return body
  }
  body.append(h('div', { class: 'desc', html: fmtBody(str('description')) }))
  const table = h('table', { class: 'god-favour' })
  for (const [label, value] of [
    ['Title', str('title')],
    ['Favour', str('favour')],
  ])
    table.append(h('tr', null, h('td', null, label), h('td', null, '-'), h('td', { class: 'fg' + colour, html: formattedStringToHtml(value) })))
  body.append(table)
  const powers = h('div', { class: 'god-powers' })
  powers.append(h('div', { class: 'power' }, h('div', null, 'Granted powers'), h('div', null, '(Cost)')))
  // the server's list arrives as a block of lines; the official client drops its
  // heading and its trailing blank, then splits each line into the power and its cost
  for (const line of str('powers_list').split('\n').slice(3, -1)) {
    const m = /^(<[a-z]*>)?(.*\.) *(\(.*\))?$/.exec(line)
    if (!m) continue
    powers.append(h('div', { class: 'power fg' + (m[1] === '<darkgrey>' ? 8 : colour) }, h('div', null, m[2]), h('div', null, m[3] || '')))
  }
  body.append(powers)
  return body
}

/**
 * The tiles a monster describe popup draws in its header (ui-layouts.js
 * describe_monster). A monster is named by its foreground tile id, not by a
 * `tile` field: a plain sprite is that one tile, while a monster built from a
 * player doll or an mcache is the stack of its parts, each at the offset its
 * mcache entry gives it. A part taller than a cell hangs below the top, as
 * draw_dolls does.
 */
export function monsterTiles(gd: Gamedata | null, d: Record<string, unknown>): TileRef[] {
  const fg = typeof d.fg_idx === 'number' ? d.fg_idx : 0
  const doll = (Array.isArray(d.doll) ? d.doll : []).filter((x): x is [number, number] => Array.isArray(x) && typeof x[0] === 'number')
  const mcache = (Array.isArray(d.mcache) ? d.mcache : []).filter((x): x is [number, number, number] => Array.isArray(x) && typeof x[0] === 'number')
  const r = gd?.ranges
  const drop = (id: number) => Math.max(0, (gd?.tile(id)?.h ?? 32) - 32)
  if (r && fg >= r.mainMax && doll.length) {
    const off = new Map<number, [number, number, number]>()
    for (const m of mcache) off.set(m[0], m)
    const base = drop(doll[0][0])
    return doll.map((part) => {
      const m = off.get(part[0])
      return { t: part[0], ymax: part[1], ox: m?.[1] || 0, oy: base + (m?.[2] || 0) }
    })
  }
  if (r && fg >= r.mcacheStart && mcache.length) return mcache.map((m) => ({ t: m[0], ox: m[1], oy: m[2] + drop(m[0]) }))
  return fg > 0 ? [{ t: fg }] : []
}

/**
 * A spell's description, as the official format_spell_html does: the `Level:`
 * line is one field per column, so its spaces are held together rather than
 * left to wrap.
 */
function spellDescHtml(txt: string): string {
  const m = txt.match(/(^[\s\S]*\n\n)(Level: [^\n]+)(\n\n[\s\S]*)$/)
  if (!m) return fmtBody(txt)
  // the spaces carry a marker across the colour pass, so they become non-breaking in the
  // line's own text and not inside the spans the colour tags turn into
  const level = formattedStringToHtml(m[2].replace(/ /g, '\u0000')).replace(/\u0000/g, '&nbsp;')
  return fmtBody(m[1]) + level + fmtBody(m[3])
}

/**
 * One entry of a describe popup's `actions` string ("(w)ield", "or (d)rop.").
 * Mirrors clickify_action in the official ui-layouts.js: a trailing period and
 * an "or " prefix are decoration, the key is the parenthesised character.
 */
interface ActionWord {
  prefix: string
  suffix: string
  text: string
  key: string | null
}

function parseActionWord(w: string): ActionWord {
  let suffix = ''
  let prefix = ''
  if (w.endsWith('.')) {
    suffix = '.'
    w = w.slice(0, -1)
  }
  if (w.startsWith('or ')) {
    prefix = 'or '
    w = w.substr(3)
  }
  const m = w.match(/\(.\)/)
  return { prefix, suffix, text: w, key: m ? m[0][1] : null }
}

/**
 * What a formatted scroller does with keys it never prints, as a describe
 * popup's actions line would spell them. The dungeon overview (Ctrl-O,
 * dgn-overview.cc `_process_command`: `G` travels, `_` travels to an altar,
 * `$` searches the shops, `!` annotates; it has no tag, its text opens with
 * its own title behind colour tags and indent: `<lightgrey>    <white>Dungeon
 * Overview...`, as CDI sent it on 2026-09-10). The help screen (command.cc `help_popup`, tag `help`:
 * every "<w>k</w>: Section" line of its menu is a key it takes; the manual
 * replaces the text when one is pressed, so the tag names it, not the text).
 */
function scrollerActions(tag: string, text: string, pushed = text): string {
  if (/^(\s|<[^>]+>)*Dungeon Overview and Level Annotations/.test(text)) return '(G) Travel, (_) Altar, ($) Shops, (!) Annotate'
  if (tag === 'help' || /Dungeon Crawl Help/.test(text)) {
    // the menu is the text the popup was pushed with; a section shown since replaced it
    const out: string[] = []
    const re = /<w>(.)<\/w>: ([^\n<]+)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(pushed))) out.push('(' + m[1] + ') ' + m[2].trim())
    return out.join(', ')
  }
  return ''
}

/**
 * The travel depth prompt's own keys (travel.cc `_travel_depth_munge`), on
 * the pad's keyboard as a labelled row: each is sent at once, and the server
 * asks again with the moved default, which Enter then takes.
 */
const TRAVEL_DEPTH_KEYS: { ch: string; label: string }[] = [
  { ch: '<', label: 'Up' },
  { ch: '>', label: 'Down' },
  { ch: '^', label: 'Entrance' },
  { ch: '$', label: 'Deepest' },
]

/** The `actions` string is joined with ", " on the server (describe.cc _actions_desc). */
function parseActions(text: string): { key: string; label: string }[] {
  if (!text) return []
  const out: { key: string; label: string }[] = []
  for (const w of text.split(', ')) {
    const a = parseActionWord(w)
    if (!a.key) continue
    // "(r)ead" is Read; "(G) Travel" (a row the client wrote in the overview's own style) is Travel
    const label = (/^\(.\) /.test(a.text) ? a.text.slice(4) : a.text.replace(/[()]/g, '')).trim()
    out.push({ key: a.key, label: label ? label[0].toUpperCase() + label.slice(1) : a.key })
  }
  return out
}

function clickifyActions(text: string): string {
  return text
    .split(', ')
    .map((w) => {
      const a = parseActionWord(w)
      const attr = a.key ? ` data-hotkey="${escapeHtml(a.key)}"` : ''
      return a.prefix + `<span${attr}>${escapeHtml(a.text)}</span>` + a.suffix
    })
    .join(', ')
}

/**
 * A Range over `[start, end)` of an element's text, wherever the tags fall.
 * The range may cross element boundaries (a more-line switch runs from a
 * plain `[` into the coloured span holding its key); `extractContents` then
 * clones the ancestors it only half covers, so the colours survive the move.
 */
function textRange(root: HTMLElement, start: number, end: number): Range | null {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let at = 0
  let from: { node: Node; offset: number } | null = null
  let to: { node: Node; offset: number } | null = null
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const len = node.textContent?.length ?? 0
    if (!from && at + len >= start) from = { node, offset: start - at }
    if (!to && at + len >= end) to = { node, offset: end - at }
    at += len
  }
  if (!from || !to) return null
  const range = root.ownerDocument.createRange()
  range.setStart(from.node, from.offset)
  range.setEnd(to.node, to.offset)
  return range
}

/** Official textinput.js keeps the last ten entries per historyId (up/down recall). */
const HISTORY_SIZE = 10
const histories: Record<string, string[]> = {}

// ------------------------------------------------------------------ overlays

type ClientOverlayKind = 'choices' | 'palette' | 'system' | 'bindings' | 'settings'

/**
 * One entry of the command catalogue (data/commands.json), generated from the
 * server's default key table (cmd-keys.h). `mode` is the key-table section the
 * command lives in; `key` is the literal the official client would send, `ck`
 * the name of a CK_* constant for keys that have no character.
 */
interface CatalogueCommand {
  id: string
  label: string
  category: string
  mode: 'command' | 'levelmap' | 'targeting' | 'menu'
  key?: string
  ck?: string
}
const CATALOGUE = commands as CatalogueCommand[]

/** Categories of one key-table section, catalogue order, 'all' first. */
function categoriesFor(mode: string): string[] {
  return ['all', ...Array.from(new Set(CATALOGUE.filter((c) => c.mode === mode).map((c) => c.category)))]
}

/** The message the official client sends for a catalogue command's key. */
function commandMessage(c: CatalogueCommand): ClientMessage | null {
  if (c.ck) {
    const code = (Keys as unknown as Record<string, number>)[c.ck]
    return code === undefined ? null : cm.key(code)
  }
  if (!c.key) return null
  const code = c.key.charCodeAt(0)
  // control characters, Esc, Enter, Tab go as keycodes; everything else is typed text
  return c.key.length === 1 && code < 32 ? cm.key(code) : cm.input(c.key)
}

export type ClientOverlayOp =
  | 'next'
  | 'prev'
  | 'select'
  | 'cancel'
  | 'pageNext'
  | 'pagePrev'
  | 'bumperNext'
  | 'bumperPrev'
  | 'left'
  | 'right'
  | 'catNext'
  | 'catPrev'
  | 'keyboard'
  | 'space'
  | 'submit'
  | 'backspace'
  | 'first'
  | 'last'

/** LB / RB on a new-game grid move the cursor this many rows. */
const NEWGAME_PAGE_ROWS = 5

export class Overlays {
  root: HTMLElement
  private hooks: OverlayHooks
  private lastUiRev = -1
  private menuEl: HTMLElement | null = null
  /** the menu `menuEl` shows (the top one), for the scroll memo */
  private menuTop: MenuState | null = null
  /** shows or hides the top menu's `more` line from its overflow; run before any scroll is set, since it changes the body's height */
  private menuMore: (() => void) | null = null
  private hovered = -1
  /**
   * The switches of the top menu's more line, once they are the cursor's
   * (the shop's `[!] buy|examine`, `[/] sort`, `[Enter] buy marked items`,
   * `[Esc] exit`), and where the cursor sits among them: -1 while it is on
   * the rows. Down past the last row walks into them, up walks back.
   */
  private menuFooter: { key: string; label: string; el: HTMLElement }[] = []
  private menuFooterIndex = -1
  /** the menu the footer cursor belongs to, so a rebuild of the same menu keeps it */
  private menuFooterTag = ''
  /**
   * Orbrun's own row on the game menu, and the server item it is drawn above
   * (the separator before Quit). It sits inside the menu's list but is kept
   * out of `menuBody`, so every index the server sends still lines up with
   * the element that draws it.
   */
  private menuExtra: { at: number; el: HTMLElement } | null = null
  /** the cursor is on that row: the server's hover stays where it is, unlit */
  private menuExtraOn = false
  /** the game menu the row was last built for, so a fresh opening seats the cursor once */
  private gameMenuFor: MenuState | null = null
  /** the row the game menu was last left on, so it opens where the player left it */
  private gameMenuLast: number | 'extra' = -1
  private scrollTimer: number | null = null
  /** the top popup's element and state, for its scroller */
  private popupEl: HTMLElement | null = null
  private popupTop: Popup | null = null
  /**
   * Scroll position of each server overlay's body, by the state object it
   * draws, so a rebuild (an `update_menu_items` chunk, a `ui-state`, a
   * `menu_scroll`) keeps the reader's place; the official client keeps its
   * DOM and never has to.
   */
  private scrollMemo = new WeakMap<object, number>()
  /** the last server scroll line applied per popup (`Popup.scrollSeq`) */
  private popupScrollApplied = new WeakMap<Popup, number>()
  private scrollerTimer: number | null = null
  /** a scroll the server asked for is being applied: do not report it back (ui-layouts.js scroller_from_server) */
  private scrollerFromServer = false
  private clientOverlay: {
    kind: ClientOverlayKind
    el: HTMLElement
    focus: number
    items: HTMLElement[]
    filter?: HTMLInputElement
    category?: number
    categories?: string[]
    rebuild?: () => void
    /** what closing this one goes back to: the menu it was opened from, on the row that opened it */
    back?: () => void
  } | null = null
  /** the pause menu's last row, by its label, and how it was drawn: it opens again where it was left, and Back off the screens it leads to comes back to it */
  private systemAt: string | null = null
  private osk = new Osk(oskPrompts(), () => this.hooks.padKind?.() ?? 'generic')
  /** the server-driven text field the pad types into (init_input, menu filter, seed) */
  private textTarget: OskTarget | null = null
  /** who spoke last (`setDevice`): a server text prompt brings the on-screen keyboard up only for the pad */
  private device: InputDevice = 'keyboard'
  private currentTextTarget(): OskTarget | null { return this.textTarget }
  /** the seed-selection popup's field, wired when the matching init_input is up */
  private seedInput: HTMLInputElement | null = null
  private actions: PopupAction[] = []
  private gen = 0
  /** the focus layer's cursor over the top server overlay, or over the prompt strip */
  private nav = new FocusNav()
  /** focusables the top server overlay registered on its last build, with its identity and how the cursor behaves there */
  private focusables: Focusable[] = []
  private focusScreen = ''
  private focusOpts: FocusOptions = {}
  private focusInitial = 0
  /** the server moved the new-game focus itself: the cursor goes to `focusInitial` even on the same screen */
  private focusForce = false
  /** the prompt card (yes/no and multi-choice prompts; --more-- has none) and its focusables */
  private promptEl: HTMLElement | null = null
  private promptKey = ''
  private promptFocusables: Focusable[] = []
  /** where the cursor starts on a fresh card: the letter being moved on a letter picker, else the first chip */
  private promptInitial = 0
  /** one row of chips walked linearly, or the letter picker's grid */
  private promptFocusOpts: FocusOptions = { wrap: true, linear: true }
  /**
   * The keyboard has moved the cursor on the current prompt. Until then Enter
   * and Escape stay raw, as in the official client: a yes/no in the message
   * pane takes both as its default answer (prompt.cc `yesno`, `f_keyfilter`),
   * which a client-side "Yes" under Enter would override.
   */
  /**
   * The keyboard has moved the focus layer's cursor on the screen it is on:
   * only then does its Enter fire the focused item on a prompt card or a
   * popup. Before that the key stays raw, so the server's own Enter applies
   * (a yes/no's default answer, a popup's Enter, such as joining at an altar
   * from the god's description). Cleared whenever the cursor is reseated on a
   * rebuilt or a new screen (`syncFocus`).
   */
  private keyArmed = false
  /** newgame: the server's `button_focus` at the last build, so a move of its own re-seats our cursor and an echo of ours does not */
  private newgameFocus = ''
  /** bumped whenever either focus set is rebuilt, so syncFocus re-seats the cursor once */
  private focusGen = 0
  private focusSynced = -1

  constructor(host: HTMLElement, hooks: OverlayHooks) {
    this.hooks = hooks
    this.root = h('div', { class: 'overlay-stack' })
    host.append(this.root)
  }

  get hasClientOverlay(): boolean {
    return !!this.clientOverlay
  }

  /**
   * The text field the pad can type into, when one is up: a server text
   * prompt, a menu filter (Ctrl-F title_prompt) or the seed field. Context
   * should treat the game as in 'text' mode while this is non-null.
   */
  activeInput(): HTMLInputElement | HTMLTextAreaElement | null {
    return this.textTarget?.input ?? null
  }

  /** The on-screen keyboard is showing (for either a server field or a client overlay). */
  get oskVisible(): boolean {
    return this.osk.visible
  }

  /**
   * The top popup scrolls its own text (a describe screen, the help, the
   * game-over report): space and the paging keys belong to the scroller
   * there, not to the cursor.
   */
  get popupScrolls(): boolean {
    return !!this.popupTop && SCROLLER_POPUPS.has(this.popupTop.type)
  }

  /** Actions the top popup offers, in pad order (A, X, Y, LT, RT). */
  popupActions(): { key: string; label: string }[] {
    return this.actions.map((a) => ({ key: a.key, label: a.label }))
  }

  /** Fire the i-th popup action. Returns false when there is none. */
  triggerPopupAction(i: number): boolean {
    const a = this.actions[i]
    if (!a) return false
    a.send()
    return true
  }

  update(state: GameState) {
    if (state.rev.ui === this.lastUiRev) return
    this.lastUiRev = state.rev.ui
    this.gen++
    const oskWasUp = this.osk.visible && !!this.textTarget
    // remember where the reader was in the overlays about to be rebuilt
    this.memoScroll()
    // remove server-driven overlays and rebuild
    for (const el of Array.from(this.root.children)) {
      const he = el as HTMLElement
      if (he === this.promptEl) continue
      if (!he.dataset.client || he.classList.contains('osk')) he.remove()
    }
    this.menuEl = null
    this.menuTop = null
    this.menuMore = null
    this.menuFooter = []
    this.menuExtra = null
    this.popupEl = null
    this.popupTop = null
    this.textTarget = null
    this.seedInput = null
    this.actions = []
    this.focusables = []
    this.focusScreen = ''
    this.focusOpts = {}
    this.focusInitial = 0
    this.focusForce = false
    this.focusGen++
    // menus first (they are below popups pushed later, but both exist at once rarely)
    const menus = state.menus
    const popups = state.ui
    // Display order: the server's ui stack interleaves; we show menus then popups, the last on top.
    // The focus set is the top overlay's in mode priority (dialog > popup > menu > crt): each
    // renderer registers over the one before, so the last to register wins.
    // a `ui_cutoff` hid what was up when it arrived (state.ts applyCutoff), as game.js handle_set_ui_cutoff does
    menus.forEach((m, i) => {
      const el = this.renderMenu(state, m, i === menus.length - 1)
      if (m.hidden) el.classList.add('hidden')
      this.root.append(el)
    })
    if (!this.menuExtra) {
      this.gameMenuFor = null
      this.menuExtraOn = false
    }
    popups.forEach((p, i) => {
      const el = this.renderPopup(state, p, i === popups.length - 1)
      if (p.hidden) el.classList.add('hidden')
      this.root.append(el)
    })
    if (state.uiState === 1 && menus.length === 0 && popups.length === 0) this.root.append(this.renderCrt(state))
    if (state.dialog) {
      const el = h('div', { class: 'popup dialog-html', html: state.dialog })
      this.root.append(el)
      // show_dialog html: whatever buttons or links it carries are the choices.
      // client.js handle_dialog wires every `[data-key]` element to send that
      // key, and nothing else: the save-transfer question the launcher asks at
      // game start (dgamelaunch-config crawl-git-launcher.sh) is two such
      // buttons, so without the wiring neither a click nor the cursor answers it.
      // The key goes as `input` bytes (client.js send_bytes), never as a `key`
      // message: the server writes `input` to the process's stdin, where the
      // launcher's `read` waits, and hands everything else to crawl's own
      // socket (process_handler.py handle_input), which is not open yet while
      // the launcher is still asking. A `key` would vanish and the question stay.
      const items: Focusable[] = []
      el.querySelectorAll('[data-key], button, input[type=button], input[type=submit], a').forEach((b, i) => {
        const be = b as HTMLElement
        const label = ((be as HTMLInputElement).value || be.textContent || 'OK').trim()
        const key = be.dataset.key
        const activate = key ? () => this.hooks.send(cm.inputBytes([key.charCodeAt(0)])) : () => be.click()
        // a click leaves the button focused in the DOM: the cursor follows it there,
        // so Enter right after acts on what was clicked, not on where the cursor was
        const at = i
        be.addEventListener('click', () => {
          this.nav.focus(at)
          if (key) activate()
        })
        // B and Escape answer the way the dialog's own refusal does. The html
        // lays the choices out itself (the transfer question floats them side by
        // side), so the set is linear: every arrow walks it whatever the layout.
        items.push({ label, el: be, activate, row: 0, col: i, cancel: /^(no|cancel)$/i.test(label) })
      })
      this.registerFocus('dialog', items, { wrap: true, linear: true })
    }
    const ti = state.textInput
    if (ti && !this.hooks.watching()) {
      if (ti.type === 'seed-selection' && this.seedInput) this.wireInput(this.seedInput, ti, true)
      else this.root.append(this.renderTextInput(state))
    }
    // a prompt of the server's comes with the on-screen keyboard up when the pad spoke last, so it has
    // its keys at once; the keyboard follows the field across rebuilds. After a physical keyboard or the
    // mouse the field stands alone and takes the typing (the on-screen keyboard would cover it and its
    // prompt, and show none of what was typed); X still brings it up (`oskOp`). The new game's seed
    // field waits to be asked.
    const tt = this.currentTextTarget() // reassigned by the render helpers above
    const prompt = !!ti && ti.type !== 'seed-selection' && !this.hooks.watching() && this.device === 'pad'
    if (tt && (oskWasUp || prompt)) this.osk.attach(tt, tt.input.closest('.popup') || this.root)
    else if (!tt && !this.clientOverlay) this.osk.detach()
    // now that the new elements are laid out: the reader's place, or the scroll the server asked for
    this.restoreScroll()
  }

  /** Record the top menu's and top popup's body scroll before their elements go. */
  private memoScroll() {
    if (this.menuTop) {
      const body = this.menuEl?.querySelector('.body') as HTMLElement | null
      if (body) this.scrollMemo.set(this.menuTop, body.scrollTop)
    }
    if (this.popupTop) {
      const body = this.popupScrollBody()
      if (body) this.scrollMemo.set(this.popupTop, body.scrollTop)
    }
  }

  /**
   * After a rebuild: put each body back where it was, then let the server's
   * word win. A menu keeps its hover in view (menu.js handle_size_change); a
   * popup takes the server's scroll line when a new one arrived and it was
   * not an echo of our own (ui-layouts.js recv_ui_scroll,
   * formatted_scroller_update: `!from_webtiles || is_watching()`).
   */
  private restoreScroll() {
    if (this.menuTop && this.menuEl) {
      // the `more` line takes its share of the height first, or the scroll would be clamped to a taller body
      this.menuMore?.()
      const body = this.menuEl.querySelector('.body') as HTMLElement | null
      const memo = this.scrollMemo.get(this.menuTop)
      if (body && memo !== undefined) body.scrollTop = memo
      this.scrollHoverIntoView()
    }
    const p = this.popupTop
    const body = this.popupScrollBody()
    if (p && body) {
      const memo = this.scrollMemo.get(p)
      if (memo !== undefined) body.scrollTop = memo
      if (p.scrollSeq !== undefined && this.popupScrollApplied.get(p) !== p.scrollSeq) {
        this.popupScrollApplied.set(p, p.scrollSeq)
        if (typeof p.scroll === 'number' && (!p.scrollFromWebtiles || this.hooks.watching())) {
          this.scrollerFromServer = true
          this.scrollToLine(body, p.scroll)
          this.scrollerFromServer = false
        }
      }
    }
  }

  // ------------------------------------------------------------------ menus

  private renderMenu(state: GameState, menu: MenuState, top: boolean): HTMLElement {
    const gd = this.hooks.gamedata()
    const el = h('div', { class: 'popup menu menu_' + menu.tag })
    if (menu.type === 'crt') {
      el.append(this.crtBody(state, menu.tag, top))
      return el
    }
    const title = h('div', { class: 'title', html: formattedStringToHtml(menu.title?.text || '') })
    const tp = menu.titlePrompt as { prompt: string; raw: boolean } | null | undefined
    if (tp && !tp.raw) {
      // official menu.js title_prompt: the title becomes the prompt plus a field;
      // Enter sends the text with a CR, Esc (focusout there) sends ESC
      title.innerHTML = escapeHtml(tp.prompt)
      const input = h('input', { class: 'text', type: 'text' })
      title.append(input)
      const target: OskTarget = {
        input,
        submit: () => this.hooks.send(cm.textInput(input.value + '\r')),
        cancel: () => this.hooks.send(cm.key(27)),
        special: (ch) => {
          // macro_mapping: '?' is help, sent as a key even inside the prompt (menu.js:714)
          if (menu.tag === 'macro_mapping' && ch === '?') {
            this.hooks.send(cm.key(63))
            return true
          }
          return false
        },
      }
      input.addEventListener('keydown', (ev) => {
        ev.stopPropagation()
        if (ev.key === 'Enter') {
          ev.preventDefault()
          target.submit()
        } else if (ev.key === 'Escape') {
          ev.preventDefault()
          target.cancel()
        } else if (ev.key.length === 1 && !ev.ctrlKey && !ev.altKey && !ev.metaKey && target.special!(ev.key)) ev.preventDefault()
      })
      if (!this.hooks.watching()) setTimeout(() => input.focus(), 30)
      this.textTarget = target
    }
    el.append(title)
    const body = h('div', { class: 'body' })
    const ol = h('ol')
    const arrows = !!(menu.flags & MenuFlag.ARROWS_SELECT)
    for (let i = 0; i < menu.items.length; i++) {
      const it = menu.items[i]
      const li = h('li', { class: 'level' + (it?.level ?? 2) + ' fg' + (it?.colour ?? 7) })
      if (!it) {
        li.textContent = '...'
        ol.append(li)
        continue
      }
      if (it.tiles && it.tiles.length) li.append(tileCanvas(gd, it.tiles))
      li.append(h('span', { html: formattedStringToHtml(it.text || '') }))
      const selectable = (it.level ?? 2) === 2 && (menu.tag === 'use_item' || (it.hotkeys && it.hotkeys.length) || arrows)
      if (selectable) {
        li.classList.add('selectable')
        li.addEventListener('click', () => {
          if (arrows) {
            this.setHover(menu, i, true)
            this.hooks.send(cm.key(menu.flags & MenuFlag.MULTISELECT ? 32 : 13))
          } else if (it.hotkeys && it.hotkeys.length) this.hooks.send(cm.key(it.hotkeys[0]))
        })
      }
      if (it.preselected) li.classList.add('preselected')
      if (i === menu.last_hovered) li.classList.add('hovered')
      ol.append(li)
    }
    if (menu.tag === GAME_MENU_TAG) this.addGameMenuRow(menu, ol, top)
    body.append(ol)
    el.append(body)
    // official menu.js update_more: `more` when the list overflows, else `alt_more`,
    // with XXX standing for the scroll position; measured once laid out and on scroll
    const more = h('div', { class: 'more hidden' })
    el.append(more)
    const updateMore = () => this.updateMore(body, more, menu)
    body.addEventListener('scroll', updateMore, { passive: true })
    requestAnimationFrame(updateMore)
    if (top) {
      this.menuEl = el
      this.menuTop = menu
      this.menuMore = updateMore
      this.hovered = menu.last_hovered
      if (menu.tag === GAME_MENU_TAG) this.seatGameMenu(menu)
    }
    return el
  }

  /**
   * Orbrun's settings row on the game menu. It goes where the menu's own
   * options end — above the separator the server draws before Quit — and is
   * marked `extra` so the rows the server sent keep their indices.
   */
  private addGameMenuRow(menu: MenuState, ol: HTMLElement, top: boolean) {
    let at = menu.items.length
    for (let i = menu.items.length - 1; i > 0; i--) {
      if ((menu.items[i]?.level ?? 2) < 2) {
        at = i
        break
      }
    }
    const li = h('li', { class: 'level2 fg7 selectable extra' }, h('span', { class: 'tile-glyph' }, '\u2699'), h('span', null, GAME_MENU_ROW_TEXT))
    li.addEventListener('click', () => this.openGameMenuRow())
    ol.insertBefore(li, ol.children[at] ?? null)
    if (top) this.menuExtra = { at, el: li }
  }

  /**
   * The cursor on a game menu just built: a fresh one opens on the row it was
   * left on last time (the server seats its own hover on the first row,
   * MF_INIT_HOVER), a rebuild of the same one keeps where it is.
   */
  private seatGameMenu(menu: MenuState) {
    if (this.gameMenuFor === menu) {
      if (this.menuExtraOn) this.setExtraHover(true)
      return
    }
    this.gameMenuFor = menu
    this.menuExtraOn = false
    if (this.gameMenuLast === 'extra') this.setExtraHover(true)
    else if (this.gameMenuLast >= 0) this.setHover(menu, this.gameMenuLast)
  }

  /** Move the cursor onto Orbrun's row, or off it and back onto the server's. */
  private setExtraHover(on: boolean) {
    this.menuExtraOn = on
    if (on) {
      this.gameMenuLast = 'extra'
      this.menuFooterIndex = -1
      for (const f of this.menuFooter) f.el.classList.remove('hovered')
      this.menuBody()?.lis.forEach((li) => li.classList.remove('hovered'))
    }
    this.menuExtra?.el.classList.toggle('hovered', on)
  }

  /** Orbrun's row chosen: its settings open over the menu, which is still there behind them. */
  private openGameMenuRow() {
    this.setExtraHover(true)
    this.showSettings()
  }

  /**
   * Up or down between the server's rows and Orbrun's. The row is in the ring
   * where it is drawn, so the step onto it is the step that would cross it:
   * down off the last row above it, up off the first row below. True when the
   * cursor moved.
   */
  private extraStep(menu: MenuState, down: boolean): boolean {
    const extra = this.menuExtra
    if (!extra || menu !== this.menuTop) return false
    if (this.menuExtraOn) {
      const to = down ? nextHoverableItem(menu, false, extra.at, true) : nextHoverableItem(menu, true, extra.at - 1, true)
      if (to < 0) return true
      this.setHover(menu, to)
      return true
    }
    if (this.menuFooterIndex >= 0 || menu.last_hovered < 0) return false
    const from = menu.last_hovered
    if (down && from < extra.at) {
      const next = nextHoverableItem(menu, false, from)
      if (next >= 0 && next < extra.at) return false
    } else if (!down && from >= extra.at) {
      const prev = nextHoverableItem(menu, true, from)
      if (prev < 0 || prev >= extra.at) return false
    } else return false
    this.setExtraHover(true)
    return true
  }

  private updateMore(body: HTMLElement, more: HTMLElement, menu: MenuState) {
    const overflow = body.scrollHeight > body.clientHeight + 1
    let shown = overflow ? menu.more : menu.alt_more
    const end = body.scrollHeight - body.clientHeight
    let pct: string
    if (body.scrollTop === 0 || end <= 0) pct = 'top'
    else if (body.scrollTop >= end) pct = 'bot'
    else {
      pct = ((body.scrollTop * 100) / end).toFixed(0) + '%'
      if (pct.length === 2) pct = ' ' + pct
    }
    shown = (shown || '').replace(/XXX/, pct)
    more.innerHTML = formattedStringToHtml(shown)
    more.classList.toggle('hidden', shown.length === 0)
    if (menu === this.menuTop) this.markMoreSwitches(more, menu)
  }

  /**
   * The switches a more line prints (`[<w>!</w>] buy|examine items`), made
   * into targets the cursor can reach. The line is the server's own formatted
   * string, so the switches are found in its plain text and the rendered
   * nodes they cover are moved into a span of their own, colours and all.
   * Clicking one sends its key, as clicking a row sends the row's. Shared by
   * the menus and by the popups that print a more line of their own.
   */
  private hotSwitches(more: HTMLElement): { key: string; label: string; el: HTMLElement }[] {
    const out: { key: string; label: string; el: HTMLElement }[] = []
    const switches = parseMoreSwitches(more.textContent || '')
    // last first: wrapping one leaves the offsets of those before it untouched
    for (let i = switches.length - 1; i >= 0; i--) {
      const sw = switches[i]
      const range = textRange(more, sw.start, sw.end)
      if (!range) continue
      const span = h('span', { class: 'more-hot', title: sw.label })
      span.append(range.extractContents())
      range.insertNode(span)
      span.addEventListener('click', () => this.sendMoreSwitch(sw.key))
      out.unshift({ key: sw.key, label: sw.label, el: span })
    }
    return out
  }

  /**
   * The top menu's more-line switches: the tail of the ring the cursor walks,
   * on every menu (the inventory's `[Esc] exit`, the use-item menu's `[!]
   * read|quaff|evoke` and `[?] describe selected`, the shop's four). The line
   * is remeasured on every scroll, so the cursor's place in it is kept while
   * the menu stands.
   */
  private markMoreSwitches(more: HTMLElement, menu: MenuState) {
    if (this.menuFooterTag !== menu.tag) {
      this.menuFooterTag = menu.tag
      this.menuFooterIndex = -1
    }
    this.menuFooter = this.hotSwitches(more)
    if (this.menuFooterIndex >= this.menuFooter.length) this.menuFooterIndex = -1
    this.paintFooter()
  }

  /** A more-line switch: the key it prints, as the official client would send it. */
  private sendMoreSwitch(key: string) {
    const code = moreSwitchKeycode(key)
    if (code) this.hooks.send(cm.key(code))
    else if (key.length === 1) this.hooks.send(cm.input(key))
  }

  /** One highlight at a time: the cursor is either on a row or on a more-line switch. */
  private paintFooter() {
    this.menuFooter.forEach((f, i) => f.el.classList.toggle('hovered', i === this.menuFooterIndex))
    this.menuExtra?.el.classList.toggle('hovered', this.menuExtraOn)
    const lis = this.menuBody()?.lis
    const row = this.menuFooterIndex < 0 && !this.menuExtraOn ? this.menuTop?.last_hovered ?? -1 : -1
    lis?.forEach((li, i) => li.classList.toggle('hovered', i === row))
  }

  /** Move the cursor onto a more-line switch (or, with -1, back to the row the server hovers). */
  private setFooterIndex(index: number) {
    this.menuFooterIndex = index
    this.paintFooter()
  }

  /**
   * menu.js handle_size_change: after a rebuild the page is kept (the memo
   * put it back) and the hover is only brought in when it fell off it; a hover
   * already on the page does not move the page (`set_hovered` returns early
   * for the same index).
   */
  private scrollHoverIntoView() {
    const menu = this.menuTop
    if (!menu) return
    const hover = menu.last_hovered
    if (hover >= 0) {
      const vis = this.menuVisible()
      if (hover < vis.first || hover > vis.last) this.snapInPage(menu, hover)
    }
    this.scheduleScrollSync()
  }

  /** The top menu's scrolling body and its rows. */
  private menuBody(): { body: HTMLElement; lis: HTMLElement[] } | null {
    const el = this.menuEl
    if (!el) return null
    const body = el.querySelector('.body') as HTMLElement | null
    if (!body) return null
    // Orbrun's own row (the game menu's settings) is not the server's: the rest line up with `menu.items`
    return { body, lis: (Array.from(body.querySelectorAll('li')) as HTMLElement[]).filter((li) => !li.classList.contains('extra')) }
  }

  /**
   * menu.js update_visible_indices: the first and last row shown in full. A
   * row whose top is at or below the body's top (within a pixel) starts the
   * page; the page ends before the first row whose bottom goes past the
   * body's bottom.
   */
  private menuVisible(): Visible {
    const mb = this.menuBody()
    const n = mb ? mb.lis.length : 0
    const vis: Visible = { first: 0, last: Math.max(0, n - 1) }
    if (!mb || !n) return vis
    const rect = mb.body.getBoundingClientRect()
    const top = rect.top
    const bottom = rect.bottom
    let i = 0
    for (; i < n; i++) {
      if (mb.lis[i].getBoundingClientRect().top + 1 >= top) {
        vis.first = i
        break
      }
    }
    for (; i < n; i++) {
      if (mb.lis[i].getBoundingClientRect().bottom - 1 >= bottom) break
      vis.last = i
    }
    return vis
  }

  /**
   * menu.js scroll_to_item / scroll_bottom_to_item: put row `index` at the
   * top of the page (with the header right above it, if any), or its bottom
   * at the bottom of the page.
   */
  private menuScrollTo(menu: MenuState, index: number, anchor: 'top' | 'bottom') {
    const mb = this.menuBody()
    if (!mb || !mb.lis.length) return
    index = Math.max(0, Math.min(index, mb.lis.length - 1))
    if (anchor === 'top' && index > 0 && (menu.items[index - 1]?.level ?? 2) < 2) index--
    const li = mb.lis[index]
    const liRect = li.getBoundingClientRect()
    // measured from the first row, as menu.js does from its container's first child: a row
    // put at the top sits where the first row sits with nothing scrolled, under the same inset
    const firstRect = mb.lis[0].getBoundingClientRect()
    const y = liRect.top - firstRect.top
    const inset = firstRect.top - mb.body.getBoundingClientRect().top + mb.body.scrollTop
    mb.body.scrollTop = anchor === 'top' ? Math.max(0, y) : Math.max(0, y + liRect.height + 2 * inset - mb.body.clientHeight)
    this.scheduleScrollSync()
  }

  /** menu.js snap_in_page: scroll only as far as needed to show the hover (and a header over it). */
  private snapInPage(menu: MenuState, index: number) {
    const mb = this.menuBody()
    if (!mb || index < 0 || index >= mb.lis.length) return
    const vis = this.menuVisible()
    if (index <= vis.first) this.menuScrollTo(menu, index, 'top')
    else if (index >= vis.last) this.menuScrollTo(menu, index, 'bottom')
  }

  /** menu.js update_server_scroll (debounced 100 ms as there): tell the server what page we show. */
  private scheduleScrollSync() {
    if (this.scrollTimer) return
    this.scrollTimer = window.setTimeout(() => {
      this.scrollTimer = null
      if (!this.menuEl) return
      const vis = this.menuVisible()
      if (!this.hooks.watching()) this.hooks.send(cm.menuScroll(vis.first, vis.last, this.hovered))
    }, 100)
  }

  /**
   * menu.js set_hovered: move the hover class and tell the server, only when
   * the hover changes and the row can take it. `snap` scrolls the row into
   * the page (off for the line scrolls, which already chose the page).
   */
  private setHover(menu: MenuState, index: number, mouse = false, snap = true) {
    if (index >= menu.items.length) index = Math.max(0, menu.items.length - 1)
    const lis = this.menuBody()?.lis
    const paint = () => {
      // the cursor is on a row again: the more line's switches and Orbrun's own row drop their highlight
      this.menuFooterIndex = -1
      for (const f of this.menuFooter) f.el.classList.remove('hovered')
      if (this.menuExtraOn) this.setExtraHover(false)
      lis?.forEach((li, i) => li.classList.toggle('hovered', i === menu.last_hovered))
    }
    if (menu.tag === GAME_MENU_TAG && index >= 0) this.gameMenuLast = index
    if (index === menu.last_hovered && (index < 0 || itemSelectable(menu, index) || this.padHoverable(menu, index))) {
      paint()
      return
    }
    if (index < 0 || itemSelectable(menu, index) || this.padHoverable(menu, index)) {
      this.hovered = index
      menu.last_hovered = index
      paint()
      if (index >= 0 && snap) this.snapInPage(menu, index)
      this.hooks.send(cm.menuHover(index, mouse))
      this.scheduleScrollSync()
    }
  }

  /** The pad also hovers the rows of an arrows-select menu that print no hotkey, so A can send Enter on them. */
  private padHoverable(menu: MenuState, index: number): boolean {
    const it = menu.items[index]
    return !!it && (it.level ?? 2) === 2 && !!(menu.flags & MenuFlag.ARROWS_SELECT)
  }

  private hoverable(menu: MenuState): number[] {
    const out: number[] = []
    for (let i = 0; i < menu.items.length; i++) if (itemSelectable(menu, i) || this.padHoverable(menu, i)) out.push(i)
    return out
  }

  /**
   * A keyboard key while a server menu is up: menu.js menu_keydown_handler /
   * menu_keypress_handler, which the official client runs before anything
   * reaches the server. Returns true when the key was the menu's (consumed);
   * false leaves it raw, exactly as there.
   */
  menuKey(state: GameState, ev: NavKeyLike): boolean {
    const menu = topMenu(state)
    if (!menu || menu.type === 'crt' || menu !== this.menuTop) return false
    // left and right walk the more line's switches while the cursor is on them (they are the server's on the rows)
    if (this.menuFooterIndex >= 0 && !ev.ctrlKey && !ev.altKey && !ev.shiftKey && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight')) {
      this.menuFooterStep(menu, ev.key === 'ArrowRight')
      return true
    }
    // on a more-line switch, space and Enter fire it (the switch's own key goes to the server)
    if (this.menuFooterIndex >= 0 && !ev.ctrlKey && !ev.altKey && !ev.shiftKey && (ev.key === ' ' || ev.key === 'Enter')) {
      this.sendMoreSwitch(this.menuFooter[this.menuFooterIndex].key)
      return true
    }
    // Orbrun's row on the game menu: Enter and space fire it, and its letter reaches
    // it from anywhere on the menu, as a server row's hotkey reaches the server
    const plain = !ev.ctrlKey && !ev.altKey && !ev.shiftKey
    if (this.menuExtra && plain && ((this.menuExtraOn && (ev.key === 'Enter' || ev.key === ' ')) || ev.key === GAME_MENU_ROW_KEY)) {
      this.openGameMenuRow()
      return true
    }
    // the cursor is Orbrun's on every menu the server did not flag ARROWS_SELECT
    // (menu-nav menuClientHover): space (and Enter, off the shop) fire the hovered
    // row, sending the letter the row printed, exactly as the pad's A does
    if (menuHoverSelectKey(menu, ev)) {
      const hk = menu.items[menu.last_hovered]?.hotkeys?.[0]
      if (hk !== undefined) {
        this.hooks.send(cm.key(hk))
        return true
      }
      // no row under the cursor yet: the key is not the cursor's, so it falls
      // through to what it otherwise means (space pages, Enter goes to the server)
    }
    const intent = menuKeyIntent(menu, ev)
    if (!intent) return false
    this.menuNavigate(menu, intent)
    return true
  }

  /** The navigation itself, shared by the keyboard and the pad's bumpers. */
  private menuNavigate(menu: MenuState, key: MenuNavKey) {
    const n = menu.items.length
    const arrows = menuClientHover(menu)
    switch (key) {
      case 'up':
      case 'down': {
        const down = key === 'down'
        if (this.extraStep(menu, down)) break
        if (this.menuFooterStep(menu, down)) break
        if (menu.last_hovered < 0) {
          // the menu opened without a hover (no MF_INIT_HOVER): seat the cursor at
          // the near end of the ring rather than letting the key fall on the floor
          const hov = this.hoverable(menu)
          if (!hov.length) {
            // nothing on this menu can take a cursor (a list of text): the arrows scroll it
            this.menuNavigate(menu, down ? 'lineDown' : 'lineUp')
            break
          }
          if (!down && this.menuFooter.length) this.setFooterIndex(this.menuFooter.length - 1)
          else this.setHover(menu, down ? hov[0] : hov[hov.length - 1])
          break
        }
        // cycle_hover
        const next = nextHoverableItem(menu, !down, menu.last_hovered)
        if (next !== -1) this.setHover(menu, next)
        break
      }
      case 'lineUp':
      case 'lineDown': {
        if (n <= 0) break
        const vis = this.menuVisible()
        this.menuScrollTo(menu, key === 'lineUp' ? lineUpTarget(vis) : lineDownTarget(menu, vis), 'top')
        const snap = snapHoverTarget(menu, this.menuVisible())
        if (snap >= 0) this.setHover(menu, snap, false, false)
        break
      }
      case 'pageUp':
      case 'pageDown': {
        // paging
        if (n === 0) break
        const vis = this.menuVisible()
        if (arrows && menu.last_hovered < 0) {
          menu.last_hovered = vis.first
          this.hovered = vis.first
        }
        const adjust = menu.last_hovered >= 0
        let rel = relativeHover(menu, vis)
        if (key === 'pageUp') {
          // at the top already: no scroll, the hover goes to the top of the page
          if (vis.first === 0) rel = 0
          else this.menuScrollTo(menu, vis.first, 'bottom')
        } else if (vis.last === n - 1) rel = -1
        else this.menuScrollTo(menu, vis.last, 'top')
        if (adjust) {
          const target = relativeHoverTarget(menu, this.menuVisible(), rel)
          if (target >= 0) this.setHover(menu, target)
        }
        break
      }
      case 'home': {
        this.menuScrollTo(menu, 0, 'top')
        if (arrows) {
          const t = nextHoverableItem(menu, false, 0, true)
          if (t >= 0) this.setHover(menu, t)
        }
        break
      }
      case 'end': {
        this.menuScrollTo(menu, n - 1, 'bottom')
        if (n > 0 && arrows) {
          const t = nextHoverableItem(menu, true, n - 1, true)
          if (t >= 0) this.setHover(menu, t)
        }
        break
      }
    }
    this.scheduleScrollSync()
  }

  /**
   * Up or down between the more line's switches, into them from the last row
   * and back out to it. Rows and switches make one ring here, whatever the
   * menu's WRAP flag says (the shop's cursor is Orbrun's own, and a screen
   * this short is quicker walked round than back up): down off the last
   * switch comes back to the first row, up off the first row lands on the
   * last switch. True when the cursor moved, false to leave the step to the
   * rows.
   */
  private menuFooterStep(menu: MenuState, down: boolean): boolean {
    const foot = this.menuFooter
    if (!foot.length) return false
    const i = this.menuFooterIndex
    if (i >= 0) {
      const next = i + (down ? 1 : -1)
      if (next >= 0 && next < foot.length) {
        this.setFooterIndex(next)
        return true
      }
      // off the end of the switches: round to the first row, or back up to the last
      this.setFooterIndex(-1)
      const row = nextHoverableItem(menu, !down, down ? 0 : menu.items.length - 1, true)
      if (row >= 0) this.setHover(menu, row)
      return true
    }
    if (menu.last_hovered < 0) return false
    // cycle_hover has nowhere left to go: the cursor steps off the rows onto the more line
    const next = nextHoverableItem(menu, !down, menu.last_hovered)
    if (next !== -1 && next !== menu.last_hovered) return false
    this.setFooterIndex(down ? 0 : foot.length - 1)
    return true
  }

  /** Gamepad menu operations. */
  menuOp(state: GameState, op: string) {
    const menu = topMenu(state)
    if (!menu) return
    const arrows = !!(menu.flags & MenuFlag.ARROWS_SELECT)
    const multi = !!(menu.flags & MenuFlag.MULTISELECT)
    // the server's WRAP flag decides whether hover wraps at the ends (menu.js:353)
    const wrap = !!(menu.flags & MenuFlag.WRAP)
    const hov = this.hoverable(menu)
    const cur = hov.indexOf(this.hovered)
    switch (op) {
      case 'next': {
        if (this.extraStep(menu, true)) break
        if (this.menuFooterStep(menu, true)) break
        if (!hov.length) return this.hooks.send(cm.key(Keys.CK_DOWN))
        const n = cur < 0 ? 0 : cur + 1 < hov.length ? cur + 1 : wrap ? 0 : cur
        this.setHover(menu, hov[n])
        break
      }
      case 'prev': {
        if (this.extraStep(menu, false)) break
        if (this.menuFooterStep(menu, false)) break
        if (!hov.length) return this.hooks.send(cm.key(Keys.CK_UP))
        const n = cur < 0 ? hov.length - 1 : cur > 0 ? cur - 1 : wrap ? hov.length - 1 : 0
        this.setHover(menu, hov[n])
        break
      }
      case 'left':
      case 'right':
        // on the more line's switches they walk them; on the rows they are the keyboard's:
        // raw, as menu.js leaves them (CMD_MENU_LEFT / RIGHT on the server:
        // the inventory's category pages, invent.cc InvMenu::process_command `cycle_page`; elsewhere
        // `cycle_mode`, the `!` toggle)
        if (this.menuFooterIndex >= 0) this.menuFooterStep(menu, op === 'right')
        else this.hooks.send(cm.key(op === 'left' ? Keys.CK_LEFT : Keys.CK_RIGHT))
        break
      case 'sectionNext':
      case 'sectionPrev': {
        // menu.cc cycle_headers, both ways, on the client's hover; a menu without sections pages instead
        if (!menuHasSections(menu)) {
          this.menuNavigate(menu, op === 'sectionNext' ? 'pageDown' : 'pageUp')
          break
        }
        const vis = this.menuVisible()
        const header = cycleHeadersTarget(menu, op === 'sectionNext', vis)
        if (header < 0) break
        if (!arrows || header < vis.first || header > vis.last) this.menuScrollTo(menu, header, 'top')
        if (arrows) {
          // set_hovered on the header, then cycle_hover to the first row it heads
          const t = nextHoverableItem(menu, false, header, true)
          if (t >= 0) this.setHover(menu, t)
        }
        this.scheduleScrollSync()
        break
      }
      case 'pageNext':
        // the page turns on the client, as PgDn does on a keyboard (the server cannot scroll our list)
        this.menuNavigate(menu, 'pageDown')
        break
      case 'pagePrev':
        this.menuNavigate(menu, 'pageUp')
        break
      case 'first':
        this.menuNavigate(menu, 'home')
        if (hov.length && this.hovered !== hov[0]) this.setHover(menu, hov[0])
        break
      case 'last':
        this.menuNavigate(menu, 'end')
        if (hov.length && this.hovered !== hov[hov.length - 1]) this.setHover(menu, hov[hov.length - 1])
        break
      case 'select': {
        if (this.menuExtraOn) {
          this.openGameMenuRow()
          break
        }
        if (this.menuFooterIndex >= 0) {
          this.sendMoreSwitch(this.menuFooter[this.menuFooterIndex].key)
          break
        }
        const it = menu.items[this.hovered]
        const hk = it?.hotkeys?.[0]
        // the shop's letters mark (or, in examine mode, describe) the row, as its help says; Enter there buys
        if (menu.tag === 'shop' && hk !== undefined) this.hooks.send(cm.key(hk))
        else if (arrows) this.hooks.send(cm.key(multi ? 32 : 13))
        else if (hk !== undefined) this.hooks.send(cm.key(hk))
        else this.hooks.send(cm.key(13))
        break
      }
      case 'altSelect': {
        // the hovered row's letter, shifted: `A`..`Z` put a shop item on the shopping list
        const hk = menu.items[this.hovered]?.hotkeys?.[0]
        if (hk !== undefined && hk >= 97 && hk <= 122) this.hooks.send(cm.key(hk - 32))
        break
      }
      case 'examine': {
        // the hovered row described where it stands: menu.js item_click_handler's right click on an
        // arrows-select row, `text_input` `'` (cmd-keys.h: `'` and `\\` are CMD_MENU_EXAMINE in the menu
        // keymap; menu.cc process_command examines `last_hovered`). The spell, ability and item menus
        // answer it whatever their `[?]` mode is, so the toggle is never needed. A menu without
        // arrows-select drops a plain `menu_hover` (Menu::set_hovered keeps the hover only when
        // forced), so the mouse form goes first there; the more line's switches and Orbrun's own
        // row have nothing to describe
        if (this.menuExtraOn || this.menuFooterIndex >= 0 || this.hovered < 0) break
        if (!menu.items[this.hovered]?.hotkeys?.length) break
        if (!arrows) this.hooks.send(cm.menuHover(this.hovered, true))
        this.hooks.send(cm.textInput("'"))
        break
      }
      case 'toggle':
        this.hooks.send(cm.key(32))
        break
      case 'cancel':
        this.hooks.send(cm.key(27))
        break
    }
  }

  // ----------------------------------------------------------------- popups

  private renderPopup(state: GameState, p: Popup, top: boolean): HTMLElement {
    const d = p.data as Record<string, unknown>
    const gd = this.hooks.gamedata()
    const el = h('div', { class: 'popup type-' + p.type })
    const str = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : '')
    const acts: PopupAction[] = []
    const header = (title: string, tile?: TileRef | TileRef[], colour?: number) => {
      const tiles = tile ? (Array.isArray(tile) ? tile : [tile]) : []
      if (!title && !tiles.length) return
      const hd = h('div', { class: 'header' })
      if (tiles.length) hd.append(tileCanvas(gd, tiles, 2))
      hd.append(h('span', { class: colour === undefined ? '' : 'fg' + colour, html: formattedStringToHtml(title) }))
      el.append(hd)
    }
    // the describe popups' actions line: clickable, and offered to the pad in order
    // focusables in visual order: spells, then the pane switch, then the verbs on one row
    let newgame: { screen: string; initial: number; force: boolean } | undefined
    const items: Focusable[] = []
    let row = 0
    const actions = (text: string) => {
      if (!text) return
      const a = h('div', { class: 'actions', html: clickifyActions(text) })
      const spans = Array.from(a.querySelectorAll('[data-hotkey]')) as HTMLElement[]
      const parsed = parseActions(text)
      const r = row++
      spans.forEach((sp, i) => {
        const key = sp.dataset.hotkey || ''
        const send = () => this.hooks.send(cm.input(key))
        sp.addEventListener('click', send)
        items.push({ label: parsed[i]?.label || key, el: sp, activate: send, row: r, col: i, id: 'act:' + key })
      })
      el.append(a)
      for (const x of parsed) acts.push({ key: x.key, label: x.label, send: () => this.hooks.send(cm.input(x.key)) })
    }
    const paneAction = (key: string, names: string[], pane: number, foot: HTMLElement) => {
      if (names.length < 2) return
      const next = names[(pane + 1) % names.length]
      const send = () => this.hooks.send(cm.input(key))
      acts.push({ key, label: next, send })
      foot.classList.add('pane-switch')
      foot.addEventListener('click', send)
      items.push({ label: next, el: foot, activate: send, row: row++, id: 'pane' })
    }
    /**
     * A describe popup's scrolling body. The server marks where the spell list
     * belongs with SPELLSET_PLACEHOLDER (official _fmt_spellset_html), so the
     * list sits inside the body's text, not after it, and scrolls with it. An
     * item's spells wear their own colour, a monster's do not (_fmt_spells_list
     * takes `colour` false for monsters).
     */
    const describeBody = (text: string, books: SpellBook[] = [], colour = false) => {
      const body = h('div', { class: 'body' })
      const parts = text.split('SPELLSET_PLACEHOLDER')
      body.append(h('div', { html: fmtBody(parts[0]) }))
      if (books.length) {
        body.append(this.spellset(books, items, () => row++, colour))
        for (const b of books) for (const s of b.spells) acts.push({ key: s.letter, label: formattedStringToText(s.title), send: () => this.hooks.send(cm.textInput(s.letter)) })
      }
      if (parts.length > 1) body.append(h('div', { html: fmtBody(parts.slice(1).join('')) }))
      el.append(body)
      return body
    }
    const spellsOf = (v: unknown): SpellBook[] => (Array.isArray(v) && v.length ? (v as SpellBook[]) : [])
    switch (p.type) {
      case 'formatted-scroller': {
        header(str('title'))
        const text = typeof p.state.text === 'string' ? (p.state.text as string) : str('text')
        el.append(h('div', { class: 'body', html: formattedStringToHtml(text) }))
        if (str('more')) el.append(h('div', { class: 'more', html: formattedStringToHtml(str('more')) }))
        // the keys a scroller answers to but never prints: a row of them, so the pad has them
        actions(scrollerActions(str('tag'), text, str('text')))
        break
      }
      case 'describe-spell': {
        // official: desc.desc is the text; the template's action shows when can_mem
        header(str('title'), d.tile as TileRef | undefined)
        el.append(h('div', { class: 'body', html: spellDescHtml(str('desc') || str('body')) }))
        if (d.can_mem) actions('(M)emorise this spell.')
        break
      }
      case 'describe-item':
      case 'describe-cards':
      case 'describe-generic': {
        header(str('title'), (d.tiles as TileRef[]) || (d.tile as TileRef | undefined))
        describeBody(str('body') + (p.type === 'describe-generic' ? str('footer') : ''), spellsOf(d.spellset), true)
        actions(str('actions'))
        break
      }
      case 'describe-feature-wide': {
        for (const f of (d.feats as { title: string; body: string; quote?: string; tile?: TileRef }[]) || []) {
          const hd = h('div', { class: 'header' })
          if (f.tile) hd.append(tileCanvas(gd, [f.tile], 2))
          hd.append(h('span', null, f.title))
          el.append(hd)
          if (f.body !== f.title) el.append(h('div', { class: 'body', html: formattedStringToHtml(f.body + (f.quote ? '\n\n' + f.quote : '')) }))
        }
        actions(str('actions'))
        break
      }
      case 'describe-monster':
      case 'describe-god': {
        // a god comes with its own tile and is named by `name` in its colour; a monster is
        // drawn from its foreground tile id (and doll or mcache parts) and named by `title`
        if (p.type === 'describe-god') header(str('name') || str('title'), d.tile as TileRef | undefined, typeof d.colour === 'number' ? (d.colour as number) : undefined)
        else header(str('title'), monsterTiles(gd, d))
        const pane = typeof p.state.pane === 'number' ? (p.state.pane as number) : 0
        let panes: string[]
        let names: string[]
        if (p.type === 'describe-monster') {
          // official: the status and quote panes exist only when non-empty
          panes = [str('body')]
          names = ['Description']
          if (str('status')) {
            panes.push(str('status'))
            names.push('Status')
          }
          if (str('quote')) {
            panes.push(str('quote'))
            names.push('Quote')
          }
        } else {
          // a god sends no `body`: the overview is its description, its title and favour,
          // and the list of powers it grants (ui-layouts.js describe_god)
          panes = ['', str('powers'), str('wrath')]
          names = ['Overview', 'Powers', 'Wrath']
          if (str('extra')) {
            panes.push(str('extra'))
            names.push('Extra')
          }
        }
        const cur = Math.min(pane, panes.length - 1)
        if (p.type === 'describe-god') el.append(godPane(d, cur))
        else describeBody(panes[cur] || '', cur === 0 ? spellsOf(d.spellset) : [])
        // official templates: the pane names sit behind the key that cycles them, in cyan
        const key = p.type === 'describe-god' ? '<b class="fg3">!</b>/<b class="fg3">^</b>:&nbsp;' : '[<b class="fg3">!</b>]:&nbsp;'
        const foot = key + names.map((n, i) => (i === cur ? `<b class="fg15">${n}</b>` : n)).join(' | ') + (d.is_altar ? '&nbsp;&nbsp;<b class="fg3">J</b>/<b class="fg3">Enter</b>: join religion' + escapeHtml(str('service_fee')) : '')
        const footEl = h('div', { class: 'footer', html: foot + (typeof p.state.prompt === 'string' ? '<br>' + formattedStringToHtml(p.state.prompt as string) : '') })
        el.append(footEl)
        // '!' cycles panes in both (ui-layouts.js; '^' too for gods)
        paneAction('!', names, cur, footEl)
        actions(str('actions'))
        break
      }
      case 'version':
      case 'game-over': {
        header(str('title'), d.tile as TileRef | undefined)
        el.append(h('div', { class: 'body', html: fmtBody(str('body') || str('information') || '') }))
        if (str('features')) el.append(h('div', { class: 'body', html: fmtBody(str('features')) }))
        break
      }
      case 'progress-bar': {
        const status = typeof p.state.status === 'string' ? (p.state.status as string) : str('status')
        const bar = typeof p.state.bar_text === 'string' ? (p.state.bar_text as string) : str('bar_text')
        header(str('title'))
        el.append(h('div', { class: 'body', html: formattedStringToHtml(bar) + '<br>' + escapeHtml(status) }))
        break
      }
      case 'seed-selection': {
        // the field is driven by the matching init_input (type 'seed-selection'), wired in update()
        header(str('title'))
        el.append(h('div', { class: 'body', html: str('body') }))
        const input = h('input', { class: 'text', type: 'text', placeholder: 'seed (digits)', disabled: true })
        const clearBtn = h('button', { class: 'btn' }, '[-] Clear')
        const daily = h('button', { class: 'btn' }, "[d] Today's daily seed")
        clearBtn.addEventListener('click', () => this.hooks.send(cm.key(45)))
        daily.addEventListener('click', () => this.hooks.send(cm.key(100)))
        el.append(h('div', { class: 'footer seed-input' }, h('span', null, 'Enter seed: '), input, clearBtn, daily))
        el.append(h('div', { class: 'footer', html: str('footer') }))
        this.seedInput = input
        acts.push({ key: '-', label: 'Clear', send: () => this.hooks.send(cm.key(45)) })
        acts.push({ key: 'd', label: 'Daily seed', send: () => this.hooks.send(cm.key(100)) })
        acts.push({ key: '?', label: 'Help', send: () => this.hooks.send(cm.key(63)) })
        // the field opens the keyboard; the buttons send their keys
        const r = row++
        items.push({ label: 'Type seed', el: input, activate: () => this.oskOp('shift'), row: r, col: 0, id: 'seed' })
        items.push({ label: 'Clear', el: clearBtn, activate: () => this.hooks.send(cm.key(45)), row: r, col: 1, id: 'clear' })
        items.push({ label: 'Daily seed', el: daily, activate: () => this.hooks.send(cm.key(100)), row: r, col: 2, id: 'daily' })
        break
      }
      case 'msgwin-get-line': {
        header(str('prompt'))
        break
      }
      case 'newgame-choice':
        el.classList.add('newgame')
        newgame = this.renderNewgame(el, d, p, items)
        break
      case 'newgame-random-combo': {
        header(str('prompt'), undefined)
        if (Array.isArray(d.doll)) el.querySelector('.header')?.prepend(tileCanvas(gd, (d.doll as [number, number][]).map((x) => ({ t: x[0], tex: 3, ymax: x[1] })), 2))
        el.append(h('div', { class: 'body' }, 'Do you want to play this combination?'))
        // newgame.cc _prompt_choose_random: Y plays it, n rolls again, q quits. The
        // three answers are the popup's rows, so the cursor walks them like any other
        actions('(Y)es, (n)o, (q)uit')
        break
      }
      default:
        header(str('title') || p.type)
        el.append(h('div', { class: 'body', html: fmtBody(str('body') || str('text') || JSON.stringify(d).slice(0, 500)) }))
    }
    // the more line a popup prints (the formatted scroller's) is walkable too: its
    // switches are a row of the cursor's ring, as a menu's more line is (markMoreSwitches)
    const moreEl = el.querySelector('.more') as HTMLElement | null
    if (moreEl) {
      const r = row++
      this.hotSwitches(moreEl).forEach((sw, i) => {
        const send = () => this.sendMoreSwitch(sw.key)
        items.push({ label: sw.label, el: sw.el, activate: send, row: r, col: i, id: 'more:' + sw.key })
        acts.push({ key: sw.key, label: sw.label, send })
      })
    }
    if (top) {
      this.actions = acts
      this.popupEl = el
      this.popupTop = p
      // ui-layouts.js scroller_onscroll: a formatted scroller tells the server where it is, 100 ms after the wheel stops
      if (p.type === 'formatted-scroller') {
        const body = this.scrollBodyOf(el)
        body?.addEventListener(
          'scroll',
          () => {
            if (this.scrollerFromServer || this.scrollerTimer) return
            this.scrollerTimer = window.setTimeout(() => this.reportScrollerScroll(), 100)
          },
          { passive: true },
        )
      }
      if (newgame) this.registerFocus(newgame.screen, items, { pageRows: NEWGAME_PAGE_ROWS }, newgame.initial, newgame.force)
      else this.registerFocus('popup:' + p.type, items, {})
    }
    return el
  }

  private spellset(books: SpellBook[], items: Focusable[], nextRow: () => number, colour = false): HTMLElement {
    const c = h('div', { class: 'spellset' })
    const gd = this.hooks.gamedata()
    const gui = gd?.enums?.texture?.GUI
    for (const book of books) {
      if (book.label && book.label.trim()) c.append(h('div', { html: formattedStringToHtml(book.label) }))
      const ol = h('ol')
      // the list lays its entries two to a line (styles.css .spellset li: 50% each), so a pair
      // shares one focus row and left / right cross between them, as up / down walk the lines
      let pairRow = 0
      book.spells.forEach((s, i) => {
        if (i % 2 === 0) pairRow = nextRow()
        const li = h('li', { class: 'selectable' + (colour && s.colour !== undefined ? ' fg' + s.colour : '') })
        // official _fmt_spells_list: the spell's own icon from the GUI texture, then its
        // letter and title, then the effect and range as the server coloured them (a range
        // the player is already inside comes through in red)
        if (typeof s.tile === 'number' && typeof gui === 'number') li.append(tileCanvas(gd, [{ t: s.tile, tex: gui }]))
        li.append(
          h('span', { class: 'title', html: formattedStringToHtml(`${s.letter} - ${s.title}`) }),
          h('span', { class: 'effect', html: formattedStringToHtml(s.effect || '') }),
          h('span', { class: 'range', html: formattedStringToHtml(s.range_string || s.range || '') }),
        )
        // official: a click sends the letter as text input
        const send = () => this.hooks.send(cm.textInput(s.letter))
        li.addEventListener('click', send)
        items.push({ label: formattedStringToText(s.title), el: li, activate: send, row: pairRow, col: i % 2, id: 'spell:' + s.letter })
        ol.append(li)
      })
      c.append(ol)
    }
    return c
  }

  /**
   * The new-game screens (species, background, weapon): the server's
   * `OuterMenu` grids as buttons. The cursor is ours and moves at once; each
   * move tells the server with `outer_menu_focus`, exactly what the official
   * client sends when the mouse enters a button (ui-layouts.js
   * `focus_button`), and the server keeps its own focus in step. It answers
   * with a `ui-state` carrying `button_focus` and `from_client`; a
   * `button_focus` it moved itself (a new screen, a raw hotkey) re-seats the
   * cursor, an echo of ours does not (`newgame_choice_update` ignores those
   * too). The description under the grid follows the cursor.
   */
  private renderNewgame(el: HTMLElement, d: Record<string, unknown>, p: Popup, items: Focusable[]): { screen: string; initial: number; force: boolean } {
    const gd = this.hooks.gamedata()
    const hd = h('div', { class: 'header' })
    if (Array.isArray(d.doll)) hd.append(tileCanvas(gd, (d.doll as [number, number][]).map((x) => ({ t: x[0], tex: 3, ymax: x[1] })), 2))
    hd.append(h('span', { html: formattedStringToHtml(String(d.title || '')) }))
    el.append(hd)
    if (d.prompt) el.append(h('div', { class: 'header', html: formattedStringToHtml(String(d.prompt)) }))
    const descriptions: string[] = []
    // ui-layouts.js newgame_choice_init / style.css .paneset: every description is a pane in the same grid
    // cell and only the current one is visible, so the block is sized by the longest and the popup never
    // resizes as the cursor moves (Random and the recommended rows have empty ones)
    const descEl = h('div', { class: 'descriptions paneset' })
    const showDescription = (i: number) => {
      descEl.querySelectorAll('.pane').forEach((pane, j) => pane.classList.toggle('current', j === i))
    }
    const focusKey = typeof p.state.button_focus === 'number' ? (p.state.button_focus as number) : undefined
    const buttons: HTMLElement[] = []
    // the sub grid's rows follow the main grid's, so down from the last species reaches the random / recommended row
    let rowBase = 0
    const grid = (data: Record<string, unknown> | undefined, cls: string) => {
      const g = h('div', { class: 'grid ' + cls })
      if (!data) return g
      const menuId = String(data.menu_id || '')
      let maxCol = 1
      let maxRow = -1
      for (const b of (data.buttons as Record<string, unknown>[]) || []) {
        const btn = h('div', { class: 'button hlc-' + (b.highlight_colour ?? 0) })
        if (Array.isArray(b.tile) && (b.tile as TileRef[]).length) btn.append(tileCanvas(gd, b.tile as TileRef[]))
        const labels = (b.labels as string[]) || [String(b.label || '')]
        for (const l of labels) btn.append(h('span', { html: formattedStringToHtml(l) }))
        const x = Number(b.x) + 1
        const y = Number(b.y) + 1
        maxCol = Math.max(maxCol, x)
        maxRow = Math.max(maxRow, Number(b.y))
        btn.style.gridRow = String(y)
        btn.style.gridColumn = String(x)
        const hk = Number(b.hotkey)
        btn.dataset.hotkey = String(hk)
        descriptions.push(String(b.description || ''))
        const descIndex = descriptions.length - 1
        if (focusKey !== undefined && hk === focusKey) btn.classList.add('selected')
        // ui-layouts.js focus_button: the highlight and the description move, and the server is told
        const show = () => {
          for (const o of buttons) o.classList.toggle('selected', o === btn)
          showDescription(descIndex)
          this.hooks.send(cm.outerMenuFocus(hk, menuId))
        }
        const item: Focusable = {
          label: labels.map((l) => formattedStringToText(l)).join(' ').trim() || String.fromCharCode(hk),
          el: btn,
          activate: () => {
            this.hooks.send(cm.outerMenuFocus(hk, menuId))
            this.hooks.send(cm.key(hk))
          },
          onFocus: show,
          row: rowBase + Number(b.y),
          col: Number(b.x),
          group: cls,
          id: cls + ':' + hk,
        }
        btn.addEventListener('mouseenter', () => {
          // the pointer moves the one cursor too, so A and Enter take what the mouse is over
          const i = this.focusables.indexOf(item)
          if (i >= 0 && this.nav.count === this.focusables.length) this.nav.focus(i)
          else show()
        })
        btn.addEventListener('click', item.activate)
        items.push(item)
        buttons.push(btn)
        g.append(btn)
      }
      for (const l of (data.labels as Record<string, unknown>[]) || []) {
        const lb = h('div', { class: 'label', html: formattedStringToHtml(String(l.label || '')) })
        lb.style.gridRow = String(Number(l.y) + 1)
        lb.style.gridColumn = String(Number(l.x) + 1)
        g.append(lb)
      }
      g.style.gridTemplateColumns = `repeat(${maxCol}, auto)`
      rowBase += maxRow + 1
      return g
    }
    const mainData = d['main-items'] as Record<string, unknown> | undefined
    const main = grid(mainData, 'main')
    const sub = grid(d['sub-items'] as Record<string, unknown>, 'sub')
    const body = h('div', { class: 'body', style: { padding: '0' } }, main)
    el.append(body, sub)
    const sel = items.findIndex((f) => f.el.classList.contains('selected'))
    for (const text of descriptions) descEl.append(h('span', { class: 'pane', html: formattedStringToHtml(text) }))
    showDescription(sel)
    el.append(descEl)
    if (sel >= 0) {
      const selEl = items[sel].el
      requestAnimationFrame(() => selEl.scrollIntoView({ block: 'nearest' }))
    }
    // one screen per grid (species, then background: same popup type, new menu_id)
    const screen = 'popup:newgame-choice:' + String(mainData?.menu_id || '')
    const serverFocus = screen + ':' + (focusKey ?? '')
    const force = !p.state.from_client && serverFocus !== this.newgameFocus
    this.newgameFocus = serverFocus
    return { screen, initial: Math.max(0, sel), force }
  }

  private renderCrt(state: GameState): HTMLElement {
    const el = h('div', { class: 'popup' })
    el.append(this.crtBody(state, 'crt', true))
    return el
  }

  /**
   * A CRT text screen, one element per line. The lines are the server's own
   * HTML (tileweb-text.cc WebTextArea::send emits <span class='fgN'>; the
   * official text.js injects it verbatim), so no formatted-string pass here.
   * On a screen the scraper knows (the skills screen), each hotkey the text
   * prints gets a cursor marker over its row, measured in `ch` since the
   * screen is monospace; the markers are the focusables.
   */
  private crtBody(state: GameState, tag: string, top: boolean): HTMLElement {
    const pre = h('div', { class: 'crt' })
    const lines: string[] = []
    const areas = [state.crt.lines, ...Array.from(state.crt.areas.entries()).filter(([k]) => k !== 'crt').map(([, v]) => v)]
    for (const area of areas) {
      const max = Math.max(-1, ...area.keys())
      for (let i = 0; i <= max; i++) lines.push(area.get(i) || '')
    }
    const els = lines.map((l) => h('div', { class: 'crt-line', html: l || ' ' }))
    pre.append(...els)
    if (!top) return pre
    const items: Focusable[] = []
    const hotkeys = scrapeCrt(tag, lines)
    // skill-menu.cc: `=` puts the screen in set-target mode (set_flag, so a second `=` is harmless)
    // and a skill's letter then prompts for its target (read_skill_target, text input `skill_target`).
    // A row's Y sends both, so one press asks for the target without a mode switch first. The screen
    // only prints the switch when targets are available (not for a Gnoll), and in set-target mode
    // it prints `[-] clear selected target` in its stead.
    const targets = tag === 'skills' && hotkeys.some((hk) => hk.kind === 'footer' && (hk.key === '=' || /skill target|selected target/.test(hk.label)))
    for (const hk of hotkeys) {
      const line = els[hk.line]
      if (!line) continue
      const marker = h('span', { class: 'crt-hot ' + hk.kind, style: { left: hk.col + 'ch', width: hk.len + 'ch' }, title: hk.label })
      const send = () => this.hooks.send(cm.input(hk.key))
      marker.addEventListener('click', send)
      line.append(marker)
      // rows sit in the screen's columns; footer switches get columns of their own so a
      // column walk never jumps from the last row into the footer
      const n = Number(hk.group.replace(/\D/g, '')) || 0
      const col = hk.kind === 'row' ? n : 10 + n
      const item: Focusable = { label: hk.label, el: marker, activate: send, row: hk.line, col, group: hk.group, id: hk.kind + ':' + hk.key }
      if (targets && hk.kind === 'row') item.alt = { label: 'Set target', activate: () => this.hooks.send(cm.input('=' + hk.key)) }
      items.push(item)
    }
    // the skills screen is two columns of rows, and a row often has an entry in
    // only one of them: left / right cross columns rather than staying on the line
    this.registerFocus('crt:' + tag, items, { wrap: true, pageRows: 8, columns: true })
    return pre
  }

  // ------------------------------------------------------------ focus layer

  /** A renderer's focusables for the top overlay; the last registration of a build wins. */
  private registerFocus(screen: string, items: Focusable[], opts: FocusOptions, initial = 0, force = false) {
    this.focusables = items
    this.focusScreen = screen
    this.focusOpts = opts
    this.focusInitial = initial
    this.focusForce = force
    this.focusGen++
  }

  /**
   * The prompt card: a yes/no or multi-choice prompt (parsed by the context
   * from the prompt channel, only while the server says one is up) in the
   * middle of the view: the question and one chip per answer, nothing of the
   * message log, which stays in its pane. Each chip wears what fires it on
   * the device that spoke last, as the action bar does (hud.ts renderBar):
   * after the pad, the button (`promptButtons`: only a yes/no has them, a
   * choice prompt's chips are bare and the d-pad and A pick one), after the
   * keyboard or the mouse the hotkey as a key cap. A choice
   * prompt that is nothing but its options (`promptLead`) prints no question
   * line: the chips are the question, headed by its verb, so the card never
   * says the same thing twice. The cursor walks the chips too. Called every
   * frame; it rebuilds only when the prompt or the device changes. `--more--`
   * has no card at all: the message pane rings itself where it stands (hud.ts
   * renderMessages), the bar carries the Continue chip, and every face button
   * continues (bindings.ts MORE).
   */
  updatePrompt(mode: Mode, prompt: ParsedPrompt | undefined, device: InputDevice = 'pad') {
    let key = ''
    let chips: { label: string; hotkey: string; send: () => void; cancel?: boolean }[] = []
    let text = ''
    let lead: string | null = null
    let buttons = new Map<string, Button>()
    let letters: ParsedPrompt | null = null
    if (mode === 'yesno' || mode === 'prompt') {
      const p: ParsedPrompt | undefined = prompt ?? (mode === 'yesno' ? { text: '', options: [{ hotkey: 'y', label: 'Yes' }, { hotkey: 'n', label: 'No' }], yesno: true, cancel: true } : undefined)
      if (p && p.options.length) {
        text = p.text
        // a yes/no's text is the question, its Yes and No are not in it; a choice prompt's may be only its options
        lead = p.yesno ? null : promptLead(text)
        key = mode + '|' + device + '|' + text + '|' + (p.letters ? p.letters + '|' + (p.from ?? '') + '|' : '') + p.options.map((o) => o.hotkey + '=' + o.label + (o.held ? ':' + o.held : '')).join(',')
        // Tab and Enter are keys, not text (context.ts NAMED_KEYS)
        chips = p.options.map((o) => ({ label: o.label, hotkey: o.hotkey, send: () => this.hooks.send(o.hotkey === '\t' || o.hotkey === '\r' ? cm.key(o.hotkey.charCodeAt(0)) : cm.input(o.hotkey)), cancel: o.hotkey.toLowerCase() === 'n' && p.yesno }))
        buttons = promptButtons(p)
        letters = p.letters ? p : null
      }
    }
    if (key === this.promptKey) return
    this.promptKey = key
    this.promptEl?.remove()
    this.promptEl = null
    this.promptFocusables = []
    this.promptInitial = 0
    this.keyArmed = false
    this.focusGen++
    if (!key) return
    const padKind = this.hooks.padKind?.() ?? 'xbox'
    const pad = device === 'pad'
    const el = h('div', { class: 'prompt-card' + (pad ? '' : ' kbd'), 'data-client': '1' })
    if (text && lead === null) el.append(h('div', { class: 'text' }, text))
    if (letters) {
      this.letterGrid(el, letters, chips)
      this.root.append(el)
      this.promptEl = el
      return
    }
    this.promptFocusOpts = { wrap: true, linear: true }
    const rowEl = h('div', { class: 'chips' })
    if (lead) rowEl.append(h('span', { class: 'lead' }, lead))
    chips.forEach((c, i) => {
      const b = buttons.get(c.hotkey)
      // after the pad a choice chip wears nothing: the cursor marks it and A sends it
      const keyName = c.hotkey === '\t' ? 'Tab' : c.hotkey === '\r' ? 'Enter' : c.hotkey
      const cap = pad ? (b ? glyph(b, padKind) : null) : h('kbd', null, keyName)
      const title = pad ? (b ? glyphName(b, padKind) : c.label) : 'Press ' + keyName
      const chip = h('span', { class: 'chip' + (b ? ' ' + b : ''), title }, cap, h('span', { class: 'label' }, c.label))
      chip.addEventListener('click', c.send)
      rowEl.append(chip)
      // one row of chips; the card is linear, so up/down walk it as well as left/right
      this.promptFocusables.push({ label: c.label, el: chip, activate: c.send, row: 0, col: i, cancel: c.cancel, id: 'chip:' + i })
    })
    el.append(rowEl)
    this.root.append(el)
    this.promptEl = el
  }

  /**
   * The letter picker on a prompt card (context.ts `ParsedPrompt.letters`):
   * a chip per inventory letter in four rows of thirteen, a-m, n-z, A-M,
   * N-Z, so a letter is at most six presses from any other, with the
   * bumpers hopping two rows between the cases. The d-pad walks the grid and
   * A sends the lit letter, as a choice prompt's chips work; the cursor
   * starts on the letter being moved (`from`), marked as such, and letters
   * that hold something are marked too. Over the inventory a line under the
   * grid names what the lit letter holds, following the cursor, so the
   * player sees what a swap would displace before pressing. A physical
   * keyboard types the letter as it always did: the card only walks after an
   * arrow (`promptArmed`).
   */
  private letterGrid(el: HTMLElement, p: ParsedPrompt, chips: { label: string; hotkey: string; send: () => void }[]) {
    const COLS = 13
    const grid = h('div', { class: 'letters' })
    const slot = h('div', { class: 'slot' })
    const opts = p.options
    const describe = (i: number) => {
      if (p.letters !== 'item') return
      const o = opts[i]
      clear(slot)
      slot.append(h('b', null, o.hotkey), o.held ? h('span', { html: formattedStringToHtml(o.held) }) : h('span', { class: 'empty' }, 'empty'))
    }
    chips.forEach((c, i) => {
      const o = opts[i]
      const chip = h('div', { class: 'chip letter' + (o.held ? ' held' : '') + (o.hotkey === p.from ? ' from' : ''), title: o.held ? formattedStringToText(o.held) : 'empty' }, c.label)
      chip.addEventListener('click', c.send)
      grid.append(chip)
      this.promptFocusables.push({ label: c.label, el: chip, activate: c.send, row: Math.floor(i / COLS), col: i % COLS, id: 'letter:' + c.hotkey, onFocus: () => describe(i) })
    })
    el.append(grid)
    if (p.letters === 'item') el.append(slot)
    const from = p.from ? opts.findIndex((o) => o.hotkey === p.from) : -1
    this.promptInitial = from >= 0 ? from : 0
    this.promptFocusOpts = { wrap: true, pageRows: 2 }
    describe(this.promptInitial)
  }

  /** Which focus set the mode reads: the card for prompts, the top overlay otherwise. */
  private focusSet(ctx: Context): { items: Focusable[]; screen: string; opts: FocusOptions; initial: number; force: boolean } {
    if (ctx.mode === 'yesno' || ctx.mode === 'prompt') {
      return { items: this.promptFocusables, screen: 'prompt:' + this.promptKey, opts: this.promptFocusOpts, initial: this.promptInitial, force: false }
    }
    return { items: this.focusables, screen: this.focusScreen, opts: this.focusOpts, initial: this.focusInitial, force: this.focusForce }
  }

  /** Seat the cursor on the current focus set after a rebuild. Called every frame; cheap when nothing changed. */
  syncFocus(ctx: Context) {
    if (!isFocusMode(ctx)) {
      if (this.nav.count) this.nav.clear()
      this.focusSynced = this.focusGen
      return
    }
    if (this.focusSynced === this.focusGen) return
    this.focusSynced = this.focusGen
    this.keyArmed = false
    const set = this.focusSet(ctx)
    this.nav.set(set.items, set.screen, set.opts, set.initial, set.force)
  }

  /** The cursor as the bindings see it, when the mode has one. */
  focusInfo(ctx: Context): FocusInfo | undefined {
    if (!isFocusMode(ctx)) return undefined
    return this.nav.info()
  }

  /**
   * A focus operation from the pad. With nothing under the cursor the op
   * falls back to the key the official client would send: Esc to close a
   * popup or cancel, Enter to confirm, the arrow to scroll or move.
   */
  focusOp(state: GameState, ctx: Context, op: FocusOp) {
    if (ctx.mode === 'menu' && ctx.menu?.menu.type !== 'crt') return this.menuOp(state, op)
    if (!this.focusKeyOp(ctx, op, false)) this.focusFallbackKey(ctx, op)
  }

  /**
   * A keyboard key in a focus mode. Consumed only when the screen has a
   * client-owned cursor and the op moved or fired it; otherwise the key stays
   * raw, as in the official client. On a prompt the arrows arm the cursor
   * first: Enter fires the focused chip only after one, and Escape is always
   * raw (a yes/no takes both as its default answer, see `promptArmed`).
   */
  focusKey(state: GameState, ctx: Context, op: FocusOp): boolean {
    void state
    return this.focusKeyOp(ctx, op, true)
  }

  private focusKeyOp(ctx: Context, op: FocusOp, keyboard: boolean): boolean {
    const set = this.focusSet(ctx)
    if (keyboard && !this.nav.count) return false
    const prompt = set.items === this.promptFocusables
    // a prompt card and a popup: Enter is the server's until an arrow has moved the cursor (`keyArmed`);
    // on a prompt any arrow arms it, on a popup only one the cursor took (the others scroll the text)
    if (keyboard && prompt) {
      if (op === 'cancel' || op === 'pageNext' || op === 'pagePrev') return false
      if (op === 'select' && !this.keyArmed) return false
      if (op !== 'select') {
        this.keyArmed = true
        this.promptEl?.classList.add('armed')
      }
    } else if (keyboard && ctx.mode === 'popup') {
      if (op === 'select' && !this.keyArmed) return false
      if (op !== 'select' && op !== 'cancel') {
        const moved = this.focusKeyMove(op)
        if (moved) this.keyArmed = true
        return moved
      }
    }
    return this.focusKeyMove(op)
  }

  private focusKeyMove(op: FocusOp): boolean {
    switch (op) {
      case 'select':
        return this.nav.activate()
      case 'altSelect':
        return this.nav.altActivate()
      case 'cancel':
        return this.nav.cancel()
      case 'prev':
        return this.nav.move('up')
      case 'next':
        return this.nav.move('down')
      case 'left':
        return this.nav.move('left')
      case 'right':
        return this.nav.move('right')
      case 'pageNext':
        return this.nav.page(1)
      case 'pagePrev':
        return this.nav.page(-1)
      case 'first':
        return this.nav.first()
      case 'last':
        return this.nav.last()
    }
  }

  private focusFallbackKey(ctx: Context, op: FocusOp) {
    // a popup that scrolls on the client (describe screens, help, the game-over
    // text) takes the moves itself, as the arrows and PgUp / PgDn do on a keyboard
    if (ctx.mode === 'popup' || ctx.mode === 'ended') {
      const scroll: Partial<Record<FocusOp, ScrollKey>> = { prev: 'lineUp', next: 'lineDown', pagePrev: 'pageUp', pageNext: 'pageDown', first: 'home', last: 'end' }
      const k = scroll[op]
      if (k && this.popupTop && SCROLLER_POPUPS.has(this.popupTop.type) && this.popupScroll(k)) return
    }
    const fb = focusFallback(ctx)
    const keys: Record<FocusOp, number | null> = {
      select: fb.select === 'close' ? Keys.ESC : Keys.ENTER,
      // a second action is the item's own: nothing to fall back to
      altSelect: null,
      cancel: Keys.ESC,
      prev: Keys.CK_UP,
      next: Keys.CK_DOWN,
      left: Keys.CK_LEFT,
      right: Keys.CK_RIGHT,
      pageNext: Keys.CK_PGDN,
      pagePrev: Keys.CK_PGUP,
      first: Keys.CK_HOME,
      last: Keys.CK_END,
    }
    const k = keys[op]
    if (k !== null) this.hooks.send(cm.key(k))
  }

  // --------------------------------------------------------- popup scroller

  /**
   * The element a popup scrolls: its `.body` (ui-layouts.js wraps each
   * layout's body in a scroller; the feature and card popups scroll the whole
   * popup, which here is the tallest body). The spell list of a describe
   * popup is a body of its own and does not count.
   */
  private scrollBodyOf(el: HTMLElement): HTMLElement | null {
    const bodies = (Array.from(el.children) as HTMLElement[]).filter((c) => c.classList.contains('body') && !c.classList.contains('spellset'))
    if (!bodies.length) return null
    let best = bodies[0]
    for (const b of bodies) if (b.scrollHeight - b.clientHeight > best.scrollHeight - best.clientHeight) best = b
    return best
  }

  private popupScrollBody(): HTMLElement | null {
    return this.popupEl ? this.scrollBodyOf(this.popupEl) : null
  }

  /** ui-layouts.js scroller_line_height: the height of one line of the body's text. */
  private lineHeightOf(body: HTMLElement): number {
    const cs = getComputedStyle(body)
    const lh = parseFloat(cs.lineHeight)
    if (lh > 0) return lh
    const fs = parseFloat(cs.fontSize)
    return fs > 0 ? fs * 1.2 : 16
  }

  /** ui-layouts.js scroller_scroll_to_line: the server's line, or the end for FS_START_AT_END. */
  private scrollToLine(body: HTMLElement, line: number) {
    if (line === 2147483647) body.scrollTop = body.scrollHeight - body.clientHeight
    else body.scrollTop = line * this.lineHeightOf(body)
  }

  /**
   * ui-layouts.js scroller_handle_key: a line, a page or an end. False when
   * the top popup has no scrolling body. A page is the body's height in
   * whole lines less one, so the last line read stays in view; the official
   * client gets the same overlap from the 24 px of its fade shades.
   */
  private popupScroll(key: ScrollKey): boolean {
    const body = this.popupScrollBody()
    if (!body) return false
    const lh = this.lineHeightOf(body)
    const page = Math.max(1, Math.floor(body.clientHeight / lh) - 1) * lh
    switch (key) {
      case 'lineUp':
        body.scrollTop -= lh
        break
      case 'lineDown':
        body.scrollTop += lh
        break
      case 'pageUp':
        body.scrollTop -= page
        break
      case 'pageDown':
        body.scrollTop += page
        break
      case 'home':
        this.scrollToLine(body, 0)
        break
      case 'end':
        this.scrollToLine(body, 2147483647)
        break
    }
    // a key reports at once (ui-layouts.js update_server_scroll), the wheel after a pause
    this.reportScrollerScroll()
    return true
  }

  /** ui-layouts.js update_server_scroll: a formatted scroller's top line, so the server keeps our place. */
  private reportScrollerScroll() {
    if (this.scrollerTimer) {
      clearTimeout(this.scrollerTimer)
      this.scrollerTimer = null
    }
    if (!this.popupTop || this.popupTop.type !== 'formatted-scroller' || this.hooks.watching()) return
    const body = this.popupScrollBody()
    if (!body) return
    this.hooks.send(cm.formattedScrollerScroll(Math.round(body.scrollTop / this.lineHeightOf(body))))
  }

  /**
   * A keyboard key while a popup is up: ui-layouts.js scroller_handle_key,
   * which the official client runs before anything reaches the server.
   * Returns true when the key scrolled the popup (consumed); false leaves it
   * raw, exactly as there.
   */
  popupKey(state: GameState, ev: NavKeyLike): boolean {
    const p = topPopup(state)
    if (!p || p !== this.popupTop) return false
    const intent = scrollKeyIntent(p.type, ev)
    if (!intent) return false
    return this.popupScroll(intent)
  }

  // ------------------------------------------------------------- text input

  private renderTextInput(state: GameState): HTMLElement {
    const ti = state.textInput!
    const el = h('div', { class: 'popup', style: { top: 'auto', bottom: '9rem', transform: 'translateX(-50%)', minWidth: '20rem' } })
    const input = h('input', { class: 'text', type: 'text', maxlength: ti.maxlen, size: ti.size })
    el.append(h('div', { class: 'header', html: formattedStringToHtml(ti.prompt || 'Input here (ESC to cancel): ') }), h('div', { class: 'body' }, input))
    this.wireInput(input, ti, true)
    return el
  }

  /**
   * Wire a field to a server text prompt, following the official textinput.js:
   * Enter submits with a CR, Esc sends ESC, up/down recall history, and the
   * prompt's tag decides which characters are hotkeys rather than text.
   */
  private wireInput(input: HTMLInputElement, ti: { tag?: string; type?: string; text?: string; historyId?: string; select_prefill?: boolean; select?: boolean }, focus: boolean) {
    const tag = ti.tag
    const seed = ti.type === 'seed-selection'
    input.disabled = false
    input.value = ti.text || ''
    let history: string[] | undefined
    let historyPos = 0
    if (ti.historyId) {
      history = histories[ti.historyId] || (histories[ti.historyId] = [])
      historyPos = history.length
    }
    const send = (finalChar: number) => {
      if (history && input.value.length > 0) {
        const at = history.indexOf(input.value)
        if (at !== -1) history.splice(at, 1)
        history.push(input.value)
        if (history.length > HISTORY_SIZE) history.shift()
      }
      this.submitText(input.value, tag, finalChar)
    }
    const special = (ch: string): boolean => {
      if (tag === 'stash_search') {
        if (ch === '?' && input.value.length === 0) {
          this.hooks.send(cm.key(63))
          return true
        }
      } else if (tag === 'repeat') {
        if (!/^\d$/.test(ch)) {
          send(ch.charCodeAt(0))
          return true
        }
      } else if (tag === 'travel_depth') {
        if ('<>?$^-p'.includes(ch)) {
          send(ch.charCodeAt(0))
          return true
        }
      } else if (tag === 'skill_target') {
        if (ch === '-') {
          send(ch.charCodeAt(0))
          return true
        }
      } else if (seed) {
        // '-' clears, '?' helps, 'd' picks the daily seed; anything but a digit is refused (keyfunc on the crawl side)
        if (ch === '-' || ch === '?' || ch === 'd') {
          this.hooks.send(cm.key(ch.charCodeAt(0)))
          return true
        }
        if (!/^\d$/.test(ch)) return true
      }
      return false
    }
    const target: OskTarget = {
      input,
      submit: () => send(13),
      cancel: () => this.hooks.send(cm.key(27)),
      special,
    }
    // travel.cc _travel_depth_keyfilter: the keys that move the default target, as a row of the pad's keyboard
    if (tag === 'travel_depth') target.extras = TRAVEL_DEPTH_KEYS
    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation()
      if (ev.key === 'Escape') {
        ev.preventDefault()
        target.cancel()
      } else if (ev.key === 'Enter') {
        ev.preventDefault()
        target.submit()
      } else if (history && history.length > 0 && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) {
        historyPos += ev.key === 'ArrowUp' ? -1 : 1
        if (historyPos < 0) historyPos = history.length - 1
        if (historyPos >= history.length) historyPos = 0
        input.value = history[historyPos]
        input.setSelectionRange(input.value.length, input.value.length)
        ev.preventDefault()
      } else if (ev.key.length === 1 && !ev.ctrlKey && !ev.altKey && !ev.metaKey && special(ev.key)) ev.preventDefault()
    })
    this.textTarget = target
    if (focus) {
      setTimeout(() => {
        input.focus()
        input.setSelectionRange(input.value.length, input.value.length)
        // init_input's select_prefill and update_input's select both mean "select all"
        if (ti.select_prefill || ti.select) input.select()
      }, 20)
    }
  }

  private submitText(text: string, tag?: string, finalChar = 13) {
    // ctrl-u + ctrl-k wipe any prefill on the crawl side; 'repeat' has none
    if (tag !== 'repeat') {
      this.hooks.send(cm.key(21))
      this.hooks.send(cm.key(11))
    }
    this.hooks.send(cm.textInput(text + String.fromCharCode(finalChar)))
  }

  /**
   * Pad operations on the on-screen keyboard. The keyboard types into the
   * active server field, or into a client overlay's own field (palette
   * filter) when one has it open.
   */
  oskOp(op: string, dir?: Dir8) {
    if (!this.osk.visible) {
      const t = this.textTarget
      if (!t) return
      this.osk.attach(t, t.input.closest('.popup') || this.root)
      // the press that reveals the keyboard leaves its cursor on the first key
      // and types nothing: it is a reveal, not a step, a letter or a shift
      if (op === 'move' || op === 'type' || op === 'shift') return
    }
    this.osk.op(op as OskOp, dir)
    if (op === 'submit' || op === 'cancel') this.osk.detach()
  }

  // ---------------------------------------------------------- client overlays

  closeClientOverlay() {
    if (!this.clientOverlay) return
    // the pause menu is a place, not a step: it opens again on the row it was left on
    if (this.clientOverlay.kind === 'system') this.systemAt = rowLabel(this.clientOverlay.items[this.clientOverlay.focus])
    if (this.clientOverlay.kind === 'choices') this.choiceAt.set(this.clientOverlay.el.dataset.remember ?? '', this.clientOverlay.focus)
    if (this.osk.input && this.clientOverlay.el.contains(this.osk.input)) this.osk.detach()
    this.clientOverlay.el.remove()
    this.clientOverlay = null
    this.hooks.onClientOverlayChange()
  }

  private openClientOverlay(kind: ClientOverlayKind, el: HTMLElement, items: HTMLElement[], back?: () => void) {
    this.closeClientOverlay()
    el.dataset.client = '1'
    this.root.append(el)
    this.clientOverlay = { kind, el, focus: 0, items, back }
    this.itemsTakeMouse(items)
    this.setClientFocus(0)
    this.hooks.onClientOverlayChange()
  }

  /**
   * The pointer moves the one cursor: the row the mouse is over becomes the
   * focused row, so left and right (and Enter after) act on what is under
   * the mouse and not on where the keyboard was left. The server's own menus
   * do the same with the hover their buttons send (ui-layouts.js).
   */
  private itemsTakeMouse(items: HTMLElement[]) {
    items.forEach((it, i) =>
      it.addEventListener('mouseenter', () => {
        if (this.clientOverlay?.items === items) this.setClientFocus(i, false)
      }),
    )
  }

  private setClientFocus(i: number, scroll = true) {
    const o = this.clientOverlay
    if (!o || !o.items.length) return
    o.items[o.focus]?.classList.remove('focused')
    o.focus = ((i % o.items.length) + o.items.length) % o.items.length
    o.items[o.focus].classList.add('focused')
    // the mouse asks for no scrolling: a half-shown row scrolled under a resting pointer would hover the next row
    if (scroll) o.items[o.focus].scrollIntoView({ block: 'nearest' })
  }

  /** The keyboard is typing into this overlay's filter field. */
  private get clientOskOpen(): boolean {
    const o = this.clientOverlay
    return !!o && !!o.filter && this.osk.visible && this.osk.input === o.filter
  }

  /**
   * Navigation inside a client overlay. Returns true if consumed. While the
   * palette's keyboard is open, direction and select/cancel drive the
   * keyboard instead (move, type, backspace) until 'submit' closes it.
   */
  clientOverlayInput(op: ClientOverlayOp): boolean {
    const o = this.clientOverlay
    if (!o) return false
    if (this.clientOskOpen) {
      switch (op) {
        case 'next':
          this.osk.op('move', 4)
          return true
        case 'prev':
          this.osk.op('move', 0)
          return true
        case 'left':
          this.osk.op('move', 6)
          return true
        case 'right':
          this.osk.op('move', 2)
          return true
        case 'select':
          this.osk.op('type')
          return true
        case 'backspace':
          this.osk.op('backspace')
          return true
        case 'cancel':
          // backspace; on an empty field, put the keyboard away
          if (o.filter && o.filter.value.length) this.osk.op('backspace')
          else this.osk.detach()
          return true
        case 'space':
          this.osk.op('space')
          return true
        case 'submit':
        case 'keyboard':
          this.osk.detach()
          return true
        default:
          break
      }
    }
    switch (op) {
      case 'next':
        this.setClientFocus(o.focus + 1)
        break
      case 'prev':
        this.setClientFocus(o.focus - 1)
        break
      case 'bumperNext':
        return this.clientOverlayInput(o.category !== undefined ? 'catNext' : 'pageNext')
      case 'bumperPrev':
        return this.clientOverlayInput(o.category !== undefined ? 'catPrev' : 'pagePrev')
      case 'pageNext':
        this.setClientFocus(Math.min(o.items.length - 1, o.focus + 10))
        break
      case 'pagePrev':
        this.setClientFocus(Math.max(0, o.focus - 10))
        break
      case 'left':
      case 'right':
        if (o.category !== undefined) return this.clientOverlayInput(op === 'left' ? 'catPrev' : 'catNext')
        o.items[o.focus]?.dispatchEvent(new CustomEvent('adjust', { detail: op === 'left' ? -1 : 1 }))
        break
      case 'catNext':
      case 'catPrev':
        if (o.category !== undefined && o.rebuild && o.categories?.length) {
          o.category = (o.category + (op === 'catNext' ? 1 : -1) + o.categories.length) % o.categories.length
          o.rebuild()
        }
        break
      case 'keyboard':
        if (o.filter) {
          this.osk.attach({ input: o.filter, submit: () => this.osk.detach(), cancel: () => this.osk.detach() }, o.el)
        }
        break
      case 'first':
        this.setClientFocus(0)
        break
      case 'last':
        this.setClientFocus(o.items.length - 1)
        break
      case 'select':
      case 'submit':
      // space fires the row the cursor is on, as it does in a server menu
      case 'space':
        o.items[o.focus]?.click()
        break
      case 'backspace':
        break
      case 'cancel': {
        const back = o.back
        this.closeClientOverlay()
        back?.()
        break
      }
    }
    return true
  }

  private choiceAt = new Map<string, number>()
  /** the Select tab that was open last: Select comes back to it, on the row it was left on */
  private commandGroup: CommandGroup = 'travel'

  /**
   * Small controller menus. Opening, highlighting and backing out never send a
   * game key. `remember` names the cursor memory (the title by default), so
   * screens that share a title can still each keep their own row.
   */
  private choiceRows(choices: { label: string; key?: string; sep?: boolean; run(): void }[]): HTMLElement[] {
    return choices.map((choice) => {
      const row = h('li', { class: 'row level2 selectable fg7' + (choice.sep ? ' sep' : ''), role: 'button', tabindex: -1, dataset: { hotkey: choice.key && !choice.key.includes(' ') ? choice.key : '' } },
        h('span', { class: 'label' }, choice.label),
        choice.key ? h('span', { class: 'hotkey' }, choice.key) : null)
      row.addEventListener('click', () => {
        // a touch does not hover first: the clicked row is the one remembered
        const o = this.clientOverlay
        if (o) {
          const i = o.items.indexOf(row)
          if (i >= 0) this.setClientFocus(i, false)
        }
        this.closeClientOverlay()
        choice.run()
      })
      return row
    })
  }

  /**
   * The footer of a client menu (the Commands screen, a list of choices):
   * what moves the cursor and fires the row, in the words of the device that
   * spoke last. Both readings are built and the stack's `device-*` class
   * (`setDevice`) shows one, so the footer follows the player from the pad
   * to the keyboard without a rebuild. `tabs`: the menu has categories on
   * the bumpers and the left and right arrows.
   */
  private clientFooter(tabs: boolean): HTMLElement {
    const kind = this.hooks.padKind?.() ?? 'generic'
    const pad = h('span', { class: 'pad-only' })
    if (tabs) pad.append(glyph('LB', kind), ' / ', glyph('RB', kind), ' Tabs · ')
    pad.append(glyph('A', kind), ' Select · ', glyph('B', kind), ' Back')
    const kbd = h('span', { class: 'kbd-only' })
    if (tabs) kbd.append(h('kbd', null, '←'), ' ', h('kbd', null, '→'), ' Tabs · ')
    kbd.append(h('kbd', null, 'Enter'), ' Select · ', h('kbd', null, 'Esc'), ' Back')
    return h('div', { class: 'more' }, pad, kbd)
  }

  /**
   * Which device spoke last (game.ts `inputFrom`): the overlays that print
   * both a pad and a keyboard reading of their controls show the one that
   * fits (styles.css `.device-pad .kbd-only`, `.kbd-only`). Called every frame; cheap when unchanged.
   */
  setDevice(device: InputDevice) {
    const cls = device === 'pad' ? 'device-pad' : 'device-keyboard'
    this.device = device
    if (this.root.classList.contains(cls)) return
    this.root.classList.remove('device-pad', 'device-keyboard')
    this.root.classList.add(cls)
    // a server text prompt that is up: the pad taking over brings the on-screen keyboard with it, and a
    // physical key or the mouse puts it away so the field it was covering shows what is typed
    const t = this.textTarget
    if (!t || this.clientOverlay) return
    if (device === 'pad' && !this.osk.visible) this.osk.attach(t, t.input.closest('.popup') || this.root)
    else if (device !== 'pad' && this.osk.visible && this.osk.input === t.input) this.osk.detach()
  }

  showChoices(title: string, choices: { label: string; key?: string; sep?: boolean; run(): void }[], back?: () => void, remember = title) {
    const el = h('div', { class: 'popup menu game command-menu', dataset: { remember } })
    const items = this.choiceRows(choices)
    el.append(h('div', { class: 'title' }, title), h('div', { class: 'body' }, h('ol', null, ...items)))
    el.append(this.clientFooter(false))
    this.openClientOverlay('choices', el, items, back)
    this.setClientFocus(this.choiceAt.get(remember) ?? 0)
  }

  /**
   * RB opens battle actions only; Select owns the remaining commands. Game
   * options are on the Start menu (showSystem). `select` opens the tab that was
   * open last, on the row it was left on, so a command picked once is under
   * the cursor the next time.
   */
  showCommands(run: (action: Action) => void, start: CommandGroup | 'battle' | 'select' = 'battle') {
    const rows = (entries: CommandEntry[]) => entries.map((c) => ({ label: c.label, key: c.key, run: () => run(c.action) }))
    if (start === 'battle') {
      this.showChoices('Actions', rows(BATTLE_COMMANDS), undefined, 'commands:battle')
      return
    }
    if (start === 'select') start = this.commandGroup
    this.showChoices('Commands', [], undefined, 'commands:' + start)
    const o = this.clientOverlay!
    o.el.classList.add('tabbed')
    const body = o.el.querySelector('.body')!
    body.replaceChildren()
    const tabs = h('div', { class: 'command-tabs', role: 'tablist', 'aria-label': 'Command groups' })
    const hints = h('div', { class: 'command-hints' })
    // Keep every panel in one grid cell: the largest sizes the dialog, while
    // only the current panel is visible/interactive. Tab changes never close
    // the overlay or restart its opening animation (or the world's dimming).
    const panels = COMMAND_GROUPS.map((group, index) => {
      const items = this.choiceRows(rows(group.entries))
      const tabId = 'command-tab-' + group.id
      const panelId = 'command-panel-' + group.id
      const panel = h('ol', { id: panelId, role: 'tabpanel', 'aria-labelledby': tabId }, ...items)
      const hint = h('div', { class: 'command-hint' }, group.hint)
      const tab = h('button', { id: tabId, type: 'button', role: 'tab', 'aria-controls': panelId, title: group.hint, onclick: () => { o.category = index; o.rebuild!() } }, group.label)
      this.itemsTakeMouse(items)
      tabs.append(tab)
      hints.append(hint)
      body.append(panel)
      return { group, items, panel, hint, tab }
    })
    o.category = COMMAND_GROUPS.findIndex((g) => g.id === start)
    o.categories = COMMAND_GROUPS.map((g) => g.id)
    o.rebuild = () => {
      if (o.items.length) this.choiceAt.set(o.el.dataset.remember!, o.focus)
      o.items[o.focus]?.classList.remove('focused')
      panels.forEach(({ panel, hint, tab }, i) => {
        const active = i === o.category
        panel.inert = !active
        panel.classList.toggle('inactive', !active)
        hint.classList.toggle('inactive', !active)
        tab.classList.toggle('current', active)
        tab.setAttribute('aria-selected', String(active))
      })
      const current = panels[o.category!]
      this.commandGroup = current.group.id
      o.el.dataset.remember = 'commands:' + current.group.id
      o.items = current.items
      o.focus = 0
      body.scrollTop = 0
      this.setClientFocus(this.choiceAt.get(o.el.dataset.remember) ?? 0)
    }
    o.el.querySelector('.title')!.after(tabs, hints)
    o.el.querySelector('.more')!.replaceWith(this.clientFooter(true))
    o.rebuild()
  }

  /**
   * The command palette: the cmd-keys.h section for the current mode
   * (command, level map, targeting, menu), filtered by typed text and by
   * category. The bindings open it with the mode's section; bumpers cycle
   * categories. Selecting a command sends exactly the key the official client
   * would.
   */
  showPalette(mode: string = 'command', startCategory?: string, back?: () => void) {
    const section = CATALOGUE.filter((c) => c.mode === mode && (mode !== 'command' || !c.key || !GAMEPAD_COMMAND_KEYS.has(c.key)))
    const categories = categoriesFor(mode)
    const el = h('div', { class: 'popup palette ours' })
    const input = h('input', { type: 'text', placeholder: 'Filter commands…' })
    const cats = h('div', { class: 'cats' })
    const list = h('div', { class: 'list' })
    const title = { command: 'Commands', levelmap: 'Level map commands', targeting: 'Targeting commands', menu: 'Menu commands' }[mode] || 'Commands'
    el.append(h('div', { class: 'header' }, title), cats, h('div', { style: { padding: '0.3rem 0.8rem' } }, input), list)
    let catIndex = Math.max(0, categories.indexOf(startCategory || 'all'))
    const build = () => {
      const filter = input.value.toLowerCase()
      const cat = categories[catIndex]
      clear(cats)
      categories.forEach((c, i) => {
        const chip = h('span', { class: 'chip' + (i === catIndex ? ' current' : '') }, c)
        chip.addEventListener('click', () => {
          catIndex = i
          if (this.clientOverlay) this.clientOverlay.category = i
          build()
        })
        cats.append(chip)
      })
      clear(list)
      const items: HTMLElement[] = []
      for (const c of section) {
        if (cat !== 'all' && c.category !== cat) continue
        if (filter && !(c.label + ' ' + c.category + ' ' + c.id).toLowerCase().includes(filter)) continue
        const it = h('div', { class: 'item' }, h('span', null, c.label), h('span', { class: 'cat' }, `${c.category} · ${keyName(c)}`))
        it.addEventListener('click', () => {
          this.closeClientOverlay()
          const msg = commandMessage(c)
          if (msg) this.hooks.send(msg)
        })
        list.append(it)
        items.push(it)
      }
      if (this.clientOverlay) {
        this.clientOverlay.items = items
        this.clientOverlay.focus = 0
        this.itemsTakeMouse(items)
        this.setClientFocus(0)
      }
      return items
    }
    const items = build()
    input.addEventListener('input', () => build())
    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation()
      if (ev.key === 'Escape') this.clientOverlayInput('cancel')
      else if (ev.key === 'Enter') this.clientOverlayInput('select')
      else if (ev.key === 'ArrowDown') this.clientOverlayInput('next')
      else if (ev.key === 'ArrowUp') this.clientOverlayInput('prev')
      else if (ev.key === 'Tab') this.clientOverlayInput(ev.shiftKey ? 'catPrev' : 'catNext')
      else return
      ev.preventDefault()
    })
    this.openClientOverlay('palette', el, items, back)
    const o = this.clientOverlay!
    o.filter = input
    o.category = catIndex
    o.categories = categories
    o.rebuild = () => {
      catIndex = o.category ?? 0
      build()
    }
    setTimeout(() => input.focus(), 20)
  }

  /**
   * The pause menu, drawn as the game draws a menu: a letter per item, the
   * hovered line lit. It is a place of its own, so it opens again on the row
   * it was left on, and the screens it leads to (the settings, the controls)
   * come back to it, on the row that led away.
   */
  showSystem(opts: { spectating: boolean; inGame: boolean }) {
    const again = () => this.showSystem(opts)
    const el = h('div', { class: 'popup menu game sysmenu' })
    el.append(h('div', { class: 'title' }, 'Orbrun'))
    const ol = h('ol')
    el.append(h('div', { class: 'body' }, ol))
    const items: HTMLElement[] = []
    const add = (label: string, fn: () => void, sep = false) => {
      const k = String.fromCharCode(97 + items.length)
      const it = h('li', { class: 'row level2 selectable fg7' + (sep ? ' sep' : ''), dataset: { hotkey: k } }, h('span', { class: 'hotkey' }, k), h('span', { class: 'dash' }, '-'), h('span', { class: 'label' }, label))
      it.addEventListener('click', () => {
        this.closeClientOverlay()
        fn()
      })
      items.push(it)
      ol.append(it)
    }
    const playing = opts.inGame && !opts.spectating
    // three runs under rules: the game (back to it, its own commands and screens), Orbrun (the pad, the settings),
    // and last the way out
    add('Resume', () => {})
    if (playing) {
      add(`${REPEAT_COMMAND.label} (${REPEAT_COMMAND.key})`, () => this.hooks.send(cm.input(REPEAT_COMMAND.key)))
      // crawl binds CMD_GAME_MENU to `~` and F1 (cmd-keys.h); Escape does nothing in the main view
      add('Game menu (F1)', () => this.hooks.send(cm.input('~')))
      add(`${HELP_COMMAND.label} (${HELP_COMMAND.key})`, () => this.hooks.send(cm.input(HELP_COMMAND.key)))
    }
    if (opts.inGame) add('Chat (F12)', () => this.hooks.onSystemAction('chat'))
    // 2D and third person are out for now (VIEW_OPTIONS in servers.ts); the camera is client-side, so a spectator may move it too
    if (playing && VIEW_OPTIONS) add('Toggle 2D / 3D view', () => this.hooks.onSystemAction('toggleRenderer'))
    if (opts.inGame && VIEW_OPTIONS) add('Toggle first / third person', () => this.hooks.onSystemAction('toggleView'))
    add('Gamepad', () => this.showBindings(this.hooks.padKind?.() ?? 'generic', again), true)
    add('Settings', () => this.showSettings(again))
    // a player saves (crawl's S, which asks first, then go_lobby brings the front end back); a spectator has nothing to
    // save and goes back to the Watch screen (`#lobby`) the game was picked from
    if (playing) add('Save and exit (S)', () => this.hooks.send(cm.input('S')), true)
    else add(opts.spectating ? 'Stop watching' : 'Leave game', () => this.hooks.onSystemAction('disconnect'), true)
    el.append(h('div', { class: 'more' }, '[Esc] resume'))
    this.openClientOverlay('system', el, items)
    // where it was left: the same row again, by its name, since which rows are drawn depends on the game
    const at = items.findIndex((it) => rowLabel(it) === this.systemAt)
    if (at > 0) this.setClientFocus(at)
  }

  showSettings(back?: () => void) {
    const panel = this.hooks.settingsPanel()
    panel.classList.add('popup', 'settings')
    const items = Array.from(panel.querySelectorAll('.row')) as HTMLElement[]
    this.openClientOverlay('settings', panel, items, back)
  }

  /** A letter in the pause menu or the settings: the item with that hotkey, as in the game's menus. */
  clientOverlayHotkey(ch: string): boolean {
    const o = this.clientOverlay
    if (!o || this.clientOskOpen) return false
    const i = o.items.findIndex((it) => it.dataset.hotkey === ch)
    if (i < 0) return false
    this.setClientFocus(i)
    o.items[i].click()
    return true
  }

  showBindings(padKind: PadKind = 'generic', back?: () => void) {
    const el = h('div', { class: 'popup bindings-sheet ours' })
    el.append(h('div', { class: 'header' }, 'Gamepad'))
    el.append(controlsSheet(padKind))
    const close = h('div', { class: 'row action' }, h('span', { class: 'marker' }), h('span', { class: 'label' }, 'Close'))
    close.addEventListener('click', () => {
      this.closeClientOverlay()
      back?.()
    })
    el.append(close)
    this.openClientOverlay('bindings', el, [close], back)
  }
}

interface SpellBook {
  label: string
  spells: { letter: string; title: string; effect?: string; range_string?: string; range?: string; colour?: number; hotkey?: number; tile?: number }[]
}

/** A client menu row's name: its label, which is what a row is found by again when the menu is drawn afresh. */
function rowLabel(el: HTMLElement | undefined): string | null {
  if (!el) return null
  return (el.querySelector('.label') as HTMLElement | null)?.textContent ?? el.textContent ?? null
}

function keyName(c: CatalogueCommand): string {
  if (c.ck) return c.ck.replace(/^CK_/, '').replace(/_/g, ' ').toLowerCase()
  if (!c.key) return ''
  const code = c.key.charCodeAt(0)
  if (c.key === '\t') return 'Tab'
  if (c.key === '\r') return 'Enter'
  if (code === 27) return 'Esc'
  if (code < 32) return 'Ctrl-' + String.fromCharCode(64 + code)
  return c.key
}
