/**
 * crawl's screens as console crawl draws them: what is up over the game
 * (a menu, a popup, a CRT screen, a dialog, a line being typed) read straight
 * from the game's state and laid out as text, with no page between. A menu is
 * its title, its rows (`a - a +0 dagger`) and its more line; a description is
 * its title, its text and its keys; the new-game choices are crawl's grid of
 * them; a CRT screen is crawl's own lines. Each is one box (`Box`): a head
 * and a foot that stay, a body between that scrolls.
 *
 * The keys go to crawl, as they do in console crawl, but for what the
 * official client keeps for itself and so the server never moves: a menu's
 * cursor and its pages (menu-nav.ts, menu.js), a popup's scroll
 * (`scrollKeyIntent`, ui-layouts.js), the new-game cursor (`outer_menu_focus`),
 * and the line typed at a prompt (text-entry.ts, textinput.js).
 */
import { cm, type ClientMessage, type GameState, type MenuState, type Popup, type TextInputState } from '@orbrun/webtiles'
import type { KeyLike } from '../../../apps/orbrun/src/keys'
import { lineDownTarget, lineUpTarget, menuClientHover, menuKeyIntent, nextHoverableItem, scrollKeyIntent, snapHoverTarget, type ScrollKey, type Visible } from '../../../apps/orbrun/src/menu-nav'
import { typedInLog } from '../../../apps/orbrun/src/bindings'
import { EntryHistory, entryKey, submitMessages } from '../../../apps/orbrun/src/text-entry'
import { PALETTE, formatted, htmlLines, lineText, lit, tinted, wrap, wrapAll, type Line } from './text'

/** A screen as a box of lines: the head and foot stand, the body scrolls from `scroll`, `lit` its lit lines. */
export interface Box {
  head: Line[]
  body: Line[]
  foot: Line[]
  /** the body's first line shown */
  scroll: number
  lit: number[]
  /** in the middle of the screen, as crawl centres it (`ui-centred`) and a prompt stands; else hung from the top */
  centred: boolean
  /** as wide as it can be (a CRT screen is crawl's whole console), rather than as its widest line */
  wide?: boolean
}

/** A box as a screen builds it, before its page is chosen: whose scroll it keeps, what must stay in view, and its more line by its place. */
interface Draft extends Omit<Box, 'scroll'> {
  /** the state's own object for the screen, which its scroll is kept by */
  of?: object
  /** the body lines from..to (exclusive) to keep in the page: the cursor's row */
  keep?: [number, number]
  /** the foot, given where in the body the page is (`top`, `bot`, ` 37%`: menu.js update_more) */
  more?: (at: string) => Line[]
}

/** What is up over the game, the top first: what the keys go to. */
type Top =
  | { kind: 'dialog'; html: string }
  | { kind: 'popup'; p: Popup }
  | { kind: 'menu'; menu: MenuState }
  | { kind: 'crt' }

const CYAN = PALETTE[3]
const GREY = PALETTE[8]
const WHITE = PALETTE[15]

/** A cell of a new-game grid: a button (its hotkey, its grid's id, its description), or a heading. */
interface NewgameCell {
  row: number
  col: number
  label: string
  hotkey?: number
  menuId?: string
  description?: string
}
type Button = NewgameCell & { hotkey: number; menuId: string }

/** Where a menu's rows are in its body as last laid out: each item's first line, and the lines a page shows. */
interface MenuLayout {
  menu: MenuState
  starts: number[]
}

export class Screens {
  /** each screen's scroll, kept while it is up (a menu, a popup): by the object the state keeps for it */
  private scrolls = new WeakMap<object, number>()
  private menuAt: MenuLayout | null = null
  /** how many body lines the box showed last, for the paging keys */
  private room = 10
  private bodyLines = 0
  /** the new-game cursor: the hotkey of the button it is on, by popup */
  private focus = new WeakMap<object, number>()
  /** a line crawl reads itself (`msgwin-get-line`), as typed */
  private echo = new WeakMap<object, string>()
  /** a menu's title prompt (the filter, Ctrl-F), as typed */
  private filter = new WeakMap<object, string>()
  private histories = new WeakMap<object, EntryHistory>()
  /** the prompts typed at since they came up: a prefill to select (`select_prefill`) is replaced by the first key, not added to */
  private edited = new WeakSet<object>()

