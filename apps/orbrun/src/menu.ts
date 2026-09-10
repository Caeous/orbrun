import { cm, gameLinkRows, type GameLink, type GameState, type LobbyEntry } from '@orbrun/webtiles'
import { settingsPanel } from './settings-panel'
import { controlsSheet } from './controls-sheet'
import { h, replace } from './dom'
import { FocusNav, type Focusable } from './focus'
import { RoomView } from './room/view'
import { addAccount, addServer, characterOf, describeCharacter, describePlace, findServer, getCharacter, getChosenAccount, getGames, getLast, listAccounts, listServers, loginState, morgueUrlFor, removeAccount, sameAccount, setChosenAccount, setLast, type Account, type LastCharacter, type ServerInfo } from './servers'
import type { Session } from './session'
import type { PadEvent, PadKind } from './gamepad'
import { Osk, oskPrompts } from './osk'
import { glyph, glyphName, type GlyphName } from './glyphs'
import { pickSplash } from './splash'
import { renderMarkdown } from './markdown'
import aboutText from '../../../ABOUT.md?raw'
import changelogText from '../../../CHANGELOG.md?raw'

/** What to do once a fresh connection is up: rejoin a game or a spectate. */
export type Intent = { kind: 'play'; gameId: string } | { kind: 'watch'; username: string }

/**
 * The front end's screens. Play, Watch and Settings are the sections the
 * shoulder buttons walk; the rest are the flows off them: the account and
 * server flows off the account row, the login and register forms.
 */
export type View = 'home' | 'watch' | 'settings' | 'controls' | 'accounts' | 'servers' | 'login' | 'register' | 'about' | 'exit' | 'doc'

const SECTIONS: View[] = ['home', 'watch', 'settings']

/** the way off a screen (`data-focus`) */
const BACK = 'back'

/** A text file read through the shell's proxy; a status that is not success is the failure's words. */
async function fetchText(url: string): Promise<string> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.text()
}

export type NavDir = 'up' | 'down' | 'left' | 'right'

const ARROW_DIRS: Record<string, NavDir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }
/** the four vim keys the game moves with, minus the diagonals: the screens are a row / column grid */
const VIM_DIRS: Record<string, NavDir> = { k: 'up', j: 'down', h: 'left', l: 'right' }

/**
 * Where a key moves the cursor, or null when it is not a movement key. The
 * arrows work everywhere except that left and right are left to a text field,
 * so the caret can be moved; the vim keys (k up, j down, h left, l right, as
 * in the game) are letters, so a text field takes them all. Ctrl / Alt / Meta
 * combos are never movement.
 */
export function navDir(ev: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey'>, inInput: boolean): NavDir | null {
  if (ev.ctrlKey || ev.altKey || ev.metaKey) return null
  const arrow = ARROW_DIRS[ev.key]
  if (arrow) return inInput && (arrow === 'left' || arrow === 'right') ? null : arrow
  if (inInput || ev.key.length !== 1) return null
  return VIM_DIRS[ev.key.toLowerCase()] ?? null
}

export interface FrontHooks {
  /** whether a controller is connected: the message line then says which button opens the keyboard on a text field */
  padConnected?(): boolean
  /** which pad, for the controls sheet's glyphs */
  padKind?(): PadKind
  /** a session on `server` for `username` (none while an account is being added, or spectating without one); an open one is reused */
  connect(server: ServerInfo, username: string | null, intent?: Intent): Session
  /** the session on `server` for `username` that is up, or opening (the warm connection), if any */
  session?(server: ServerInfo, username: string | null): Session | null
  /** whether a connection that just closed will be opened again on its own (asked as the close lands) */
  retrying?(): boolean
  /** forget the login of `account` (its token and the server's cookie) and close its session */
  logout(account: Account): void
  play(session: Session, gameId: string): void
  watch(session: Session, username: string): void
  /** back on the home screen, or on the Watch screen (`#lobby`): the address bar says so, the connection stays */
  leave(where: 'home' | 'lobby'): void
}

/** One line of a menu: what it says, what it does, what the message line says while the cursor is on it. */
interface Row {
  id: string
  label: string
  sub?: string | null
  /** where a connection stands, as a dot before the label: green logged in, gold waiting, gray logged out, red down */
  conn?: 'up' | 'wait' | 'off' | 'down'
  /** the glyph in the margin, as the game marks a feature: `>` stairs, `?` a scroll, `{` the pool, `+` a door */
  marker?: string
  hint?: string
  fn?: () => void
  /** things standing beside the row, reached with left and right (an account's log out beside its name) */
  also?: { id: string; label: string; title?: string; fn: () => void }[]
  /** a text field: the row is the prompt, X (or a click) types into it */
  input?: HTMLInputElement
  /** the way in: lit brighter, as the game lights the choice that matters */
  main?: boolean
  /** a row that cannot be taken right now (a setting that means nothing under the others) */
  off?: boolean
  /** a group starts here: a little air above */
  gap?: boolean
  /**
   * A small button in a row of them, rather than a line of its own: the
   * utilities under the way in, were they ever chips again.
   * Neighbouring chips share one focus row, so left and right walk them and a
   * pad reaches the bottom of the menu in two presses.
   */
  chip?: boolean
}

/**
 * The front end: readable menus over the room (room/view.ts), in the
 * console face, one cursor driven by the pad, the keyboard, the mouse or
 * touch. The home screen is the chosen account and the four things to do:
 * Continue, Play, Watch, Settings; Play, Watch and Settings are the
 * sections the shoulder buttons walk. The account row leads to the
 * accounts on this device, adding one (a server, then its login or
 * register form), and logging out. Every screen remembers the row it was
 * left on, so Back lands where the player was.
 *
 * Text is never attached to the scenery: the room is looked around with
 * the right stick or a drag on it, and the menus stand still.
 */
export class FrontEnd {
  root: HTMLElement
  private hooks: FrontHooks
  private nav = new FocusNav()
  private session: Session | null = null
  private unsub: (() => void) | null = null
  private _view: View = 'home'
  private reloaded = false
  private error: string | null = null
  /** pad-driven keyboard for the login, register and add-server fields */
  private osk = new Osk(oskPrompts('Submit', 'Cancel'), () => this.hooks.padKind?.() ?? 'generic')
  /** the room behind the screens */
  private roomView: RoomView
  /** Xom's line under the title, drawn once per visit so redraws don't reshuffle it */
  private splash = pickSplash()
  /** what the settings screen goes back to: the screen it was opened from */
  private settingsFrom: (() => void) | null = null
  /** the name last typed into the login form: a refused login keeps it, as the official form does */
  private loginName = ''
  /** the server picked for an account being added: the login and register screens are its */
  private adding: ServerInfo | null = null
  /** where the server list was opened from, so B retraces the way in: the accounts, or the front screen */
  private serversFrom: View = 'accounts'
  /** the server picked to watch on without an account */
  private watchOn: ServerInfo | null = null
  /** what a screen held last time it was drawn: the same again, and it is left alone */
  private shape = new Map<View, string>()
  /** the redraw waiting for the next frame: the server's messages come in bursts, and one redraw serves them all */
  private frame = 0
  /** the message line of the screen on show */
  private msg: HTMLElement | null = null
  /** where the cursor stood on each screen when it was left: the row's id, so a list that changed still finds it */
  private marks = new Map<View, string>()
  /**
   * the roster: the rows on show by lobby entry (a player can run a game of
   * each version at once, so the name is not the key), each with its details
   * row and what it read last time, so a row that reads the same is kept
   */
  private rosterRows = new Map<number, { tr: HTMLTableRowElement; dt: HTMLTableRowElement; sig: string }>()
  /** the entries the roster shows: arrivals are held back from the table until the player asks for them (Y) */
  private rosterSeen = new Set<number>()
  private rosterTable: HTMLTableElement | null = null
  /** the rows whose details are opened (narrow screens: the extra columns as a second line) */
  private detailsOpen = new Set<number>()
  private legend: HTMLElement | null = null
  private legendShape = ''
  /** the document on show (About, What's new, a morgue file): its scroll region, which up and down move */
  private docScroller: HTMLElement | null = null
  /** what the document goes back to: the screen it was opened from */
  private docFrom: (() => void) | null = null
  /** the footer line on the home screen that says which controller is plugged in (or that none is) */

  constructor(host: HTMLElement, hooks: FrontHooks) {
    this.hooks = hooks
    this.root = h('div', { class: 'screen home' })
    host.append(this.root)
    this.root.addEventListener('focusin', this.onNativeFocus)
    this.roomView = new RoomView(this.root)
    this.showHome()
  }

  destroy() {
    this.unsub?.()
    if (this.frame) cancelAnimationFrame(this.frame)
    this.osk.detach()
    this.roomView.destroy()
    this.root.remove()
  }

  get view(): View {
    return this._view
  }

  // ------------------------------------------------------------------ input

  /** The element the cursor is on. */
  private get focused(): HTMLElement | null {
    const el = this.nav.current()?.el
    return el?.querySelector<HTMLInputElement>('input') ?? el ?? null
  }

