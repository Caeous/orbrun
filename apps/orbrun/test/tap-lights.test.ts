// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { tapLights } from '../src/focus'

function tap(el: HTMLElement, pointerType = 'touch', target: HTMLElement = el) {
  target.dispatchEvent(new PointerEvent('pointerdown', { pointerType, bubbles: true } as PointerEventInit))
  target.click()
}

/** a row with a click of its own, lit when `lit.on` */
function row() {
  const el = document.createElement('li')
  const arrow = document.createElement('span')
  arrow.setAttribute('role', 'button')
  el.append(arrow)
  document.body.append(el)
  const lit = { on: false }
  const chose = vi.fn()
  const light = vi.fn(() => void (lit.on = true))
  tapLights(el, () => lit.on, light)
  el.addEventListener('click', chose)
  return { el, arrow, lit, chose, light }
}

describe('tapLights', () => {
  it('a tap on an unlit row lights it; a tap on the lit row chooses it', () => {
    const r = row()
    tap(r.el)
    expect(r.light).toHaveBeenCalledTimes(1)
    expect(r.chose).not.toHaveBeenCalled()
    tap(r.el)
    expect(r.light).toHaveBeenCalledTimes(1)
    expect(r.chose).toHaveBeenCalledTimes(1)
  })

  it('a mouse click and a key choose at once', () => {
    const r = row()
    tap(r.el, 'mouse')
    expect(r.chose).toHaveBeenCalledTimes(1)
    r.el.click()
    expect(r.chose).toHaveBeenCalledTimes(2)
    expect(r.light).not.toHaveBeenCalled()
  })

  it("a control inside the row acts at once", () => {
    const r = row()
    tap(r.el, 'touch', r.arrow)
    expect(r.light).not.toHaveBeenCalled()
    expect(r.chose).toHaveBeenCalledTimes(1)
  })

  it('reads the row as the finger went down, before a focus can light it', () => {
    const r = row()
    r.el.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true } as PointerEventInit))
    r.lit.on = true
    r.el.click()
    expect(r.chose).not.toHaveBeenCalled()
  })
})
