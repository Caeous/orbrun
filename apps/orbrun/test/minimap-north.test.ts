// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { northMark } from '../src/hud'

const SIZE = 380
const R = SIZE / 2

/** how far from the map's centre the mark's letter stands, and on what bearing (0 up, clockwise) */
const polar = (m: { x: number; y: number }) => ({
  r: Math.hypot(m.x - R, m.y - R),
  deg: ((Math.atan2(m.x - R, R - m.y) * 180) / Math.PI + 360) % 360,
})

describe('northMark: the N on the minimap rim', () => {
  it('stands at the top while the map stands on north', () => {
    const m = northMark(SIZE, 0)
    expect(m.x).toBeCloseTo(R)
    expect(m.y).toBeLessThan(R)
    expect(m.tick.y2).toBeLessThan(m.tick.y1)
  })

  it('travels round the rim with the ground, at the heading level north is drawn on', () => {
    // the renderer turns the ground by -upYaw, so north leaves the centre on the bearing -upYaw
    for (const deg of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const up = (deg * Math.PI) / 180
      expect(polar(northMark(SIZE, up)).deg).toBeCloseTo((360 - deg) % 360)
    }
  })

  it('keeps the same reach from the centre on every heading, and stays inside the disc', () => {
    const at0 = polar(northMark(SIZE, 0)).r
    for (let deg = 0; deg < 360; deg += 7) {
      const m = northMark(SIZE, (deg * Math.PI) / 180)
      expect(polar(m).r).toBeCloseTo(at0)
      expect(Math.hypot(m.tick.x2 - R, m.tick.y2 - R)).toBeLessThan(R)
      expect(Math.hypot(m.x - R, m.y - R) + m.font / 2).toBeLessThan(R)
    }
  })

  it('the tick runs outward from the letter to the rim, no further', () => {
    const m = northMark(SIZE, 1.1)
    const letter = Math.hypot(m.x - R, m.y - R)
    const inner = Math.hypot(m.tick.x1 - R, m.tick.y1 - R)
    const outer = Math.hypot(m.tick.x2 - R, m.tick.y2 - R)
    expect(letter).toBeLessThan(inner)
    expect(inner).toBeLessThan(outer)
    expect(outer).toBeLessThanOrEqual(R)
  })

  it('scales with the map but holds a legible floor and a modest ceiling', () => {
    expect(northMark(120, 0).font).toBe(8.4)
    expect(northMark(60, 0).font).toBe(8)
    expect(northMark(1000, 0).font).toBe(14)
    // the tick is small on any map: never under 3px, never over 8
    for (const size of [60, 120, 380, 1000]) {
      const m = northMark(size, 0)
      const tick = Math.hypot(m.tick.x2 - m.tick.x1, m.tick.y2 - m.tick.y1)
      expect(tick).toBeGreaterThanOrEqual(3)
      expect(tick).toBeLessThanOrEqual(8)
    }
  })
})
