import { describe, it, expect } from 'vitest'
import type { Billboard } from '@orbrun/scene'
import { CameraController } from '../src/camera'
import { Movers } from '../../../packages/render-3d/src/motion'

function mon(x: number, y = 0): Billboard {
  return { x, y, tile: 1, kind: 'monster', height: 1, ref: { id: 1 } }
}

describe('server-confirmed walking', () => {
  it.each([30, 60, 120, 144])('keeps player and monster in step through jitter at %i Hz', (fps) => {
    const camera = new CameraController()
    camera.snapTo(0, 0)
    const monsters = new Movers()
    monsters.track([mon(0)], 0)
    let now = 0
    let goal = 0
    function advance(to: number) {
      while (now < to - 1e-9) {
        const dt = Math.min(1 / fps, to - now)
        camera.update(dt)
        now += dt
        const x = goal + (monsters.offset(1, now)?.x ?? 0)
        expect(camera.camera.eyeX).toBeCloseTo(x, 9)
        expect(x).toBeLessThanOrEqual(goal)
        monsters.landed(now)
      }
    }
    for (const arrival of [0, 0.1, 0.21, 0.305, 0.43, 0.54, 0.64, 0.77]) {
      advance(arrival)
      goal++
      camera.walkTo(goal, 0, [{ dx: 1, dy: 0 }], arrival)
      monsters.track([mon(goal)], arrival)
      // Neither renderer moves ahead of the confirmed cell.
      expect(camera.camera.x).toBe(goal)
      expect(camera.camera.eyeX).toBeLessThan(goal)
    }
    advance(0.91)
    expect(camera.camera.eyeX).toBe(goal)
    expect(monsters.active).toBe(false)
    advance(2)
    expect(camera.camera.eyeX).toBe(goal)
    expect(camera.update(0.01)).toBe(false)
    // A long wait restores the short isolated step, not the previous cadence.
    camera.walkTo(goal + 1, 0, [{ dx: 1, dy: 0 }], 2)
    camera.update(0.1)
    expect(camera.camera.eyeX).toBe(goal + 1)
  })

  it('keeps moving through a small late reply without extending the previous destination', () => {
    const c = new CameraController()
    c.snapTo(0, 0)
    c.walkTo(1, 0, [{ dx: 1, dy: 0 }], 0)
    c.update(0.1)
    c.walkTo(2, 0, [{ dx: 1, dy: 0 }], 0.1)
    c.update(0.1)
    const before = c.camera.eyeX
    expect(before).toBeGreaterThan(1)
    expect(before).toBeLessThan(2)
    c.update(0.01)
    expect(c.camera.eyeX).toBeGreaterThan(before)
    expect(c.camera.eyeX).toBeLessThan(2)
    c.update(1) // no reply: stop, never guess a third cell
    expect(c.camera.eyeX).toBe(2)
    expect(c.update(1)).toBe(false)
  })

  it('ignores duplicate scene updates when measuring cadence', () => {
    const a = new CameraController()
    const b = new CameraController()
    for (const c of [a, b]) {
      c.snapTo(0, 0)
      c.walkTo(1, 0, [{ dx: 1, dy: 0 }], 0)
      c.update(0.1)
    }
    a.walkTo(1, 0, [], 0.09)
    for (const c of [a, b]) {
      c.walkTo(2, 0, [{ dx: 1, dy: 0 }], 0.12)
      c.update(0.11)
    }
    expect(a.camera.eyeX).toBe(b.camera.eyeX)
    expect(a.camera.eyeX).toBeLessThan(2)
  })

  it('forgets cadence on a teleport and still honours reduced motion', () => {
    const c = new CameraController()
    c.walkTo(1, 0, [{ dx: 1, dy: 0 }], 0)
    c.update(0.1)
    c.walkTo(2, 0, [{ dx: 1, dy: 0 }], 0.12)
    c.snapTo(10, 10)
    c.walkTo(11, 10, [{ dx: 1, dy: 0 }], 0.13)
    c.update(0.1)
    expect(c.camera.eyeX).toBe(11)
    c.walkTo(12, 10, [{ dx: 1, dy: 0 }], 0.23)
    c.reducedMotion = true
    c.update(0.01)
    expect(c.camera.eyeX).toBe(12)
    expect(c.update(0.01)).toBe(false)
  })
})

describe('a shared presentation clock', () => {
  it('does not give a new reply the time elapsed before it arrived', () => {
    const c = new CameraController()
    const m = new Movers()
    c.snapTo(0, 0)
    m.track([mon(0)], 1)
    // The reply is applied inside the frame, after 50 ms since the last frame.
    c.walkTo(1, 0, [{ dx: 1, dy: 0 }], 1.05)
    m.track([mon(1)], 1.05)
    c.update(0.05, 1.05)
    expect(c.camera.eyeX).toBe(0)
    expect(m.offset(1, 1.05)!.x).toBe(-1)
    c.update(0.016, 1.066)
    expect(c.camera.eyeX).toBeCloseTo(1 + m.offset(1, 1.066)!.x, 12)
  })

  it('samples both old walks at the reply time, even between rendered frames', () => {
    const c = new CameraController()
    const m = new Movers()
    c.snapTo(0, 0)
    m.track([mon(0)], 1)
    c.walkTo(1, 0, [{ dx: 1, dy: 0 }], 1)
    m.track([mon(1)], 1)
    c.update(0.02, 1.02)
    // No frame at 1.05: the new reply must carry the old walk's current position/speed.
    c.walkTo(2, 0, [{ dx: 1, dy: 0 }], 1.05)
    m.track([mon(2)], 1.05)
    expect(c.camera.eyeX).toBeCloseTo(2 + m.offset(1, 1.05)!.x, 12)
    c.update(0.04, 1.06)
    expect(c.camera.eyeX).toBeCloseTo(2 + m.offset(1, 1.06)!.x, 12)
    // A long frame caps look input elsewhere, but must not leave movement behind the clock.
    c.update(0.1, 2)
    expect(c.camera.eyeX).toBe(2)
    expect(m.offset(1, 2)).toEqual({ x: 0, y: 0 })
    expect(c.update(0.1, 2.1)).toBe(false)
  })

  it('never rewinds on a frame timestamp just before a reply timestamp', () => {
    const c = new CameraController()
    c.walkTo(1, 0, [{ dx: 1, dy: 0 }], 1)
    c.update(0.02, 1.02)
    c.walkTo(2, 0, [{ dx: 1, dy: 0 }], 1.05)
    const x = c.camera.eyeX
    c.update(0.02, 1.049)
    expect(c.camera.eyeX).toBe(x)
    c.update(0.02, 1.05)
    expect(c.camera.eyeX).toBe(x)
    c.update(0.02, 1.06)
    expect(c.camera.eyeX).toBeGreaterThan(x)
  })
})
