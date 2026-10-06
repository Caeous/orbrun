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
    canvas, is3d: true, drag: null, hover: null, pointerLive: false, tooltipTimer: 0, ctx: { mode: 'command' },
    cam: { lookBy, endDrag }, hud: { hideTooltip: vi.fn() }, session: { state: initialState() },
    hooks: { settings: () => ({ lookSensitivity: 1, invertLook: false }) },
    inputFrom: vi.fn(), wake: vi.fn(), armCellTooltip: vi.fn(), onPointer,
  }) as { attachPointer(c: HTMLCanvasElement): void; cancelDrag(): void; drag: unknown }
  screen.attachPointer(canvas)
  const at = (type: string, x: number, y: number, buttons: number) => {
    canvas.dispatchEvent(Object.assign(new Event(type), { pointerId: 1, pointerType: 'mouse', button: 0, buttons, clientX: x, clientY: y, pageX: x, pageY: y }))
  }
  /** a finger at `t` ms; `type` pointercancel when the system takes it away */
  const touch = (type: string, x: number, y: number, t: number) => {
    const ev = Object.assign(new Event(type), { pointerId: 2, pointerType: 'touch', button: 0, buttons: 1, clientX: x, clientY: y, pageX: x, pageY: y })
    Object.defineProperty(ev, 'timeStamp', { value: t })
    canvas.dispatchEvent(ev)
  }
  return { screen, at, touch, lookBy, endDrag, onPointer }
}

describe('a finger swiping the view', () => {
  it('turns it the way the dungeon is dragged, keeps to the turn, and lifts with the swipe’s speed', () => {
    const h = harness()
    h.touch('pointerdown', 300, 300, 0)
    // leftward and a little down, at 120 Hz
    for (let t = 8; t <= 80; t += 8) h.touch('pointermove', 300 - 2 * t, 300 + 0.5 * t, t)
    h.touch('pointerup', 140, 340, 84)
    expect(h.lookBy).toHaveBeenCalled()
    for (const [dyaw, dpitch] of h.lookBy.mock.calls) {
      expect(dyaw).toBeGreaterThan(0)
      expect(dpitch).toBe(0)
    }
    const release = h.endDrag.mock.calls[0][0]
    expect(release.yawSpeed).toBeGreaterThan(0)
    expect(release.pitchSpeed).toBe(0)
    expect(release.commit).toBeLessThan(Infinity)
  })

  it('a wobble under the slop is still a tap', () => {
    const h = harness()
    Object.assign(h.screen, { tapSteps: () => false, tapMapCursor: () => false, hud: { hideTooltip: vi.fn(), dismissesMoreAt: () => false } })
    h.touch('pointerdown', 300, 300, 0)
    h.touch('pointermove', 307, 300, 8)
    h.touch('pointerup', 307, 300, 16)
    expect(h.lookBy).not.toHaveBeenCalled()
    expect(h.endDrag).not.toHaveBeenCalled()
    expect(h.onPointer).toHaveBeenCalledOnce()
  })

  it('a swipe the system takes away settles on the nearest heading, no fling', () => {
    const h = harness()
    h.touch('pointerdown', 300, 300, 0)
    for (let t = 8; t <= 40; t += 8) h.touch('pointermove', 300 - 3 * t, 300, t)
    h.touch('pointercancel', 180, 300, 44)
    expect(h.endDrag).toHaveBeenCalledWith({ yawSpeed: 0, pitchSpeed: 0, commit: Infinity })
  })
})

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

  it('a second canvas (a renderer swap) shares the one blur listener, so leaving the game leaves none behind', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const h = harness()
    const again = document.createElement('canvas')
    Object.assign(again, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn(), hasPointerCapture: () => true })
    h.screen.attachPointer(again)
    const blurs = add.mock.calls.filter(([type]) => type === 'blur').map(([, fn]) => fn)
    expect(blurs.length).toBe(2)
    expect(new Set(blurs).size).toBe(1)
    add.mockRestore()
  })
})
