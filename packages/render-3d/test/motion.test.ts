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
    expect(half.x).toBeCloseTo(-0.5, 6)
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
    expect(m.offset(1, t)!.x).toBeCloseTo(-1.5, 6)
    expect(m.offset(1, t + STEP_SECONDS)).toEqual({ x: 0, y: 0 })
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
