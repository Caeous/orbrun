import { describe, expect, it } from 'vitest'
import { HEADING, VelocityTracker, releaseSteps } from '../src/fling'

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
  it('a flick carries further, at most an about-turn', () => {
    expect(releaseSteps(HEADING / 2, HEADING / 2, 12, C)).toBe(2)
    expect(releaseSteps(HEADING, HEADING, 200, C)).toBe(4)
  })
  it('a swipe that catches a turn still easing in goes on from where that turn was headed', () => {
    expect(releaseSteps(-0.6 * HEADING, C, 0, C)).toBe(1)
    expect(releaseSteps(-0.9 * HEADING, -C, 0, C)).toBe(-1)
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
