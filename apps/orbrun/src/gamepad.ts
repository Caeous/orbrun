import type { Dir8 } from '@orbrun/scene'

/**
 * Gamepad polling -> PadEvent stream. W3C standard mapping.
 */

export type Button = 'A' | 'B' | 'X' | 'Y' | 'LB' | 'RB' | 'LT' | 'RT' | 'SELECT' | 'START' | 'L3' | 'R3' | 'DU' | 'DD' | 'DL' | 'DR' | 'HOME'

const BUTTON_INDEX: Button[] = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'SELECT', 'START', 'L3', 'R3', 'DU', 'DD', 'DL', 'DR', 'HOME']

export type PadEvent =
  | { type: 'press'; button: Button; t: number }
  | { type: 'release'; button: Button; t: number; held: number }
  | { type: 'repeat'; button: Button; n: number }
  | { type: 'dir'; source: 'dpad' | 'lstick'; dir: Dir8 | null }
  | { type: 'dirRepeat'; source: 'dpad' | 'lstick'; dir: Dir8; n: number }
  /** `start`: true on the first frame of a deflection; false on the frames that follow and on the settle to 0,0 */
  | { type: 'look'; dx: number; dy: number; start?: boolean }

/**
 * Whether an event is the player choosing the controller: a button going
 * down, or a stick or the d-pad being pushed. A connection, a release or a
 * centred stick is not, and neither is the continuation of something already
 * counted (a held button's repeats, a held direction's repeats, the frames of
 * a look after its first): a stick that rests off centre, or a key typed
 * while the stick is still pushed, must not keep the prompts in pad glyphs
 * against a keyboard that spoke since (game.ts `inputFrom`).
 */
export function isPadActivity(ev: PadEvent): boolean {
  return ev.type === 'press' || (ev.type === 'dir' && ev.dir !== null) || (ev.type === 'look' && ev.start === true)
}

export interface GamepadOptions {
  deadzoneL?: number
  enterL?: number
  leaveL?: number
  deadzoneR?: number
  /** Right stick starts a look only past this; it keeps looking down to deadzoneR. */
  enterR?: number
  repeatDelay?: number
  repeatInterval?: number
  buttonRepeatDelay?: number
  buttonRepeatInterval?: number
}

/**
 * Whose button names the glyphs use. There is no Steam Deck kind: Steam
 * Input hands a browser a virtual Xbox 360 pad whatever is in the player's
 * hands, and the Deck's own labels are Xbox's letters anyway, so a Deck is
 * an Xbox pad here.
 */
export type PadKind = 'xbox' | 'playstation' | 'nintendo' | 'generic'

/** The kind each pad id was read as: the id is matched once, not every frame the pad is polled. */
const kindOf = new Map<string, PadKind>()
function detectKind(id: string): PadKind {
  let kind = kindOf.get(id)
  if (kind === undefined) {
    if (kindOf.size > 32) kindOf.clear()
    kindOf.set(id, (kind = matchKind(id)))
  }
  return kind
}
function matchKind(id: string): PadKind {
  const s = id.toLowerCase()
  if (/xbox|xinput|045e|valve|steam/.test(s)) return 'xbox'
  if (/playstation|dualshock|dualsense|054c|sony/.test(s)) return 'playstation'
  if (/nintendo|switch|057e|pro controller/.test(s)) return 'nintendo'
  return 'generic'
}

export class GamepadInput {
  private pressed = new Map<Button, number>()
  private repeatState = new Map<Button, { next: number; n: number }>()
  private dpadDir: Dir8 | null = null
  private stickDir: Dir8 | null = null
  private dirRepeat = new Map<'dpad' | 'lstick', { next: number; n: number }>()
  private opts: Required<GamepadOptions>
  private listeners = new Set<(e: PadEvent) => void>()
  private lastActive = -1
  /** Each pad's axes as first seen, keyed by id and index: what "at rest" means for that pad. */
  private rest = new Map<string, readonly number[]>()
  kind: PadKind = 'generic'
  connected = false
  private looking = false

