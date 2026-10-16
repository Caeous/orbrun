import { describe, expect, it } from 'vitest'
import { FLICK_MIN, SWIPE_MIN, swipeLean, swipeStep } from '../src/swipe'

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
  it('a short quick flick is a swipe, a short slow slide is not', () => {
    expect(swipeStep(-FLICK_MIN, 0, 40)).toBe(1)
    expect(swipeStep(FLICK_MIN, 0, 40)).toBe(-1)
    expect(swipeStep(-FLICK_MIN, 0, 300)).toBe(0)
    expect(swipeStep(-(FLICK_MIN - 1), 0, 10)).toBe(0)
    expect(swipeStep(-20, 15, 40)).toBe(0)
  })
})

describe('swipeLean', () => {
  it('leans the way the swipe would turn, whole where letting go turns', () => {
    expect(swipeLean(-SWIPE_MIN / 2, 0)).toBe(0.5)
    expect(swipeLean(SWIPE_MIN / 2, 0)).toBe(-0.5)
    expect(swipeLean(-SWIPE_MIN, 0)).toBe(1)
    expect(swipeLean(-SWIPE_MIN * 3, 0)).toBe(1)
    expect(swipeStep(-SWIPE_MIN, 0)).toBe(1)
  })
  it('a scroll leans nothing', () => {
    expect(swipeLean(30, 40)).toBe(0)
    expect(swipeLean(-60, 40)).toBe(0)
  })
})
