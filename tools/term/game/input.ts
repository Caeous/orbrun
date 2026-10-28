/**
 * Terminal keys as the keydown events a US-layout browser fires: the e2e
 * harness's `keyEventInit` (apps/orbrun/test/e2e/client.ts), so every key
 * takes the app's own route (keys.ts reads `keyCode` first, as the official
 * client reads `which`).
 */
// @ts-expect-error: plain JS, shared with the browser bridge
import { parseKeys } from '../keys.mjs'

const US_SYMBOLS: [string, string, string, number][] = [
  ['1', '!', 'Digit1', 49], ['2', '@', 'Digit2', 50], ['3', '#', 'Digit3', 51], ['4', '$', 'Digit4', 52], ['5', '%', 'Digit5', 53],
  ['6', '^', 'Digit6', 54], ['7', '&', 'Digit7', 55], ['8', '*', 'Digit8', 56], ['9', '(', 'Digit9', 57], ['0', ')', 'Digit0', 48],
  ['-', '_', 'Minus', 189], ['=', '+', 'Equal', 187], ['[', '{', 'BracketLeft', 219], [']', '}', 'BracketRight', 221],
  ['\\', '|', 'Backslash', 220], [';', ':', 'Semicolon', 186], ["'", '"', 'Quote', 222], [',', '<', 'Comma', 188],
  ['.', '>', 'Period', 190], ['/', '?', 'Slash', 191], ['`', '~', 'Backquote', 192],
]
const NAMED: Record<string, [string, number]> = {
  Enter: ['Enter', 13], Escape: ['Escape', 27], Tab: ['Tab', 9], Backspace: ['Backspace', 8], ' ': ['Space', 32],
  ArrowUp: ['ArrowUp', 38], ArrowDown: ['ArrowDown', 40], ArrowLeft: ['ArrowLeft', 37], ArrowRight: ['ArrowRight', 39],
  PageUp: ['PageUp', 33], PageDown: ['PageDown', 34], Home: ['Home', 36], End: ['End', 35], Delete: ['Delete', 46], Insert: ['Insert', 45],
}

export interface Mods {
  shift?: boolean
  ctrl?: boolean
  alt?: boolean
}

function keyEventInit(key: string, mods: Mods): KeyboardEventInit & { keyCode: number } {
  let code = key
  let keyCode = 0
  let shift = !!mods.shift
  if (key in NAMED) [code, keyCode] = NAMED[key]
  else if (/^F\d{1,2}$/.test(key)) keyCode = 111 + Number(key.slice(1))
  else if (/^[a-z]$/i.test(key)) {
    code = 'Key' + key.toUpperCase()
    keyCode = key.toUpperCase().charCodeAt(0)
    if (key !== key.toLowerCase()) shift = true
  } else {
    const row = US_SYMBOLS.find((r) => r[0] === key || r[1] === key)
    if (row) {
      code = row[2]
      keyCode = row[3]
      if (row[1] === key) shift = true
    }
  }
  return { key, code, keyCode, shiftKey: shift, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, bubbles: true, cancelable: true }
}

/** The keys in one read of terminal input, as key names and modifiers. */
export function terminalKeys(data: Buffer | string): { key: string; mods: Mods }[] {
  return (parseKeys(data) as { key: string; modifiers?: number }[]).map((k) => {
    const m = k.modifiers ?? 0
    // a shifted letter comes as its capital, with shift already said by the letter
    const key = k.key === 'Space' ? ' ' : k.key
    return { key, mods: { alt: !!(m & 1), ctrl: !!(m & 2), shift: !!(m & 8) && !/^[A-Z]$/.test(key) } }
  })
}

/**
 * Fire `key` at the page as a keydown and a keyup, at the focused element.
 * A browser types into a focused field as the keydown's default action, and
 * happy-dom does not: so an unhandled printable key or Backspace edits the
 * field here, and the field hears an `input` event, as it would.
 */
export function press(key: string, mods: Mods) {
  const init = keyEventInit(key, mods)
  const active = document.activeElement
  const target = active && active !== document.body ? active : window
  for (const type of ['keydown', 'keyup'] as const) {
    const ev = new KeyboardEvent(type, init)
    // happy-dom leaves the legacy field at 0 whatever the init says
    if (ev.keyCode !== init.keyCode) Object.defineProperty(ev, 'keyCode', { value: init.keyCode })
    const go = target.dispatchEvent(ev)
    if (type === 'keydown' && go && !ev.defaultPrevented && (active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA')) typeInto(active as HTMLInputElement, key, mods)
  }
}

function typeInto(input: HTMLInputElement, key: string, mods: Mods) {
  if (mods.ctrl || mods.alt) return
  const v = input.value
  let from = input.selectionStart ?? v.length
  let to = input.selectionEnd ?? v.length
  if (key === 'Backspace') {
    if (from === to) from = Math.max(0, from - 1)
  } else if (key === 'Delete') {
    if (from === to) to = Math.min(v.length, to + 1)
  } else if (key.length !== 1) return
  const text = key.length === 1 ? key : ''
  input.value = v.slice(0, from) + text + v.slice(to)
  const at = from + text.length
  input.setSelectionRange(at, at)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