  /** The screen on top, as a box `width` wide and up to `height` lines inside its border; null with none up. */
  box(st: GameState, width: number, height: number): Box | null {
    const ti = st.textInput
    // a line crawl reads, but where it is typed in the log, as the browser has it (bindings.ts typedInLog), or in the
    // seed popup's own field
    const top = this.top(st)
    let box: Draft
    if (ti && ti.type !== 'seed-selection' && !typedInLog(ti)) box = this.entryBox(st, ti, width)
    else if (!top) return null
    else if (top.kind === 'dialog') box = { head: [], body: wrapAll(htmlLines(top.html), width), foot: [], lit: [], centred: true }
    else if (top.kind === 'popup') box = this.popupBox(st, top.p, width)
    else if (top.kind === 'menu') box = top.menu.type === 'crt' ? crtBox(st) : this.menuBox(top.menu, width)
    else box = crtBox(st)
    // the page: where it was left, moved only as far as keeps the cursor's row in it
    const room = (this.room = Math.max(1, height - box.head.length - box.foot.length))
    this.bodyLines = box.body.length
    let scroll = box.of ? (this.scrolls.get(box.of) ?? 0) : 0
    if (box.keep) {
      const [from, to] = box.keep
      if (from < scroll) scroll = from
      else if (to > scroll + room) scroll = to - room
    }
    const end = Math.max(0, box.body.length - room)
    scroll = Math.max(0, Math.min(scroll, end))
    if (box.of) this.scrolls.set(box.of, scroll)
    const foot = box.more ? box.more(end === 0 || scroll === 0 ? 'top' : scroll >= end ? 'bot' : String(Math.round((scroll * 100) / end)).padStart(3) + '%') : box.foot
    return { head: box.head, body: box.body, foot, scroll, lit: box.lit, centred: box.centred, wide: box.wide }
  }

  /**
   * A key to the screen on top: what it keeps for itself it does, sending what that tells the server, and true;
   * false leaves the key to crawl.
   */
  key(st: GameState, k: KeyLike, send: (m: ClientMessage) => void): boolean {
    if (st.textInput) return this.entryKey(st.textInput, k, send)
    const top = this.top(st)
    if (!top) return false
    // show_dialog: its keys go as input bytes to whatever asked (client.js handle_dialog)
    if (top.kind === 'dialog') {
      if (k.key.length === 1 && !k.ctrlKey && !k.altKey) send(cm.inputBytes([k.key.charCodeAt(0)]))
      else if (k.key === 'Escape') send(cm.inputBytes([27]))
      else if (k.key === 'Enter') send(cm.inputBytes([13]))
      return true
    }
    if (top.kind === 'popup') {
      if (top.p.type === 'newgame-choice') return this.newgameKey(top.p, k, send)
      if (top.p.type === 'msgwin-get-line') {
        // crawl reads this line itself, key by key, and echoes it to spectators alone: the keys go on, and are echoed here
        const t = this.echo.get(top.p) ?? ''
        if (k.key === 'Backspace') this.echo.set(top.p, t.slice(0, -1))
        else if (k.key.length === 1 && !k.ctrlKey && !k.altKey) this.echo.set(top.p, t + k.key)
        return false
      }
      const intent = scrollKeyIntent(top.p.type, k)
      if (!intent) return false
      this.scrolls.set(top.p, scrolled(this.scrolls.get(top.p) ?? 0, intent, this.room, this.bodyLines))
      return true
    }
    if (top.kind === 'menu' && top.menu.type !== 'crt') return this.menuKey(top.menu, k, send)
    return false
  }

  /** What is up under a line being typed, the top first (overlays.ts `update`: menus, over them popups, the dialog). */
  private top(st: GameState): Top | null {
    if (st.dialog) return { kind: 'dialog', html: st.dialog }
    const popups = st.ui.filter((p) => !p.hidden)
    const menus = st.menus.filter((m) => !m.hidden)
    const p = popups.at(-1)
    const m = menus.at(-1)
    // menus and popups share the server's one stack: the later is on top
    if (p && (!m || (p.stackOrder ?? 0) >= (m.stackOrder ?? 0))) return { kind: 'popup', p }
    if (m) return { kind: 'menu', menu: m }
    if (st.uiState === 1) return { kind: 'crt' }
    return null
  }

