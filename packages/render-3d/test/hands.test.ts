import { describe, it, expect } from 'vitest'
import { handsFootprint, handsScale } from '../src/hands'

describe('hands footprint (rendering-3d.md II.7)', () => {
  it('a wielded weapon stands low right: right of centre, the lower third, on a 16:9 canvas', () => {
    const [w] = handsFootprint({ weapon: true, offhand: 'none' }, 16 / 9)
    expect(w.x0).toBeCloseTo(0.647, 2)
    expect(w.x1).toBeCloseTo(0.872, 2)
    expect(w.y0).toBeCloseTo(0.66, 2)
    expect(w.y1).toBe(1)
  })
  it('keeps its place against the edge as the screen narrows', () => {
    const wide = handsFootprint({ weapon: true, offhand: 'none' }, 2)[0]
    const tall = handsFootprint({ weapon: true, offhand: 'none' }, 1)[0]
    expect(wide.x0).toBeGreaterThan(tall.x0)
    expect(tall.x1).toBeLessThanOrEqual(1)
  })
  it('an off-hand weapon or shield stands low left, never in the right corner', () => {
    for (const offhand of ['weapon', 'shield'] as const) {
      const rects = handsFootprint({ weapon: true, offhand }, 16 / 9)
      expect(rects).toHaveLength(2)
      expect(rects[1].x1).toBeLessThan(0.5)
    }
  })
  it('empty hands leave the whole canvas free', () => {
    expect(handsFootprint({ weapon: false, offhand: 'none' }, 16 / 9)).toEqual([])
  })
})

describe('hands on a phone held upright', () => {
  it('shrink with the width on a view taller than wide, still hanging from the bottom edge', () => {
    const square = handsFootprint({ weapon: true, offhand: 'shield' }, 1)
    const phone = handsFootprint({ weapon: true, offhand: 'shield' }, 390 / 844)
    for (let i = 0; i < 2; i++) {
      expect(phone[i].y1).toBe(1)
      expect(phone[i].y1 - phone[i].y0).toBeLessThan(square[i].y1 - square[i].y0)
      // the same share of the width as on a square view: the weapon no longer fills it
      expect(phone[i].x1 - phone[i].x0).toBeCloseTo(square[i].x1 - square[i].x0, 5)
    }
  })
  it('a view at least as wide as tall keeps them whole', () => {
    expect(handsScale(1)).toBe(1)
    expect(handsScale(16 / 9)).toBe(1)
  })
})

describe('hands over a touch bar along the foot', () => {
  it('stand on the bar\'s top edge, the same size and across as without it', () => {
    const bare = handsFootprint({ weapon: true, offhand: 'shield' }, 390 / 844)
    const lifted = handsFootprint({ weapon: true, offhand: 'shield' }, 390 / 844, 0.25)
    for (let i = 0; i < 2; i++) {
      // lifted by the bar's share of the height, the grip reaching a touch past its edge as it does past the view's
      expect(lifted[i].y0).toBeCloseTo(bare[i].y0 - 0.25, 5)
      expect(lifted[i].y1).toBeGreaterThan(0.75)
      expect(lifted[i].y1).toBeLessThan(0.8)
      expect(lifted[i].x0).toBeCloseTo(bare[i].x0, 5)
      expect(lifted[i].x1).toBeCloseTo(bare[i].x1, 5)
    }
  })
})
