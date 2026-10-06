/**
 * Where a finger's turn of the view comes to rest when it lifts. The drag
 * follows the finger as it goes; letting go goes on to the next heading the
 * way the finger was going, as a swipe turns a grid crawler on a phone,
 * rather than back to whichever heading happens to be nearest. A flick
 * carries the turn on by its speed (the resting point is projected from the
 * release velocity, as iOS pages a scroll view), and a finger pulling back
 * as it lifts is let go back.
 */

/** one heading of the eight, in radians */
export const HEADING = Math.PI / 4
/** how long a release's speed carries on, in seconds: where the view would come to rest if it coasted (UIScrollView's fast deceleration, 0.99 a millisecond) */
const PROJECT_S = 0.099
/** a finger moving back faster than this as it lifts (radians a second) is pulling the turn back */
const PULL_BACK = 0.6
/** the most headings one swipe turns: an about-turn */
const MAX_STEPS = 4

/**
 * The headings a lifted drag turns by, from the heading it set off from:
 * `at` radians the view stands from that heading as the finger lifts,
 * `turned` radians of that the finger itself turned, `speed` its release
 * speed in radians a second, `commit` the radians past which a drag means
 * the next heading. Positive is the way yaw grows. `at` and `turned` part
 * when a drag catches a turn still easing in: a second swipe on the heels of
 * the first goes on a heading further, not back to the nearest.
 */
export function releaseSteps(at: number, turned: number, speed: number, commit: number): number {
  let n = Math.round((at + speed * PROJECT_S) / HEADING)
  const way = Math.sign(turned)
  // a finger that set off one way and is not coming back means the next heading that way
  if (way !== 0 && Math.abs(turned) >= commit && speed * way > -PULL_BACK && n * way < 1) n = way
  return Math.max(-MAX_STEPS, Math.min(MAX_STEPS, n))
}

/** how far back a release's speed is read, in ms (Android's VelocityTracker horizon) */
const HORIZON_MS = 100
/** a finger that has not moved for this long before lifting has stopped (Android's ASSUME_POINTER_STOPPED_TIME) */
const STOPPED_MS = 40

/** A finger's recent positions along one axis, for its speed as it lifts. */
export class VelocityTracker {
  private samples: { t: number; v: number }[] = []

  add(t: number, v: number) {
    this.samples.push({ t, v })
    while (this.samples.length > 2 && t - this.samples[0].t > HORIZON_MS) this.samples.shift()
  }

  /** Units a millisecond at `now`: a least-squares slope over the horizon, 0 once the finger stood still. */
  speed(now: number): number {
    const s = this.samples.filter((p) => now - p.t <= HORIZON_MS)
    if (s.length < 2 || now - s[s.length - 1].t > STOPPED_MS) return 0
    const t0 = s[0].t
    let n = 0, st = 0, sv = 0, stt = 0, stv = 0
    for (const p of s) {
      const t = p.t - t0
      n++
      st += t
      sv += p.v
      stt += t * t
      stv += t * p.v
    }
    const den = n * stt - st * st
    return den > 0 ? (n * stv - st * sv) / den : 0
  }
}