  /**
   * A pad event, by precedence: a dialog the server put up takes any press;
   * the on-screen keyboard takes everything while it is open; then the
   * screen: the stick and d-pad move the cursor, A chooses, B goes back, X types, Y
   * brings the roster's arrivals in, the shoulders walk the sections, and
   * Start confirms like Enter.
   */
  pad(ev: PadEvent) {
    if (ev.type === 'look') {
      // a document takes the right stick as its scroll; the room is looked around from every other screen
      if (this.docScroller) this.scrollDoc(ev.dy * 12)
      else this.roomView.look(ev.dx, ev.dy)
      return
    }
    if (ev.type === 'press' && this.session?.state.lobby.staleProcesses) {
      this.stopStalePurge()
      return
    }
    if (this.osk.visible) {
      if ((ev.type === 'dir' || ev.type === 'dirRepeat') && ev.dir !== null) this.osk.op('move', ev.dir)
      else if (ev.type === 'press') {
        if (ev.button === 'A') this.osk.op('type')
        else if (ev.button === 'B' || ev.button === 'SELECT') this.osk.op('cancel')
        else if (ev.button === 'X') this.osk.op('backspace')
        else if (ev.button === 'Y' || ev.button === 'START') this.osk.op('submit')
        else if (ev.button === 'LB') this.osk.op('shift')
        else if (ev.button === 'RB') this.osk.op('space')
      }
      return
    }
    if ((ev.type === 'dir' || ev.type === 'dirRepeat') && ev.dir !== null) this.dir(ev.dir)
    else if (ev.type === 'press') {
      if (ev.button === 'A') this.activate()
      else if (ev.button === 'B') this.back()
      else if (ev.button === 'X') {
        // nothing to type into on the front screen: X is the settings there, as it opens the keyboard everywhere else
        if (this._view === 'home') this.showSettings(() => this.showHome())
        else this.openOsk()
      } else if (ev.button === 'Y') this.takeArrivals()
      else if (ev.button === 'LB') this.section(-1)
      else if (ev.button === 'RB') this.section(1)
      else if (ev.button === 'START') this.confirm()
    }
  }

  private dir(d: number) {
    if (d === 0 || d === 7 || d === 1) this.up('up')
    else if (d === 4 || d === 3 || d === 5) this.up('down')
    else if (d === 2) this.side(1)
    else if (d === 6) this.side(-1)
  }

  /** Up or down: a document scrolls, otherwise the cursor moves. */
  private up(dir: 'up' | 'down') {
    if (this.docScroller) this.scrollDoc(dir === 'up' ? -this.docStep() : this.docStep())
    else this.nav.move(dir)
  }

  /** one press of up or down on a document: a fifth of what is in view, never less than a line or two */
  private docStep(): number {
    return Math.max(48, Math.round((this.docScroller?.clientHeight ?? 0) / 5))
  }

  private scrollDoc(by: number) {
    const el = this.docScroller
    if (!el) return
    el.scrollTop = Math.max(0, el.scrollTop + by)
  }

  /** Native Tab, pointer and assistive-technology focus share the pad's cursor. */
  private onNativeFocus = (ev: FocusEvent) => {
    const target = ev.target as HTMLElement
    const at = this.navItems.findIndex((f) => f.el === target || f.el.contains(target))
    if (at >= 0 && this.nav.current() !== this.navItems[at]) this.nav.focus(at)
  }

  /** Make non-native rows tabbable, and give pad moves real browser focus. */
  private prepareFocus(items: Focusable[]) {
    for (const f of items) {
      const input = f.el.querySelector<HTMLInputElement>('input')
      const target = input ?? f.el
      if (target.tabIndex < 0) target.tabIndex = 0
      const onFocus = f.onFocus
      f.onFocus = () => {
        onFocus?.()
        if (document.activeElement !== target) target.focus({ preventScroll: true })
      }
    }
    this.navItems = items
  }

  /** Keyboard. Returns true when the key was taken. */
  key(ev: KeyboardEvent): boolean {
    if (this.osk.visible) {
      if (ev.key === 'Escape') {
        this.osk.detach()
        return true
      }
      return false
    }
    // Browser shortcuts (including modified Enter on a link) belong to the browser.
    if (ev.ctrlKey || ev.altKey || ev.metaKey || ev.key === 'Tab') return false
    // client.js handle_keydown: any key while the stale-processes notice shows keeps the old game alive
    if (this.session?.state.lobby.staleProcesses) {
      this.stopStalePurge()
      ev.preventDefault()
      return true
    }
    const target = ev.target as HTMLElement | null
    const inInput = target instanceof HTMLInputElement
    const dir = navDir(ev, inInput)
    if (dir) {
      if (dir === 'up' || dir === 'down') this.up(dir)
      else this.side(dir === 'right' ? 1 : -1)
      ev.preventDefault()
      return true
    }
    // Native buttons and links handle Enter/Space themselves, exactly once.
    if ((ev.key === 'Enter' || ev.key === ' ') && (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement)) return false
    if (ev.key === 'Enter' || (ev.key === ' ' && !inInput)) {
      if (inInput && (target as HTMLInputElement).form) (target as HTMLInputElement).form!.requestSubmit()
      else this.activate()
      ev.preventDefault()
      return true
    }
    if (ev.key === 'Escape') {
      this.back()
      return true
    }
    if ((ev.key === 'y' || ev.key === 'Y') && !inInput && this._view === 'watch') {
      this.takeArrivals()
      return true
    }
    if (ev.key === 'PageUp' || ev.key === 'PageDown') {
      if (inInput) return false
      // a document pages; elsewhere the keys walk the sections as the shoulders do
      if (this.docScroller) this.scrollDoc((ev.key === 'PageUp' ? -1 : 1) * Math.max(48, this.docScroller.clientHeight - 48))
      else this.section(ev.key === 'PageUp' ? -1 : 1)
      ev.preventDefault()
      return true
    }
    if ((ev.key === 'Home' || ev.key === 'End') && this.docScroller && !inInput) {
      this.docScroller.scrollTop = ev.key === 'Home' ? 0 : this.docScroller.scrollHeight
      ev.preventDefault()
      return true
    }
    return false
  }

  /** Left or right: a setting turns, a roster row opens or closes its details, otherwise the cursor moves along the row. */
  private side(d: number) {
    const cur = this.nav.current()
    if (!cur) return
    const id = cur.id ?? ''
    if (cur.el.dataset.hotkey !== undefined && cur.el.classList.contains('row')) {
      cur.el.dispatchEvent(new CustomEvent('adjust', { detail: d }))
      this.say(cur.el.dataset.hint)
      return
    }
    if (id.startsWith('watch:')) {
      this.details(Number(id.slice(6)), d > 0)
      return
    }
    this.nav.move(d > 0 ? 'right' : 'left')
  }

  private activate() {
    const cur = this.nav.current()
    if (!cur) return
    if (cur.el instanceof HTMLInputElement || cur.el instanceof HTMLTextAreaElement) this.openOsk()
    else cur.activate()
  }

  /** Start is Enter: submit a focused form rather than opening its keyboard. */
  private confirm() {
    const el = this.focused
    if (el instanceof HTMLTextAreaElement) {
      el.setRangeText('\n', el.selectionStart, el.selectionEnd, 'end')
      el.dispatchEvent(new Event('input', { bubbles: true }))
    } else if (el instanceof HTMLInputElement && el.form) el.form.requestSubmit()
    else this.activate()
  }

  /** Open the on-screen keyboard on the focused field, if the focus is on one. */
  private openOsk() {
    const el = this.focused
    if (!(el instanceof HTMLInputElement)) return
    const input = el
    this.osk.attach(
      {
        input,
        submit: () => {
          this.osk.detach()
          if (input.form) input.form.requestSubmit()
          else this.nav.move('down')
        },
        cancel: () => this.osk.detach(),
      },
      this.root,
    )
  }

  /** The next or previous section: Play (the home screen), Watch, Settings. Inert off the sections and in a flow. */
  private section(d: number) {
    const v: View = this._view === 'controls' ? 'settings' : this._view
    const i = SECTIONS.indexOf(v)
    if (i < 0) return
    const next = SECTIONS[(i + d + SECTIONS.length) % SECTIONS.length]
    if (next === 'home') this.goHome()
    else if (next === 'watch') this.showWatch()
    else this.showSettings(() => this.showHome())
  }

  private back() {
    this.osk.detach()
    const v = this._view
    if (v === 'home') return
    if (v === 'settings') {
      const from = this.settingsFrom
      this.settingsFrom = null
      if (from) from()
      else this.showHome()
    } else if (v === 'controls') this.showSettings(this.settingsFrom ?? undefined)
    else if (v === 'doc') {
      const from = this.docFrom
      this.docFrom = null
      if (from) from()
      else this.showHome()
    } else if (v === 'watch') this.goHome()
    else if (v === 'accounts' || v === 'about') this.showHome()
    else if (v === 'exit') {
      if (this.session) this.session.state.exit = null
      this.shape.delete('home')
      this.showHome()
    } else if (v === 'servers') {
      if (this.watchOn || this.serversFrom === 'home') this.showHome()
      else this.showAccounts()
    } else if (v === 'login') this.cancelAuth()
    else if (v === 'register') this.showLogin()
  }

  /**
   * Redraw the screen on show without moving the cursor: the home screen (the
   * account's login, the game list, the notices) and the roster.
   * Called on every message of the connection, so each is guarded: nothing is
   * redrawn while it would read the same.
   */
  refresh() {
    if (this._view === 'home') this.showHome()
    else if (this._view === 'watch') this.showWatch()
  }

