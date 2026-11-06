/** What kind of screen the client is on, where there is a window to ask; with none (a terminal), a computer's. */

/** A phone: a finger for a pointer, on a screen no more than `PHONE_SIDE` css px across its short side (not a tablet, nor a Steam Deck). */
const PHONE_SIDE = 600
export function isPhone(): boolean {
  if (typeof window === 'undefined') return false
  if (!(window.matchMedia?.('(pointer: coarse)').matches ?? false)) return false
  return Math.min(window.screen?.width || Infinity, window.screen?.height || Infinity) < PHONE_SIDE
}

/** Held upright: a phone taller than it is wide (console.ts `isPortrait`, near enough before there is a grid). */
export function upright(): boolean {
  return isPhone() && window.innerHeight > window.innerWidth
}
