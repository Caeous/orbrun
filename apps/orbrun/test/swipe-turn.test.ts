import { describe, expect, it } from 'vitest'
import { SWIPE_FIRST_PX, SWIPE_HEADING_PX, SWIPE_MAX, SWIPE_ON, swipeRest, swipeView } from '../src/swipe-turn'

const SLOP = 8

describe('a swipe turning the view a heading at a time', () => {
  it('stands still under a tap, then turns at one pace with the finger, either way', () => {
    expect(swipeView(SLOP)).toBe(0)
    expect(swipeView(SLOP + SWIPE_HEADING_PX)).toBeCloseTo(1)
    expect(swipeView(-SLOP - 2 * SWIPE_HEADING_PX)).toBeCloseTo(-2)
    expect(swipeView(SLOP + 10 * SWIPE_HEADING_PX)).toBe(SWIPE_MAX)
  })

  it('takes the pace it is given, the lens’s own, so the dungeon stays under the finger', () => {
    expect(swipeView(SLOP + 280, 280)).toBeCloseTo(1)
    expect(swipeRest(SWIPE_FIRST_PX, 280)).toBe(1)
    expect(swipeRest(SLOP + 280 * 1.3, 280)).toBe(2)
  })

  it('lifted a little past a heading, goes on to the next; barely past, or barely moved, stays', () => {
    const at = (headings: number) => SLOP + headings * SWIPE_HEADING_PX
    expect(swipeRest(SWIPE_FIRST_PX - 1)).toBe(0)
    expect(swipeRest(SWIPE_FIRST_PX)).toBe(1)
    expect(swipeRest(-SWIPE_FIRST_PX)).toBe(-1)
    expect(swipeRest(at(1 + SWIPE_ON - 0.05))).toBe(1)
    expect(swipeRest(at(1 + SWIPE_ON + 0.05))).toBe(2)
    expect(swipeRest(at(1.1))).toBe(1)
    expect(swipeRest(at(1.4))).toBe(2)
    expect(swipeRest(at(10))).toBe(SWIPE_MAX)
  })
})
