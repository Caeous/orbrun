// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { isScenery } from '../src/room/view'

/**
 * The room is looked around from anywhere it shows through the menus, so what
 * a press belongs to is decided by what it landed on, not by what the canvas
 * happens to be left uncovered by.
 */
describe('what a press on the front screen takes hold of', () => {
  const on = (html: string, sel: string) => {
    const screen = document.createElement('div')
    screen.className = 'screen home'
    screen.innerHTML = html
    return isScenery(screen.querySelector(sel))
  }

  it('the room takes the canvas, the title, the words around the menu and the empty screen', () => {
    expect(on('<canvas class="room"></canvas>', 'canvas')).toBe(true)
    expect(on('<div class="frame"><div class="head"><h1 class="place">Orbrun</h1></div></div>', 'h1')).toBe(true)
    expect(on('<div class="splash">Ponder my incredible Orb!</div>', '.splash')).toBe(true)
    expect(on('<div class="legend"><span class="menu-prompt">Choose</span></div>', '.menu-prompt')).toBe(true)
    expect(on('<div class="frame"></div>', '.frame')).toBe(true)
  })

  it('the menus keep their rows, their fields and anything that scrolls', () => {
    expect(on('<button class="item"><span class="label">Play</span></button>', '.label')).toBe(false)
    expect(on('<a class="item" href="#">About</a>', 'a')).toBe(false)
    expect(on('<label class="item field-item"><input /></label>', 'input')).toBe(false)
    expect(on('<table class="roster"><tbody><tr class="game"><td>caeo</td></tr></tbody></table>', 'td')).toBe(false)
    expect(on('<div class="doc-scroll"><pre class="doc-text">…</pre></div>', 'pre')).toBe(false)
    expect(on('<div class="settings-scroll"><div class="row">Camera</div></div>', '.row')).toBe(false)
  })

  it('a press on nothing at all is nobody’s', () => {
    expect(isScenery(null)).toBe(false)
  })
})