  // ---- menus

  /**
   * A menu as console crawl draws it (menu.cc): its title, its rows, a heading row in its colour, the row under
   * the cursor lit, and its more line, `XXX` the place in the list (menu.js update_more).
   */
  private menuBox(menu: MenuState, width: number): Draft {
    const tp = menu.titlePrompt
    const head = tp && !tp.raw ? [[{ text: tp.prompt, fg: WHITE }, { text: (this.filter.get(menu) ?? '') + '_' }]] : wrapAll(formatted(menu.title?.text || ''), width)
    const body: Line[] = []
    const starts: number[] = []
    menu.items.forEach((it, i) => {
      starts.push(body.length)
      if (!it) return void body.push([{ text: '...', fg: GREY }])
      const fg = PALETTE[(it.colour ?? 7) & 15]
      let lines = wrapAll(formatted(it.text || ''), width).map((l) => tinted(l, fg))
      if (i === menu.last_hovered) lines = lines.map(lit)
      body.push(...lines)
    })
    starts.push(body.length)
    this.menuAt = { menu, starts }
    const hover = menu.last_hovered
    const on = hover >= 0 && hover < menu.items.length
    const litLines: number[] = []
    if (on) for (let j = starts[hover]; j < starts[hover + 1]; j++) litLines.push(j)
    // `more` when the list runs past the page, else `alt_more`, XXX its place in the list (menu.js update_more)
    const more = (at: string) => {
      const t = (at === 'top' && body.length <= this.room ? menu.alt_more : menu.more) || ''
      return t ? wrapAll(formatted(t.replace(/XXX/, at)), width) : []
    }
    return { head, body, foot: more('top'), more, of: menu, keep: on ? [starts[hover], starts[hover + 1]] : undefined, lit: litLines, centred: !!menu['ui-centred'] }
  }

  /** The rows a menu's page shows in full, as menu.js measures them (`first_visible`, `last_visible`). */
  private visible(menu: MenuState): Visible {
    const at = this.menuAt
    const scroll = this.scrolls.get(menu) ?? 0
    if (!at || at.menu !== menu) return { first: 0, last: Math.min(menu.items.length, this.room) - 1 }
    let first = at.starts.findIndex((s) => s >= scroll)
    if (first < 0) first = 0
    let last = first
    while (last + 1 < menu.items.length && at.starts[last + 2] <= scroll + this.room) last++
    return { first, last }
  }

