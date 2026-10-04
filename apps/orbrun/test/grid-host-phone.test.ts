// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { GridHost } from '../src/grid/host'

describe('the grid asks again at every fit whether the screen is a phone', () => {
  it('a screen that becomes a phone under a running game (a device toolbar) gets the phone console, and back', () => {
    const host = document.createElement('div')
    let w = 1280
    let h = 800
    Object.defineProperty(host, 'clientWidth', { get: () => w })
    Object.defineProperty(host, 'clientHeight', { get: () => h })
    document.body.append(host)
    let phone = false
    const grid = new GridHost(host, 16)
    let fits = 0
    grid.onfit = () => fits++
    grid.setLeast(() => phone)
    expect(grid.phone).toBe(false)
    const desk = grid.shrink
    // the toolbar turns the window into an iPhone: the same game, no reload
    w = 390
    h = 844
    phone = true
    fits = 0
    grid.fit()
    expect(grid.phone).toBe(true)
    expect(grid.shrink).toBeLessThan(desk)
    expect(fits).toBe(1)
    // and back to the desktop: the text goes back up
    w = 1280
    h = 800
    phone = false
    grid.fit()
    expect(grid.phone).toBe(false)
    expect(grid.shrink).toBe(desk)
    grid.destroy()
  })
  it('says so when only the phone-ness changed, the cells the same, so the page can follow (game.ts shrinkText)', () => {
    const host = document.createElement('div')
    Object.defineProperty(host, 'clientWidth', { value: 1600 })
    Object.defineProperty(host, 'clientHeight', { value: 900 })
    document.body.append(host)
    let phone = false
    const grid = new GridHost(host, 16)
    grid.setLeast(() => phone)
    let fits = 0
    grid.onfit = () => fits++
    phone = true
    grid.fit()
    expect(grid.phone).toBe(true)
    expect(fits).toBe(1)
    grid.destroy()
  })
})