  /** A redraw on the next frame: a burst of messages (the roster on arrival) is drawn once. */
  private schedule() {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.refresh()
    })
  }

  // ------------------------------------------------------------------ screens

  /** Leave the screen on show: remember the row the cursor was on, put the keyboard away. */
  private setView(v: View, cls: string) {
    const cur = this.nav.current()
    if (cur) this.marks.set(this._view, cur.id ?? cur.label)
    this.osk.detach()
    this.docScroller = null
    if (v !== this._view) this.shape.delete(v)
    this._view = v
    this.root.className = 'screen home ' + cls
    if (v !== 'watch') {
      this.rosterRows.clear()
      this.rosterSeen.clear()
      this.rosterTable = null
    }
  }

  /** The screen's frame in the safe area, over the room; the room and its poster stay where they are. */
  private screen(cls: string, content: (HTMLElement | null)[]) {
    const keep: HTMLElement[] = [this.roomView.poster, this.roomView.el]
    for (const child of Array.from(this.root.children)) if (!keep.includes(child as HTMLElement)) child.remove()
    for (const el of keep) if (el.parentNode !== this.root) this.root.append(el)
    this.root.append(h('div', { class: 'frame menu-frame ' + cls }, ...content))
  }

  /** The head of a screen: its name and the line under it; the title screen has Xom's word beneath both. */
  private head(title: string, lede: string | null, splash?: string): HTMLElement {
    return h('div', { class: 'head' }, h('h1', { class: 'place' }, title), lede ? h('div', { class: 'lede' }, lede) : null, splash ? h('div', { class: 'splash', title: 'Xom, in the game’s own words' }, splash) : null)
  }

  /** The message line: what the row under the cursor is, said the way the game says what is underfoot. */
  private say(text: string | undefined) {
    const m = this.msg
    if (!m) return
    const t = text ?? ''
    if (m.textContent === t) return
    // a redraw (the roster's count changing under the cursor) hands a fresh line the same words:
    // they stand as they were, without playing the fade-in again
    const same = t === this.said
    this.said = t
    m.textContent = t
    m.classList.remove('said')
    if (t && !same) {
      void m.offsetWidth
      m.classList.add('said')
    }
  }

  /** the words the message line last said, kept across redraws so they do not fade in twice */
  private said = ''

  private rows: Row[] = []

  /** A row as a button: the marker in the margin, the label, the note on the right. */
  private item(r: Row): HTMLElement {
    return h(
      'button',
      { type: 'button', class: 'item' + (r.main ? ' main' : '') + (r.off ? ' off' : '') + (r.gap && !r.chip ? ' gap' : '') + (r.chip ? ' chip' : '') + (r.conn ? ' conn ' + r.conn : ''), dataset: { focus: r.id, marker: r.marker ?? '' }, onclick: () => this.click(r) },
      h('span', { class: 'marker' }),
      r.conn ? h('span', { class: 'dot', 'aria-hidden': 'true' }) : null,
      h('span', { class: 'label' }, r.label),
      r.sub ? h('span', { class: 'sub' }, r.sub) : null,
    )
  }

  private click(r: Row) {
    const at = this.navItems.findIndex((f) => f.id === r.id)
    if (at >= 0) this.nav.focus(at)
    r.fn?.()
  }

  private navItems: Focusable[] = []

  /**
   * Draw a list screen: the head, the notices, the rows with whatever stands
   * beside them, the message line, and anything under (the roster). The
   * cursor starts on the row the screen was left on, else where the caller
   * says, else the first row past Back.
   */
  private list(opts: { cls: string; title: string; lede?: string | null; splash?: string; rows: Row[]; utilities?: Row[]; notices?: HTMLElement[]; below?: HTMLElement[]; extra?: Focusable[]; wrap?: (list: HTMLElement) => HTMLElement; focus?: string }): HTMLElement {
    this.rows = [...opts.rows, ...(opts.utilities ?? [])]
    const items: Focusable[] = []
    const home = this._view === 'home'
    const list = h('nav', { class: 'menu menu-actions' + (home ? ' home-actions' : ''), 'aria-label': home ? 'Main menu' : opts.title })
    /** the row of chips being filled, and the focus row they share */
    let chips: { el: HTMLElement; row: number; n: number } | null = null
    opts.rows.forEach((r, i) => {
      if (r.chip) {
        // a run of chips is one line on screen and one row under the cursor: left and right walk it
        if (!chips) {
          const el = h('div', { class: 'chips' + (r.gap ? ' gap' : '') })
          list.append(el)
          chips = { el, row: i, n: 0 }
        }
        const el = this.item(r)
        chips.el.append(el)
        items.push({ id: r.id, label: r.label, el, row: chips.row, col: chips.n++, activate: () => r.fn?.(), onFocus: () => this.onRow(r, el) })
        return
      }
      chips = null
      if (r.input) {
        const field = h('label', { class: 'item field-item' + (r.gap ? ' gap' : ''), dataset: { focus: r.id } }, h('span', { class: 'marker' }), h('span', { class: 'label' }, r.label), r.input)
        r.input.dataset.focus = r.id
        list.append(field)
        items.push({ id: r.id, label: r.label, el: field, row: i, activate: () => this.openOsk(), onFocus: () => this.onRow(r, field) })
        return
      }
      const el = this.item(r)
      const line = h('div', { class: 'line' }, el, ...(r.also ?? []).map((a) => h('button', { type: 'button', class: 'item beside', title: a.title ?? '', dataset: { focus: a.id }, onclick: a.fn }, h('span', { class: 'label' }, a.label))))
      list.append(line)
      items.push({ id: r.id, label: r.label, el, row: i, col: 0, activate: () => r.fn?.(), onFocus: () => this.onRow(r, el) })
      r.also?.forEach((a, k) => {
        const bel = line.children[k + 1] as HTMLElement
        items.push({ id: a.id, label: a.label, el: bel, row: i, col: k + 1, activate: a.fn, onFocus: () => this.say(a.title) })
      })
    })
    const body = opts.wrap ? opts.wrap(list) : list
    const error = this.error ? h('div', { class: 'error' }, this.error) : null
    this.error = null
    this.msg = h('div', { class: 'menu-msg', 'aria-live': 'polite' })
    this.legend = h('div', { class: 'legend', 'aria-label': 'Menu controls' })
    this.legendShape = ''
    this.updateInputHints()
    // Size bottom-aligned home help for every hint, not just the focused row.
    // Overlapping hidden copies wrap naturally at the current viewport width.
    const help = this._view === 'home'
      ? h('div', { class: 'home-menu-help' }, this.msg,
        h('div', { class: 'menu-msg menu-msg-reserve', 'aria-hidden': 'true' },
          ...this.rows.flatMap((r) => [r.hint ?? '', ...(r.also?.map((a) => a.title ?? '') ?? [])]).map((hint) => h('span', {}, hint))))
      : this.msg
    const brand = h('div', { class: 'brand' }, this.head(opts.title, opts.lede ?? null, opts.splash), error, ...(opts.notices ?? []), body, ...(opts.below ?? []), help, this.legend)
    const all = [...items, ...(opts.extra ?? [])]
    if (opts.utilities?.length) {
      const utilities = h('nav', { class: 'menu home-utilities', 'aria-label': 'Account and information' })
      opts.utilities.forEach((r, i) => {
        const el = this.item(r)
        utilities.append(el)
        all.push({ id: r.id, label: r.label, el, row: 200, col: i, activate: () => r.fn?.(), onFocus: () => this.onRow(r, el) })
      })
      brand.append(h('footer', { class: 'home-footer' }, utilities))
    }
    this.screen(opts.cls, [brand])
    this.prepareFocus(all)
    // Back is never where the cursor lands on its own: a screen drawn before its rows arrived
    // (Play while connecting) stood on Back, and the redraw that brings the rows must not stay there
    const want = opts.focus ?? this.marks.get(this._view)
    let at = want && want !== BACK ? all.findIndex((f) => f.id === want) : -1
    if (at < 0) at = all.findIndex((f) => f.id !== BACK)
    this.nav.set(all, this._view, { wrap: true }, at < 0 ? 0 : at, true)
    const cur = this.nav.current()
    if (cur) {
      if (cur.el instanceof HTMLInputElement) cur.el.focus()
      cur.onFocus?.()
    }
    return brand
  }

  /** Refresh just the prompts when a controller connects, disconnects or changes kind. */
  updateInputHints() {
    if (!this.legend) return
    const connected = !!this.hooks.padConnected?.()
    const kind = this.hooks.padKind?.() ?? 'generic'
    const shape = `${connected}/${kind}/${this._view}`
    if (shape === this.legendShape) return
    this.legendShape = shape
    const prompt = (key: GlyphName, text: string) => h('span', { class: 'menu-prompt', 'aria-label': `${glyphName(key, kind)} ${text}` }, glyph(key, kind), text)
    // the legend is for the pad only, and only on the title screen, where it says how to look around
    // the room; Move, Choose and Back go without saying, and X still opens Settings, unadvertised
    replace(this.legend, ...(connected && this._view === 'home' ? [prompt('RSTICK', 'Look around')] : []))
  }

  /** The cursor landed on a row: say what it is, and give a field the caret. */
  private onRow(r: Row, el: HTMLElement) {
    this.say(r.hint)
    if (r.input) r.input.focus()
    else if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) (document.activeElement as HTMLElement).blur()
    void el
  }

  /** The chosen account, and its server, when both are known. */
  private chosen(): { account: Account; server: ServerInfo } | null {
    const account = getChosenAccount()
    const server = account ? findServer(account.serverId) : null
    return account && server ? { account, server } : null
  }

  /** The session up (or opening) on `server` for `username`, if any: the warm connection, followed from here on. */
  private sessionOn(server: ServerInfo | null, username: string | null): Session | null {
    if (!server) return null
    const s = this.hooks.session?.(server, username) ?? null
    if (s && s !== this.session) this.follow(s)
    return s ?? (this.session && !this.session.closed && this.session.server.id === server.id && (this.session.username ?? null) === username ? this.session : null)
  }

  /** The games a server offers: the live list, or the one kept from last time. */
  private games(server: ServerInfo, s: Session | null): GameLink[] | null {
    const lobby = s?.conn.open ? s.state.lobby : null
    return lobby?.games.length ? lobby.games : getGames(server.id)
  }

  /**
   * Who waits in a game: the lobby's own word first (game_links.html save_info, "orbruntest, a level 3 Minotaur
   * Berserker of Trog", less the account's name at its head); else the roster, when the account's own game is
   * still open on the server (a socket that dropped, another tab); else the character this device saw there last.
   * A server that keeps its save info to itself (CDI, checked 2026-09-09) leaves only the last two.
   */
  private saveOf(server: ServerInfo, g: GameLink, who: string | null, s: Session | null): { sub: string; hint: string } | null {
    const stairs = (c: LastCharacter | null) => 'Down the stairs to your game.' + (c && describePlace(c) ? ` ${describePlace(c)} lies below.` : '')
    if (g.save && g.save !== 'playing' && g.save !== 'slot full') return { sub: who && g.save.startsWith(who + ', ') ? g.save.slice(who.length + 2) : g.save, hint: stairs(null) }
    const c = getCharacter(server.id, g.id)
    const open = this.ownGame(s, who, g.id)
    if (open) {
      const live = characterOf(open, c)
      return { sub: describeCharacter(live), hint: 'Down the stairs to your game, still open on the server.' + (describePlace(live) ? ` ${describePlace(live)} lies below.` : '') }
    }
    return c ? { sub: describeCharacter(c), hint: stairs(c) } : null
  }

  /** The roster's line for the account's own game `gameId`, when the server lists one: a game of theirs still running there. */
  private ownGame(s: Session | null, who: string | null, gameId: string): LobbyEntry | null {
    if (!who || !s?.conn.open) return null
    const name = who.toLowerCase()
    for (const e of s.state.lobby.entries.values()) if (e.game_id === gameId && e.username.toLowerCase() === name) return e
    return null
  }

  /**
   * The home screen: every offered DCSS version, then Watch and Settings.
   * The preferred saved game comes first, without a duplicate Continue row.
   * The compact account control and About & credits live in the footer;
   * connection details are in Accounts unless something fails. Without an
   * account, Play leads to adding one; Watch asks for a server.
   * A login still to come puts
   * Log in in Play's place, as the lobby page does (the server sends its
   * "Play now" lines only to someone logged in). The server's notices stand
   * above the rows. Redrawn as the connection's news lands, and only when it
   * would read differently; the cursor stays where it is.
   */
  showHome() {
    this.adding = null
    this.watchOn = null
    const chosen = this.chosen()
    const s = chosen ? this.sessionOn(chosen.server, chosen.account.username) : null
    const st: GameState | null = s?.state ?? null
    const lobby = st?.lobby ?? null
    const open = !!s?.conn.open
    const loggedIn = open && lobby ? lobby.username || null : null
    const rows: Row[] = []
    const notices: HTMLElement[] = []
    const extra: Focusable[] = []
    if (chosen) {
      const { account, server } = chosen
      const login = loginState(account, loggedIn)
      const problem = s?.closed ? 'Disconnected' : open && login === 'out' ? 'Not logged in' : null
      // the dot before the name: green once the server knows you, gray when it does not, gold on the way, red when the line is down
      const conn = loggedIn ? 'up' : s?.closed ? 'down' : open && login === 'out' ? 'off' : 'wait'
      rows.push({ id: 'account', label: `${loggedIn ?? account.username} · ${server.name}`, sub: problem, conn, hint: 'Manage accounts, check your connection, or log out.', fn: () => this.showAccounts() })
      const games = this.games(server, s)
      const links = games?.length ? gameLinkRows(games) : null
      const offered = [...(links?.latest ?? []), ...(links?.trunk ?? []), ...(links?.other ?? [])].filter((g) => !g.disabled)
      if (login === 'out') {
        rows.push({ id: 'login', label: 'Log in', sub: `as ${account.username}`, marker: '\\', main: true, gap: true, hint: `${server.host} asks who you are before it offers a game.`, fn: () => this.showLogin() })
      } else {
        const last = getLast()
        const who = loggedIn ?? account.username
        const versions = offered.map((game) => ({ game, save: this.saveOf(server, game, who, s) }))
        // Keep access to a last-played older version even when the normal list
        // only shows the latest release, but never re-enable a disabled slot.
        const previous = last?.serverId === server.id ? games?.find((g) => g.id === last.gameId && !g.disabled) : null
        if (previous && !offered.includes(previous)) {
          const save = this.saveOf(server, previous, who, s)
          if (save) versions.push({ game: previous, save })
        }
        const primary = versions.find(({ game, save }) => save && last?.serverId === server.id && last.gameId === game.id)
          ?? versions.find(({ save }) => save) ?? versions[0]
        // One row per version; put the last saved adventure (or latest release) first.
        const ordered = primary ? [primary, ...versions.filter((v) => v !== primary)] : []
        // a lobby whose links carry no save at all may be keeping its save info to itself: Play is then not
        // surely a new game, and the row says so rather than promising one
        const silent = !!games?.length && !games.some((g) => g.save)
        for (const { game: g, save } of ordered) {
          rows.push({
            id: 'play:' + g.id, label: `${save ? 'Continue' : 'Play'} ${g.label}`,
            sub: save?.sub ?? (g.save ? `[${g.save}]` : null), marker: '>', main: g === primary?.game,
            hint: save?.hint ?? (silent ? `${g.label} on ${server.host}. A game of yours already waiting there continues instead.` : `A new game of ${g.label} on ${server.host}.`),
            fn: () => this.connectTo(account, { kind: 'play', gameId: g.id }),
          })
        }
        if (!ordered.length) notices.push(h('div', { class: 'hint' }, !open ? 'Connecting…' : lobby?.complete ? 'No games offered by this server.' : 'Loading game versions…'))
      }
      const n = lobby?.entries.size ?? 0
      rows.push({ id: 'watch', label: 'Watch', sub: open ? (lobby?.complete ? `${n} playing` : 'loading…') : 'connecting…', marker: '{', hint: `Look into the pool: who is playing on ${server.host} right now, and watch them.`, fn: () => this.showWatch() })
      // the server's notices (client.html #account_restricted, #stale_processes_message, #force_terminate)
      if (lobby?.accountHold) notices.push(h('div', { class: 'notice' }, 'This account is being held for administrator approval. Until approved, community features and some game modes may be restricted, and games will not be visible to other players.'))
      if (lobby?.staleProcesses) notices.push(h('div', { class: 'notice dialog' }, `There are some stale ${lobby.staleProcesses.game} processes. They'll be stopped in ${lobby.staleProcesses.timeout} seconds. Press a key now if you don't want this to happen!`))
      if (s && lobby?.forceTerminate) {
        const answer = (yes: boolean) => {
          s.send(cm.forceTerminate(yes))
          lobby.forceTerminate = false
          this.shape.delete('home')
          this.showHome()
        }
        const yes = h('button', { type: 'button', class: 'item small', dataset: { focus: 'terminate:yes' }, onclick: () => answer(true) }, h('span', { class: 'marker' }), h('span', { class: 'label' }, 'Yes'))
        const no = h('button', { type: 'button', class: 'item small', dataset: { focus: 'terminate:no' }, onclick: () => answer(false) }, h('span', { class: 'marker' }), h('span', { class: 'label' }, 'No'))
        notices.push(h('div', { class: 'notice dialog' }, `Couldn't stop one of your stale ${lobby.staleProcesses?.game || 'game'} processes gracefully. Force its termination? [yn]`, h('div', { class: 'actions' }, yes, no)))
        extra.push({ id: 'terminate:yes', label: 'Yes', el: yes, row: 100, col: 0, activate: () => answer(true) }, { id: 'terminate:no', label: 'No', el: no, row: 100, col: 1, activate: () => answer(false) })
      }
      if (open && lobby && !lobby.username && lobby.loginFailed) notices.push(h('div', { class: 'error' }, lobby.loginFailed))
      // how the last game ended (client.html #exit_game) stands on a screen of its own, over the front, until
      // closed; a saved game says nothing unless the server had words
      if (s && st?.exit && st.exit.reason) {
        const exit = st.exit
        const why = exitReasonMessage(exit.reason, exit.watched ?? null)
        const words = (exit.message ?? '').replace(/\s+$/, '')
        if (exit.watched || why || words) return this.showExit(s, exit, why, words)
        s.state.exit = null
      }
    } else {
      rows.push({ id: 'account', label: 'Play', marker: '>', main: true, hint: 'Choose a public server, then log in or create an account.', fn: () => this.showServers('add') })
      rows.push({ id: 'watch', label: 'Watch', sub: 'No account needed', marker: '{', hint: 'Pick a server and watch a live game. No login needed.', fn: () => this.showServers('watch') })
    }
    // Only game actions in the main list; identity and information share a quiet footer.
    const accountRow = chosen ? rows.shift() : undefined
    const utilities: Row[] = accountRow ? [accountRow] : []
    utilities.push({ id: 'about', label: 'About & credits', hint: 'About Orbrun, what’s new, and the people behind the game.', fn: () => this.showAbout() })
    const onPad = !!this.hooks.padConnected?.()
    rows.push({ id: 'settings', label: 'Settings', marker: '?', hint: 'Camera, controls, the HUD: kept on this device.' + (onPad ? ' (X)' : ''), fn: () => this.showSettings(() => this.showHome()) })
    const shape = JSON.stringify([[...rows, ...utilities].map((r) => [r.id, r.label, r.sub, r.conn, r.main, !!r.also]), notices.map((n) => n.textContent)])
    if (this._view === 'home' && this.shape.get('home') === shape && !this.error) return
    const redraw = this._view === 'home' && this.shape.has('home')
    const keep = redraw ? this.nav.current()?.id : undefined
    this.setView('home', 'accounts')
    this.shape.set('home', shape)
    const first = rows.find((r) => r.main)?.id ?? rows[0]?.id
    this.list({ cls: 'home-list' + (redraw ? ' still' : ''), title: 'Orbrun', lede: 'An unofficial first-person client for Dungeon Crawl Stone Soup.', splash: this.splash, rows, utilities, notices, extra, focus: keep ?? this.marks.get('home') ?? first })
  }

  /**
   * How the last game ended, as the official lobby's exit dialog (client.html
   * #exit_game): the reason, the game's parting words, and its morgue file or
   * character dump. Close, Escape or B put it away and show the front.
   */
  private showExit(s: Session, exit: NonNullable<GameState['exit']>, why: string | null, words: string) {
    this.setView('exit', 'exit')
    const close = () => {
      s.state.exit = null
      this.shape.delete('home')
      this.showHome()
    }
    const parts: HTMLElement[] = []
    if (why) parts.push(h('p', { class: 'exit-why' }, why))
    if (words) parts.push(h('pre', { class: 'exit-message' }, words))
    const rows: Row[] = [{ id: 'exit:close', label: 'Close', marker: '<', hint: 'Back to the front.', fn: close }]
    if (exit.dump) {
      const text = exit.reason === 'saved' ? 'Character dump' : exit.reason === 'crash' ? 'Crash log' : 'Morgue file'
      const url = morgueUrlFor(s.server, exit.dump)
      let href = exit.dump + '.txt'
      try {
        href = new URL(href, s.server.http).href
      } catch {
        // an address the browser cannot resolve is handed over as it came
      }
      rows.push({
        id: 'exit:dump', label: text, marker: '?', hint: `Read the ${text.toLowerCase()} here.`,
        fn: () => this.showDoc({
          title: text, lede: `${s.server.name} keeps it; it reads here.`, links: [{ label: 'Open in a new tab', href }],
          from: () => this.showExit(s, exit, why, words),
          body: () => (url ? fetchText(url) : Promise.reject(new Error('not a URL the proxy carries'))).then((t) => h('pre', { class: 'doc-text' }, t)),
        }),
      })
    }
    this.list({
      cls: 'exit-list', title: exitTitle(exit.reason, exit.watched ?? null),
      rows,
      below: [h('div', { class: 'exit-report' }, ...parts)],
    })
  }

  /**
   * A document to read on a screen of its own: About, What's new, a morgue
   * file. It scrolls in a region under the head, with up and down (the
   * d-pad, the arrows, the right stick, PageUp and PageDown), so the
   * message line and Back keep their place. A body that arrives later shows
   * "Loading…" until it does; one that fails says so, with the document's
   * link out as the way to it, when it has one.
   */
  private showDoc(opts: { title: string; lede?: string; body: () => HTMLElement | Promise<HTMLElement>; from: () => void; links?: { label: string; href: string }[]; failed?: string }) {
    this.setView('doc', 'doc-list')
    this.docFrom = opts.from
    const rows: Row[] = [{ id: BACK, label: 'Back', marker: '<', hint: 'Back.', fn: () => this.back() }]
    const extra: Focusable[] = []
    const below: HTMLElement[] = []
    const scroller = h('div', { class: 'doc-scroll' })
    let content: HTMLElement | Promise<HTMLElement>
    try {
      content = opts.body()
    } catch (e) {
      content = Promise.reject(e)
    }
    if (content instanceof Promise) {
      scroller.append(h('p', { class: 'doc-wait' }, 'Loading…'))
      content.then(
        (el) => {
          if (this.docScroller !== scroller) return
          replace(scroller, el)
        },
        (e: unknown) => {
          if (this.docScroller !== scroller) return
          const why = e instanceof Error ? e.message : String(e)
          this.showDoc({ ...opts, body: () => h('p', { class: 'doc-failed' }, `Could not read it here (${why}).`), failed: why })
        },
      )
    } else scroller.append(content)
    below.push(scroller)
    // the way out, only once reading here has failed: what reads here needs no tab
    if (opts.links?.length && opts.failed) {
      const links = h('nav', { class: 'about-links', 'aria-label': opts.title })
      opts.links.forEach(({ label, href }, i) => {
        const el = h('a', { class: 'item', href, target: '_blank', rel: 'noopener noreferrer', dataset: { focus: 'link:' + i } }, h('span', { class: 'marker', 'aria-hidden': 'true' }), h('span', { class: 'label' }, label), h('span', { class: 'sub', 'aria-hidden': 'true' }, '↗'))
        links.append(el)
        extra.push({ id: 'link:' + i, label, el, row: i + 1, activate: () => el.click(), onFocus: () => this.say('Opens in a new tab. Your game stays here.') })
      })
      below.push(links)
    }
    this.list({ cls: 'doc-list', title: opts.title, lede: opts.lede ?? (this.hooks.padConnected?.() ? 'Up and down scroll it; so does the right stick.' : 'Up and down scroll it.'), rows, below, extra, focus: BACK })
    // the list settles the cursor on Back, the one row: the document, not the cursor, is what up and down move
    this.docScroller = scroller
  }

  /**
   * About and what's new, read here, one step away from the title screen;
   * the source and the game's own site are the two exits, in a new tab.
   */
  private showAbout() {
    this.setView('about', 'about')
    const rows: Row[] = [
      { id: BACK, label: 'Back', marker: '<', hint: 'Back to the front.', fn: () => this.back() },
      { id: 'about:doc', label: 'About Orbrun', marker: '?', hint: 'What Orbrun is, how it plays, and what it does with your account.', fn: () => this.showDoc({ title: 'About Orbrun', body: () => renderMarkdown(aboutText, { dropTitle: true }), from: () => this.showAbout() }) },
      { id: 'about:new', label: 'What’s new', marker: '?', hint: 'What changed, newest first.', fn: () => this.showDoc({ title: 'What’s new', body: () => renderMarkdown(changelogText, { dropTitle: true }), from: () => this.showAbout() }) },
    ]
    const links = h('nav', { class: 'about-links', 'aria-label': 'Links out' })
    const extra: Focusable[] = []
    const destinations = [
      ['Source on GitHub', 'https://github.com/Caeous/orbrun'],
      ['Dungeon Crawl Stone Soup', 'https://crawl.develz.org/'],
    ]
    destinations.forEach(([label, href], i) => {
      const el = h('a', { class: 'item', href, target: '_blank', rel: 'noopener noreferrer', dataset: { focus: 'link:' + i } }, h('span', { class: 'marker', 'aria-hidden': 'true' }), h('span', { class: 'label' }, label), h('span', { class: 'sub', 'aria-hidden': 'true' }, '↗'))
      links.append(el)
      extra.push({ id: 'link:' + i, label, el, row: rows.length + i, activate: () => el.click(), onFocus: () => this.say('Opens in a new tab. Your game stays here.') })
    })
    this.list({
      cls: 'about-list', title: 'About & credits',
      rows,
      below: [h('p', { class: 'about-copy' }, 'Orbrun is an unofficial client for Dungeon Crawl Stone Soup on the public servers. Not affiliated with the DCSS team.'), links],
      extra,
    })
  }

  // ------------------------------------------------------------------ watch

  /**
   * Watch: the roster of games running (client.html #player_list), a table
   * in the console face, by player name. A row is a game to spectate (A);
   * right opens its details on a narrow screen. Arrivals after the table is
   * up are held back and counted on the line under it, and come in on Y
   * or on coming back to the screen: rows never move under the cursor.
   * Someone who stops playing leaves at once.
   */
  showWatch() {
    const chosen = this.watchOn ? null : this.chosen()
    const server = this.watchOn ?? chosen?.server ?? null
    if (!server) return this.showServers('watch')
    const username = chosen?.account.username ?? null
    const s = this.sessionOn(server, username) ?? this.ensureSession(server, username)
    const open = !!s.conn.open
    const lobby = s.state.lobby
    const all = Array.from(lobby.entries.values()).sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: 'base' }) || a.id - b.id).slice(0, 200)
    const first = this._view !== 'watch' || !this.rosterTable
    if (first) {
      // the address bar says `#lobby`, the official client's name for this roster, so Back out of a spectate lands here
      this.hooks.leave('lobby')
      this.rosterSeen = new Set(all.map((e) => e.id))
      this.rosterRows.clear()
      this.detailsOpen.clear()
    }
    // whoever is gone is gone; whoever arrived waits, once the roster has loaded and has rows under the cursor to keep still
    for (const id of [...this.rosterSeen]) if (!all.some((e) => e.id === id)) this.rosterSeen.delete(id)
    if (!lobby.complete || this.rosterSeen.size === 0) for (const e of all) this.rosterSeen.add(e.id)
    const shown = all.filter((e) => this.rosterSeen.has(e.id))
    const held = all.length - shown.length
    const lede = `${server.host}${username ? ' · ' + username : ''} · ${!open ? 'connecting…' : lobby.complete ? `${all.length} playing` : 'loading…'}`
    if (first) {
      this.setView('watch', 'watch')
      const table = h('table', { class: 'roster' }, h('thead', null, h('tr', null, ...ROSTER_COLS.map((c) => h('th', { class: 'col-' + c.cls + (c.extra ? ' extra' : '') }, c.head)))), h('tbody'))
      this.rosterTable = table
      const rows: Row[] = [
        { id: BACK, label: 'Back', marker: '<', hint: 'Back to the front.', fn: () => this.back() },
      ]
      // the table scrolls in a region of its own, so the head above and the message line and legend under it stay put
      const scroller = h('div', { class: 'roster-scroll' }, table)
      const held_ = h('button', { type: 'button', class: 'held', tabindex: -1, hidden: true, onclick: () => this.takeArrivals() })
      const empty = h('div', { class: 'hint empty' })
      this.list({ cls: 'watch-list', title: `Watch · ${server.name}`, lede, rows, below: [scroller, held_, empty], extra: [], focus: this.marks.get('watch') })
    } else {
      const ledeEl = this.root.querySelector('.head .lede')
      if (ledeEl && ledeEl.textContent !== lede) ledeEl.textContent = lede
    }
    const table = this.rosterTable!
    const body = table.tBodies[0]
    // rows: reused where they read the same, in order
    const keep = new Set<number>()
    let before: Element | null = body.firstElementChild
    for (const e of shown) {
      keep.add(e.id)
      const sig = ROSTER_COLS.map((c) => rosterCell(c.key, e[c.key])).join('\x1f')
      let r = this.rosterRows.get(e.id)
      if (!r || r.sig !== sig) {
        const [tr, dt] = this.rosterRow(e, s)
        if (r) {
          r.tr.replaceWith(tr)
          r.dt.replaceWith(dt)
        }
        r = { tr, dt, sig }
        this.rosterRows.set(e.id, r)
      }
      const open = this.detailsOpen.has(e.id)
      r.tr.hidden = false
      r.dt.hidden = !open
      r.tr.classList.toggle('open', open)
      if (r.tr.parentNode !== body || r.tr !== before) body.insertBefore(r.tr, before)
      if (r.dt !== r.tr.nextElementSibling) body.insertBefore(r.dt, r.tr.nextElementSibling)
      before = r.dt.nextElementSibling
    }
    for (const [id, r] of this.rosterRows) {
      if (keep.has(id)) continue
      r.tr.remove()
      r.dt.remove()
      this.rosterRows.delete(id)
      this.detailsOpen.delete(id)
    }
    const heldEl = this.root.querySelector<HTMLElement>('.held')
    if (heldEl) {
      heldEl.textContent = held ? `${held} new · press Y to bring them in` : ''
      heldEl.hidden = !held
    }
    const emptyEl = this.root.querySelector('.hint.empty')
    if (emptyEl) emptyEl.textContent = !open ? `Connecting to ${server.host}…` : !lobby.complete ? 'Loading games…' : !all.length ? 'Nobody is playing right now.' : ''
    // the cursor: the rows past Back are the players
    const items: Focusable[] = [...this.navItems.filter((f) => !f.id?.startsWith('watch:'))]
    shown.forEach((e, i) => {
      const r = this.rosterRows.get(e.id)!
      items.push({ id: 'watch:' + e.id, label: e.username, el: r.tr, row: 10 + i, activate: () => this.hooks.watch(s, e.username), onFocus: () => this.say(rosterHere(e)) })
    })
    // The Back row is already prepared; only roster rows are new.
    this.prepareFocus(items.filter((f) => f.id?.startsWith('watch:')))
    this.navItems = items
    const cur = this.nav.current()
    const want = first ? this.marks.get('watch') : cur?.id
    let at = want ? items.findIndex((f) => f.id === want) : -1
    if (at < 0) at = items.findIndex((f) => f.id?.startsWith('watch:'))
    if (at < 0) at = items.findIndex((f) => f.id !== BACK)
    this.nav.set(items, 'watch', { wrap: true }, at < 0 ? 0 : at, first)
    if (first) this.nav.current()?.onFocus?.()
  }

  /**
   * A roster entry's rows: the game, and under it its details: the extra
   * columns, each a span the width shows only while its column is hidden
   * (styles.css), in the order the columns go as the screen narrows.
   */
  private rosterRow(e: LobbyEntry, s: Session): [HTMLTableRowElement, HTMLTableRowElement] {
    const tr = h('tr', { class: 'game' + (e.idle_time ? ' idle' : ''), dataset: { focus: 'watch:' + e.id }, onclick: () => this.hooks.watch(s, e.username) }, ...ROSTER_COLS.map((c) => h('td', { class: 'col-' + c.cls + (c.extra ? ' extra' : '') }, rosterCell(c.key, e[c.key]))))
    const details = DETAILS_ORDER.map((cls) => ROSTER_COLS.find((c) => c.cls === cls)!)
      .map((c) => [c, rosterCell(c.key, e[c.key])] as const)
      .filter(([, v]) => v)
      .map(([c, v]) => h('span', { class: 'd col-' + c.cls }, `${c.head} ${v}`))
    const dt = h('tr', { class: 'details', hidden: true, onclick: () => this.hooks.watch(s, e.username) }, h('td', { class: 'details', colspan: ROSTER_COLS.filter((c) => !c.extra).length }, ...details))
    return [tr, dt]
  }

  /** Right on a roster row opens its details (the extra columns as a line under it on a narrow screen); left closes them. */
  private details(id: number, open: boolean) {
    if (open) this.detailsOpen.add(id)
    else this.detailsOpen.delete(id)
    const r = this.rosterRows.get(id)
    if (!r) return
    r.tr.classList.toggle('open', open)
    r.dt.hidden = !open || r.tr.hidden
    if (open && !r.dt.hidden) r.dt.scrollIntoView({ block: 'nearest' })
  }

  /** Y on the roster (or the line that counts them): the arrivals held back come into the table. */
  private takeArrivals() {
    if (this._view !== 'watch' || !this.session) return
    for (const e of this.session.state.lobby.entries.values()) this.rosterSeen.add(e.id)
    this.showWatch()
  }

  // ------------------------------------------------------------------ settings

  /**
   * Orbrun's settings: the one panel the pause menu opens over the game
   * (settings-panel.ts), in its groups, under Back; Gamepad, the sheet of
   * what every button does, is a row of its own. Left and right turn a
   * setting (A turns it on), the message line says what it does.
   */
  showSettings(from?: () => void) {
    if (this._view === 'settings') return
    const back = from ?? (this._view === 'watch' ? () => this.showWatch() : this._view === 'controls' ? this.settingsFrom ?? (() => this.showHome()) : () => this.showHome())
    this.settingsFrom = back
    this.setView('settings', 'settings')
    // a change shows on the room behind the panel at once: the camera rows are the room's camera too
    const panel = settingsPanel({ close: false, onchange: () => this.roomView.applySettings() })
    // Only the front-end instance gets the title-screen treatment; the pause
    // menu keeps its compact in-game rows and hotkeys.
    for (const el of panel.rows) {
      el.classList.add('item', 'front-setting')
      el.prepend(h('span', { class: 'marker', 'aria-hidden': 'true' }))
      // Arrow clicks stop bubbling, so share their row's cursor in capture.
      el.addEventListener('click', () => el.focus({ preventScroll: true }), { capture: true })
    }
    const rows: Row[] = [
      { id: BACK, label: 'Back', marker: '<', hint: 'Back to where you were.', fn: () => this.back() },
      { id: 'controls', label: 'Gamepad', sub: 'what every button does', marker: '?', hint: 'The pad’s buttons on each layer.', fn: () => this.showControls() },
    ]
    const extra: Focusable[] = panel.rows.map((el, i) => ({
      id: el.dataset.focus ?? 'setting:' + i,
      label: (el.querySelector('.label') as HTMLElement | null)?.textContent ?? '',
      el,
      row: 10 + i,
      activate: () => el.click(),
      onFocus: () => this.say(el.dataset.hint),
    }))
    // like the roster, the settings scroll in a region of their own under the head and the rows, so the message line keeps its place
    const scroller = h('div', { class: 'settings-scroll' }, panel.el)
    this.list({ cls: 'settings-list', title: 'Settings', lede: 'Left and right turn a setting. They are kept on this device.', rows, below: [scroller], extra })
  }

  /** The gamepad sheet (controls-sheet.ts), as the pause menu shows it; a row of the settings. */
  private showControls() {
    if (this._view === 'controls') return
    this.setView('controls', 'controls')
    const sheet = h('div', { class: 'bindings-sheet ours' }, controlsSheet(this.hooks.padKind?.() ?? 'generic'))
    const rows: Row[] = [{ id: BACK, label: 'Back', marker: '<', hint: 'Back to the settings.', fn: () => this.back() }]
    this.list({ cls: 'controls-list', title: 'Gamepad', lede: 'What every button does, on each layer.', rows, below: [sheet] })
  }

  // ------------------------------------------------------------------ accounts, servers, login

  /**
   * The accounts on this device: one row each, the chosen one lit, with its
   * server and where its login stands; Log out beside each. Add an account
   * leads to the server list.
   */
  showAccounts() {
    this.adding = null
    this.watchOn = null
    this.setView('accounts', 'accounts-list')
    const accounts = listAccounts()
    const chosen = getChosenAccount()
    const rows: Row[] = [{ id: BACK, label: 'Back', marker: '<', hint: 'Back to the front.', fn: () => this.back() }]
    for (const a of accounts) {
      const server = findServer(a.serverId)
      if (!server) continue
      const s = this.hooks.session?.(server, a.username)
      const state = loginWord(s, sameAccount(a, chosen))
      rows.push({
        id: 'account:' + a.serverId + '/' + a.username,
        label: a.username,
        sub: [server.name, server.host, state].filter(Boolean).join(' · '),
        marker: '\\',
        main: sameAccount(a, chosen),
        hint: `Play as ${a.username} on ${server.host}.`,
        fn: () => {
          setChosenAccount(a)
          this.connectTo(a)
        },
        also: [{ id: 'logout:' + a.serverId + '/' + a.username, label: '(log out)', title: `Forget ${a.username}'s login on this device.`, fn: () => this.logout(a) }],
      })
    }
    rows.push({ id: 'add', label: 'Add an account', sub: accounts.length ? 'on any server' : 'to play online', marker: '+', gap: true, main: !accounts.length, hint: 'Choose a server, then log in or register.', fn: () => this.showServers('add') })
    this.list({ cls: 'accounts-list', title: 'Accounts', lede: 'The accounts on this device.', rows })
  }

  /** the lobby page's Log out (client.html #logout_link): it forgets the account on this device */
  private logout(account: Account) {
    // the account goes first, so nothing (the home screen's warm connection) opens it again on the way out
    removeAccount(account)
    this.hooks.logout(account)
    this.session = null
    this.showHome()
  }

  /**
   * The server list: one row per server with its region and host (and the
   * accounts kept there); picking one leads to its login when adding an
   * account, or straight to its roster when watching without one. Add a
   * server takes a host or URL for one not on the list.
   */
  showServers(mode: 'add' | 'watch') {
    // the way back is set when the list is entered; a redraw, or a step back from the login on it, keeps it
    if (this._view === 'home' || this._view === 'accounts') this.serversFrom = this._view
    this.adding = null
    this.watchOn = mode === 'watch' ? this.watchOn ?? listServers()[0] ?? null : null
    if (mode === 'watch') this.watchOn = null
    this.setView('servers', 'servers-list')
    const servers = listServers()
    const accounts = listAccounts()
    const rows: Row[] = [{ id: BACK, label: 'Back', marker: '<', hint: 'Back.', fn: () => this.back() }]
    for (const sv of servers) {
      const mine = accounts.filter((a) => a.serverId === sv.id).map((a) => a.username)
      rows.push({
        id: 'server:' + sv.id,
        label: sv.name,
        sub: [sv.region, sv.host].filter(Boolean).join(' · ') + (mine.length ? ` · ${mine.join(', ')}` : ''),
        marker: '\\',
        hint: mode === 'watch' ? `Watch who is playing on ${sv.host}.` : `An account on ${sv.host}.` + (mine.length ? ` ${mine.join(' and ')} ${mine.length === 1 ? 'is' : 'are'} already here.` : ''),
        fn: () => {
          if (mode === 'watch') {
            this.watchOn = sv
            this.showWatch()
          } else {
            this.adding = sv
            this.showLogin()
          }
        },
      })
    }
    const input = h('input', { type: 'text', placeholder: 'host or URL', autocomplete: 'off', spellcheck: 'false', size: 24 })
    const form = h(
      'form',
      {
        class: 'prompt',
        onsubmit: (ev: Event) => {
          ev.preventDefault()
          if (!input.value.trim()) return
          try {
            addServer(input.value.trim())
            this.showServers(mode)
          } catch (e) {
            this.error = 'Invalid server: ' + String(e)
            this.showServers(mode)
          }
        },
      },
    )
    rows.push({ id: 'add-server', label: 'Add a server', input, gap: true, hint: 'Enter a host or URL; Enter adds it to the list.' })
    this.list({ cls: 'servers-list', title: mode === 'watch' ? 'Watch' : 'Add an account', lede: 'Choose a server.', rows, wrap: (list) => (form.append(list), form), focus: this.error ? 'add-server' : undefined })
  }

  /**
   * Open a session for `account` and show the home screen, its server's
   * lobby. With an `intent` (Continue, Play, a `#play-`/`#watch-` address
   * on reload) the game or spectate starts on its own once the login is
   * through, and the screen stays up meanwhile.
   */
  connectTo(account: Account, intent?: Intent) {
    const server = findServer(account.serverId)
    if (!server) return this.showHome()
    const session = this.hooks.connect(server, account.username, intent)
    const last = getLast()
    if (!last || last.serverId !== server.id) setLast({ serverId: server.id, username: account.username })
    // Play or Continue pressed on the home screen of the session already followed: the game comes when the server
    // answers, and until then the screen stands where it is (redrawn in place if its lines changed) rather than
    // being torn down and slid in again as a new one
    if (session === this.session && this._view === 'home') return this.showHome()
    this.attach(session)
  }

  /** Follow an already open session and show the home screen: after a death, a save, or a reload. */
  attach(session: Session) {
    this.follow(session)
    this.hooks.leave('home')
    this.shape.delete('home')
    this.showHome()
  }

  /** Follow an already open session and show the Watch screen: after a spectate ended, or Back to `#lobby`. */
  watchFor(session: Session) {
    this.follow(session)
    this.showWatch()
  }

  /** A session on `server` for `username` to log in to, register on, or watch from: the warm one, or a fresh one. */
  private ensureSession(server: ServerInfo, username: string | null): Session {
    const s = this.hooks.session?.(server, username) ?? this.session
    if (s && !s.closed && s.server.id === server.id && (s.username ?? null) === username) {
      if (s !== this.session) this.follow(s)
      return s
    }
    const n = this.hooks.connect(server, username)
    this.follow(n)
    return n
  }

  /** Follow a session's events without changing the screen. */
  private follow(session: Session) {
    this.unsub?.()
    this.session = session
    this.unsub = session.on((e) => {
      // every message redraws what changed, once a frame however many came
      if ((e.type === 'state' || e.type === 'open') && (this._view === 'home' || this._view === 'watch')) this.schedule()
      if (e.type === 'state' && e.msg.msg === 'login_success' && (this._view === 'login' || this._view === 'register')) this.loggedIn(session)
      if (e.type === 'state' && e.msg.msg === 'login_fail' && this._view === 'login') this.showLogin()
      if (e.type === 'state' && e.msg.msg === 'register_fail' && this._view === 'register') this.showRegister()
      if (e.type === 'state' && e.msg.msg === 'reload_url' && !this.reloaded) {
        this.reloaded = true
        window.location.reload()
      }
      if (e.type === 'closed') {
        // a drop the app is already retrying says so; one it is not (the server closed it) says why
        this.error = this.hooks.retrying?.() ? 'Connection lost. Reconnecting…' : 'Connection closed: ' + e.reason
        if (this._view === 'login' || this._view === 'register') this.goHome()
        else {
          this.shape.delete(this._view)
          this.refresh()
        }
      }
    })
  }

  /** The home screen, with the address bar saying so. */
  private goHome() {
    this.hooks.leave('home')
    this.shape.delete('home')
    this.showHome()
  }

  /** Through Log in or Register (client.js logged_in): the account is kept, chosen, and its screen comes up. */
  private loggedIn(session: Session) {
    const username = session.state.lobby.username
    if (!username) return
    const account: Account = { serverId: session.server.id, username }
    addAccount(account)
    setChosenAccount(account)
    setLast({ serverId: account.serverId, username })
    this.adding = null
    this.loginName = ''
    this.attach(session)
  }

  /** Out of Log in without logging in: back to the server list while adding an account, else home. */
  private cancelAuth() {
    this.loginName = ''
    if (this.adding) this.showServers('add')
    else this.goHome()
  }

  /** client.js: a key while the stale-processes notice shows sends `stop_stale_process_purge`. */
  private stopStalePurge() {
    const s = this.session
    if (!s) return
    s.send(cm.stopStaleProcessPurge())
    s.state.lobby.staleProcesses = null
    this.shape.delete('home')
    if (this._view === 'home') this.showHome()
  }

  /**
   * The lobby page's login form (client.html #login_form): adding an
   * account, step two, on the server picked; or the chosen account's, when
   * its token was refused (a Play then follows the login, main.ts). The
   * register form is a row off it while an account is being added.
   */
  showLogin() {
    const chosen = this.adding ? null : this.chosen()
    const server = this.adding ?? chosen?.server ?? null
    if (!server) return this.showServers('add')
    const s = this.ensureSession(server, chosen?.account.username ?? null)
    if (!this.loginName && chosen) this.loginName = chosen.account.username
    this.setView('login', 'login')
    const user = h('input', { type: 'text', name: 'username', autocomplete: 'username', placeholder: 'name', size: 20, value: this.loginName })
    const pass = h('input', { type: 'password', name: 'password', autocomplete: 'current-password', placeholder: 'password', size: 20 })
    let form: HTMLFormElement
    const typing = this.hooks.padConnected?.() ? ' Press X to type.' : ''
    const rows: Row[] = [
      { id: BACK, label: 'Back', marker: '<', hint: 'Back without logging in.', fn: () => this.back() },
      { id: 'username', label: 'Name', input: user, hint: `Your name on ${s.server.host}.` + typing },
      { id: 'password', label: 'Password', input: pass, hint: 'It is sent to the server once; only a login token is kept on this device.' + typing },
      { id: 'login', label: 'Log in', sub: s.server.name, marker: '\\', main: true, hint: `Log in to ${s.server.host}.`, fn: () => form.requestSubmit() },
    ]
    if (this.adding) rows.push({ id: 'register', label: 'Register', sub: 'a new account', marker: '+', gap: true, hint: 'A new account on this server.', fn: () => this.showRegister() })
    if (s.state.lobby.loginFailed) this.error = s.state.lobby.loginFailed
    this.list({
      cls: 'login-form',
      title: 'Log in',
      lede: s.server.name,
      rows,
      focus: this.loginName ? 'password' : 'username',
      wrap: (list) => {
        form = h(
          'form',
          {
            class: 'form',
            onsubmit: (ev: Event) => {
              ev.preventDefault()
              this.loginName = user.value
              s.send(cm.login(user.value, pass.value))
              setLast({ serverId: s.server.id, username: user.value })
            },
          },
          list,
        )
        return form
      },
    })
  }

  /** The lobby page's register dialog (client.html #reg_link), off the login of an account being added. */
  showRegister() {
    const server = this.adding ?? this.chosen()?.server ?? null
    if (!server) return this.showServers('add')
    const s = this.ensureSession(server, this.adding ? null : (this.chosen()?.account.username ?? null))
    this.setView('register', 'register-form')
    const user = h('input', { type: 'text', placeholder: 'name', size: 20 })
    const pass = h('input', { type: 'password', placeholder: 'password', size: 20 })
    const pass2 = h('input', { type: 'password', placeholder: 'repeat password', size: 20 })
    const email = h('input', { type: 'email', placeholder: 'email (optional)', size: 20 })
    let form: HTMLFormElement
    const typing = this.hooks.padConnected?.() ? ' Press X to type.' : ''
    const rows: Row[] = [
      { id: BACK, label: 'Back', marker: '<', hint: 'Back to the login.', fn: () => this.back() },
      { id: 'username', label: 'Name', input: user, hint: `What your name will be on ${s.server.host}.` + typing },
      { id: 'password', label: 'Password', input: pass, hint: 'Choose a password. It is sent to the server once; only a login token is kept on this device.' + typing },
      { id: 'password2', label: 'Repeat', input: pass2, hint: 'Enter it again.' + typing },
      { id: 'email', label: 'Email', input: email, hint: 'Optional; the server uses it to reset a lost password.' + typing },
      { id: 'register', label: 'Register', sub: s.server.name, marker: '\\', main: true, hint: `Register on ${s.server.host}.`, fn: () => form.requestSubmit() },
    ]
    if (s.state.lobby.registerFailed) this.error = s.state.lobby.registerFailed
    this.list({
      cls: 'register-form',
      title: 'Register',
      lede: `A new account on ${s.server.name}`,
      rows,
      focus: 'username',
      wrap: (list) => {
        form = h(
          'form',
          {
            class: 'form',
            onsubmit: (ev: Event) => {
              ev.preventDefault()
              if (pass.value !== pass2.value) {
                this.error = 'Passwords do not match.'
                this.showRegister()
                return
              }
              s.send(cm.register(user.value, pass.value, email.value))
              setLast({ serverId: s.server.id, username: user.value })
            },
          },
          list,
        )
        return form
      },
    })
  }
}

