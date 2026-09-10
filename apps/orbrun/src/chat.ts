import { cm, type ClientMessage, type GameState } from '@orbrun/webtiles'
import { h, clear, escapeHtml } from './dom'
import { Osk, oskPrompts } from './osk'
import { glyph, glyphName, type GlyphName } from './glyphs'
import type { PadKind } from './gamepad'
import type { PadEvent } from './gamepad'

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
  private input = h('input', { class: 'text chat_input', type: 'text', name: 'chat_input', autocomplete: 'off' })
  private loginText = h('div', { class: 'chat_login_text', style: { display: 'none' } }, 'Log in to chat')
  private hooks: ChatHooks
  private newMessages = 0
  private rendered = 0
  private lastRev = -1
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
  private osk = new Osk(oskPrompts('Send', 'Close'), () => this.hooks.padKind?.() ?? 'generic')

  constructor(host: HTMLElement, hooks: ChatHooks) {
    this.hooks = hooks
    const hideBtn = h('a', { class: 'chat_hide_button', href: 'javascript:', onclick: () => this.toggleEntire() }, h('span', null, '(-)'))
    const caption = h('a', { class: 'chat_caption', href: 'javascript:', onclick: () => this.toggle() }, this.countEl, ' ', this.messageCount)
    this.historyBox.append(this.history)
    this.body.append(this.specList, h('br'), this.historyBox, this.input, this.loginText)
    const head = h('div', { class: 'chat_head' }, caption, hideBtn)
    this.root = h('div', { class: 'chat', style: { display: 'none' } }, head, this.body)
    this.hiddenTab = h('div', { class: 'chat_hidden', style: { display: 'none' } }, h('a', { href: 'javascript:', onclick: () => this.toggleEntire() }, '+'))
    host.append(this.root, this.hiddenTab)
    this.input.addEventListener('keydown', (ev) => this.onKey(ev))
    this.updateMessageCount()
  }

  /** The pad is reading the chat or typing into its line; game buttons go here instead. */
  get capturing(): boolean {
    return this.reading || this.osk.visible
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
    // client.js reset_visibility: no chat outside a game
    const superHidden = state.chatSuperHidden
    const show = inGame && state.chatVisible && !this.hidden && !superHidden
    this.root.style.display = show ? '' : 'none'
    this.hiddenTab.style.display = inGame && this.hidden && !superHidden ? '' : 'none'
    this.input.style.display = loggedIn ? '' : 'none'
    this.loginText.style.display = loggedIn ? 'none' : ''
    if (state.rev.chat === this.lastRev) return
    this.lastRev = state.rev.chat
    // spectators
    const sp = state.spectators
    const n = sp?.count ?? 0
    this.countEl.textContent = `${n} ${n === 1 ? 'spectator' : 'spectators'}`
    this.specList.innerHTML = sp?.names || '&nbsp;'
    // lines: the reducer keeps the log bounded, so a shrink means a fresh game
    if (state.chat.length < this.rendered) {
      clear(this.history)
      this.rendered = 0
      this.newMessages = 0
      this.updateMessageCount()
    }
    const box = this.historyBox
    const atBottom = Math.abs(box.scrollHeight - box.scrollTop - box.clientHeight) < 1.0
    for (; this.rendered < state.chat.length; this.rendered++) {
      const line = state.chat[this.rendered]
      // chat.js receive_message: the server's html, with urls in the message span made into links
      const wrap = h('div', { html: line.html })
      for (const m of Array.from(wrap.querySelectorAll('.chat_msg'))) m.innerHTML = linkify(m.textContent || '')
      this.history.insertAdjacentHTML('beforeend', wrap.innerHTML + '<br>')
      if (this.body.style.display === 'none' && !line.meta) {
        this.newMessages++
        this.updateMessageCount()
      }
    }
    if (atBottom) box.scrollTop = box.scrollHeight
  }

  private updateMessageCount() {
    const pressKey = this.newMessages > 0 ? ' (Press F12)' : ''
    this.messageCount.textContent = `${this.newMessages} new messages${pressKey}`
    this.messageCount.classList.toggle('has_new', this.newMessages > 0)
  }

  /** chat.js toggle: open or close the body under the caption. */
  toggle() {
    if (this.body.style.display === 'none') {
      this.body.style.display = ''
      this.newMessages = 0
      this.updateMessageCount()
      this.messageCount.textContent = '(Esc: close)'
      this.historyBox.scrollTop = this.historyBox.scrollHeight
    } else {
      this.body.style.display = 'none'
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
    this.readHints.append(hint('DPAD', 'Scroll'), ' · ', hint('A', 'Write'), ' · ', hint('B', 'Close'))
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
