import { describe, it, expect } from 'vitest'
import { Keys, cm } from '@orbrun/webtiles'
import { keydownMessage, directionKey, whichOf, type KeyLike } from '../src/keys'

// ---------------------------------------------------------------------------
// The official tables, transcribed from
// crawl-ref/source/webserver/static/scripts/key_conversion.js (keyed by
// e.which). CK_* values come from protocol.ts, which mirrors cio.h.

const K = Keys
const simple: Record<number, number> = {
  27: 27,
  8: 8,
  9: 9,
  46: K.CK_DELETE,
  45: K.CK_INSERT,
  35: K.CK_END,
  40: K.CK_DOWN,
  34: K.CK_PGDN,
  37: K.CK_LEFT,
  12: K.CK_CLEAR,
  39: K.CK_RIGHT,
  36: K.CK_HOME,
  38: K.CK_UP,
  33: K.CK_PGUP,
}
const shift: Record<number, number> = {
  9: K.CK_SHIFT_TAB,
  45: K.CK_SHIFT_INSERT,
  35: K.CK_SHIFT_END,
  40: K.CK_SHIFT_DOWN,
  34: K.CK_SHIFT_PGDN,
  37: K.CK_SHIFT_LEFT,
  12: K.CK_SHIFT_CLEAR,
  39: K.CK_SHIFT_RIGHT,
  36: K.CK_SHIFT_HOME,
  38: K.CK_SHIFT_UP,
  33: K.CK_SHIFT_PGUP,
  97: K.CK_SHIFT_END,
  98: K.CK_SHIFT_DOWN,
  99: K.CK_SHIFT_PGDN,
  100: K.CK_SHIFT_LEFT,
  102: K.CK_SHIFT_RIGHT,
  103: K.CK_SHIFT_HOME,
  104: K.CK_SHIFT_UP,
  105: K.CK_SHIFT_PGUP,
  13: K.CK_SHIFT_ENTER,
  8: K.CK_SHIFT_BKSP,
  27: K.CK_SHIFT_ESCAPE,
  46: K.CK_SHIFT_DELETE,
  32: K.CK_SHIFT_SPACE,
}
const ctrl: Record<number, number> = {
  45: K.CK_CTRL_INSERT,
  35: K.CK_CTRL_END,
  40: K.CK_CTRL_DOWN,
  34: K.CK_CTRL_PGDN,
  37: K.CK_CTRL_LEFT,
  12: K.CK_CTRL_CLEAR,
  39: K.CK_CTRL_RIGHT,
  36: K.CK_CTRL_HOME,
  38: K.CK_CTRL_UP,
  33: K.CK_CTRL_PGUP,
  97: K.CK_CTRL_END,
  98: K.CK_CTRL_DOWN,
  99: K.CK_CTRL_PGDN,
  100: K.CK_CTRL_LEFT,
  102: K.CK_CTRL_RIGHT,
  103: K.CK_CTRL_HOME,
  104: K.CK_CTRL_UP,
  105: K.CK_CTRL_PGUP,
  13: K.CK_CTRL_ENTER,
  8: K.CK_CTRL_BKSP,
  27: K.CK_CTRL_ESCAPE,
  46: K.CK_CTRL_DELETE,
  32: K.CK_CTRL_SPACE,
}
const ctrlshift: Record<number, number> = {
  45: K.CK_CTRL_SHIFT_INSERT,
  35: K.CK_CTRL_SHIFT_END,
  40: K.CK_CTRL_SHIFT_DOWN,
  34: K.CK_CTRL_SHIFT_PGDN,
  37: K.CK_CTRL_SHIFT_LEFT,
  12: K.CK_CTRL_SHIFT_CLEAR,
  39: K.CK_CTRL_SHIFT_RIGHT,
  36: K.CK_CTRL_SHIFT_HOME,
  38: K.CK_CTRL_SHIFT_UP,
  33: K.CK_CTRL_SHIFT_PGUP,
  97: K.CK_CTRL_SHIFT_END,
  98: K.CK_CTRL_SHIFT_DOWN,
  99: K.CK_CTRL_SHIFT_PGDN,
  100: K.CK_CTRL_SHIFT_LEFT,
  102: K.CK_CTRL_SHIFT_RIGHT,
  103: K.CK_CTRL_SHIFT_HOME,
  104: K.CK_CTRL_SHIFT_UP,
  105: K.CK_CTRL_SHIFT_PGUP,
  13: K.CK_CTRL_SHIFT_ENTER,
  8: K.CK_CTRL_SHIFT_BKSP,
  27: K.CK_CTRL_SHIFT_ESCAPE,
  46: K.CK_CTRL_SHIFT_DELETE,
  32: K.CK_CTRL_SHIFT_SPACE,
}
const codes: Record<string, number> = {
  Delete: K.CK_DELETE,
  Numpad0: -1000,
  Numpad1: -1001,
  Numpad2: -1002,
  Numpad3: -1003,
  Numpad4: -1004,
  Numpad5: -1005,
  Numpad6: -1006,
  Numpad7: -1007,
  Numpad8: -1008,
  Numpad9: -1009,
  NumpadEnter: -1010,
  NumpadDivide: -1012,
  NumpadMultiply: -1015,
  NumpadAdd: -1016,
  NumpadSubtract: -1018,
  NumpadDecimal: -1019,
  NumpadEqual: -1021,
  F1: -265,
  F2: -266,
  F3: -267,
  F4: -268,
  F5: -269,
  F6: -270,
  F7: -271,
  F8: -272,
  F9: -273,
  F10: -274,
  F13: -277,
  F14: -278,
  F15: -279,
  F16: -280,
  F17: -281,
  F18: -282,
  F19: -283,
}
const capturedControlKeys = [
  'O', 'Q', 'F', 'P', 'W', 'A', 'T', 'X', 'S', 'G', 'I', 'D', 'E',
  'H', 'J', 'K', 'L', 'Y', 'U', 'B', 'N', 'C', 'M',
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '0',
]

