import { VelocityTracker } from './fling'

/**
 * A press on the view read as a look drag, from down to up, apart from the
 * DOM so it can be tested by itself: it is no drag until it crosses the slop,
 * a finger then turns or tilts by the way it first went, and as it lifts its
 * speed is read for the release (fling.ts). The screen owns what a press that
 * never moved, or a finger held still, does instead.
 */

/** css pixels a mouse moves before a press is a drag, not a click */
export const MOUSE_SLOP = 6
/** css pixels a finger moves before a touch is a drag, not a tap (Android's ViewConfiguration TOUCH_SLOP, 8dp) */
export const TOUCH_SLOP = 8

export interface Sample {
  t: number
  x: number
  y: number
}

export class LookDrag {
  readonly x0: number
  readonly y0: number
  /** where the press is now */
  x: number
  y: number
  /** past the slop: a drag, and no click or tap follows */
  moved = false
  /** a finger's look keeps to the way it set off: across turns, up and down tilts */
  axis?: 'x' | 'y'
  private readonly vx = new VelocityTracker()
  private readonly vy = new VelocityTracker()

  constructor(readonly touch: boolean, at: Sample) {
    this.x0 = this.x = at.x
    this.y0 = this.y = at.y
    this.add(at)
  }

  /**
   * The press moved through `samples` (a pointermove's coalesced events, the
   * last where it is now): the css px it went since the last move, or null
   * while it is still under the slop. The slop it crossed is swallowed, so the
   * view does not jump as the drag starts.
   */
  move(samples: readonly Sample[]): { dx: number; dy: number } | null {
    if (!samples.length) return null
    for (const s of samples) this.add(s)
    const at = samples[samples.length - 1]
    const dx = at.x - this.x
    const dy = at.y - this.y
    this.x = at.x
    this.y = at.y
    if (!this.moved && Math.hypot(at.x - this.x0, at.y - this.y0) < (this.touch ? TOUCH_SLOP : MOUSE_SLOP)) return null
    this.moved = true
    return { dx, dy }
  }

  /** A move's share of the look: a finger turns or tilts, not both, by the way it first went, so a swipe across never leaves the view tipped. */
  look(dx: number, dy: number): { dx: number; dy: number } {
    if (!this.touch) return { dx, dy }
    this.axis ??= Math.abs(this.x - this.x0) >= Math.abs(this.y - this.y0) ? 'x' : 'y'
    return this.axis === 'x' ? { dx, dy: 0 } : { dx: 0, dy }
  }

  /**
   * Its speed as it lifts at `t`, css px a millisecond, kept to its axis. The
   * lift's own position is not a sample: it repeats the last move's (Android's
   * VelocityTracker leaves ACTION_UP out for the same reason), and its time
   * only tells whether the finger had stopped.
   */
  speed(t: number): { vx: number; vy: number } {
    return {
      vx: this.axis === 'y' ? 0 : this.vx.speed(t),
      vy: this.axis === 'x' ? 0 : this.vy.speed(t),
    }
  }

  private add(s: Sample) {
    this.vx.add(s.t, s.x)
    this.vy.add(s.t, s.y)
  }
}
