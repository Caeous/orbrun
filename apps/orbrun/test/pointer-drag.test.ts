// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { initialState } from '@orbrun/webtiles'
import { GameScreen } from '../src/game'

/**
 * A held button that goes up outside the window is never heard as a pointerup,
 * so the drag has to be let go of some other way: the page losing focus, or
 * the next move arriving with nothing held.
 */
function harness(swipeTurn: 'step' | 'drag' = 'drag') {
  const canvas = document.createElement('canvas')
  Object.assign(canvas, {
    setPointerCapture: vi.fn(), releasePointerCapture: vi.fn(), hasPointerCapture: () => true,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  })
  const lookBy = vi.fn()
  const endDrag = vi.fn()
  const lean = vi.fn()
  const endLean = vi.fn()
  const onPointer = vi.fn()
  const screen = Object.assign(Object.create(GameScreen.prototype), {
    canvas, is3d: true, drag: null, hover: null, pointerLive: false, tooltipTimer: 0, ctx: { mode: 'command' },
    cam: { lookBy, endDrag, lean, endLean }, hud: { hideTooltip: vi.fn() }, session: { state: initialState() },
    hooks: { settings: () => ({ lookSensitivity: 1, invertLook: false, swipeTurn }) },
    inputFrom: vi.fn(), wake: vi.fn(), armCellTooltip: vi.fn(), onPointer,
  }) as { attachPointer(c: HTMLCanvasElement): void; cancelDrag(): void; toggleRenderer(): void; drag: unknown; canvas: HTMLCanvasElement }
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
  return { screen, at, touch, lookBy, endDrag, lean, endLean, onPointer }
}

describe('a finger swiping the view, a heading at a time', () => {
  const leaned = (h: ReturnType<typeof harness>) => h.lean.mock.calls.at(-1)![0] / (Math.PI / 4)
  /** the headings each lift turned the view on (`+ 0`: a swipe that turns nothing may say -0) */
  const turned = (h: ReturnType<typeof harness>) => h.endLean.mock.calls.map(([n]) => n + 0)

  it('takes the view with the finger, the dungeon going its way, and on to the next heading as it lifts', () => {
    const h = harness('step')
    h.touch('pointerdown', 300, 300, 0)
    h.touch('pointermove', 290, 301, 8)
    expect(leaned(h)).toBeGreaterThan(0)
    h.touch('pointermove', 270, 302, 16)
    expect(leaned(h)).toBeCloseTo(22 / 70)
    h.touch('pointermove', 255, 302, 24)
    expect(h.endLean).not.toHaveBeenCalled()
    // held still a moment before it lifts: no speed to coast on
    h.touch('pointerup', 255, 302, 80)
    expect(turned(h)).toEqual([1])
    expect(h.lookBy).not.toHaveBeenCalled()
    expect(h.onPointer).not.toHaveBeenCalled()
  })

  it('a long drag turns on, a swipe to the right turns left', () => {
    const h = harness('step')
    h.touch('pointerdown', 100, 300, 0)
    // 192px across: 2.6 headings, so on to the third
    for (let t = 8; t <= 48; t += 8) h.touch('pointermove', 100 + 4 * t, 300, t)
    h.touch('pointerup', 292, 300, 100)
    expect(turned(h)).toEqual([-3])
  })

  it('flicked, it turns as many headings as held still, only quicker', () => {
    const h = harness('step')
    h.touch('pointerdown', 100, 300, 0)
    for (let t = 8; t <= 48; t += 8) h.touch('pointermove', 100 + 4 * t, 300, t)
    h.touch('pointerup', 292, 300, 56)
    expect(turned(h)).toEqual([-3])
    // and it goes there at the finger’s speed, the way it turns
    expect(h.endLean.mock.calls[0][1]).toBeLessThan(0)
  })

  it('barely moved, it turns nothing', () => {
    const h = harness('step')
    h.touch('pointerdown', 300, 300, 0)
    h.touch('pointermove', 290, 300, 80)
    h.touch('pointermove', 285, 300, 160)
    h.touch('pointerup', 285, 300, 170)
    expect(turned(h)).toEqual([0])
  })

  it('barely moved but flicked, it turns a heading', () => {
    const h = harness('step')
    h.touch('pointerdown', 300, 300, 0)
    h.touch('pointermove', 290, 300, 16)
    h.touch('pointermove', 280, 300, 32)
    h.touch('pointerup', 280, 300, 36)
    expect(turned(h)).toEqual([1])
  })

  it('dragged back where it came down, it turns nothing', () => {
    const h = harness('step')
    h.touch('pointerdown', 300, 300, 0)
    h.touch('pointermove', 340, 300, 8)
    h.touch('pointermove', 302, 300, 16)
    h.touch('pointerup', 302, 300, 24)
    expect(leaned(h)).toBeCloseTo(0)
    expect(turned(h)).toEqual([0])
  })

  it('a drag up or down still tilts, and turns nothing', () => {
    const h = harness('step')
    h.touch('pointerdown', 300, 300, 0)
    for (let t = 8; t <= 40; t += 8) h.touch('pointermove', 302, 300 + 3 * t, t)
    h.touch('pointerup', 302, 420, 44)
    expect(h.endLean).not.toHaveBeenCalled()
    expect(h.lean).not.toHaveBeenCalled()
    for (const [dyaw] of h.lookBy.mock.calls) expect(dyaw).toBeCloseTo(0)
    expect(h.endDrag).toHaveBeenCalledOnce()
  })
})

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

  it('a finger on the view as the level map swaps it out lets go, so the view springs back level and the next press is a fresh one', () => {
    const h = harness()
    document.body.append(h.screen.canvas)
    const swapped = { setCursor: vi.fn(), destroy: vi.fn() }
    Object.assign(h.screen, {
      renderer: { setCursor: vi.fn(), destroy: vi.fn() }, park: { take: () => null }, lastCursor: null,
      makeRenderer: () => swapped, relayout: vi.fn(), mapBorrowed2d: false,
    })
    h.touch('pointerdown', 300, 300, 0)
    for (let t = 8; t <= 40; t += 8) h.touch('pointermove', 300, 300 + 4 * t, t)
    h.screen.toggleRenderer()
    expect(h.screen.drag).toBe(null)
    // the system's let-go: no fling, the pitch springs back to rest (camera.ts endDrag)
    expect(h.endDrag).toHaveBeenCalledExactlyOnceWith({ yawSpeed: 0, pitchSpeed: 0, commit: Infinity })
  })
})