// ---------------------------------------------------------------------------
// cio.h layout sanity: the table values must line up with the enum

describe('Keys layout matches cio.h', () => {
  it('has the documented anchors', () => {
    expect(K.CK_DELETE).toBe(-255)
    expect(K.CK_UP).toBe(-254)
    expect(K.CK_SHIFT_UP).toBe(K.CK_UP + 11)
    expect(K.CK_CTRL_UP).toBe(K.CK_SHIFT_UP + 11)
    expect(K.CK_CTRL_SHIFT_UP).toBe(K.CK_CTRL_UP + 11)
    expect(K.CK_CTRL_SHIFT_TAB).toBe(K.CK_CTRL_SHIFT_UP + 10)
    // five placeholders (ENTER, BKSP, ESCAPE, DELETE, SPACE) follow CK_CTRL_SHIFT_TAB
    expect(K.CK_SHIFT_ENTER).toBe(K.CK_CTRL_SHIFT_TAB + 6)
    expect(K.CK_CTRL_ENTER).toBe(K.CK_SHIFT_ENTER + 5)
    expect(K.CK_CTRL_SHIFT_ENTER).toBe(K.CK_CTRL_ENTER + 5)
    expect(K.CK_CTRL_SHIFT_SPACE).toBe(K.CK_CTRL_SHIFT_ENTER + 4)
  })
})

// ---------------------------------------------------------------------------
// synthetic events

