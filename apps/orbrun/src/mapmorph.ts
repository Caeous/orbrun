/**
 * The minimap ⇄ level map morph.
 *
 * Opening the level map (X) reads as the corner minimap growing to fill the
 * screen; closing it reads as the map shrinking back into the corner. Two
 * elements move along the same path and crossfade, so they read as one
 * object: the minimap canvas scales *out* to cover the view while the
 * fullscreen map canvas scales *in* from the minimap's rectangle.
 *
 * Pure geometry and timing live here (unit tested); the DOM work is in
 * `Hud` and `GameScreen`.
 */

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/** Motion tokens. Durations in ms; the easings are "emphasized" curves. */
export const MORPH = {
  /** Open: quick to start, soft landing. */
  enter: { duration: 380, easing: 'cubic-bezier(0.2, 0.9, 0.25, 1)' },
  /** Close: a touch faster and a little snappier than opening. */
  exit: { duration: 300, easing: 'cubic-bezier(0.3, 0, 0.2, 1)' },
  /** prefers-reduced-motion: a plain crossfade. */
  reduced: { duration: 140, easing: 'ease-out' },
} as const

const centre = (r: Rect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 })

function morph(from: Rect, to: Rect, pick: (a: number, b: number) => number): string {
  const s = from.width > 0 && from.height > 0 ? pick(to.width / from.width, to.height / from.height) : 1
  const a = centre(from)
  const b = centre(to)
  return `translate(${round(b.x - a.x)}px, ${round(b.y - a.y)}px) scale(${round(s)})`
}

/**
 * CSS transform (origin: centre) that moves an element laid out at `from`
 * so it uniformly covers `to`. Used to blow the minimap up over the view.
 */
export function coverTransform(from: Rect, to: Rect): string {
  return morph(from, to, Math.max)
}

/**
 * CSS transform (origin: centre) that moves an element laid out at `from`
 * so it uniformly fits inside `to`. Used to shrink the fullscreen map into
 * the minimap's frame.
 */
export function containTransform(from: Rect, to: Rect): string {
  return morph(from, to, Math.min)
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}

export function reducedMotion(): boolean {
  return typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
}

/**
 * Run a Web Animations keyframe set on `el` if the platform supports it, and
 * resolve when it settles (or immediately when it cannot animate). Cancelled
 * animations resolve too, so callers can always clean up.
 */
export function animate(el: Element, frames: Keyframe[], opts: KeyframeAnimationOptions): Promise<void> {
  if (typeof el.animate !== 'function') return Promise.resolve()
  const a = el.animate(frames, opts)
  return a.finished.then(
    () => undefined,
    () => undefined,
  )
}
