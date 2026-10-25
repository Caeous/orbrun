/**
 * A finger's swipe across the view turns it whole headings (`swipeTurn`
 * step). While it is down the view turns with it at one steady pace, the
 * dungeon staying under the finger (`swipeView`); lifted, it goes on to the
 * next heading the way it was turning once it is a little past the last and
 * the finger went a real swipe (`swipeRest`), so a short swipe turns 45°, a
 * long drag turns about, and a drag back where it came down turns nothing.
 * How many headings is the distance alone. The lift's speed only lets a
 * flick too short to count by itself turn 45°, if it would coast past a real
 * swipe as a phone's scroll view carries a flick (fling.ts PROJECT_S), and
 * sets how quickly the view gets there (camera.ts endLean).
 */

import { PROJECT_S } from './fling'

/** css px a finger moves before it is a drag at all (look-drag.ts TOUCH_SLOP): the view stands still under a tap */
const SLOP_PX = 8
/** css px across a finger takes the view one heading, 45°, where the lens is not known (game.ts passes the lens's own, so the dungeon stays under the finger) */
export const SWIPE_HEADING_PX = 70
/** how far past a heading, in headings, the view has to be as it lifts to go on to the next */
export const SWIPE_ON = 0.25
/** css px across a finger has to go, or flicked coast, before it turns at all as it lifts: a deliberate swipe, not a finger that barely moved */
export const SWIPE_FIRST_PX = 40
/** headings one drag turns at most: about */
export const SWIPE_MAX = 4

/** The headings the view stands turned with the finger `dx` css px across from where it came down, signed the finger's way. */
export function swipeView(dx: number, headingPx = SWIPE_HEADING_PX): number {
  const a = Math.max(0, Math.abs(dx) - SLOP_PX)
  return Math.sign(dx) * Math.min(SWIPE_MAX, a / headingPx)
}

/** The headings the finger `dx` css px across, lifting at `speed` css px a millisecond (signed as `dx`), turns the view. */
export function swipeRest(dx: number, headingPx = SWIPE_HEADING_PX, speed = 0): number {
  // a finger that never got past the slop was a tap, however it lifted
  if (Math.abs(dx) < SLOP_PX) return 0
  if (Math.abs(dx) < SWIPE_FIRST_PX) {
    // short, it is a swipe only flicked on the way it went
    const coast = dx + speed * PROJECT_S * 1000
    return Math.sign(coast) === Math.sign(dx) && Math.abs(coast) >= SWIPE_FIRST_PX ? Math.sign(dx) : 0
  }
  const v = swipeView(dx, headingPx)
  // a real swipe is always at least a heading, however slow the lens's pace
  return Math.sign(dx) * Math.min(SWIPE_MAX, Math.max(1, Math.floor(Math.abs(v) + 1 - SWIPE_ON)))
}