  constructor(opts: GamepadOptions = {}) {
    this.opts = {
      deadzoneL: opts.deadzoneL ?? 0.25,
      enterL: opts.enterL ?? 0.55,
      leaveL: opts.leaveL ?? 0.4,
      deadzoneR: opts.deadzoneR ?? 0.15,
      enterR: opts.enterR ?? 0.3,
      repeatDelay: opts.repeatDelay ?? 350,
      repeatInterval: opts.repeatInterval ?? 90,
      // A held button repeats at the cadence a held key does, since what it repeats is
      // autofight, which the keyboard plays by leaning on Tab (bindings.ts `repeatsHeld`):
      // macOS's own defaults, 25 and 6 ticks of a 60Hz clock, are 417ms then every 100ms.
      buttonRepeatDelay: opts.buttonRepeatDelay ?? 420,
      buttonRepeatInterval: opts.buttonRepeatInterval ?? 100,
    }
  }

  on(fn: (e: PadEvent) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(e: PadEvent) {
    for (const l of this.listeners) l(e)
  }

  isHeld(b: Button): boolean {
    return this.pressed.has(b) || this.virtual.has(b)
  }

  /**
   * Buttons a key is standing in for (`installPadKeys`), kept apart from the
   * real pad's: `poll` reads a connected pad's buttons as the whole truth and
   * would release them on the next frame.
   */
  private virtual = new Map<Button, number>()

  /** Press a button as if the pad had. The key's auto-repeat is dropped by the caller, so a held key is one long press. */
  virtualDown(b: Button, now = performance.now()) {
    if (this.virtual.has(b)) return
    this.virtual.set(b, now)
    this.emit({ type: 'press', button: b, t: now })
  }

  virtualUp(b: Button, now = performance.now()) {
    const t0 = this.virtual.get(b)
    if (t0 === undefined) return
    this.virtual.delete(b)
    this.emit({ type: 'release', button: b, t: now, held: now - t0 })
  }

  /** Let go of every stand-in button (the window lost focus, and its keyup will never come). */
  virtualRelease() {
    for (const b of [...this.virtual.keys()]) this.virtualUp(b)
  }

  /** Whether the right stick is deflected (camera is being steered). */
  get isLooking(): boolean {
    return this.looking
  }

  /** Call every animation frame. */
  poll(now: number) {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []
    let pad: Gamepad | null = null
    // most recently active pad is primary
    for (const p of pads) {
      if (!p) continue
      if (this.lastActive === p.index) pad = p
    }
    if (!pad) for (const p of pads) if (p) pad = pad || p
    // An axis counts as moved against where that pad's axis rested when first seen, not
    // against 0: an unmapped pad (a Steam Deck's external controller as Chrome sees the raw
    // device) rests its triggers at -1, and would otherwise be "active" every frame and
    // take the primary from the pad actually in use. When several wake on the same frame,
    // as Steam Input's virtual pad and its raw twin do, the standard-mapped one wins.
    let woke: Gamepad | null = null
    for (const p of pads) {
      if (!p) continue
      let rest = this.rest.get(p.id + p.index)
      if (!rest) this.rest.set(p.id + p.index, (rest = p.axes.slice()))
      const active = p.buttons.some((b) => b.pressed) || p.axes.some((a, i) => Math.abs(a - (rest[i] ?? 0)) > 0.5)
      if (active && (!woke || (woke.mapping !== 'standard' && p.mapping === 'standard'))) woke = p
    }
    if (woke) {
      this.lastActive = woke.index
      pad = woke
    }
    this.connected = !!pad
    if (!pad) return
    this.kind = detectKind(pad.id)
    const { buttons, axes } = standardView(pad)
    // buttons
    for (let i = 0; i < BUTTON_INDEX.length && i < buttons.length; i++) {
      const b = BUTTON_INDEX[i]
      const down = buttons[i]
      const was = this.pressed.has(b)
      if (down && !was) {
        this.pressed.set(b, now)
        this.repeatState.set(b, { next: now + this.opts.buttonRepeatDelay, n: 0 })
        this.emit({ type: 'press', button: b, t: now })
      } else if (!down && was) {
        const t0 = this.pressed.get(b) ?? now
        this.pressed.delete(b)
        this.repeatState.delete(b)
        this.emit({ type: 'release', button: b, t: now, held: now - t0 })
      } else if (down) {
        const r = this.repeatState.get(b)
        if (r && now >= r.next) {
          r.n++
          r.next = now + this.opts.buttonRepeatInterval
          this.emit({ type: 'repeat', button: b, n: r.n })
        }
      }
    }
    // dpad as direction
    const du = this.pressed.has('DU')
    const dd = this.pressed.has('DD')
    const dl = this.pressed.has('DL')
    const dr = this.pressed.has('DR')
    const dx = (dr ? 1 : 0) - (dl ? 1 : 0)
    const dy = (dd ? 1 : 0) - (du ? 1 : 0)
    const newDpad = dx === 0 && dy === 0 ? null : dirFromDelta(dx, dy)
    if (newDpad !== this.dpadDir) {
      this.dpadDir = newDpad
      this.emit({ type: 'dir', source: 'dpad', dir: newDpad })
      if (newDpad !== null) this.dirRepeat.set('dpad', { next: now + this.opts.repeatDelay, n: 0 })
      else this.dirRepeat.delete('dpad')
    } else if (newDpad !== null) {
      const r = this.dirRepeat.get('dpad')
      if (r && now >= r.next) {
        r.next = now + this.opts.repeatInterval
        r.n++
        this.emit({ type: 'dirRepeat', source: 'dpad', dir: newDpad, n: r.n })
      }
    }
    // left stick 8-way with hysteresis
    const lx = axes[0] || 0
    const ly = axes[1] || 0
    const mag = Math.hypot(lx, ly)
    let newStick: Dir8 | null = this.stickDir
    if (this.stickDir === null) {
      if (mag >= this.opts.enterL) newStick = sectorOf(lx, ly)
    } else {
      if (mag < this.opts.leaveL) newStick = null
      else {
        // switch sector only when the stick is clearly inside the new one: a
        // forward push that wobbles across the 22.5° edge must not turn into a
        // diagonal, then back, restarting the repeat delay each time
        const s = sectorOf(lx, ly, SECTOR_MARGIN)
        if (s !== null && s !== this.stickDir && mag >= this.opts.enterL) newStick = s
      }
    }
    if (newStick !== this.stickDir) {
      this.stickDir = newStick
      this.emit({ type: 'dir', source: 'lstick', dir: newStick })
      if (newStick !== null) this.dirRepeat.set('lstick', { next: now + this.opts.repeatDelay, n: 0 })
      else this.dirRepeat.delete('lstick')
    } else if (newStick !== null) {
      const r = this.dirRepeat.get('lstick')
      if (r && now >= r.next) {
        r.next = now + this.opts.repeatInterval
        r.n++
        this.emit({ type: 'dirRepeat', source: 'lstick', dir: newStick, n: r.n })
      }
    }
    // right stick look, with hysteresis like the left stick: a worn stick
    // resting a little off centre must not steer the camera, nor count as the
    // pad speaking every frame (game.ts `pad`), which would keep the prompts
    // in pad glyphs while the player is on the keyboard
    const rx = axes[2] || 0
    const ry = axes[3] || 0
    const rm = Math.hypot(rx, ry)
    if (rm > (this.looking ? this.opts.deadzoneR : this.opts.enterR)) {
      const k = ((rm - this.opts.deadzoneR) / (1 - this.opts.deadzoneR)) ** 2
      const start = !this.looking
      this.looking = true
      this.emit({ type: 'look', dx: (rx / rm) * k, dy: (ry / rm) * k, start })
    } else if (this.looking) {
      this.looking = false
      this.emit({ type: 'look', dx: 0, dy: 0 })
    }
  }
}

/** Standard-layout slot (index into BUTTON_INDEX) of each raw button, by raw index; -1 is a gap. */
// Linux xpad (a wired Xbox pad, or Steam's virtual one when the browser gets it raw):
// A B X Y LB RB Back Start Guide L3 R3; axes LX LY LT RX RY RT, then the hat
const XPAD_BUTTONS = [0, 1, 2, 3, 4, 5, 8, 9, 16, 10, 11]
// Linux HID (an Xbox pad over Bluetooth): A B _ X Y _ LB RB _ _ Back Start Guide L3 R3;
// axes LX LY RX RY RT LT, then the hat
const BT_BUTTONS = [0, 1, -1, 2, 3, -1, 4, 5, -1, -1, 8, 9, 16, 10, 11]

/**
 * A pad's buttons (down or not, in BUTTON_INDEX order) and its sticks (LX LY RX RY)
 * in the standard layout. The browser maps the pads it knows; one it does not (an Xbox
 * pad on a Steam Deck, read raw) comes in the order Linux lists its controls, with the
 * triggers on axes resting at -1 and the d-pad as a hat on the two axes after the rest.
 */
export function standardView(pad: Gamepad): { buttons: boolean[]; axes: number[] } {
  const raw = pad.buttons.map((b) => b.pressed || b.value > 0.5)
  if (pad.mapping === 'standard') return { buttons: raw, axes: pad.axes.slice(0, 4) }
  const bt = pad.buttons.length >= BT_BUTTONS.length
  const xpad = !bt && pad.buttons.length === XPAD_BUTTONS.length
  if (!bt && !xpad) {
    // an unknown layout: its buttons as they come, the d-pad from a hat if it has one
    const buttons = raw.slice()
    if (pad.axes.length >= 8) hat(buttons, pad.axes[6], pad.axes[7])
    return { buttons, axes: pad.axes.slice(0, 4) }
  }
  const buttons: boolean[] = new Array(BUTTON_INDEX.length).fill(false)
  const slots = bt ? BT_BUTTONS : XPAD_BUTTONS
  slots.forEach((slot, i) => { if (slot >= 0 && raw[i]) buttons[slot] = true })
  const a = pad.axes
  const trigger = (v: number | undefined) => v !== undefined && v > 0.2
  buttons[6] = buttons[6] || trigger(bt ? a[5] : a[2])
  buttons[7] = buttons[7] || trigger(bt ? a[4] : a[5])
  if (a.length >= 8) hat(buttons, a[6], a[7])
  return { buttons, axes: bt ? [a[0], a[1], a[2], a[3]] : [a[0], a[1], a[3], a[4]] }
}

function hat(buttons: boolean[], hx: number, hy: number) {
  buttons[12] = buttons[12] || hy < -0.5
  buttons[13] = buttons[13] || hy > 0.5
  buttons[14] = buttons[14] || hx < -0.5
  buttons[15] = buttons[15] || hx > 0.5
}

function dirFromDelta(dx: number, dy: number): Dir8 {
  const table: Record<string, Dir8> = { '0,-1': 0, '1,-1': 1, '1,0': 2, '1,1': 3, '0,1': 4, '-1,1': 5, '-1,0': 6, '-1,-1': 7 }
  return table[`${dx},${dy}`] ?? 0
}

/**
 * Angular hysteresis, in sectors (1 = 45°): a held stick changes sector only
 * once it is this far past the boundary. 0.2 is 9°, so a sector is entered
 * from within ±13.5° of its centre and kept up to ±22.5°.
 */
const SECTOR_MARGIN = 0.2

/**
 * The 8-way sector of a deflection, angle 0 = up (north), clockwise. With a
 * `margin`, null when the stick sits within that many sectors of a boundary.
 */
function sectorOf(x: number, y: number, margin = 0): Dir8 | null {
  const a = Math.atan2(x, -y) / (Math.PI / 4)
  const q = Math.round(a)
  if (Math.abs(a - q) > 0.5 - margin) return null
  return (((q % 8) + 8) % 8) as Dir8
}

/** Optional keyboard stand-ins for testing controller menus. Native Crawl punctuation stays untouched. */
const PAD_KEYS: Record<string, Button> = { F1: 'RB', F2: 'SELECT' }

/** Wire PAD_KEYS to `pad` on the window; returns the undo. */
export function installPadKeys(pad: GamepadInput): () => void {
  const down = (ev: KeyboardEvent) => {
    const b = PAD_KEYS[ev.code]
    if (!b || !ev.shiftKey || ev.ctrlKey || ev.altKey || ev.metaKey) return
    ev.preventDefault()
    ev.stopImmediatePropagation()
    if (ev.repeat) return
    pad.virtualDown(b)
  }
  // shift may be let go first, so the release goes by the key alone
  const up = (ev: KeyboardEvent) => {
    const b = PAD_KEYS[ev.code]
    if (!b) return
    ev.stopImmediatePropagation()
    pad.virtualUp(b)
  }
  const blur = () => pad.virtualRelease()
  window.addEventListener('keydown', down, true)
  window.addEventListener('keyup', up, true)
  window.addEventListener('blur', blur)
  return () => {
    window.removeEventListener('keydown', down, true)
    window.removeEventListener('keyup', up, true)
    window.removeEventListener('blur', blur)
  }
}
