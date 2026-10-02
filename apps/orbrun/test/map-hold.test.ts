import { describe, expect, it } from 'vitest'
import { MapHold } from '../src/map-hold'

describe('the level map held across a key that leaves it', () => {
  it('is only crawl’s own map when nothing is held', () => {
    const h = new MapHold()
    expect(h.shown(true, 'levelmap', 0)).toBe(true)
    expect(h.shown(false, 'command', 0)).toBe(false)
  })

  it('stays through the dungeon between the map and the search, and under the search, until crawl’s map is back', () => {
    const h = new MapHold()
    h.begin(0)
    expect(h.shown(true, 'levelmap', 10)).toBe(true) // the Escape not landed yet
    expect(h.shown(false, 'command', 20)).toBe(true) // closed, the prompt not up yet
    expect(h.shown(false, 'text', 30)).toBe(true) // "Search for what?"
    expect(h.shown(false, 'menu', 40)).toBe(true) // its results
    expect(h.shown(true, 'levelmap', 50)).toBe(true) // a result picked: crawl's map at the find
    // and from here it is crawl's alone
    expect(h.shown(false, 'command', 60)).toBe(false)
  })

  it('lets go once the screen it waited for is put away', () => {
    const h = new MapHold()
    h.begin(0)
    expect(h.shown(false, 'popup', 20)).toBe(true) // the overview
    expect(h.shown(false, 'command', 30)).toBe(false)
  })

  it('lets go when no screen came', () => {
    const h = new MapHold()
    h.begin(0)
    expect(h.shown(false, 'command', 1000)).toBe(true)
    expect(h.shown(false, 'command', 2000)).toBe(false)
  })
})