  private menuKey(menu: MenuState, k: KeyLike, send: (m: ClientMessage) => void): boolean {
    const tp = menu.titlePrompt
    if (tp && !tp.raw) {
      // menu.js title_prompt: the title is a field; Enter sends what was typed, Esc leaves it
      const text = this.filter.get(menu) ?? ''
      if (k.key === 'Enter') send(cm.textInput(text + '\r'))
      else if (k.key === 'Escape') send(cm.key(27))
      else if (k.key === 'Backspace') this.filter.set(menu, text.slice(0, -1))
      // macro_mapping: '?' is help, sent as a key even inside the prompt (menu.js)
      else if (menu.tag === 'macro_mapping' && k.key === '?') send(cm.key(63))
      else if (k.key.length === 1 && !k.ctrlKey && !k.altKey) this.filter.set(menu, text + k.key)
      else return false
      return true
    }
    const intent = menuKeyIntent(menu, k)
    if (!intent) return false
    const n = menu.items.length
    const hover = (i: number) => {
      if (i < 0 || i >= n || i === menu.last_hovered) return
      menu.last_hovered = i
      send(cm.menuHover(i))
    }
    const scrollTo = (line: number) => this.scrolls.set(menu, Math.max(0, line))
    const starts = this.menuAt?.menu === menu ? this.menuAt.starts : null
    const lineOf = (i: number) => starts?.[Math.max(0, Math.min(i, n))] ?? i
    const hoverable = () => menu.items.flatMap((_, i) => (nextHoverableItem({ ...menu, last_hovered: -1 }, false, i, true) === i ? [i] : []))
    switch (intent) {
      case 'up':
      case 'down': {
        const down = intent === 'down'
        if (menu.last_hovered < 0) {
          // the menu opened without a hover: the cursor comes in at the near end, or, with nothing to take it, the arrows scroll
          const h = hoverable()
          if (!h.length) {
            const vis = this.visible(menu)
            scrollTo(lineOf(down ? lineDownTarget(menu, vis) : lineUpTarget(vis)))
          } else hover(down ? h[0] : h[h.length - 1])
          break
        }
        hover(nextHoverableItem(menu, !down, menu.last_hovered))
        break
      }
      case 'lineUp':
      case 'lineDown': {
        const vis = this.visible(menu)
        scrollTo(lineOf(intent === 'lineUp' ? lineUpTarget(vis) : lineDownTarget(menu, vis)))
        const snap = snapHoverTarget(menu, this.visible(menu))
        if (snap >= 0) hover(snap)
        break
      }
      case 'pageUp':
      case 'pageDown': {
        const scroll = this.scrolls.get(menu) ?? 0
        const by = intent === 'pageUp' ? -this.room : this.room
        scrollTo(Math.min(scroll + by, Math.max(0, this.bodyLines - this.room)))
        // menu.js paging: a cursor on the page moves with it, to the page's first row it can stand on
        if (menu.last_hovered >= 0 || menuClientHover(menu)) {
          const t = nextHoverableItem(menu, false, this.visible(menu).first, true)
          if (t >= 0) hover(t)
        }
        break
      }
      case 'home':
      case 'end': {
        scrollTo(intent === 'home' ? 0 : this.bodyLines)
        if (menuClientHover(menu) && n > 0) {
          const t = intent === 'home' ? nextHoverableItem(menu, false, 0, true) : nextHoverableItem(menu, true, n - 1, true)
          if (t >= 0) hover(t)
        }
        break
      }
    }
    const vis = this.visible(menu)
    // menu.js update_server_scroll: the server is told which page is shown, and sends the rows of it it has not yet
    send(cm.menuScroll(vis.first, vis.last, menu.last_hovered))
    return true
  }

  // ---- popups