// ---------------------------------------------------------------- the roster

/**
 * The roster's columns (client.html #player_list, in its order). The four
 * that always stand say who and where; the rest are `extra`: shown on a wide
 * screen, and on a narrow one as the details line a row opens (right).
 */
interface RosterCol {
  key: keyof LobbyEntry & string
  head: string
  cls: string
  extra?: boolean
}
const ROSTER_COLS: RosterCol[] = [
  { key: 'username', head: 'Player', cls: 'user' },
  { key: 'char', head: 'Char', cls: 'char' },
  { key: 'xl', head: 'XL', cls: 'xl' },
  { key: 'place', head: 'Place', cls: 'place' },
  { key: 'spectator_count', head: 'Watching', cls: 'specs', extra: true },
  { key: 'game_id', head: 'Game', cls: 'game', extra: true },
  { key: 'god', head: 'God', cls: 'god', extra: true },
  { key: 'turn', head: 'Turn', cls: 'turn', extra: true },
  { key: 'dur', head: 'Time', cls: 'time', extra: true },
  { key: 'idle_time', head: 'Idle', cls: 'idle', extra: true },
  { key: 'milestone', head: 'Milestone', cls: 'milestone', extra: true },
]

/** The extra columns in the order the width folds them into the details row: the first three go at a middling width, the rest on a narrow one. */
const DETAILS_ORDER = ['specs', 'time', 'idle', 'game', 'god', 'turn', 'milestone']

