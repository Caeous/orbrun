import { describe, expect, it } from 'vitest'
import { LookDrag, MOUSE_SLOP, TOUCH_SLOP } from '../src/look-drag'

/** A finger going `dx`, `dy` css px a millisecond from (100, 100), sampled at 120 Hz for `ms`. */
function swipe(g: LookDrag, dx: number, dy: number, ms: number, t0 = 0) {
  const out: { dx: number; dy: number }[] = []
  for (let t = t0 + 8; t <= t0 + ms; t += 8) {
    const s = g.move([{ t, x: 100 + dx * (t - t0), y: 100 + dy * (t - t0) }])
    if (s) out.push(s)
  }
  return out
}

describe('LookDrag', () => {
  it('is no drag under the slop, a finger’s wider than a mouse’s', () => {
    const finger = new LookDrag(true, { t: 0, x: 0, y: 0 })
    const mouse = new LookDrag(false, { t: 0, x: 0, y: 0 })
    expect(finger.move([{ t: 8, x: TOUCH_SLOP - 1, y: 0 }])).toBe(null)
    expect(mouse.move([{ t: 8, x: MOUSE_SLOP, y: 0 }])).not.toBe(null)
    expect(finger.moved).toBe(false)
    expect(mouse.moved).toBe(true)
  })

  it('swallows the slop it crossed, so the view does not jump as the drag starts', () => {
    const g = new LookDrag(true, { t: 0, x: 0, y: 0 })
    g.move([{ t: 8, x: 7, y: 0 }])
    expect(g.move([{ t: 16, x: 9, y: 0 }])).toEqual({ dx: 2, dy: 0 })
  })

  it('reads every coalesced sample of a move', () => {
    const g = new LookDrag(true, { t: 0, x: 0, y: 0 })
    g.move([1, 2, 3, 4, 5].map((i) => ({ t: i * 4, x: i * 4, y: 0 })))
    expect(g.speed(20).vx).toBeCloseTo(1)
  })

  it('a finger keeps to the axis it set off on, a mouse to none', () => {
    const finger = new LookDrag(true, { t: 0, x: 100, y: 100 })
    const steps = swipe(finger, 1, 0.4, 64)
    const look = steps.map((s) => finger.look(s.dx, s.dy))
    expect(finger.axis).toBe('x')
    expect(look.every((s) => s.dy === 0)).toBe(true)
    expect(finger.speed(64).vy).toBe(0)
    const mouse = new LookDrag(false, { t: 0, x: 100, y: 100 })
    const m = swipe(mouse, 1, 0.4, 64).map((s) => mouse.look(s.dx, s.dy))
    expect(m.some((s) => s.dy !== 0)).toBe(true)
  })

  it('a quick swipe lifts at its speed; one that stopped first lifts at none', () => {
    const quick = new LookDrag(true, { t: 0, x: 100, y: 100 })
    swipe(quick, -2, 0, 80)
    expect(quick.speed(80).vx).toBeCloseTo(-2)
    const stopped = new LookDrag(true, { t: 0, x: 100, y: 100 })
    swipe(stopped, -2, 0, 80)
    expect(stopped.speed(80 + 60).vx).toBe(0)
  })
})