/** `key` / `code` a browser reports for a given keyCode (numpad digits: numlock on). */
const WHICH_KEY: Record<number, [key: string, code: string]> = {
  8: ['Backspace', 'Backspace'],
  9: ['Tab', 'Tab'],
  12: ['Clear', 'NumLock'],
  13: ['Enter', 'Enter'],
  27: ['Escape', 'Escape'],
  32: [' ', 'Space'],
  33: ['PageUp', 'PageUp'],
  34: ['PageDown', 'PageDown'],
  35: ['End', 'End'],
  36: ['Home', 'Home'],
  37: ['ArrowLeft', 'ArrowLeft'],
  38: ['ArrowUp', 'ArrowUp'],
  39: ['ArrowRight', 'ArrowRight'],
  40: ['ArrowDown', 'ArrowDown'],
  45: ['Insert', 'Insert'],
  46: ['Delete', 'Delete'],
  97: ['1', 'Numpad1'],
  98: ['2', 'Numpad2'],
  99: ['3', 'Numpad3'],
  100: ['4', 'Numpad4'],
  102: ['6', 'Numpad6'],
  103: ['7', 'Numpad7'],
  104: ['8', 'Numpad8'],
  105: ['9', 'Numpad9'],
}

type Mods = Partial<Pick<KeyLike, 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>>

function ev(key: string, code = key, mods: Mods = {}, keyCode?: number): KeyLike {
  return { key, code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, keyCode, ...mods }
}

/** An event as the browser would deliver it for keyCode `which`, with and without keyCode. */
function evFor(which: number, mods: Mods = {}, withKeyCode = true): KeyLike {
  const named = WHICH_KEY[which]
  const [key, code] = named ?? [String.fromCharCode(which).toLowerCase(), '']
  // a browser reports the digit keyCode for numpad digits; the official
  // client rewrites it to 96..105 from `code`, and so must we
  const reported = which >= 97 && which <= 105 ? which - 48 : which
  return ev(key, code, mods, withKeyCode ? reported : undefined)
}

function table(name: string, t: Record<number, number>, mods: Mods) {
  describe(name, () => {
    for (const [w, expected] of Object.entries(t)) {
      const which = Number(w)
      it(`which ${which} -> ${expected}`, () => {
        expect(keydownMessage(evFor(which, mods))).toEqual(cm.key(expected))
        expect(keydownMessage(evFor(which, mods, false))).toEqual(cm.key(expected))
      })
    }
  })
}

table('key_conversion.simple', simple, {})
table('key_conversion.shift', shift, { shiftKey: true })
table('key_conversion.ctrl', ctrl, { ctrlKey: true })
table('key_conversion.ctrlshift', ctrlshift, { ctrlKey: true, shiftKey: true })

describe('key_conversion.codes', () => {
  for (const [code, expected] of Object.entries(codes)) {
    it(`${code} -> ${expected}`, () => {
      // key is what a numlock-on / plain keyboard reports; keyCode is whatever
      const key = code.startsWith('Numpad') && /\d$/.test(code) ? code.slice(-1) : code === 'Delete' ? 'Delete' : code
      expect(keydownMessage(ev(key, code))).toEqual(cm.key(expected))
    })
  }
  it('numpad digits map by code whether NumLock is on or off', () => {
    expect(keydownMessage(ev('ArrowUp', 'Numpad8', {}, 38))).toEqual(cm.key(-1008))
    expect(keydownMessage(ev('8', 'Numpad8', {}, 104))).toEqual(cm.key(-1008))
  })
  it('F11 and F12 stay with the browser (fullscreen / chat)', () => {
    expect(keydownMessage(ev('F11', 'F11', {}, 122))).toBeNull()
    expect(keydownMessage(ev('F12', 'F12', {}, 123))).toBeNull()
  })
  it('F20+ is not mapped', () => {
    expect(keydownMessage(ev('F20', 'F20'))).toBeNull()
  })
})

