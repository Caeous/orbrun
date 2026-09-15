// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { initialState } from '@orbrun/webtiles'
import { GameScreen } from '../src/game'

/**
 * A held button that goes up outside the window is never heard as a pointerup,
 * so the drag has to be let go of some other way: the page losing focus, or
 * the next move arriving with nothing held.
 */
function harness() {
  const canvas = document.createElement('canvas')
  Object.assign(canvas, {
    setPointerCapture: vi.fn(), releasePointerCapture: vi.fn(), hasPointerCapture: () => true,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  })
  const lookBy = vi.fn()
  const endDrag = vi.fn()
  const onPointer = vi.fn()
  const screen = Object.assign(Object.create(GameScreen.prototype), {
    canvas, is3d: true, drag: null, hover: null, pointerLive: false, tooltipTimer: 0,
    cam: { lookBy, endDrag }, hud: { hideTooltip: vi.fn() }, session: { state: initialState() },
    hooks: { settings: () => ({ lookSensitivity: 1, invertLook: false, view: 'third' }) },
    inputFrom: vi.fn(), wake: vi.fn(), armCellTooltip: vi.fn(), onPointer,
  }) as { attachPointer(c: HTMLCanvasElement): void; cancelDrag(): void; drag: unknown }
  screen.attachPointer(canvas)
  const at = (type: string, x: number, y: number, buttons: number) => {
    canvas.dispatchEvent(Object.assign(new Event(type), { pointerId: 1, pointerType: 'mouse', button: 0, buttons, clientX: x, clientY: y, pageX: x, pageY: y }))
  }
  return { screen, at, lookBy, endDrag, onPointer }
}

describe('a drag whose release the page never saw', () => {
  it('lets go on the first move with no button held, and orbits no further', () => {
    const h = harness()
    h.at('pointerdown', 100, 100, 1)
    h.at('pointermove', 200, 100, 1)
    expect(h.lookBy).toHaveBeenCalledOnce()
    // the button came up off the window; the pointer comes back over the canvas
    h.at('pointermove', 300, 100, 0)
    expect(h.screen.drag).toBe(null)
    expect(h.endDrag).toHaveBeenCalledOnce()
    h.at('pointermove', 400, 100, 0)
    expect(h.lookBy).toHaveBeenCalledOnce()
  })

  it('lets go when the window loses focus, and the press that follows is a fresh one', () => {
    const h = harness()
    h.at('pointerdown', 100, 100, 1)
    h.at('pointermove', 200, 100, 1)
    window.dispatchEvent(new Event('blur'))
    expect(h.screen.drag).toBe(null)
    h.at('pointermove', 300, 100, 1)
    expect(h.lookBy).toHaveBeenCalledOnce()
  })

  it('a stale drag is dropped without acting on the cell it ended over', () => {
    const h = harness()
    h.at('pointerdown', 100, 100, 1)
    h.at('pointermove', 101, 100, 0)
    expect(h.screen.drag).toBe(null)
    expect(h.endDrag).not.toHaveBeenCalled()
    expect(h.onPointer).not.toHaveBeenCalled()
  })
})
