import { cm, type ClientMessage, type GameState } from '@orbrun/webtiles'
import { h, clear, escapeHtml } from './dom'
import { Osk, oskPrompts } from './osk'
import { glyph, glyphName, type GlyphName } from './glyphs'
import type { PadKind } from './gamepad'
import type { PadEvent } from './gamepad'

type Rect = { left: number; top: number; width: number; height: number }

/** chat.js: how many sent lines the up/down history keeps. */
const HISTORY_LIMIT = 25

export interface ChatHooks {
  send(m: ClientMessage): void
  padKind?(): PadKind
}

/**
 * The WebTiles chat box (`chat.js`, `client.html`): spectator count caption,
 * spectator list, message history, an input line. It keeps the official
 * behaviour: the caption toggles the body, unread lines are counted while
 * the body is closed ("3 new messages (Press F12)"), `(-)` hides the whole
 * box to a `+`, Enter sends, up and down walk the sent-line history, Esc or
 * F12 close it. The server's `toggle_chat` and `super_hide_chat` are read
 * from state. A pad drives the same input through the on-screen keyboard.
 *
 * On a phone (`compact`) there is no standing caption: the box is shut
 * until asked for, and a badge over the log's right end stands in for the
 * caption while there is something to say (someone watching, lines unread).
 * A tap on it opens the box over the log; a tap on its caption shuts it.
 */
export class Chat {
  root: HTMLElement
  private hiddenTab: HTMLElement
  private countEl = h('span', { class: 'spectator_count' }, '0 spectators')
  private messageCount = h('span', { class: 'message_count' })
  private body = h('div', { class: 'chat_body', style: { display: 'none' } })
  private specList = h('span', { class: 'spectator_list' }, ' ')
  private historyBox = h('div', { class: 'chat_history_container' })
  private history = h('span', { class: 'chat_history' })
  private input = h('input', { class: 'text chat_input', type: 'text', name: 'chat_input', autocomplete: 'off', enterkeyhint: 'send' })
  private loginText = h('div', { class: 'chat_login_text', style: { display: 'none' } }, 'Log in to chat')
  private hooks: ChatHooks
  private newMessages = 0
  /** the log drawn from, and the last line of it drawn */
  private log: GameState['chat'] | null = null
  private last: GameState['chat'][number] | null = null
  private lastRev = -1
  /** the visibility switches as last written (`update`) */
  private lastVis = -1
  private sent: string[] = []
  private unsent = ''
  private historyPos = -1
  /** chat.js `chat_hidden`: the player put the whole box away with (-) */
  private hidden = false
  /**
   * The pad opened the box to read it: up and down scroll the history, A
   * brings the keyboard up, B closes. The keyboard is not shown straight
   * away because it would leave the history no room to be read.
   */
  private reading = false
  private readHints = h('div', { class: 'more chat_read_hints' })
  private osk = new Osk(oskPrompts('Send'), () => this.hooks.padKind?.() ?? 'generic')
  /** a phone's: the box shut until asked for, the badge in the caption's place (`place`) */
  private compact = false
  private watchers = 0
  /** the box's foot as placed, which the phone's keyboard lifts it off while the line is typed in (`lift`) */
  private placedBottom = 0
  private badgeText = h('span')
  private badge = h('a', { class: 'chat_badge', href: 'javascript:', style: { display: 'none' }, 'aria-label': 'Chat', onclick: () => this.open() }, eye(), this.badgeText)

