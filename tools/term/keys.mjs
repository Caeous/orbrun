/**
 * A terminal's input bytes as key presses for the page: the escape sequences
 * terminals send for arrows, function and editing keys, control characters,
 * and plain text. Each comes back as the DevTools `Input.dispatchKeyEvent`
 * fields for its keydown.
 */

const NAMED = {
  Enter: [13, 'Enter', '\r'],
  Tab: [9, 'Tab', '\t'],
  Backspace: [8, 'Backspace'],
  Escape: [27, 'Escape'],
  ArrowUp: [38, 'ArrowUp'],
  ArrowDown: [40, 'ArrowDown'],
  ArrowLeft: [37, 'ArrowLeft'],
  ArrowRight: [39, 'ArrowRight'],
  Home: [36, 'Home'],
  End: [35, 'End'],
  PageUp: [33, 'PageUp'],
  PageDown: [34, 'PageDown'],
  Insert: [45, 'Insert'],
  Delete: [46, 'Delete'],
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, [112 + i, `F${i + 1}`]])),
}

const SEQ = {
  '[A': 'ArrowUp', '[B': 'ArrowDown', '[C': 'ArrowRight', '[D': 'ArrowLeft',
  OA: 'ArrowUp', OB: 'ArrowDown', OC: 'ArrowRight', OD: 'ArrowLeft',
  '[H': 'Home', '[F': 'End', OH: 'Home', OF: 'End', '[1~': 'Home', '[4~': 'End', '[7~': 'Home', '[8~': 'End',
  '[2~': 'Insert', '[3~': 'Delete', '[5~': 'PageUp', '[6~': 'PageDown',
  OP: 'F1', OQ: 'F2', OR: 'F3', OS: 'F4',
  '[15~': 'F5', '[17~': 'F6', '[18~': 'F7', '[19~': 'F8', '[20~': 'F9', '[21~': 'F10', '[23~': 'F11', '[24~': 'F12',
  '[Z': 'ShiftTab',
}

/** Modifier bits as DevTools counts them. */
const ALT = 1
const CTRL = 2
const SHIFT = 8

function named(name, modifiers = 0) {
  if (name === 'ShiftTab') return named('Tab', SHIFT)
  const [code, key, text] = NAMED[name]
  return { key, code: key, windowsVirtualKeyCode: code, ...(text && !modifiers ? { text } : {}), modifiers }
}

function codeOf(ch) {
  if (/[a-z]/i.test(ch)) return 'Key' + ch.toUpperCase()
  if (/[0-9]/.test(ch)) return 'Digit' + ch
  return { ' ': 'Space', '-': 'Minus', '=': 'Equal', '[': 'BracketLeft', ']': 'BracketRight', '\\': 'Backslash', ';': 'Semicolon', "'": 'Quote', ',': 'Comma', '.': 'Period', '/': 'Slash', '`': 'Backquote' }[ch] ?? ''
}

function printable(ch, modifiers = 0) {
  const upper = /[A-Z]/.test(ch)
  const vk = /[a-z]/i.test(ch) ? ch.toUpperCase().charCodeAt(0) : /[0-9]/.test(ch) ? ch.charCodeAt(0) : 0
  return { key: ch, code: codeOf(ch), windowsVirtualKeyCode: vk, ...(modifiers & (CTRL | ALT) ? {} : { text: ch, unmodifiedText: ch }), modifiers: modifiers | (upper ? SHIFT : 0) }
}

/** The key presses in one read of terminal input. */
export function parseKeys(data) {
  const s = typeof data === 'string' ? data : data.toString('utf8')
  const out = []
  for (let i = 0; i < s.length; ) {
    const c = s[i]
    if (c === '\x1b') {
      if (i + 1 >= s.length) {
        out.push(named('Escape'))
        i++
        continue
      }
      const next = s[i + 1]
      if (next === '[' || next === 'O') {
        // CSI or SS3: parameters, then one final byte
        let j = i + 2
        while (j < s.length && /[0-9;]/.test(s[j])) j++
        const body = s.slice(i + 1, j + 1)
        // xterm's modified keys: ESC [ 1 ; m X, the modifier m - 1 as shift 1, alt 2, ctrl 4
        const mod = /^\[1;(\d)([A-DHF])$/.exec(body)
        if (mod) {
          const m = +mod[1] - 1
          const k = named(SEQ['[' + mod[2]], (m & 1 ? SHIFT : 0) | (m & 2 ? ALT : 0) | (m & 4 ? CTRL : 0))
          out.push(k)
        } else if (SEQ[body]) out.push(named(SEQ[body]))
        i = j + 1
        continue
      }
      // ESC then a key: alt with that key
      const k = parseKeys(next)[0]
      if (k) out.push({ ...k, modifiers: (k.modifiers ?? 0) | ALT, text: undefined, unmodifiedText: undefined })
      i += 2
      continue
    }
    if (c === '\r' || c === '\n') out.push(named('Enter'))
    else if (c === '\t') out.push(named('Tab'))
    else if (c === '\x7f' || c === '\b') out.push(named('Backspace'))
    else if (c < ' ') out.push(printable(String.fromCharCode(c.charCodeAt(0) + 96), CTRL))
    else out.push(printable(c))
    i++
  }
  return out
}
