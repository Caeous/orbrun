/**
 * A finger swiped sideways over a screen on top of the map is the d-pad's
 * Left or Right (game.ts presses them), so a tabbed menu (the pack, X's
 * actions, the Orbrun menu) turns its tabs under a swipe as the d-pad turns
 * them, and any other screen does what its Left and Right do. Swiping left
 * pulls the next one in, as a phone turns pages: it is Right.
 * A swipe beside the menu, over the world it would close on a tap, does the
 * same (game.ts outsideLift).
 *
 * While the finger is still down the tab strip leans toward the tab a lift
 * would turn to (`swipeLean`, overlays.ts tabSwipe), so a swipe shows it will
 * work before it does.
 *
 * Touch events, not pointer events: a menu's list scrolls under the same
 * finger, and once the browser takes a gesture for a scroll it cancels the
 * pointer but still reports the touch's end, which is where this reads it.
 */

/** how far across the finger has to go, in css px */
export const SWIPE_MIN = 40
/** or, flicked, how far it has to go at least (a swipe is the speed as much as the distance, as a phone's own pages are) */
export const FLICK_MIN = 16
/** and how fast, in css px a millisecond */
export const FLICK_SPEED = 0.3
/** and how many times further across than up or down, so a scroll that drifts is still a scroll */
const SWIPE_SLANT = 2

/** The d-pad step a finger's travel makes in `ms` milliseconds: 1 is Right, -1 Left, 0 no swipe. */
export function swipeStep(dx: number, dy: number, ms = Infinity): -1 | 0 | 1 {
  const across = Math.abs(dx)
  const flick = across >= FLICK_MIN && across / Math.max(1, ms) >= FLICK_SPEED
  if ((across < SWIPE_MIN && !flick) || across < SWIPE_SLANT * Math.abs(dy)) return 0
  return dx < 0 ? 1 : -1
}

/**
 * How far a finger still down has gone toward a turn, -1 to 1 in the step's
 * direction (1 toward Right): whole at SWIPE_MIN, where letting go turns,
 * and nothing while it goes more up or down than a swipe may.
 */
export function swipeLean(dx: number, dy: number): number {
  if (Math.abs(dx) < SWIPE_SLANT * Math.abs(dy)) return 0
  return Math.max(-1, Math.min(1, -dx / SWIPE_MIN))
}

/** Whether a finger starting on `target` keeps its sideways travel: a slider, a text field, or something that scrolls sideways itself. */
function ownsSideways(target: EventTarget | null, root: HTMLElement): boolean {
  for (let el = target instanceof Element ? target : null; el && el !== root; el = el.parentElement) {
    if (el.matches('input, textarea, select, [contenteditable]')) return true
    if (el.scrollWidth > el.clientWidth && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true
  }
  return false
}

/**
 * Calls `onSwipe` with the step of each one-finger sideways swipe over `root`,
 * `onLean` with its lean as the finger moves, and `onEnd` with its step (0 for
 * none) as it lifts or the browser takes it.
 */
export function attachSwipe(root: HTMLElement, onSwipe: (step: 1 | -1) => void, onLean?: (lean: number) => void, onEnd?: (step: -1 | 0 | 1) => void) {
  let start: { id: number; x: number; y: number; t: number } | null = null
  root.addEventListener('touchstart', (ev) => {
    const t = ev.touches[0]
    // a second finger makes it something else
    start = ev.touches.length === 1 && !ownsSideways(ev.target, root) ? { id: t.identifier, x: t.clientX, y: t.clientY, t: ev.timeStamp } : null
  }, { passive: true })
  root.addEventListener('touchmove', (ev) => {
    const t = start && Array.from(ev.changedTouches).find((c) => c.identifier === start!.id)
    if (t) onLean?.(swipeLean(t.clientX - start!.x, t.clientY - start!.y))
  }, { passive: true })
  root.addEventListener('touchend', (ev) => {
    const t = start && Array.from(ev.changedTouches).find((c) => c.identifier === start!.id)
    if (!start || !t) return
    const step = swipeStep(t.clientX - start.x, t.clientY - start.y, ev.timeStamp - start.t)
    start = null
    onEnd?.(step)
    if (step) onSwipe(step)
  }, { passive: true })
  root.addEventListener('touchcancel', () => {
    if (start) onEnd?.(0)
    start = null
  }, { passive: true })
}
