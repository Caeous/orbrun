import { describe, it, expect } from 'vitest'
import { handsFootprint } from '../src/hands'

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
