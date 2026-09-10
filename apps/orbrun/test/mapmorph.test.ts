import { describe, it, expect } from 'vitest'
import { coverTransform, containTransform, MORPH, type Rect } from '../src/mapmorph'

const view: Rect = { left: 0, top: 0, width: 1600, height: 900 }
// a 320px minimap in the top-right corner, inside the HUD padding
const mini: Rect = { left: 1270, top: 10, width: 320, height: 320 }

describe('level map morph geometry', () => {
  it('cover: the minimap blows up to fill the view about its centre', () => {
    // scale by the larger ratio (1600/320 = 5) so the square covers the wide view
    expect(coverTransform(mini, view)).toBe('translate(-630px, 280px) scale(5)')
  })

  it('contain: the fullscreen map shrinks into the minimap frame', () => {
    // scale by the smaller ratio (320/1600 = 0.2) so the wide view fits the square
    expect(containTransform(view, mini)).toBe('translate(630px, -280px) scale(0.2)')
  })

  it('cover and contain are inverses along the same path', () => {
    const tall: Rect = { left: 0, top: 0, width: 800, height: 1200 }
    // cover the tall view with the square: scale 1200/320 = 3.75
    expect(coverTransform(mini, tall)).toContain('scale(3.75)')
    // contain the tall view in the square: 320/1200
    expect(containTransform(tall, mini)).toContain('scale(0.267)')
  })

  it('degenerate source rects do not divide by zero', () => {
    expect(coverTransform({ left: 0, top: 0, width: 0, height: 0 }, view)).toBe('translate(800px, 450px) scale(1)')
  })

  it('closing is at least as quick as opening', () => {
    expect(MORPH.exit.duration).toBeLessThanOrEqual(MORPH.enter.duration)
    expect(MORPH.reduced.duration).toBeLessThan(MORPH.exit.duration)
  })
})