  constructor(host: HTMLElement, hooks: ChatHooks) {
    this.hooks = hooks
    const hideBtn = h('a', { class: 'chat_hide_button', href: 'javascript:', onclick: () => this.toggleEntire() }, h('span', null, '(-)'))
    const caption = h('a', { class: 'chat_caption', href: 'javascript:', onclick: () => this.toggle() }, this.countEl, ' ', this.messageCount)
    this.historyBox.append(this.history)
    this.body.append(this.specList, h('br'), this.historyBox, this.input, this.loginText)
    const head = h('div', { class: 'chat_head' }, caption, hideBtn)
    this.root = h('div', { class: 'chat', style: { display: 'none' } }, head, this.body)
    this.hiddenTab = h('div', { class: 'chat_hidden', style: { display: 'none' } }, h('a', { href: 'javascript:', onclick: () => this.toggleEntire() }, '+'))
    host.append(this.root, this.hiddenTab, this.badge)
    this.input.addEventListener('keydown', (ev) => this.onKey(ev))
    // a phone's keyboard comes up over the screen's foot, where the box stands: it stands on the keyboard instead
    this.input.addEventListener('focus', () => {
      if (!this.compact) return
      window.visualViewport?.addEventListener('resize', this.lift)
      window.visualViewport?.addEventListener('scroll', this.lift)
      this.lift()
    })
    this.input.addEventListener('blur', () => {
      window.visualViewport?.removeEventListener('resize', this.lift)
      window.visualViewport?.removeEventListener('scroll', this.lift)
      this.root.style.bottom = this.placedBottom + 'px'
      this.root.style.maxHeight = ''
    })
    this.updateMessageCount()
  }

  /** The pad is reading the chat or typing into its line; game buttons go here instead. */
  get capturing(): boolean {
    return this.reading || this.osk.visible
  }

  /** The element is the chat's: the box or the phone's badge. */
  owns(el: Element): boolean {
    return this.root.contains(el) || this.badge.contains(el)
  }

  /**
   * Where the box stands (game.ts relayout). Off a phone, at the foot of the
   * sidebar, as wide as it. On a phone over the log, as wide as it, growing
   * up from its foot, the badge just above the log's right end; with no log
   * the badge goes to the grid's bottom-right corner, as the folded `+` does.
   */
  place(box: Rect, hostH: number, hostW: number, compact: boolean, log: Rect | null) {
    this.compact = compact
    this.root.classList.toggle('compact', compact)
    const st = this.root.style
    const at = compact && log ? log : box
    st.left = at.left + 'px'
    st.width = at.width + 'px'
    this.placedBottom = Math.max(0, hostH - at.top - at.height)
    st.bottom = this.placedBottom + 'px'
    // over the log it hides the log whole, however few its lines
    st.minHeight = compact && log ? log.height + 'px' : ''
    const b = this.badge.style
    this.badge.classList.toggle('corner', !log)
    b.right = log ? Math.max(0, hostW - log.left - log.width) + 'px' : ''
    b.bottom = log ? Math.max(0, hostH - log.top) + 'px' : ''
    this.lastVis = -1
  }

  /** The box onto the top of the phone's keyboard, and no taller than what the keyboard leaves. */
  private lift = () => {
    const vv = window.visualViewport
    const host = this.root.offsetParent
    if (!vv || !host) return
    const covered = host.getBoundingClientRect().bottom - (vv.offsetTop + vv.height)
    this.root.style.bottom = Math.max(this.placedBottom, covered) + 'px'
    this.root.style.maxHeight = covered > 0 ? Math.max(120, vv.height - 8) + 'px' : ''
  }

  /** The keyboard focus is in the chat line (physical keyboard). */
  get focused(): boolean {
    return document.activeElement === this.input
  }

