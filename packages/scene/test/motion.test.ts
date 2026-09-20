import { describe, it, expect } from 'vitest'
import { MAX_STEP_SECONDS, STEP_SECONDS, StepCadence, planStep, sampleStep } from '../src/motion.js'

describe('confirmed movement cadence', () => {
  it('starts at 100 ms, then leaves a small bounded margin for late replies', () => {
    const c = new StepCadence()
    expect(c.confirm(0)).toEqual({ duration: STEP_SECONDS, continuous: false })
    const repeated = c.confirm(0.1)
    expect(repeated.continuous).toBe(true)
    expect(repeated.duration).toBeCloseTo(0.12)
    expect(c.confirm(0.23).duration).toBeCloseTo(0.1275)
    for (let i = 1; i < 20; i++) c.confirm(0.23 + i * 0.2)
    expect(c.confirm(4.23).duration).toBe(MAX_STEP_SECONDS)
  })

  it('ignores coalesced arrivals and resets after a stall or explicit snap', () => {
    const c = new StepCadence()
    c.confirm(0)
    c.confirm(0.12)
    expect(c.confirm(0.12).duration).toBeCloseTo(0.14)
    expect(c.confirm(0.121).duration).toBeCloseTo(0.14)
    expect(c.confirm(1)).toEqual({ duration: STEP_SECONDS, continuous: false })
    c.confirm(1.1)
    c.reset()
    expect(c.confirm(1.2)).toEqual({ duration: STEP_SECONDS, continuous: false })
  })
})

describe('finite movement curves', () => {
  it('keeps an isolated step snappy, but continuing steps move later into their duration', () => {
    const isolated = planStep(1, STEP_SECONDS, undefined, false)
    const continuous = planStep(1, STEP_SECONDS, undefined, true)
    expect(sampleStep(isolated, 0.05).distance).toBeCloseTo(0.875)
    expect(sampleStep(continuous, 0.075).speed).toBeGreaterThan(sampleStep(isolated, 0.075).speed)
    expect(sampleStep(continuous, 0.075).distance).toBeLessThan(0.9)
  })

  it.each([false, true])('is monotone, velocity-continuous and stops exactly (continuous=%s)', (continuous) => {
    for (const duration of [STEP_SECONDS, MAX_STEP_SECONDS]) {
      for (const length of [0.01, 1, 2, 20]) {
        for (const start of [0, length / duration, 3 * length / duration]) {
          const curve = planStep(length, duration, start, continuous)
          expect(sampleStep(curve, 0)).toEqual({ distance: 0, speed: start })
          let previous = 0
          for (let i = 1; i < 1000; i++) {
            const elapsed = duration * i / 1000
            const s = sampleStep(curve, elapsed)
            expect(s.distance).toBeGreaterThanOrEqual(previous)
            expect(s.distance).toBeLessThanOrEqual(length)
            expect(s.speed).toBeGreaterThanOrEqual(0)
            const epsilon = 1e-8
            const numericalSpeed = (sampleStep(curve, elapsed + epsilon).distance - sampleStep(curve, elapsed - epsilon).distance) / (2 * epsilon)
            expect(s.speed).toBeCloseTo(numericalSpeed, 4)
            previous = s.distance
          }
          expect(sampleStep(curve, duration)).toEqual({ distance: length, speed: 0 })
          expect(sampleStep(curve, 100)).toEqual({ distance: length, speed: 0 })
        }
      }
    }
  })
})
