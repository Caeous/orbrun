import { cm, type ClientMessage } from '@orbrun/webtiles'

/**
 * A line crawl reads (a server text prompt, `init_input`), as the official
 * textinput.js keeps it, with no field: which typed characters are hotkeys
 * rather than text, how the line goes back, and the recall of what was sent
 * before. The browser's field and the terminal's line both ask it.
 */

/** What a printable character typed at a prompt does: joins the line, ends it with itself, goes as a key, or nothing. */
export type EntryKey = { kind: 'type' } | { kind: 'submit'; final: number } | { kind: 'key'; code: number } | { kind: 'drop' }

/** The prompt as far as its keys go: its tag, and its type (`seed-selection`). */
export interface EntryPrompt {
  tag?: string
  type?: string
}

/** textinput.js: what `ch` does at `prompt`, the line holding `text` so far. */
export function entryKey(prompt: EntryPrompt, ch: string, text: string): EntryKey {
  const code = ch.charCodeAt(0)
  switch (prompt.tag) {
    case 'stash_search':
      return ch === '?' && text.length === 0 ? { kind: 'key', code } : { kind: 'type' }
    case 'repeat':
      return /^\d$/.test(ch) ? { kind: 'type' } : { kind: 'submit', final: code }
    case 'travel_depth':
      return '<>?$^-p'.includes(ch) ? { kind: 'submit', final: code } : { kind: 'type' }
    case 'skill_target':
      return ch === '-' ? { kind: 'submit', final: code } : { kind: 'type' }
  }
  if (prompt.type === 'seed-selection') {
    // '-' clears, '?' helps, 'd' picks the daily seed; anything but a digit is refused (keyfunc on the crawl side)
    if (ch === '-' || ch === '?' || ch === 'd') return { kind: 'key', code }
    if (!/^\d$/.test(ch)) return { kind: 'drop' }
  }
  return { kind: 'type' }
}

/**
 * The line sent back, ended by `final` (Enter, or the hotkey that ended it): Ctrl-U and Ctrl-K first wipe any
 * prefill on the crawl side, so the text lands whole; `repeat` has none.
 */
export function submitMessages(text: string, tag?: string, final = 13): ClientMessage[] {
  const out = tag !== 'repeat' ? [cm.key(21), cm.key(11)] : []
  out.push(cm.textInput(text + String.fromCharCode(final)))
  return out
}

/** Official textinput.js keeps the last ten entries per historyId (up/down recall). */
const HISTORY_SIZE = 10
const histories: Record<string, string[]> = {}

/** The lines sent at prompts of one `historyId`, oldest first, and a place in them that up and down move. */
export class EntryHistory {
  private lines: string[] | null
  private at: number

  constructor(historyId?: string) {
    this.lines = historyId ? (histories[historyId] ??= []) : null
    this.at = this.lines?.length ?? 0
  }

  /** whether there is a line to recall */
  get has(): boolean {
    return !!this.lines?.length
  }

  /** The line `by` one older (-1) or newer (1), round the ends; null with nothing to recall. */
  recall(by: -1 | 1): string | null {
    const h = this.lines
    if (!h || !h.length) return null
    this.at += by
    if (this.at < 0) this.at = h.length - 1
    if (this.at >= h.length) this.at = 0
    return h[this.at]
  }

  /** `text` was sent: it is the newest line, once. */
  sent(text: string) {
    const h = this.lines
    if (!h || !text.length) return
    const i = h.indexOf(text)
    if (i !== -1) h.splice(i, 1)
    h.push(text)
    if (h.length > HISTORY_SIZE) h.shift()
  }
}
