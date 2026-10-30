import { describe, it, expect } from 'vitest'
import { facingArrow } from '../game/minimap'

describe('the minimap', () => {
  it('points the player’s arrow the way the view faces', () => {
    expect(facingArrow(0)).toBe('↑')
    expect(facingArrow(Math.PI / 2)).toBe('→')
    expect(facingArrow(-Math.PI / 4)).toBe('↖')
    expect(facingArrow(3 * Math.PI)).toBe('↓')
  })
})
