import { describe, it, expect } from 'vitest'
import { Movers, STEP_SECONDS } from '../src/motion.js'
import type { Billboard } from '@orbrun/scene'

/**
 * Monsters glide after their cells the way the eye glides after the player's
 * feet (motion.ts). What a step is read from is the monster's client id
 * across two scenes, so these pin which changes of place glide and which
 * snap, and that the glide lands exactly on the cell.
 */
function mon(id: number, x: number, y: number): Billboard {
  return { x, y, tile: 1, kind: 'monster', height: 1, attitude: 'hostile', ref: { id } }
}

describe('monsters mid-step', () => {
  it('uses a 100 ms step, matching the player', () => {
    expect(STEP_SECONDS).toBe(0.1)
  })

  it('glides a single step from the cell it left to the one it entered', () => {
    const m = new Movers()
    m.track([mon(1, 5, 5)], 0)
    // nothing moved yet: a monster first seen stands on its cell
    expect(m.offset(1, 0)).toBeNull()
    expect(m.active).toBe(false)
    m.track([mon(1, 6, 5)], 1)
    expect(m.active).toBe(true)
    // it starts a whole cell back, west of where the scene says it is
    expect(m.offset(1, 1)).toEqual({ x: -1, y: 0 })
    const half = m.offset(1, 1 + STEP_SECONDS / 2)!
    expect(half.x).toBeCloseTo(-0.125, 6)
    expect(half.y).toBe(0)
    // and lands on the cell, exactly
    expect(m.offset(1, 1 + STEP_SECONDS)).toEqual({ x: 0, y: 0 })
  })

  it('glides a diagonal step as one move', () => {
    const m = new Movers()
    m.track([mon(1, 5, 5)], 0)
    m.track([mon(1, 4, 4)], 0.1)
    expect(m.offset(1, 0.1)).toEqual({ x: 1, y: 1 })
  })

  it('snaps anything further than a step: a blink, a teleport, a fast monster given two moves', () => {
    const m = new Movers()
    m.track([mon(1, 5, 5)], 0)
    m.track([mon(1, 7, 5)], 0.1)
    expect(m.offset(1, 0.1)).toBeNull()
    expect(m.active).toBe(false)
  })

  it('glides a step however long the monster stood still first: standing still sends no updates', () => {
    const m = new Movers()
    m.track([mon(1, 5, 5)], 0)
    m.track([mon(1, 6, 5)], 30)
    expect(m.offset(1, 30)).toEqual({ x: -1, y: 0 })
  })

  it('snaps a monster that dropped off the scene and came back a cell over', () => {
    const m = new Movers()
    m.track([mon(1, 5, 5)], 0)
    m.track([], 0.1)
    m.track([mon(1, 6, 5)], 3)
    expect(m.offset(1, 3)).toBeNull()
  })

  it('carries a step under way into the next, so a walk flows instead of restarting', () => {
    const m = new Movers()
    m.track([mon(1, 5, 5)], 0)
    m.track([mon(1, 6, 5)], 0)
    // half way over, the second step starts from where the sprite is drawn, not from the cell
    const t = STEP_SECONDS / 2
    m.track([mon(1, 7, 5)], t)
    expect(m.offset(1, t)!.x).toBeCloseTo(-1.125, 6)
    expect(m.offset(1, t + STEP_SECONDS)).toEqual({ x: 0, y: 0 })
  })

  it('preserves velocity across consecutive confirmed moves', () => {
    const m = new Movers()
    m.track([mon(1, 0, 0)], 0)
    m.track([mon(1, 1, 0)], 0)
    const t = 0.05
    const epsilon = 1e-6
    const before = 1 + m.offset(1, t - epsilon)!.x
    const at = 1 + m.offset(1, t)!.x
    m.track([mon(1, 2, 0)], t)
    expect(2 + m.offset(1, t)!.x).toBeCloseTo(at, 12)
    const after = 2 + m.offset(1, t + epsilon)!.x
    expect((after - at) / epsilon).toBeCloseTo((at - before) / epsilon, 2)
  })

  it('follows confirmed corners and reversals instead of cutting through them', () => {
    for (const target of [{ x: 1, y: 1 }, { x: 0, y: 0 }]) {
      const m = new Movers()
      m.track([mon(1, 0, 0)], 0)
      m.track([mon(1, 1, 0)], 0)
      m.track([mon(1, target.x, target.y)], 0.03)
      for (let i = 0; i <= 100; i++) {
        const offset = m.offset(1, 0.03 + i / 1000)!
        const x = target.x + offset.x
        const y = target.y + offset.y
        expect(y === 0 || x === 1).toBe(true)
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThanOrEqual(1)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThanOrEqual(1)
      }
      expect(m.offset(1, 0.13)).toEqual({ x: 0, y: 0 })
    }
  })

  it('bounds burst catch-up and stops at the last confirmed cell during a stall', () => {
    const m = new Movers()
    m.track([mon(1, 0, 0)], 0)
    for (let x = 1; x <= 30; x++) {
      m.track([mon(1, x, 0)], x * 0.001)
      expect(m.offset(1, x * 0.001)!.x).toBeGreaterThanOrEqual(-2)
      expect(m.offset(1, x * 0.001)!.x).toBeLessThanOrEqual(0)
    }
    expect(m.offset(1, 0.17)).toEqual({ x: 0, y: 0 })
    expect(m.landed(0.17)).toEqual([1])
    expect(m.active).toBe(false)
    m.track([mon(1, 31, 0)], 2)
    expect(m.offset(1, 2.1)).toEqual({ x: 0, y: 0 })
  })

  it('measures movement arrivals rather than unrelated scene updates', () => {
    const m = new Movers()
    m.track([mon(1, 0, 0)], 0)
    m.track([mon(1, 1, 0)], 0)
    m.track([mon(1, 1, 0)], 0.11)
    m.track([mon(1, 2, 0)], 0.12)
    expect(m.offset(1, 0.23)!.x).toBeLessThan(0)
    expect(m.landed(0.23)).toEqual([])
    expect(m.offset(1, 0.26)).toEqual({ x: 0, y: 0 })
    expect(m.landed(0.26)).toEqual([1])
    // The jump resets cadence even when the next real step follows immediately.
    m.track([mon(1, 10, 0)], 0.27)
    m.track([mon(1, 11, 0)], 0.28)
    expect(m.offset(1, 0.38)).toEqual({ x: 0, y: 0 })
  })

  it('glides a step split across two updates, the cell cleared before the next is filled', () => {
    const m = new Movers()
    m.track([mon(1, 5, 5)], 0)
    // the monster is on no cell in this update at all
    m.track([], 0.01)
    expect(m.active).toBe(false)
    m.track([mon(1, 6, 5)], 0.02)
    expect(m.offset(1, 0.02)).toEqual({ x: -1, y: 0 })
  })

  it('reports each landing once, and only after the step is over', () => {
    const m = new Movers()
    m.track([mon(1, 5, 5)], 0)
    m.track([mon(1, 6, 5)], 0)
    expect(m.landed(STEP_SECONDS / 2)).toEqual([])
    expect(m.flying(1)).toBe(true)
    expect(m.landed(STEP_SECONDS)).toEqual([1])
    expect(m.landed(STEP_SECONDS)).toEqual([])
    expect(m.flying(1)).toBe(false)
    expect(m.active).toBe(false)
  })

  it('leaves a monster with no client id, and everything that is not a monster, standing', () => {
    const m = new Movers()
    const item: Billboard = { x: 5, y: 5, tile: 1, kind: 'item', height: 0.6, ref: { id: 9 } }
    const nameless: Billboard = { x: 1, y: 1, tile: 1, kind: 'monster', height: 1 }
    m.track([item, nameless], 0)
    m.track([{ ...item, x: 6 }, { ...nameless, x: 2 }], 0)
    expect(m.active).toBe(false)
    expect(m.offset(9, 0)).toBeNull()
  })

  it('forgets everything when the crowd is dropped: a new level starts nothing gliding', () => {
    const m = new Movers()
    m.track([mon(1, 5, 5)], 0)
    m.clear()
    m.track([mon(1, 6, 5)], 0)
    expect(m.active).toBe(false)
  })
})