  private popupBox(st: GameState, p: Popup, width: number): Draft {
    const d = p.data as Record<string, unknown>
    const str = (k: string, from: Record<string, unknown> = d) => (typeof from[k] === 'string' ? (from[k] as string) : '')
    const centred = !!p['ui-centred']
    const head: Line[] = []
    const body: Line[] = []
    const foot: Line[] = []
    const title = (t: string, fg = WHITE) => t && head.push(...wrapAll(formatted(t), width).map((l) => tinted(l, fg)))
    const text = (t: string) => t && body.push(...wrapAll(formatted(t.replace(/\r/g, '')), width))
    const keys = (t: string) => t && foot.push(...wrapAll(formatted(t), width).map((l) => tinted(l, CYAN)))
    switch (p.type) {
      case 'formatted-scroller':
        title(str('title'))
        text(typeof p.state.text === 'string' ? (p.state.text as string) : str('text'))
        keys(str('more'))
        break
      case 'describe-spell':
        title(str('title'))
        text(str('desc') || str('body'))
        if (d.can_mem) keys('(M)emorise this spell.')
        break
      case 'describe-item':
      case 'describe-cards':
      case 'describe-generic':
        title(str('title'))
        spellBody(body, str('body') + (p.type === 'describe-generic' ? str('footer') : ''), d.spellset, width)
        keys(str('actions'))
        break
      case 'describe-feature-wide':
        for (const f of (d.feats as { title: string; body: string; quote?: string }[]) || []) {
          if (body.length) body.push([])
          body.push([{ text: f.title, fg: WHITE }])
          if (f.body !== f.title) text(f.body + (f.quote ? '\n\n' + f.quote : ''))
        }
        keys(str('actions'))
        break
      case 'describe-monster':
      case 'describe-god': {
        const god = p.type === 'describe-god'
        title(god ? str('name') || str('title') : str('title'), god && typeof d.colour === 'number' ? PALETTE[d.colour & 15] : WHITE)
        // the panes crawl cycles with `!`, the status and quote only where there is something in them (ui-layouts.js)
        const panes: [string, string][] = god
          ? [['Overview', `${str('description')}\n\nTitle  - ${str('title')}\nFavour - ${str('favour')}\n\n${str('powers_list')}`], ['Powers', str('powers') + (str('info_table') ? '\n\n' + str('info_table') : '')], ['Wrath', str('wrath')], ...(str('extra') ? [['Extra', str('extra')] as [string, string]] : [])]
          : [['Description', str('body')], ...(str('status') ? [['Status', str('status')] as [string, string]] : []), ...(str('quote') ? [['Quote', str('quote')] as [string, string]] : [])]
        const cur = Math.min(typeof p.state.pane === 'number' ? (p.state.pane as number) : 0, panes.length - 1)
        if (cur === 0 && !god) spellBody(body, panes[0][1], d.spellset, width)
        else text(panes[cur][1])
        if (panes.length > 1) foot.push([{ text: god ? '!/^' : '!', fg: CYAN }, { text: ': ' }, ...panes.flatMap(([n], i): Line => [...(i ? [{ text: ' | ' }] : []), { text: n, fg: i === cur ? WHITE : undefined }])])
        if (god && d.is_altar) foot.push([{ text: 'J', fg: CYAN }, { text: '/' }, { text: 'Enter', fg: CYAN }, { text: ': join religion' + str('service_fee') }])
        if (typeof p.state.prompt === 'string') keys(p.state.prompt as string)
        keys(str('actions'))
        break
      }
      case 'version':
      case 'game-over':
        title(str('title'))
        text(str('body') || str('information'))
        if (str('features')) {
          body.push([])
          text(str('features'))
        }
        break
      case 'progress-bar':
        title(str('title'))
        text(typeof p.state.bar_text === 'string' ? (p.state.bar_text as string) : str('bar_text'))
        body.push([{ text: typeof p.state.status === 'string' ? (p.state.status as string) : str('status') }])
        break
      case 'seed-selection': {
        title(str('title'))
        body.push(...wrapAll(htmlLines(str('body')), width))
        const ti = st.textInput?.type === 'seed-selection' ? st.textInput : null
        foot.push([{ text: 'Enter seed: ' }, { text: (ti?.text ?? '') + '_', fg: WHITE }])
        foot.push([{ text: '[-]', fg: CYAN }, { text: ' clear  ' }, { text: '[d]', fg: CYAN }, { text: " today's daily seed  " }, { text: '[?]', fg: CYAN }, { text: ' help' }])
        foot.push(...wrapAll(htmlLines(str('footer')), width))
        break
      }
      case 'msgwin-get-line':
        body.push(...wrap([...(formatted(str('prompt'))[0] ?? []), { text: (this.echo.get(p) ?? '') + '_', fg: WHITE }], width))
        break
      case 'newgame-choice':
        return this.newgameBox(p, width)
      case 'newgame-random-combo':
        title(str('prompt'))
        body.push([{ text: 'Do you want to play this combination?' }])
        keys('(Y)es, (n)o, (q)uit')
        break
      default:
        title(str('title') || p.type)
        text(str('body') || str('text'))
    }
    return { head, body, foot, of: p, lit: [], centred }
  }

  /**
   * A new-game screen's grids (`main-items`, then `sub-items`), each cell where crawl stands it: its buttons, and
   * the headings between them (`labels`: Simple, Intermediate, Advanced). A button's row counts on from the grids
   * above it, so the arrows walk from one grid into the next.
   */
  private grids(p: Popup): NewgameCell[][] {
    const d = p.data as Record<string, unknown>
    const out: NewgameCell[][] = []
    let base = 0
    for (const key of ['main-items', 'sub-items']) {
      const g = d[key] as Record<string, unknown> | undefined
      if (!g) continue
      const menuId = String(g.menu_id || '')
      const cells: NewgameCell[] = []
      for (const b of (g.buttons as Record<string, unknown>[]) || [])
        cells.push({ hotkey: Number(b.hotkey), menuId, row: base + Number(b.y), col: Number(b.x), label: ((b.labels as string[]) || [String(b.label || '')])[0], description: String(b.description || '') })
      for (const l of (g.labels as Record<string, unknown>[]) || []) cells.push({ row: base + Number(l.y), col: Number(l.x), label: String(l.label || '') })
      base = Math.max(base, ...cells.map((c) => c.row + 1))
      out.push(cells)
    }
    return out
  }

  /** The new-game buttons, all grids', in order. */
  private buttons(p: Popup): Button[] {
    return this.grids(p).flatMap((g) => g.filter((c): c is Button => c.hotkey !== undefined))
  }

