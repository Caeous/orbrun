import { describe, expect, it } from 'vitest'
import { SWIPE_MIN, swipeStep } from '../src/swipe'

describe('swipeStep', () => {
  it('pulls the next one in: a swipe left is Right, a swipe right is Left', () => {
    expect(swipeStep(-SWIPE_MIN, 0)).toBe(1)
    expect(swipeStep(SWIPE_MIN, 0)).toBe(-1)
  })
  it('a short slide, or a scroll that drifts sideways, is no swipe', () => {
    expect(swipeStep(SWIPE_MIN - 1, 0)).toBe(0)
    expect(swipeStep(60, 40)).toBe(0)
    expect(swipeStep(-80, 30)).toBe(1)
  })
})
