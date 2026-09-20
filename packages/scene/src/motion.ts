/** Presentation timing only: no input buffering or unconfirmed destinations. Times are seconds. */
export const STEP_SECONDS = 0.1
export const MAX_STEP_SECONDS = 0.14
/** Bound catch-up to confirmed grid steps, not a queue of full animations. */
export const MAX_WALK_LAG = 2
/** A longer gap is a fresh step, not a sample of continuous walking. */
const CONTINUOUS_GAP = 0.25
const JITTER_MARGIN = 0.02

/** Measure actual movement arrivals, not render frames or unrelated scene updates. */
export class StepCadence {
  private last: number | undefined
  private interval: number | undefined

  confirm(now: number): { duration: number; continuous: boolean } {
    const gap = this.last === undefined ? Infinity : now - this.last
    this.last = now
    if (gap < 0 || gap > CONTINUOUS_GAP) {
      this.interval = undefined
      return { duration: STEP_SECONDS, continuous: false }
    }
    // Coalesced replies are not evidence that the server's normal cadence is faster.
    if (gap >= 0.025) this.interval = this.interval === undefined ? gap : this.interval * 0.75 + gap * 0.25
    const duration = Math.min(MAX_STEP_SECONDS, Math.max(STEP_SECONDS, (this.interval ?? 0) + JITTER_MARGIN))
    return { duration, continuous: true }
  }

  reset(): void {
    this.last = undefined
    this.interval = undefined
  }
}

export interface StepCurve {
  length: number
  duration: number
  startSpeed: number
  continuous: boolean
}

export function planStep(length: number, duration: number, speed: number | undefined, continuous: boolean): StepCurve {
  return {
    length,
    duration,
    startSpeed: Math.max(0, Math.min(speed ?? (continuous ? 1 : 3) * length / duration, 3 * length / duration)),
    continuous,
  }
}

/** A finite, monotone landing. Its velocity can be carried into the next confirmed step. */
export function sampleStep(curve: StepCurve, elapsed: number): { distance: number; speed: number } {
  const { length, duration, startSpeed: start, continuous } = curve
  if (duration - elapsed < 1e-9) return { distance: length, speed: 0 }
  const t = Math.max(0, elapsed / duration)
  if (!continuous) {
    return {
      distance: length * t * t * (3 - 2 * t) + start * duration * t * (1 - t) ** 2,
      speed: Math.max(0, length * 6 * t * (1 - t) / duration + start * (1 - t) * (1 - 3 * t)),
    }
  }
  // Blend velocity for the first 20%, cruise until 75%, then brake. Unlike a
  // full-step ease-out, this leaves visible motion near the next expected reply.
  // Integrating smoothstep velocity gives exact distance and zero terminal speed.
  const ramp = 0.2
  const brakeAt = 0.75
  const brake = 1 - brakeAt
  const cruise = (length / duration - start * ramp / 2) / (1 - ramp / 2 - brake / 2)
  const smooth = (u: number) => u * u * (3 - 2 * u)
  const integral = (u: number) => u ** 3 - u ** 4 / 2
  let distance: number
  let speed: number
  if (t < ramp) {
    const u = t / ramp
    distance = start * t + (cruise - start) * ramp * integral(u)
    speed = start + (cruise - start) * smooth(u)
  } else if (t < brakeAt) {
    distance = ramp * (start + cruise) / 2 + cruise * (t - ramp)
    speed = cruise
  } else {
    const u = (t - brakeAt) / brake
    distance = ramp * (start + cruise) / 2 + cruise * (brakeAt - ramp) + cruise * brake * (u - integral(u))
    speed = cruise * (1 - smooth(u))
  }
  return { distance: Math.min(length, Math.max(0, distance * duration)), speed: Math.max(0, speed) }
}