  /** The hotkey the new-game cursor is on: ours, else the server's (`button_focus`), else the first button's. */
  private focused(p: Popup): number | undefined {
    const own = this.focus.get(p)
    if (own !== undefined) return own
    return typeof p.state.button_focus === 'number' ? (p.state.button_focus as number) : this.buttons(p)[0]?.hotkey
  }

  /**
   * The new-game choices as console crawl lays them out (newgame.cc): the title and prompt, then each grid in
   * columns as wide as their widest, the button under the cursor lit, and its description under all.
   */
  private newgameBox(p: Popup, width: number): Draft {
    const d = p.data as Record<string, unknown>
    const head: Line[] = [...wrapAll(formatted(String(d.title || '')), width).map((l) => tinted(l, WHITE))]
    if (d.prompt) head.push(...wrapAll(formatted(String(d.prompt)), width))
    const at = this.focused(p)
    const body: Line[] = []
    const litLines: number[] = []
    for (const grid of this.grids(p)) {
      if (body.length) body.push([])
      const label = (c: NewgameCell) => {
        const l = formatted(c.label)[0] ?? []
        return c.hotkey !== undefined && c.hotkey === at ? lit(l) : l
      }
      const colW: number[] = []
      for (const c of grid) colW[c.col] = Math.max(colW[c.col] ?? 0, lineText(label(c)).length)
      const left = (col: number) => colW.slice(0, col).reduce((a, w) => a + (w ?? 0) + 2, 0)
      // narrower than crawl's columns: each cell a line of its own
      const across = left(colW.length) - 2 <= width
      const rows = [...new Set(grid.map((c) => c.row))].sort((a, b) => a - b)
      for (const r of rows) {
        const inRow = grid.filter((c) => c.row === r).sort((a, b) => a.col - b.col)
        const lines: Line[] = []
        if (across) {
          const line: Line = []
          let x = 0
          for (const c of inRow) {
            if (left(c.col) > x) line.push({ text: ' '.repeat(left(c.col) - x) })
            line.push(...label(c))
            x = left(c.col) + lineText(label(c)).length
          }
          lines.push(line)
        } else lines.push(...inRow.map(label))
        if (inRow.some((c) => c.hotkey !== undefined && c.hotkey === at)) litLines.push(body.length + (across ? 0 : inRow.findIndex((c) => c.hotkey === at)))
        body.push(...lines)
      }
    }
    const desc = this.buttons(p).find((b) => b.hotkey === at)?.description
    const foot = desc ? [[], ...wrapAll(formatted(desc), width)] : []
    const l = litLines[0]
    return { head, body, foot, of: p, keep: l === undefined ? undefined : [l, l + 1], lit: [], centred: true }
  }

  /** ui-layouts.js newgame: the arrows walk the grid on the client and tell the server; Enter takes the button. */
  private newgameKey(p: Popup, k: KeyLike, send: (m: ClientMessage) => void): boolean {
    const buttons = this.buttons(p)
    const at = buttons.find((b) => b.hotkey === this.focused(p))
    if (!at) return false
    if (k.key === 'Enter' && !k.ctrlKey && !k.altKey) {
      send(cm.outerMenuFocus(at.hotkey, at.menuId))
      send(cm.key(at.hotkey))
      return true
    }
    const step = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[k.key]
    if (!step) return false
    const [dr, dc] = step
    // the nearest button that way: along its row or column first, then the nearest by distance
    const ahead = buttons.filter((b) => (dr ? Math.sign(b.row - at.row) === dr : b.row === at.row && Math.sign(b.col - at.col) === dc))
    const to = ahead.sort((a, b) => Math.abs(a.row - at.row) * 4 + Math.abs(a.col - at.col) - (Math.abs(b.row - at.row) * 4 + Math.abs(b.col - at.col)))[0]
    if (to) {
      this.focus.set(p, to.hotkey)
      send(cm.outerMenuFocus(to.hotkey, to.menuId))
    }
    return true
  }

  // ---- a line typed

  private entryBox(st: GameState, ti: TextInputState, width: number): Draft {
    const prompt = ti.prompt || (st.ui.at(-1)?.type === 'msgwin-get-line' ? String((st.ui.at(-1)!.data as Record<string, unknown>).prompt ?? '') : '') || 'Input here (ESC to cancel): '
    const line: Line = [...(formatted(prompt)[0] ?? []), { text: ti.text + '_', fg: WHITE }]
    return { head: [], body: wrap(line, width), foot: [], lit: [], centred: true }
  }

