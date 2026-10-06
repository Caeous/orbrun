/**
 * Where a finger's turn of the view comes to rest when it lifts. A turn is
 * mostly one heading, 45°, and now and then two: the finger says which by how
 * far it went, which it sees under it as it goes, not by how fast it lifts,
 * which it cannot judge. Any swipe past the commit goes on to the next heading
 * the way it went, as a swipe turns a grid crawler on a phone; one dragged on
 * toward the second rests on whichever the view stands nearest. The speed it
 * lifts at only lets a finger pulling back as it lifts go back, never carries
 * the turn a heading further.
 */

/** one heading of the eight, in radians */
export const HEADING = Math.PI / 4
/** how long a release's speed carries on, in seconds: where the view would come to rest if it coasted (UIScrollView's fast deceleration, 0.99 a millisecond) */
const PROJECT_S = 0.099
/** a finger moving back faster than this as it lifts (radians a second) is pulling the turn back */
const PULL_BACK = 0.6

/**
 * The headings a lifted drag turns by, from the heading it set off from:
 * `at` radians the view stands from that heading as the finger lifts,
 * `turned` radians the finger itself turned, `speed` its release speed in
 * radians a second, `commit` the radians past which a drag means the next
 * heading. Positive is the way yaw grows. `at` and `turned` part when a drag
 * catches a turn still easing in (a second swipe on the heels of the first
 * goes on a heading further, not back to the nearest), and under the detents
 * (`detent`), which `at` has been through and `turned` has not.
 */
export function releaseSteps(at: number, turned: number, speed: number, commit: number): number {
  const h = at / HEADING
  const near = Math.round(h)
  const way = Math.sign(turned)
  // the speed may let the turn back to the heading short of where the finger left the view, never on past the nearest
  let n = Math.max(Math.floor(h), Math.min(near, Math.round(h + (speed * PROJECT_S) / HEADING)))
  if (way < 0) n = Math.min(Math.ceil(h), Math.max(near, Math.round(h + (speed * PROJECT_S) / HEADING)))
  // a finger that set off one way and is not coming back means the next heading that way
  if (way !== 0 && Math.abs(turned) >= commit && speed * way > -PULL_BACK && n * way < 1) n = way
  return n
}

/** how much a finger's turn slows over a heading: 0 is none, 1 stops it there (`detent`) */
const DETENT = 0.5

/**
 * A finger's turn, in headings, as the view shows it: the view lingers on
 * each heading and hurries between them, so a swipe meant for 45° sits on it
 * and two take a deliberate drag on. Smooth, and always going the finger's
 * way (its slope is 1 − DETENT at a heading, 1 + DETENT halfway); a whole
 * number of headings is the same either side.
 */
export function detent(u: number): number {
  return u - (DETENT * Math.sin(2 * Math.PI * u)) / (2 * Math.PI)
}

/** How fast `detent` goes at `u`, against the finger. */
export function detentSlope(u: number): number {
  return 1 - DETENT * Math.cos(2 * Math.PI * u)
}

/** The finger's turn the view shows as `v` headings (`detent`'s inverse). */
export function undetent(v: number): number {
  let u = v
  for (let i = 0; i < 8; i++) u -= (detent(u) - v) / detentSlope(u)
  return u
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
