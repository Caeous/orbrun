import type { Dir8 } from '@orbrun/scene'
import { h } from './dom'
import { glyph, glyphName, type GlyphName } from './glyphs'
import type { PadKind } from './gamepad'

/**
 * The on-screen keyboard, on its own so the front end (lobby.ts) can load
 * it without the game's overlays: the home screen and the lobby are in the
 * first chunk the page loads, the game (and three.js with it) in a second
 * that is fetched once the first screen is up (main.ts).
 */

const OSK_ROWS = ['1234567890-=', 'qwertyuiop[]', "asdfghjkl;'\\", 'zxcvbnm,./`', '!@#$%^&*()_+', '{}|:"<>?~ ']

export type OskOp = 'move' | 'type' | 'backspace' | 'space' | 'submit' | 'cancel' | 'shift'

/** One button on the keyboard's hint line: the button and what it does here. */
export interface OskPrompt {
  button: GlyphName
  label: string
}

/**
 * The hint line's buttons, in the dialogs' order: what types, then the
 * edits, then the way out. Y's and B's labels are the keyboard's to name
 * (Done, Send, Submit; Cancel, Close). Start is Enter and Select is Escape,
 * unlabelled as on every other dialog.
 */
export function oskPrompts(submit = 'Done', cancel = 'Cancel'): OskPrompt[] {
  return [
    { button: 'A', label: 'Type' },
    { button: 'X', label: 'Backspace' },
    { button: 'RB', label: 'Space' },
    { button: 'LB', label: 'Shift' },
    { button: 'Y', label: submit },
    { button: 'B', label: cancel },
  ]
}

/** What the keyboard is typing into and what finishing means for it. */
export interface OskTarget {
  input: HTMLInputElement | HTMLTextAreaElement
  /** Y / Enter */
  submit(): void
  /** Select / Esc */
  cancel(): void
  /**
   * A character about to be typed. Return true when it was handled some other
   * way (a hotkey the prompt's tag sends as a key, or a blocked character), so
   * it is not inserted.
   */
  special?(ch: string): boolean
  /**
   * Keys of the prompt's own, over the letters as the keyboard's first row,
   * each with a label: a travel depth's Up and Down. Typing one goes through
   * `special`, which sends it.
   */
  extras?: { ch: string; label: string }[]
}

/**
 * A pad-driven keyboard that types into a real `<input>`, so the Steam
 * keyboard and a physical keyboard work on the same field. Shared by the
 * game overlays and the lobby forms.
 */
export class Osk {
  el: HTMLElement | null = null
  private row = 0
  private col = 0
  private shift = false
  private target: OskTarget | null = null
  private prompts: OskPrompt[]
  private padKind: () => PadKind

  constructor(prompts: OskPrompt[] = oskPrompts(), padKind: () => PadKind = () => 'generic') {
    this.prompts = prompts
    this.padKind = padKind
  }

  /** The hint line, spelled as the dialogs spell theirs (overlays.ts showChoices): glyph, label, and the keys at the end. */
  private hintLine(): HTMLElement {
    const kind = this.padKind()
    const line = h('div', { class: 'more' })
    for (const p of this.prompts) {
      line.append(h('span', { class: 'osk-prompt', 'aria-label': `${glyphName(p.button, kind)} ${p.label}` }, glyph(p.button, kind), ' ' + p.label), ' · ')
    }
    line.append('Enter / Esc')
    return line
  }

  get visible(): boolean {
    return !!this.el
  }

  get input(): HTMLInputElement | HTMLTextAreaElement | null {
    return this.target?.input ?? null
  }

  /** Show the keyboard for `target`, appended to `container`. */
  attach(target: OskTarget, container: Element) {
    this.target = target
    this.el?.remove()
    this.el = null
    container.append(this.render())
    target.input.focus()
  }

  /** Hide the keyboard and forget the target. */
  detach() {
    this.el?.remove()
    this.el = null
    this.target = null
  }

  /** The keyboard is inside a subtree that is being rebuilt; re-show it there. */
  reattach(container: Element) {
    if (!this.target) return
    this.el?.remove()
    this.el = null
    container.append(this.render())
  }