  /**
   * Follow the state once per frame: new lines, spectators, the server's
   * visibility switches, and whether this connection may chat at all
   * (client.html shows "Login to chat" to anonymous spectators).
   */
  update(state: GameState, inGame: boolean, loggedIn: boolean) {
    if (state.rev.chat !== this.lastRev) this.read(state)
    // client.js reset_visibility: no chat outside a game
    const superHidden = state.chatSuperHidden
    const open = this.body.style.display !== 'none'
    // a phone's box is shown only while open, and its badge only while there is something to say
    const show = inGame && state.chatVisible && !this.hidden && !superHidden && (!this.compact || open)
    const tab = inGame && this.hidden && !superHidden && !this.compact
    const badge = inGame && state.chatVisible && !superHidden && this.compact && !open && (this.watchers > 0 || this.newMessages > 0)
    // style writes only on a change: this runs every frame
    const vis = (show ? 1 : 0) | (tab ? 2 : 0) | (loggedIn ? 4 : 0) | (badge ? 8 : 0)
    if (vis !== this.lastVis) {
      this.lastVis = vis
      this.root.style.display = show ? '' : 'none'
      this.hiddenTab.style.display = tab ? '' : 'none'
      this.badge.style.display = badge ? '' : 'none'
      this.input.style.display = loggedIn ? '' : 'none'
      this.loginText.style.display = loggedIn ? 'none' : ''
    }
  }

  /** New lines and spectators since the last read. */
  private read(state: GameState) {
    this.lastRev = state.rev.chat
    // spectators
    const sp = state.spectators
    const n = sp?.count ?? 0
    this.watchers = n
    this.updateBadge()
    this.countEl.textContent = `${n} ${n === 1 ? 'spectator' : 'spectators'}`
    this.specList.innerHTML = sp?.names ? serverHtml(sp.names) : '&nbsp;'
    // lines: a fresh game is a fresh log. The reducer drops the oldest line
    // past 500, so the next line to draw is found after the last one drawn,
    // not by count.
    if (state.chat !== this.log) {
      clear(this.history)
      this.log = state.chat
      this.last = null
      this.newMessages = 0
      this.updateMessageCount()
    }
    const box = this.historyBox
    const atBottom = Math.abs(box.scrollHeight - box.scrollTop - box.clientHeight) < 1.0
    const from = this.last ? state.chat.lastIndexOf(this.last) + 1 : 0
    for (let i = from; i < state.chat.length; i++) {
      const line = state.chat[i]
      // chat.js receive_message: the server's html, with urls in the message span made into links
      const wrap = h('div', { html: serverHtml(line.html) })
      for (const m of Array.from(wrap.querySelectorAll('.chat_msg'))) m.innerHTML = linkify(m.textContent || '')
      this.history.insertAdjacentHTML('beforeend', wrap.innerHTML + '<br>')
      if (this.body.style.display === 'none' && !line.meta) {
        this.newMessages++
        this.updateMessageCount()
      }
    }
    this.last = state.chat.at(-1) ?? null
    if (atBottom) box.scrollTop = box.scrollHeight
  }

  private updateMessageCount() {
    const pressKey = this.newMessages > 0 ? ' (Press F12)' : ''
    this.messageCount.textContent = `${this.newMessages} new messages${pressKey}`
    this.messageCount.classList.toggle('has_new', this.newMessages > 0)
    this.updateBadge()
  }

  private updateBadge() {
    // the badge: who is watching, and what is unread
    const unread = this.newMessages > 0 ? `${this.newMessages} new` : ''
    this.badgeText.textContent = [this.watchers > 0 ? String(this.watchers) : '', unread].filter(Boolean).join(' · ')
    this.badge.classList.toggle('has_new', this.newMessages > 0)
    this.lastVis = -1
  }

  /** The badge, tapped: the box opens over the log, to read; the line is a tap further. */
  private open() {
    if (this.hidden) this.toggleEntire()
    if (this.body.style.display === 'none') this.toggle()
    this.historyBox.scrollTop = this.historyBox.scrollHeight
  }

  /** chat.js toggle: open or close the body under the caption. */
  toggle() {
    if (this.body.style.display === 'none') {
      this.body.style.display = ''
      this.root.classList.add('open')
      this.newMessages = 0
      this.updateMessageCount()
      this.messageCount.textContent = this.compact ? '(close)' : '(Esc: close)'
      this.historyBox.scrollTop = this.historyBox.scrollHeight
    } else {
      this.body.style.display = 'none'
      this.root.classList.remove('open')
      this.updateMessageCount()
      this.stopReading()
      if (this.osk.visible) this.osk.detach()
    }
  }

