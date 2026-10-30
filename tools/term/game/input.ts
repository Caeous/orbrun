/**
 * Terminal keys as what a US-layout browser's keydown says of them (the e2e
 * harness's `keyEventInit`, apps/orbrun/test/e2e/client.ts): plain objects
 * the app's key rules read (keys.ts `KeyLike`, which reads `keyCode` first,
 * as the official client reads `which`), so every key means what it does in
 * the browser.
 */
import type { KeyLike } from '../../../apps/orbrun/src/keys'
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

interface Mods {
  shift?: boolean
  ctrl?: boolean
  alt?: boolean
}

function keyLike(key: string, mods: Mods): KeyLike {
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
  return { key, code, keyCode, shiftKey: shift, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, metaKey: false }
}

/** The keys in one read of terminal input. */
export function terminalKeys(data: Buffer | string): KeyLike[] {
  return (parseKeys(data) as { key: string; modifiers?: number }[]).map((k) => {
    const m = k.modifiers ?? 0
    // a shifted letter comes as its capital, with shift already said by the letter
    const key = k.key === 'Space' ? ' ' : k.key
    return keyLike(key, { alt: !!(m & 1), ctrl: !!(m & 2), shift: !!(m & 8) && !/^[A-Z]$/.test(key) })
  })
}