/** One column of a roster row as it reads: the value formatted as client.js formats it, nothing for none. */
function rosterCell(key: string, v: unknown): string {
  if (v === undefined || v === null || v === '') return ''
  if (key === 'dur') return formatDuration(v as LobbyEntry['dur'])
  if (key === 'idle_time') return formatIdle(v as LobbyEntry['idle_time'])
  if (key === 'spectator_count') return v ? String(v) : ''
  return String(v)
}

/** The whole row, spoken, every column whether or not the width shows it. */
function rosterHere(e: LobbyEntry): string {
  const who = [e.char, e.xl ? `XL${e.xl}` : '', e.place].filter(Boolean).join(', ')
  const facts = [
    e.god ? `a worshipper of ${e.god}` : '',
    e.turn ? `turn ${e.turn}` : '',
    e.dur ? `${formatDuration(e.dur)} played` : '',
    e.idle_time ? `idle ${formatIdle(e.idle_time)}` : '',
    e.spectator_count ? `${e.spectator_count} watching` : '',
  ].filter(Boolean)
  return `You see here ${e.username}${who ? ` (${who})` : ''}${facts.length ? ', ' + facts.join(', ') : ''}${e.milestone ? ': ' + e.milestone : '.'}`
}

/**
 * Where a gateway's login stands, for an account's line. Every word is set in
 * the room of the longest, so the line is the same length from the first
 * frame to the last. The chosen account reads "connecting…" before its socket
 * is up, because it is warming one (main.ts warm); an account nobody has
 * opened says nothing at all.
 */
