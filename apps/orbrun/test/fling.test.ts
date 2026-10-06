import { describe, expect, it } from 'vitest'
import { HEADING, VelocityTracker, detent, detentSlope, releaseSteps, undetent } from '../src/fling'

const C = HEADING / 6

describe('releaseSteps', () => {
  it('a drag past the commit goes on to the next heading the way it went', () => {
    expect(releaseSteps(C, C, 0, C)).toBe(1)
    expect(releaseSteps(-C, -C, 0, C)).toBe(-1)
  })
  it('a nudge under the commit goes back', () => {
    expect(releaseSteps(C / 2, C / 2, 0, C)).toBe(0)
  })
  it('a finger pulling back lets the turn go back', () => {
    expect(releaseSteps(2 * C, 2 * C, -2, C)).toBe(0)
  })
  it('a slow drag past a heading stays on the nearest', () => {
    expect(releaseSteps(1.3 * HEADING, 1.3 * HEADING, 0, C)).toBe(1)
    expect(releaseSteps(1.6 * HEADING, 1.6 * HEADING, 0, C)).toBe(2)
  })
  it('a flick turns one heading: only the distance dragged makes it two', () => {
    expect(releaseSteps(HEADING / 2, HEADING / 2, 12, C)).toBe(1)
    expect(releaseSteps(-HEADING / 2, -HEADING / 2, -200, C)).toBe(-1)
    expect(releaseSteps(1.2 * HEADING, 1.2 * HEADING, 200, C)).toBe(1)
    expect(releaseSteps(-1.2 * HEADING, -1.2 * HEADING, -200, C)).toBe(-1)
  })
  it('a finger pulling back off a long drag lets go of the second heading, not the first', () => {
    expect(releaseSteps(1.6 * HEADING, 1.6 * HEADING, -20, C)).toBe(1)
    expect(releaseSteps(-1.6 * HEADING, -1.6 * HEADING, 20, C)).toBe(-1)
  })
  it('a swipe that catches a turn still easing in goes on from where that turn was headed', () => {
    expect(releaseSteps(-0.6 * HEADING, C, 0, C)).toBe(1)
    expect(releaseSteps(-0.9 * HEADING, -C, 0, C)).toBe(-1)
  })
})

describe('detent', () => {
  it('keeps whole headings where they are and always goes the finger’s way', () => {
    for (const n of [-2, -1, 0, 1, 2]) expect(detent(n)).toBeCloseTo(n)
    for (let u = -2; u < 2; u += 0.01) expect(detent(u + 0.01)).toBeGreaterThan(detent(u))
  })
  it('lingers on a heading and hurries between', () => {
    expect(detentSlope(0)).toBeCloseTo(1)
    expect(detentSlope(1)).toBeLessThan(1)
    expect(detentSlope(-1)).toBeLessThan(1)
    expect(detentSlope(0.5)).toBeGreaterThan(1)
    expect(detent(0.9)).toBeGreaterThan(0.94)
  })
  it('its slope is the curve’s', () => {
    for (let u = -2; u < 2; u += 0.137) expect(detentSlope(u)).toBeCloseTo((detent(u + 1e-6) - detent(u - 1e-6)) / 2e-6, 5)
  })
  it('undetent finds the finger’s turn back', () => {
    for (const v of [-1.7, -0.3, 0, 0.25, 0.8, 1.5]) expect(detent(undetent(v))).toBeCloseTo(v, 9)
  })
})

describe('VelocityTracker', () => {
  it('reads a steady finger’s speed over its last moves', () => {
    const v = new VelocityTracker()
    for (let t = 0; t <= 200; t += 8) v.add(t, t * 0.5)
    expect(v.speed(200)).toBeCloseTo(0.5)
  })
  it('a finger that stood still before lifting has no speed', () => {
    const v = new VelocityTracker()
    for (let t = 0; t <= 100; t += 8) v.add(t, t)
    expect(v.speed(96 + 50)).toBe(0)
  })
  it('one sample is no speed', () => {
    const v = new VelocityTracker()
    v.add(0, 10)
    expect(v.speed(0)).toBe(0)
  })
})