  /** The rows the cursor walks: the target's extras first when it has them, then the letters. */
  private rows(): string[] {
    const ex = this.target?.extras
    return ex && ex.length ? [ex.map((e) => e.ch).join(''), ...OSK_ROWS] : OSK_ROWS
  }

  private render(): HTMLElement {
    const el = h('div', { class: 'osk', 'data-client': '1' })
    const keys = h('div', { class: 'keys' })
    const ex = this.target?.extras
    if (ex && ex.length) {
      const row = h('div', { class: 'extras' })
      ex.forEach((e, c) => {
        const k = h('div', { class: 'key extra' + (this.row === 0 && c === this.col ? ' focused' : '') }, h('b', null, e.ch), ' ' + e.label)
        k.addEventListener('click', () => this.type(e.ch))
        row.append(k)
      })
      el.append(row)
    }
    // one element per row, so a row of keys is a row on screen whatever the widths,
    // and the cursor's up and down stay in their column
    OSK_ROWS.forEach((row, r0) => {
      const r = ex && ex.length ? r0 + 1 : r0
      const line = h('div', { class: 'row' })
      for (let c = 0; c < row.length; c++) {
        const ch = this.shift ? row[c].toUpperCase() : row[c]
        const k = h('div', { class: 'key' + (r === this.row && c === this.col ? ' focused' : '') }, ch === ' ' ? '␣' : ch)
        k.addEventListener('click', () => this.type(ch))
        line.append(k)
      }
      keys.append(line)
    })
    const input = this.target?.input
    const value = input ? (input.type === 'password' ? '•'.repeat(input.value.length) : input.value) : ''
    el.prepend(h('div', { class: 'preview' }, value || ' '))
    el.append(keys, this.hintLine())
    this.el = el
    return el
  }

  private redraw() {
    const old = this.el
    if (!old) return
    const fresh = this.render()
    old.replaceWith(fresh)
  }

  private type(ch: string) {
    const t = this.target
    if (!t) return
    if (t.special && t.special(ch)) return
    const input = t.input
    if (input.maxLength > 0 && input.value.length >= input.maxLength && input.selectionStart === input.selectionEnd) return
    const s = input.selectionStart ?? input.value.length
    const e = input.selectionEnd ?? s
    input.setRangeText(ch, s, e, 'end')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    this.redraw()
  }

  private backspace() {
    const t = this.target
    if (!t) return
    const input = t.input
    const s = input.selectionStart ?? input.value.length
    const e = input.selectionEnd ?? s
    if (s !== e) input.setRangeText('', s, e, 'end')
    else if (s > 0) input.setRangeText('', s - 1, s, 'end')
    else return
    input.dispatchEvent(new Event('input', { bubbles: true }))
    this.redraw()
  }

  /** Run one keyboard operation. Returns false when nothing is attached. */
  op(op: OskOp, dir?: Dir8): boolean {
    const t = this.target
    if (!t) return false
    switch (op) {
      case 'move': {
        if (dir === undefined) break
        const rows = this.rows()
        const dy = [-1, -1, 0, 1, 1, 1, 0, -1][dir]
        const dx = [0, 1, 1, 1, 0, -1, -1, -1][dir]
        this.row = (this.row + dy + rows.length) % rows.length
        const len = rows[this.row].length
        // left and right wrap along the row; up and down keep the column, clamped to
        // a shorter row's end (the extras row is four keys wide, the letters twelve)
        if (dx) this.col = (this.col + dx + len) % len
        else this.col = Math.min(this.col, len - 1)
        this.redraw()
        break
      }
      case 'type': {
        const rows = this.rows()
        const ch = rows[this.row][this.col]
        // an extra is sent as it is; a letter follows the shift
        this.type(this.shift && rows !== OSK_ROWS && this.row === 0 ? ch : this.shift ? ch.toUpperCase() : ch)
        break
      }
      case 'backspace':
        this.backspace()
        break
      case 'space':
        this.type(' ')
        break
      case 'shift':
        this.shift = !this.shift
        this.redraw()
        break
      case 'submit':
        t.submit()
        break
      case 'cancel':
        t.cancel()
        break
    }
    return true
  }
}