const LOGIN_WORDS = ['connecting…', 'logging in…', 'logged in', 'not logged in'] as const
const LOGIN_WIDTH = Math.max(...LOGIN_WORDS.map((w) => w.length))
/**
 * client.js exit_reason_message: the line above a game's parting words when
 * the way it ended calls for one. A normal end (death, win, quit, save) says
 * nothing of its own; a watched game's end always says whose it was.
 */
export function exitReasonMessage(reason: string, watched: string | null): string | null {
  const tail = reason !== 'unknown' ? ` (${reason})` : ''
  if (watched) {
    const whose = watched + "'" + (watched.endsWith('s') ? '' : 's')
    switch (reason) {
      case 'quit': case 'won': case 'bailed out': case 'dead': return null
      case 'cancel': return `${watched} quit before creating a character.`
      case 'saved': return `${watched} stopped playing (saved).`
      case 'crash': return `${whose} game crashed.`
      case 'error': return `${whose} game was terminated due to an error.`
      case 'disconnect': return `${watched} has been disconnected.`
      default: return `${whose} game ended unexpectedly.${tail}`
    }
  }
  switch (reason) {
    case 'quit': case 'won': case 'bailed out': case 'dead': case 'saved': case 'cancel': return null
    case 'crash': return 'Unfortunately your game crashed.'
    case 'error': return 'Unfortunately your game terminated due to an error.'
    case 'disconnect': return 'You have been disconnected.'
    default: return `Unfortunately your game ended unexpectedly.${tail}`
  }
}

