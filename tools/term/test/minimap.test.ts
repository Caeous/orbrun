import { describe, it, expect } from 'vitest'
import { facingArrow, mapFrame, mapView } from '../game/minimap'

describe('the minimap', () => {
  it('points the player’s arrow the way the view faces', () => {
    expect(facingArrow(0)).toBe('↑')
    expect(facingArrow(Math.PI / 2)).toBe('→')
    expect(facingArrow(-Math.PI / 4)).toBe('↖')
    expect(facingArrow(3 * Math.PI)).toBe('↓')
  })
})

describe('the level map', () => {
  const corner = { w: 40, h: 11 }
  it('shows all the level that is known where it fits, under the stats pane, else beside it, else over it all', () => {
    // 60 x 20 in 110 x 34: under the pane, centred in what is left
    expect(mapFrame({ left: 10, top: 5, right: 69, bottom: 24 }, 110, 34, corner)).toEqual({ left: 10 - 25, top: 5 - 11 - 1 })
    // 60 x 30: too tall to go under it, narrow enough to go beside it
    expect(mapFrame({ left: 10, top: 5, right: 69, bottom: 34 }, 110, 34, corner)).toEqual({ left: 10 - 40 - 5, top: 5 - 2 })
    // 80 x 30: neither, so over it all, the pane over its corner
    expect(mapFrame({ left: 0, top: 0, right: 79, bottom: 29 }, 110, 34, corner)).toEqual({ left: -15, top: -2 })
  })

  it('leaves a level too big for the screen to follow the cursor, and one not yet known', () => {
    expect(mapFrame({ left: 0, top: 0, right: 79, bottom: 69 }, 110, 34, corner)).toBeNull()
    expect(mapFrame({ left: 0, top: 0, right: -1, bottom: -1 }, 110, 34, corner)).toBeNull()
  })
})

describe('the level map, too big to show whole', () => {
  const corner = { w: 40, h: 11 }
  // the Sewer: 59 x 28 known, on an 83 x 20 map
  const sewer = { left: 10, top: 5, right: 68, bottom: 32 }
  it('centres the way it fits, and keeps the other within the level, none of the map beyond it', () => {
    // the cursor near the level's top: the map from the level's top row, not centred on the cursor over the blank above it
    const v = mapView(sewer, { x: 12, y: 7 }, null, 83, 20, corner, 4)
    expect(v.left).toBe(10 - 12)
    expect(v.top).toBe(5)
    // near its foot: the map's last row the level's
    expect(mapView(sewer, { x: 12, y: 31 }, null, 83, 20, corner, 4).top).toBe(32 - 20 + 1)
  })

  it('stays put while the cursor moves inside it, and scrolls when it comes near a side', () => {
    const at = mapView(sewer, { x: 30, y: 18 }, null, 83, 20, corner, 4)
    expect(mapView(sewer, { x: 30, y: 21 }, at, 83, 20, corner, 4)).toEqual(at)
    expect(mapView(sewer, { x: 30, y: at.top + 18 }, at, 83, 20, corner, 4).top).toBeGreaterThan(at.top)
  })
})
