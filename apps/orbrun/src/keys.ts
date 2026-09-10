import { Keys, cm, type ClientMessage } from '@orbrun/webtiles'

/**
 * Keyboard -> WebTiles messages, reproducing the official client's rules
 * (webserver/static/scripts/client.js `handle_keydown` / `handle_keypress`
 * and key_conversion.js), plus detection of direction keys so game.ts can
 * rewrite them as facing-relative movement in command / targeting modes.
 *
 * The official client keys everything off the legacy `e.which` (keyCode),
 * with numpad digits normalised to 96..105 by `e.code`. We use `keyCode` when
 * the browser gives one and derive it from `key` otherwise (synthetic events,
 * tests), so the messages come out identical.
 */

type RelDir = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 // 0 = forward, clockwise

export interface DirKey {
  rel: RelDir
  mod: 'none' | 'shift' | 'ctrl'
}

/** The subset of KeyboardEvent the encoder reads; plain objects work for tests. */
export interface KeyLike {
  key: string
  code: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
  keyCode?: number
}

/** vim / numpad / arrow keys mapped to absolute compass directions (N=0). */
const VIM: Record<string, number> = { k: 0, u: 1, l: 2, n: 3, j: 4, b: 5, h: 6, y: 7 }
const NUMPAD: Record<string, number> = { Numpad8: 0, Numpad9: 1, Numpad6: 2, Numpad3: 3, Numpad2: 4, Numpad1: 5, Numpad4: 6, Numpad7: 7 }
const ARROWS: Record<string, number> = { ArrowUp: 0, ArrowRight: 2, ArrowDown: 4, ArrowLeft: 6 }

/**
 * Returns the absolute direction a key means, or null if it is not a
 * direction key. Numpad keys are recognised by `code`, so NumLock does not
 * matter, and Ctrl / Shift ride along as the attack / run variants (Ctrl wins
 * when both are held, as in `mod`'s priority). Alt / Meta combos are not
 * directions and pass through to keydownMessage untouched.
 */