describe('captured control keys', () => {
  for (const c of capturedControlKeys) {
    it(`Ctrl+${c} -> ${c.charCodeAt(0) - 64}`, () => {
      const e = ev(c.toLowerCase(), /\d/.test(c) ? `Digit${c}` : `Key${c}`, { ctrlKey: true }, c.charCodeAt(0))
      expect(keydownMessage(e)).toEqual(cm.key(c.charCodeAt(0) - 64))
      expect(keydownMessage({ ...e, keyCode: undefined })).toEqual(cm.key(c.charCodeAt(0) - 64))
    })
  }
  it('Ctrl+R / Ctrl+V / Ctrl+Z are left to the browser', () => {
    for (const c of ['R', 'V', 'Z']) expect(keydownMessage(ev(c.toLowerCase(), `Key${c}`, { ctrlKey: true }))).toBeNull()
  })
  it('Ctrl+Shift+letter, Ctrl+Tab and Ctrl+Shift+Tab send nothing', () => {
    expect(keydownMessage(ev('A', 'KeyA', { ctrlKey: true, shiftKey: true }))).toBeNull()
    expect(keydownMessage(ev('Tab', 'Tab', { ctrlKey: true }))).toBeNull()
    expect(keydownMessage(ev('Tab', 'Tab', { ctrlKey: true, shiftKey: true }))).toBeNull()
  })
  it('Ctrl+numpad digit with NumLock on is the Ctrl navigation key, not a digit', () => {
    expect(keydownMessage(ev('8', 'Numpad8', { ctrlKey: true }, 56))).toEqual(cm.key(K.CK_CTRL_UP))
    expect(keydownMessage(ev('0', 'Numpad0', { ctrlKey: true }, 48))).toBeNull()
    expect(keydownMessage(ev('5', 'Numpad5', { ctrlKey: true }, 53))).toBeNull()
  })
  it('Ctrl+punctuation is not captured', () => {
    expect(keydownMessage(ev('-', 'Minus', { ctrlKey: true }, 189))).toBeNull()
    expect(keydownMessage(ev('=', 'Equal', { ctrlKey: true }, 187))).toBeNull()
  })
})

describe('alt', () => {
  it('sends ESC + which for letters (uppercase keyCode)', () => {
    expect(keydownMessage(ev('a', 'KeyA', { altKey: true }))).toEqual(cm.inputBytes([27, 65]))
    expect(keydownMessage(ev('a', 'KeyA', { altKey: true }, 65))).toEqual(cm.inputBytes([27, 65]))
  })
  it('sends ESC + which for any key with which >= 32', () => {
    expect(keydownMessage(ev('ArrowUp', 'ArrowUp', { altKey: true }))).toEqual(cm.inputBytes([27, 38]))
    expect(keydownMessage(ev(' ', 'Space', { altKey: true }))).toEqual(cm.inputBytes([27, 32]))
    expect(keydownMessage(ev('F1', 'F1', { altKey: true }))).toEqual(cm.inputBytes([27, 112]))
    expect(keydownMessage(ev('1', 'Digit1', { altKey: true }))).toEqual(cm.inputBytes([27, 49]))
  })
  it('sends nothing for which < 32 or with Shift / Ctrl added', () => {
    expect(keydownMessage(ev('Tab', 'Tab', { altKey: true }))).toBeNull()
    expect(keydownMessage(ev('Escape', 'Escape', { altKey: true }))).toBeNull()
    expect(keydownMessage(ev('Enter', 'Enter', { altKey: true }))).toBeNull()
    expect(keydownMessage(ev('A', 'KeyA', { altKey: true, shiftKey: true }))).toBeNull()
    expect(keydownMessage(ev('ArrowUp', 'ArrowUp', { altKey: true, ctrlKey: true }))).toBeNull()
  })
})