/** The exit screen's name: whose game, and how it went. */
function exitTitle(reason: string, watched: string | null): string {
  const whose = watched ? `${watched}’s game` : 'Your game'
  switch (reason) {
    case 'dead': return watched ? `${watched} died` : 'You died'
    case 'won': return watched ? `${watched} won` : 'You won'
    case 'quit': return `${whose} was quit`
    case 'bailed out': return `${whose} was abandoned`
    case 'saved': return `${whose} was saved`
    case 'cancel': return 'No character made'
    case 'crash': return `${whose} crashed`
    case 'error': return `${whose} stopped with an error`
    case 'disconnect': return watched ? `${watched} was disconnected` : 'Disconnected'
    default: return `${whose} ended`
  }
}

export function loginWord(s: Session | null | undefined, chosen: boolean): string {
  const word = !s || s.closed ? (chosen ? 'connecting…' : '') : !s.conn.open ? 'connecting…' : s.state.lobby.username ? 'logged in' : s.state.lobby.loginFailed ? 'not logged in' : 'logging in…'
  return word ? word.padEnd(LOGIN_WIDTH) : ''
}

/** client.js: idle seconds as "42s", "7m" or "2684h"; nothing when not idle. */
function formatIdle(seconds: LobbyEntry['idle_time']): string {
  if (!seconds || seconds <= 0) return ''
  if (seconds < 120) return `${Math.floor(seconds)}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  return `${Math.floor(seconds / 3600)}h`
}

/** client.js format_duration: play time in seconds as "27s", "18m" or "2h 8m". */
function formatDuration(dur: LobbyEntry['dur']): string {
  const seconds = Number(dur)
  if (!Number.isFinite(seconds) || seconds < 0) return dur ? String(dur) : ''
  if (seconds < 60) return `${Math.floor(seconds)}s`
  const hh = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return hh ? `${hh}h ${m}m` : `${m}m`
}