export function directionKey(e: KeyLike): { abs: number; mod: DirKey['mod'] } | null {
  if (e.altKey || e.metaKey) return null
  const mod: DirKey['mod'] = e.ctrlKey ? 'ctrl' : e.shiftKey ? 'shift' : 'none'
  if (e.code in NUMPAD) return { abs: NUMPAD[e.code], mod }
  if (e.key in ARROWS) return { abs: ARROWS[e.key], mod }
  if (e.key.length === 1) {
    const k = e.key.toLowerCase()
    if (k in VIM) {
      // A capital letter without Shift (CapsLock) is still the run variant,
      // as it would be in the official client where `K` is "run north".
      const upper = e.key !== k
      return { abs: VIM[k], mod: e.ctrlKey ? 'ctrl' : e.shiftKey || upper ? 'shift' : 'none' }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// key_conversion.js tables, keyed by `which` (keyCode)

/** key_conversion.simple: unmodified keys handled on keydown. */
const SIMPLE: Record<number, number> = {
  27: 27, // Escape
  8: 8, // Backspace
  9: 9, // Tab
  46: Keys.CK_DELETE,
  45: Keys.CK_INSERT,
  35: Keys.CK_END,
  40: Keys.CK_DOWN,
  34: Keys.CK_PGDN,
  37: Keys.CK_LEFT,
  12: Keys.CK_CLEAR,
  39: Keys.CK_RIGHT,
  36: Keys.CK_HOME,
  38: Keys.CK_UP,
  33: Keys.CK_PGUP,
}

/** Builds the shift / ctrl / ctrlshift tables, which share one layout. */
function modTable(
  k: Record<'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'INSERT' | 'HOME' | 'END' | 'CLEAR' | 'PGUP' | 'PGDN' | 'ENTER' | 'BKSP' | 'ESCAPE' | 'DELETE' | 'SPACE', number>,
): Record<number, number> {
  return {
    // Numpad / Arrow keys
    45: k.INSERT,
    35: k.END,
    40: k.DOWN,
    34: k.PGDN,
    37: k.LEFT,
    12: k.CLEAR,
    39: k.RIGHT,
    36: k.HOME,
    38: k.UP,
    33: k.PGUP,
    // Numpad on mac / with numlock: converted to modified navigation keys
    97: k.END,
    98: k.DOWN,
    99: k.PGDN,
    100: k.LEFT,
    102: k.RIGHT,
    103: k.HOME,
    104: k.UP,
    105: k.PGUP,
    13: k.ENTER,
    8: k.BKSP,
    27: k.ESCAPE,
    46: k.DELETE,
    32: k.SPACE,
  }
}

/** key_conversion.shift (Shift+Tab is the one entry the others lack). */
const SHIFT: Record<number, number> = {
  9: Keys.CK_SHIFT_TAB,
  ...modTable({
    UP: Keys.CK_SHIFT_UP,
    DOWN: Keys.CK_SHIFT_DOWN,
    LEFT: Keys.CK_SHIFT_LEFT,
    RIGHT: Keys.CK_SHIFT_RIGHT,
    INSERT: Keys.CK_SHIFT_INSERT,
    HOME: Keys.CK_SHIFT_HOME,
    END: Keys.CK_SHIFT_END,
    CLEAR: Keys.CK_SHIFT_CLEAR,
    PGUP: Keys.CK_SHIFT_PGUP,
    PGDN: Keys.CK_SHIFT_PGDN,
    ENTER: Keys.CK_SHIFT_ENTER,
    BKSP: Keys.CK_SHIFT_BKSP,
    ESCAPE: Keys.CK_SHIFT_ESCAPE,
    DELETE: Keys.CK_SHIFT_DELETE,
    SPACE: Keys.CK_SHIFT_SPACE,
  }),
}

/** key_conversion.ctrl */
const CTRL: Record<number, number> = modTable({
  UP: Keys.CK_CTRL_UP,
  DOWN: Keys.CK_CTRL_DOWN,
  LEFT: Keys.CK_CTRL_LEFT,
  RIGHT: Keys.CK_CTRL_RIGHT,
  INSERT: Keys.CK_CTRL_INSERT,
  HOME: Keys.CK_CTRL_HOME,
  END: Keys.CK_CTRL_END,
  CLEAR: Keys.CK_CTRL_CLEAR,
  PGUP: Keys.CK_CTRL_PGUP,
  PGDN: Keys.CK_CTRL_PGDN,
  ENTER: Keys.CK_CTRL_ENTER,
  BKSP: Keys.CK_CTRL_BKSP,
  ESCAPE: Keys.CK_CTRL_ESCAPE,
  DELETE: Keys.CK_CTRL_DELETE,
  SPACE: Keys.CK_CTRL_SPACE,
})

/** key_conversion.ctrlshift (no Tab entry: Ctrl+Shift+Tab stays with the browser). */
const CTRLSHIFT: Record<number, number> = modTable({
  UP: Keys.CK_CTRL_SHIFT_UP,
  DOWN: Keys.CK_CTRL_SHIFT_DOWN,
  LEFT: Keys.CK_CTRL_SHIFT_LEFT,
  RIGHT: Keys.CK_CTRL_SHIFT_RIGHT,
  INSERT: Keys.CK_CTRL_SHIFT_INSERT,
  HOME: Keys.CK_CTRL_SHIFT_HOME,
  END: Keys.CK_CTRL_SHIFT_END,
  CLEAR: Keys.CK_CTRL_SHIFT_CLEAR,
  PGUP: Keys.CK_CTRL_SHIFT_PGUP,
  PGDN: Keys.CK_CTRL_SHIFT_PGDN,
  ENTER: Keys.CK_CTRL_SHIFT_ENTER,
  BKSP: Keys.CK_CTRL_SHIFT_BKSP,
  ESCAPE: Keys.CK_CTRL_SHIFT_ESCAPE,
  DELETE: Keys.CK_CTRL_SHIFT_DELETE,
  SPACE: Keys.CK_CTRL_SHIFT_SPACE,
})

/**
 * key_conversion.codes: unmodified keys by `e.code` (checked before SIMPLE).
 * F11 (fullscreen) is reserved for the browser. F12 focuses chat, as in the
 * official client; the game screen handles it before keys reach here.
 */
const CODES: Record<string, number> = {
  Delete: Keys.CK_DELETE,
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

/** key_conversion.captured_control_keys: Ctrl+these are sent as `which - 64`. */
const CAPTURED_CTRL = 'OQFPWATXSGIDEHJKLYUBNCM1234567890'

// ---------------------------------------------------------------------------
// keyCode recovery

/** keyCode values for the named keys the tables above use. */
const KEY_WHICH: Record<string, number> = {
  Backspace: 8,
  Tab: 9,
  Clear: 12,
  Enter: 13,
  Escape: 27,
  ' ': 32,
  PageUp: 33,
  PageDown: 34,
  End: 35,
  Home: 36,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Insert: 45,
  Delete: 46,
}

/**
 * The `e.which` the official client would see: the browser's keyCode when
 * present, otherwise derived from `key`; then the official numpad
 * normalisation (a digit keyCode with a Numpad code becomes 96..105).
 */
export function whichOf(e: KeyLike): number {
  let which = e.keyCode || 0
  if (!which) {
    if (e.key in KEY_WHICH) which = KEY_WHICH[e.key]
    else if (/^F\d{1,2}$/.test(e.key)) which = 111 + Number(e.key.slice(1))
    else if (e.key.length === 1) which = e.key.toUpperCase().charCodeAt(0)
  }
  if (which >= 48 && which <= 57 && /^Numpad\d$/.test(e.code)) which = 96 + Number(e.code.slice(6))
  return which
}

/**
 * Convert a keydown into the message the official client would send, or null
 * if the browser should keep the key. The official client sends printable
 * characters from the keypress that follows an unhandled keydown; we do not
 * listen for keypress, so that step is folded in here (`e.key` is the same
 * character keypress would report, CapsLock and layout included).
 */
export function keydownMessage(e: KeyLike): ClientMessage | null {
  const which = whichOf(e)
  if (e.ctrlKey && !e.shiftKey && !e.altKey) {
    if (which in CTRL) return cm.key(CTRL[which])
    if (CAPTURED_CTRL.includes(String.fromCharCode(which))) return cm.key(which - 64)
    return null
  }
  if (!e.ctrlKey && e.shiftKey && !e.altKey) {
    if (which in SHIFT) return cm.key(SHIFT[which])
  } else if (e.ctrlKey && e.shiftKey && !e.altKey) {
    return which in CTRLSHIFT ? cm.key(CTRLSHIFT[which]) : null
  } else if (!e.ctrlKey && !e.shiftKey && e.altKey) {
    return which < 32 ? null : cm.inputBytes([27, which])
  } else if (!e.ctrlKey && !e.shiftKey && !e.altKey) {
    if (e.key === 'F12' || e.code === 'F12') return null // chat, handled by the game screen as in the official client
    if (e.code in CODES) return cm.key(CODES[e.code])
    if (which in SIMPLE) return cm.key(SIMPLE[which])
  }
  // keypress: skipped for Ctrl or Alt unless both are held (AltGr), and when
  // the browser would not fire it (Meta held, non-printable keys).
  if ((e.ctrlKey || e.altKey) && !(e.ctrlKey && e.altKey)) return null
  if (e.metaKey) return null
  if (e.key === 'Enter') return cm.input('\r')
  if (e.key.length !== 1) return null
  if (e.key === '{') return cm.inputBytes([123])
  return cm.input(e.key)
}

/**
 * A field the keys belong to: the chat line, a menu filter, the seed box.
 * A button is not one. The browser leaves a clicked button focused, so a test
 * as broad as "any `input`" costs the keyboard the screen it just clicked on —
 * the save-transfer dialog's buttons (overlays.ts, `show_dialog`) among them.
 */
export function isTextEntry(el: HTMLElement): boolean {
  if (el instanceof HTMLTextAreaElement || el.isContentEditable) return true
  if (!(el instanceof HTMLInputElement)) return false
  return !['button', 'submit', 'reset', 'checkbox', 'radio'].includes(el.type)
}
