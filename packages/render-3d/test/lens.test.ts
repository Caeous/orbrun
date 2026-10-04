import { describe, it, expect } from 'vitest'
import { lensFov } from '../src/lens'

const across = (vfov: number, aspect: number) => (2 * Math.atan(Math.tan((vfov * Math.PI) / 360) * aspect) * 180) / Math.PI

describe('the lens on a phone held upright', () => {
  const phone = 390 / 844
  it('a view at least as wide as tall keeps the setting as its vertical angle', () => {
    expect(lensFov(85, 16 / 9, true)).toBe(85)
    expect(lensFov(85, 1, true)).toBe(85)
  })
  it('taller than wide, the setting is the angle across, as on a square view', () => {
    expect(across(lensFov(85, phone, true), phone)).toBeCloseTo(85, 6)
    expect(across(lensFov(60, phone, true), phone)).toBeCloseTo(60, 6)
    // where the vertical setting alone left a slot some 45° across
    expect(across(85, phone)).toBeLessThan(46)
  })
  it('anywhere else, a view taller than wide keeps the setting as its vertical angle', () => {
    expect(lensFov(85, phone)).toBe(85)
    expect(lensFov(60, phone, false)).toBe(60)
  })
})