  /** textinput.js: the line edited here, its hotkeys and recall as the prompt's tag has them, sent whole on Enter. */
  private entryKey(ti: TextInputState, k: KeyLike, send: (m: ClientMessage) => void): boolean {
    let history = this.histories.get(ti)
    if (!history) this.histories.set(ti, (history = new EntryHistory(ti.historyId)))
    const fresh = !!ti.select_prefill && !this.edited.has(ti)
    const typed = () => this.edited.add(ti)
    // Ctrl-U clears the line, as crawl's own line editor does
    if (k.ctrlKey && !k.altKey && k.key === 'u') {
      ti.text = ''
      typed()
      return true
    }
    if (k.ctrlKey || k.altKey) return false
    if (k.key === 'Escape') send(cm.key(27))
    else if (k.key === 'Enter') {
      history.sent(ti.text)
      for (const m of submitMessages(ti.text, ti.tag)) send(m)
    } else if (k.key === 'Backspace') {
      ti.text = fresh ? '' : ti.text.slice(0, -1)
      typed()
    } else if (k.key === 'ArrowUp' || k.key === 'ArrowDown') {
      const line = history.recall(k.key === 'ArrowUp' ? -1 : 1)
      if (line !== null) ti.text = line
      typed()
    } else if (k.key.length === 1) {
      const e = entryKey(ti, k.key, ti.text)
      if (e.kind === 'type') {
        if (ti.maxlen && ti.text.length >= ti.maxlen && !fresh) return true
        ti.text = (fresh ? '' : ti.text) + k.key
        typed()
      } else if (e.kind === 'submit') {
        history.sent(ti.text)
        for (const m of submitMessages(ti.text, ti.tag, e.final)) send(m)
      } else if (e.kind === 'key') send(cm.key(e.code))
    } else return false
    return true
  }
}

/** A describe popup's text, the spell list where crawl marks its place (SPELLSET_PLACEHOLDER), `a - Magic Dart` a row. */
function spellBody(body: Line[], text: string, spellset: unknown, width: number) {
  const books = (Array.isArray(spellset) ? spellset : []) as { label: string; spells: { letter: string; title: string; effect?: string; range_string?: string; range?: string; colour?: number }[] }[]
  const [before, ...after] = text.replace(/\r/g, '').split('SPELLSET_PLACEHOLDER')
  body.push(...wrapAll(formatted(before), width))
  for (const b of books) {
    if (b.label?.trim()) body.push(...wrapAll(formatted(b.label), width))
    for (const s of b.spells) {
      const row = formatted(`${s.letter} - ${s.title}`)[0] ?? []
      const fg = s.colour !== undefined ? PALETTE[s.colour & 15] : undefined
      body.push([...(fg ? tinted(row, fg) : row), { text: '  ' }, ...(formatted(s.effect || '')[0] ?? []), { text: '  ' }, ...(formatted(s.range_string || s.range || '')[0] ?? [])])
    }
  }
  if (after.length) body.push(...wrapAll(formatted(after.join('')), width))
}

/** A CRT screen (the skills, `m`): crawl's console lines as it sends them, all its text areas in turn. */
function crtBox(st: GameState): Draft {
  const body: Line[] = []
  for (const area of [st.crt.lines, ...[...st.crt.areas.entries()].filter(([k]) => k !== 'crt').map(([, v]) => v)]) {
    const max = Math.max(-1, ...area.keys())
    for (let i = 0; i <= max; i++) body.push(htmlLines(area.get(i) || '')[0] ?? [])
  }
  return { head: [], body, foot: [], lit: [], centred: true, wide: true }
}

/** a scroll `by` a scroll key's worth, of `total` lines `room` to a page */
function scrolled(at: number, key: ScrollKey, room: number, total: number): number {
  const end = Math.max(0, total - room)
  const to = key === 'lineUp' ? at - 1 : key === 'lineDown' ? at + 1 : key === 'pageUp' ? at - room : key === 'pageDown' ? at + room : key === 'home' ? 0 : end
  return Math.max(0, Math.min(end, to))
}