  /** chat.js toggle_entire_chat: the (-) button folds the box to a +, and back. */
  toggleEntire() {
    this.hidden = !this.hidden
    if (this.hidden) {
      this.input.blur()
      this.stopReading()
      if (this.osk.visible) this.osk.detach()
    }
    this.lastRev = -1
  }

  /** chat.js focus (F12): make the box visible and put the caret in the line. */
  focus() {
    if (this.hidden) this.toggleEntire()
    if (this.body.style.display === 'none') this.toggle()
    this.historyBox.scrollTop = this.historyBox.scrollHeight
    this.input.focus()
  }

  /** Esc / F12 from inside the line: close the body and leave the field. */
  close() {
    if (this.body.style.display !== 'none') this.toggle()
    this.input.blur()
    this.stopReading()
    if (this.osk.visible) this.osk.detach()
  }

  /** The pad opens chat: the box with its history to read, the keyboard one press away. */
  padFocus() {
    if (this.hidden) this.toggleEntire()
    if (this.body.style.display === 'none') this.toggle()
    this.historyBox.scrollTop = this.historyBox.scrollHeight
    this.input.blur()
    if (this.osk.visible) this.osk.detach()
    this.startReading()
  }

  /** The pad asked for the keyboard from the reading box (A). */
  private padWrite() {
    this.stopReading()
    this.input.focus()
    this.osk.attach(
      {
        input: this.input,
        submit: () => this.sendLine(),
        cancel: () => this.padRead(),
      },
      this.root,
    )
  }

  /** Cancelling the keyboard goes back to reading, not out of the box. */
  private padRead() {
    if (this.osk.visible) this.osk.detach()
    this.input.blur()
    this.startReading()
  }

  private startReading() {
    this.reading = true
    const kind = this.hooks.padKind?.() ?? 'generic'
    clear(this.readHints)
    const hint = (button: GlyphName, label: string) => h('span', { class: 'osk-prompt', 'aria-label': `${glyphName(button, kind)} ${label}` }, glyph(button, kind), ' ' + label)
    this.readHints.append(hint('DPAD', 'Scroll'), ' · ', hint('A', 'Write'))
    this.root.append(this.readHints)
  }

  private stopReading() {
    this.reading = false
    this.readHints.remove()
  }

  /** Pad events while the box is being read or the keyboard is up. Returns true when consumed. */
  pad(ev: PadEvent): boolean {
    if (this.reading) {
      if ((ev.type === 'dir' || ev.type === 'dirRepeat') && ev.dir !== null) {
        const step = this.historyBox.clientHeight / 2 || 40
        if (ev.dir === 0) this.historyBox.scrollTop -= step
        else if (ev.dir === 4) this.historyBox.scrollTop += step
      } else if (ev.type === 'press') {
        if (ev.button === 'A' || ev.button === 'Y' || ev.button === 'START') this.padWrite()
        else if (ev.button === 'B' || ev.button === 'SELECT' || ev.button === 'X') this.close()
      }
      return true
    }
    if (!this.osk.visible) return false
    if ((ev.type === 'dir' || ev.type === 'dirRepeat') && ev.dir !== null) this.osk.op('move', ev.dir)
    else if (ev.type === 'press') {
      if (ev.button === 'A') this.osk.op('type')
      else if (ev.button === 'B' || ev.button === 'SELECT') this.osk.op('cancel')
      else if (ev.button === 'X') this.osk.op('backspace')
      else if (ev.button === 'Y' || ev.button === 'START') this.osk.op('submit')
      else if (ev.button === 'LB') this.osk.op('shift')
      else if (ev.button === 'RB') this.osk.op('space')
    }
    return true
  }

