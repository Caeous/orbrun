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
  | { type: 'look'; dx: number; dy: number }

/** A connection, release or centred stick is not a choice to use the controller. */
export function isPadActivity(ev: PadEvent): boolean {
  return ev.type === 'press' || ev.type === 'repeat' || ((ev.type === 'dir' || ev.type === 'dirRepeat') && ev.dir !== null) || (ev.type === 'look' && (ev.dx !== 0 || ev.dy !== 0))
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
}

export type PadKind = 'xbox' | 'playstation' | 'nintendo' | 'steamdeck' | 'generic'

function detectKind(id: string): PadKind {
  const s = id.toLowerCase()
  if (/valve|steam/.test(s)) return 'steamdeck'
  if (/xbox|xinput|045e/.test(s)) return 'xbox'
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
    for (const p of pads) {
      if (!p) continue
      const active = p.buttons.some((b) => b.pressed) || p.axes.some((a) => Math.abs(a) > 0.5)
      if (active) {
        this.lastActive = p.index
        pad = p
      }
    }
    this.connected = !!pad
    if (!pad) return
    this.kind = detectKind(pad.id)
    // buttons
    for (let i = 0; i < BUTTON_INDEX.length && i < pad.buttons.length; i++) {
      const b = BUTTON_INDEX[i]
      const down = pad.buttons[i].pressed || pad.buttons[i].value > 0.5
      const was = this.pressed.has(b)
      if (down && !was) {
        this.pressed.set(b, now)
        this.repeatState.set(b, { next: now + this.opts.repeatDelay, n: 0 })
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
          r.next = now + this.opts.repeatInterval
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
    const lx = pad.axes[0] || 0
    const ly = pad.axes[1] || 0
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
    const rx = pad.axes[2] || 0
    const ry = pad.axes[3] || 0
    const rm = Math.hypot(rx, ry)
    if (rm > (this.looking ? this.opts.deadzoneR : this.opts.enterR)) {
      const k = ((rm - this.opts.deadzoneR) / (1 - this.opts.deadzoneR)) ** 2
      this.looking = true
      this.emit({ type: 'look', dx: (rx / rm) * k, dy: (ry / rm) * k })
    } else if (this.looking) {
      this.looking = false
      this.emit({ type: 'look', dx: 0, dy: 0 })
    }
  }
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