describe('keypress (printable characters)', () => {
  it('sends the character as typed, CapsLock and layout included', () => {
    expect(keydownMessage(ev('a', 'KeyA'))).toEqual(cm.input('a'))
    expect(keydownMessage(ev('A', 'KeyA', { shiftKey: true }))).toEqual(cm.input('A'))
    expect(keydownMessage(ev('A', 'KeyA'))).toEqual(cm.input('A')) // CapsLock
    expect(keydownMessage(ev('!', 'Digit1', { shiftKey: true }, 49))).toEqual(cm.input('!'))
    expect(keydownMessage(ev('é', 'Semicolon', {}, 186))).toEqual(cm.input('é'))
    expect(keydownMessage(ev(' ', 'Space'))).toEqual(cm.input(' '))
  })
  it('sends { as raw bytes', () => {
    expect(keydownMessage(ev('{', 'BracketLeft', { shiftKey: true }, 219))).toEqual(cm.inputBytes([123]))
  })
  it('Enter comes from keypress as \\r', () => {
    expect(keydownMessage(ev('Enter', 'Enter'))).toEqual(cm.input('\r'))
  })
  it('AltGr (Ctrl+Alt) characters go through', () => {
    expect(keydownMessage(ev('@', 'KeyQ', { ctrlKey: true, altKey: true }))).toEqual(cm.input('@'))
  })
  it('modifier-only, dead and Meta keys send nothing', () => {
    expect(keydownMessage(ev('Shift', 'ShiftLeft', { shiftKey: true }))).toBeNull()
    expect(keydownMessage(ev('Dead', 'Quote'))).toBeNull()
    expect(keydownMessage(ev('a', 'KeyA', { metaKey: true }))).toBeNull()
  })
  it('Meta does not block keydown-table keys (the official client never checks it)', () => {
    expect(keydownMessage(ev('ArrowUp', 'ArrowUp', { metaKey: true }))).toEqual(cm.key(K.CK_UP))
  })
  it('Shift+F-keys send nothing on keydown (Orbrun handles Shift+F1 itself)', () => {
    expect(keydownMessage(ev('F1', 'F1', { shiftKey: true }))).toBeNull()
    expect(keydownMessage(ev('F5', 'F5', { shiftKey: true }))).toBeNull()
  })
})

describe('whichOf', () => {
  it('prefers the browser keyCode and normalises numpad digits', () => {
    expect(whichOf(ev(';', 'Semicolon', {}, 186))).toBe(186)
    expect(whichOf(ev('8', 'Numpad8', {}, 56))).toBe(104)
    expect(whichOf(ev('8', 'Digit8', {}, 56))).toBe(56)
    expect(whichOf(ev('ArrowUp', 'Numpad8', {}, 38))).toBe(38)
  })
})

describe('directionKey', () => {
  it('reads numpad by code with any of none / shift / ctrl', () => {
    expect(directionKey(ev('8', 'Numpad8'))).toEqual({ abs: 0, mod: 'none' })
    expect(directionKey(ev('ArrowUp', 'Numpad8'))).toEqual({ abs: 0, mod: 'none' })
    expect(directionKey(ev('8', 'Numpad8', { shiftKey: true }))).toEqual({ abs: 0, mod: 'shift' })
    expect(directionKey(ev('8', 'Numpad8', { ctrlKey: true }))).toEqual({ abs: 0, mod: 'ctrl' })
    expect(directionKey(ev('3', 'Numpad3', { ctrlKey: true }))).toEqual({ abs: 3, mod: 'ctrl' })
    expect(directionKey(ev('5', 'Numpad5'))).toBeNull()
  })
  it('reads arrows and vim keys', () => {
    expect(directionKey(ev('ArrowLeft', 'ArrowLeft', { ctrlKey: true }))).toEqual({ abs: 6, mod: 'ctrl' })
    expect(directionKey(ev('y', 'KeyY'))).toEqual({ abs: 7, mod: 'none' })
    expect(directionKey(ev('J', 'KeyJ', { shiftKey: true }))).toEqual({ abs: 4, mod: 'shift' })
    expect(directionKey(ev('J', 'KeyJ'))).toEqual({ abs: 4, mod: 'shift' }) // CapsLock still runs
    expect(directionKey(ev('k', 'KeyK', { ctrlKey: true }))).toEqual({ abs: 0, mod: 'ctrl' })
  })
  it('ignores Alt / Meta combos and non-direction keys', () => {
    expect(directionKey(ev('k', 'KeyK', { altKey: true }))).toBeNull()
    expect(directionKey(ev('ArrowUp', 'ArrowUp', { metaKey: true }))).toBeNull()
    expect(directionKey(ev('.', 'Period'))).toBeNull()
  })
})
