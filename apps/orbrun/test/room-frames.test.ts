// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { RoomView } from '../src/room/view'

/**
 * The front room's frame loop runs only while there is something to draw
 * with. With no room (still loading, none at all, or a context lost) a
 * pending render is parked, not polled for: the poster stands still and the
 * page burns no frames. The room's arrival wakes the loop.
 */
function harness(room: { render: () => void } | null, turn: { reducedMotion?: boolean; turnOn?: boolean } = {}) {
  const el = document.createElement('canvas')
  const view = Object.assign(Object.create(RoomView.prototype), {
    el, room, lost: false, needsRender: true, raf: 0, driftTimer: 0, last: 0, reducedMotion: true, turnOn: true, destroyed: false, driftFrame: () => {}, ...turn,
    cam: { update: () => false, steering: false, camera: { yaw: 0, pitch: 0 } },
  }) as { tick(now: number): void; invalidate(): void; raf: number; driftTimer: number; needsRender: boolean; room: unknown }
  return view
}

describe('the front room’s frames', () => {
  it('asks for no frame while there is no room to draw, and keeps the render owed', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(7)
    const view = harness(null)
    view.tick(16)
    expect(raf).not.toHaveBeenCalled()
    expect(view.needsRender).toBe(true)
    raf.mockRestore()
  })

  it('draws once the room is there, then rests', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(7)
    const view = harness(null)
    view.tick(16)
    const render = vi.fn()
    view.room = { render }
    view.invalidate()
    expect(raf).toHaveBeenCalledTimes(1)
    view.raf = 0
    view.tick(32)
    expect(render).toHaveBeenCalledOnce()
    expect(raf).toHaveBeenCalledTimes(1)
    raf.mockRestore()
  })

  it('paces the idle turn once drawn, unless the Menu room turn setting is off', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(7)
    for (const turnOn of [true, false]) {
      const view = harness({ render: () => {} }, { reducedMotion: false, turnOn })
      view.tick(16)
      expect(raf).not.toHaveBeenCalled()
      expect(view.driftTimer !== 0).toBe(turnOn)
      clearTimeout(view.driftTimer)
    }
    raf.mockRestore()
  })
})