  private sendLine() {
    const content = this.input.value
    if (content === '') return
    this.hooks.send(cm.chat(content))
    this.input.value = ''
    this.historyBox.scrollTop = this.historyBox.scrollHeight
    this.sent.unshift(content)
    if (this.sent.length > HISTORY_LIMIT) this.sent.length = HISTORY_LIMIT
    this.historyPos = -1
    this.unsent = ''
    if (this.osk.visible) this.osk.reattach(this.root)
  }

  /** chat.js chat_message_send: Enter sends, up/down walk history, Esc or F12 close. */
  private onKey(ev: KeyboardEvent) {
    if (ev.key === 'Enter') {
      ev.preventDefault()
      ev.stopPropagation()
      this.sendLine()
    } else if (ev.key === 'ArrowUp' && !ev.shiftKey) {
      ev.preventDefault()
      ev.stopPropagation()
      const lim = Math.min(this.sent.length, HISTORY_LIMIT)
      if (this.sent.length && this.historyPos < lim - 1) {
        // keep the unsent line so going past the start of the history brings it back
        if (this.historyPos === -1) this.unsent = this.input.value
        this.input.value = this.sent[++this.historyPos]
      }
    } else if (ev.key === 'ArrowDown' && !ev.shiftKey) {
      ev.preventDefault()
      ev.stopPropagation()
      if (this.sent.length && this.historyPos > -1) {
        if (this.historyPos === 0) {
          this.input.value = this.unsent
          this.historyPos--
        } else this.input.value = this.sent[--this.historyPos]
      }
    } else if (ev.key === 'Escape' || ev.key === 'F12') {
      ev.preventDefault()
      ev.stopPropagation()
      this.close()
    }
  }
}

/**
 * A server's chat or spectator html, kept to its text and its spans' classes
 * (sender, message, colours). chat.js inserts it whole, but there the page is
 * the server's own site; here every server's page is one site, holding every
 * account's login token, so no server's markup may run in it. Parsed in a
 * document of its own, where nothing loads or runs.
 */
export function serverHtml(html: string): string {
  const body = new DOMParser().parseFromString(`<body>${html}`, 'text/html').body
  const walk = (node: Node): string => {
    let out = ''
    for (const c of Array.from(node.childNodes)) {
      if (c.nodeType === Node.TEXT_NODE) out += escapeHtml(c.textContent ?? '')
      else if (c.nodeType === Node.ELEMENT_NODE) {
        const el = c as Element
        const inner = walk(el)
        const cls = el.getAttribute('class')
        out += el.tagName === 'SPAN' ? `<span${cls ? ` class="${escapeHtml(cls)}"` : ''}>${inner}</span>` : inner
      }
    }
    return out
  }
  return walk(body)
}

/** linkify (chat.js): urls in a chat line become links; everything else is escaped text. */
function linkify(text: string): string {
  const re = /(https?:\/\/[^\s<]+)/g
  let out = ''
  let last = 0
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0
    out += escapeHtml(text.slice(last, i))
    let url = m[0]
    let trail = ''
    // a closing bracket or punctuation right after a url is prose, not the url
    while (/[.,;:!?)\]]$/.test(url)) {
      trail = url.slice(-1) + trail
      url = url.slice(0, -1)
    }
    out += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>${escapeHtml(trail)}`
    last = i + m[0].length
  }
  out += escapeHtml(text.slice(last))
  return out
}

/** The badge's eye: someone is watching. */
function eye(): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  const lid = document.createElementNS(NS, 'path')
  lid.setAttribute('d', 'M1 12C4 6.5 8 4 12 4s8 2.5 11 8c-3 5.5-7 8-11 8S4 17.5 1 12z')
  lid.setAttribute('fill', 'none')
  lid.setAttribute('stroke', 'currentColor')
  lid.setAttribute('stroke-width', '2')
  const pupil = document.createElementNS(NS, 'circle')
  pupil.setAttribute('cx', '12')
  pupil.setAttribute('cy', '12')
  pupil.setAttribute('r', '3.5')
  pupil.setAttribute('fill', 'currentColor')
  svg.append(lid, pupil)
  return svg
}
