import { describe, it, expect, vi, afterEach } from 'vitest'
import { stubbed, shadowsWritten, written, type Guts } from './bed.js'
import { STEP_SECONDS } from '../src/motion.js'
import { Render3d } from '../src/index.js'
import { cellKey, emptyScene, makeCamera, type Billboard, type Scene, type TileRect, type TileSource } from '@orbrun/scene'

/**
 * A monster that steps glides after its cell (motion.ts), and the instances
 * written each frame are what that has to come through: a sprite in flight
 * is written from the cell it left towards the one it is bound for, and once
 * it lands it is written on its cell and the host is let go of. These pin
 * both halves, against the anchors the GPU is actually handed.
 */
const RECT: TileRect = { atlas: 'main', sx: 0, sy: 0, w: 32, h: 32, ox: 0, oy: 0, cell: 32 }
const tiles: TileSource = {
  tile: () => RECT,
  atlas: () => ({ width: 64, height: 64 }) as unknown as TexImageSource,
  atlasNames: () => ['main'],
}

/** A 10x10 room with the player at (2, 2) and one monster, id 7, wherever it is put. */
function room(mon: Billboard): Scene {
  const s = emptyScene()
  s.revision = s.layoutRevision = 1
  s.bounds = { left: 0, top: 0, right: 9, bottom: 9 }
  s.playerOnLevel = true
  s.player = { x: 2, y: 2 }
  for (let y = 0; y < 10; y++)
    for (let x = 0; x < 10; x++) {
      const wall = x === 0 || y === 0 || x === 9 || y === 9
      s.cells.set(cellKey(x, y), { x, y, kind: wall ? 'wall' : 'floor', visibility: 'visible', occluder: wall, floorTile: 0, wallTile: wall ? 1 : undefined })
    }
  s.billboards = [mon]
  return s
}

const monster = (x: number, y: number): Billboard => ({ x, y, tile: 1, kind: 'monster', height: 1, attitude: 'hostile', ref: { id: 7 } })

/** Where the sprite, its ghost and its shadow were written this frame, in world x and z. */
function drawn(g: Guts): { x: number; z: number }[] {
  const out = [...written(g, 'main', 'opaque'), ...written(g, 'main', 'ghostVisible')].map((i) => ({ x: i.anchor[0], z: i.anchor[2] }))
  for (const [x, z] of shadowsWritten(g)) out.push({ x, z })
  return out
}

function step(r: Render3d, s: Scene, mon: Billboard) {
  s.billboards = [mon]
  s.revision++
  r.setScene(s)
  r.render()
}

afterEach(() => vi.restoreAllMocks())

describe('a monster stepping', () => {
  it('glides from the cell it left, and stands on its own cell when it lands', () => {
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const { r, g } = stubbed({ motion: true }, tiles)
    r.setCamera(makeCamera(2, 2))
    const s = room(monster(5, 5))
    r.setScene(s)
    r.render()
    expect(drawn(g)).toHaveLength(3) // the sprite, its ghost and its shadow
    for (const p of drawn(g)) expect([p.x, p.z]).toEqual([5.5, 5.5])
    expect(r.animating).toBe(false)

    step(r, s, monster(6, 5))
    // standing a whole cell back from the one it is bound for
    for (const p of drawn(g)) {
      expect(p.x).toBeCloseTo(5.5, 6)
      expect(p.z).toBeCloseTo(5.5, 6)
    }
    expect(r.animating).toBe(true)

    // half way over it stands between the two cells, on no frame of its own: the scene has not changed
    now += (STEP_SECONDS / 2) * 1000
    r.render()
    for (const p of drawn(g)) {
      expect(p.x).toBeGreaterThan(5.5)
      expect(p.x).toBeLessThan(6.5)
      expect(p.z).toBeCloseTo(5.5, 6)
    }

    now += (STEP_SECONDS / 2) * 1000 + 16
    r.render()
    // landed: standing on the cell the server gave it, and the host is let go of
    expect(drawn(g)).toHaveLength(3)
    for (const p of drawn(g)) {
      expect(p.x).toBeCloseTo(6.5, 6)
      expect(p.z).toBeCloseTo(5.5, 6)
    }
    expect(r.animating).toBe(false)
    r.destroy()
  })

  it('draws the exact position exposed to camera tracking, on the supplied clock', () => {
    vi.spyOn(performance, 'now').mockReturnValue(999999) // deliberately unrelated to the presentation clock
    const { r, g } = stubbed({ motion: true }, tiles)
    r.setCamera(makeCamera(2, 2))
    const s = room(monster(5, 5))
    r.setScene(s, 1)
    r.render(1)
    s.billboards = [monster(6, 5)]
    s.revision++
    r.setScene(s, 1.1)
    expect(r.monsterPosition(s.billboards[0], 1.1)).toEqual({ x: 5, y: 5 })
    // Drawing later must sample from arrival, not start a new glide at render time.
    const shown = r.monsterPosition(s.billboards[0], 1.15)
    expect(shown.x).toBeCloseTo(5.875, 9)
    r.setScene(s, 1.15) // repeated setters must not restart it
    r.render(1.15)
    for (const p of drawn(g)) {
      expect(p.x).toBeCloseTo(shown.x + 0.5, 6)
      expect(p.z).toBeCloseTo(shown.y + 0.5, 6)
    }
    r.render(1.2)
    expect(r.animating).toBe(false)
    expect(r.monsterPosition(s.billboards[0], 1.2)).toEqual({ x: 6, y: 5 })
    r.destroy()
  })

  it('keeps an out-and-back walk received before a draw gliding, even on the same final cell', () => {
    const { r, g } = stubbed({ motion: true }, tiles)
    r.setCamera(makeCamera(2, 2))
    const s = room(monster(5, 5))
    r.setScene(s, 1)
    r.render(1)
    s.billboards = [monster(6, 5)]
    s.revision++
    r.setScene(s, 1.1)
    s.billboards = [monster(5, 5)]
    s.revision++
    r.setScene(s, 1.12)
    r.render(1.13)
    const shown = r.monsterPosition(s.billboards[0], 1.13)
    expect(shown.x).toBeGreaterThan(5)
    expect(r.animating).toBe(true)
    for (const p of drawn(g)) expect(p.x).toBeCloseTo(shown.x + 0.5, 6)
    r.render(1.3)
    expect(r.animating).toBe(false)
    for (const p of drawn(g)) expect(p.x).toBeCloseTo(5.5, 6)
    r.destroy()
  })

  it('drops motion on a level reset or when reduced motion is enabled mid-step', () => {
    for (const reduced of [false, true]) {
      const { r, g } = stubbed({ motion: true }, tiles)
      r.setCamera(makeCamera(2, 2))
      const s = room(monster(5, 5))
      r.setScene(s, 1)
      r.render(1)
      s.billboards = [monster(6, 5)]
      s.revision++
      r.setScene(s, 1.1)
      r.render(1.12)
      if (reduced) r.setOptions({ motion: false })
      else r.resetMotion()
      r.setScene(s, 1.13)
      r.render(1.13)
      expect(r.animating).toBe(false)
      expect(r.monsterPosition(s.billboards[0], 1.13)).toEqual({ x: 6, y: 5 })
      for (const p of drawn(g)) expect(p.x).toBeCloseTo(6.5, 6)
      r.destroy()
    }
  })

  it('snaps a jump: a blink leaves nothing gliding', () => {
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const { r, g } = stubbed({ motion: true }, tiles)
    r.setCamera(makeCamera(2, 2))
    const s = room(monster(5, 5))
    r.setScene(s)
    r.render()
    step(r, s, monster(8, 8))
    expect(r.animating).toBe(false)
    for (const p of drawn(g)) expect(p.x).toBeCloseTo(8.5, 6)
    r.destroy()
  })

  it('stands every monster on its cell with motion off, as reduced motion asks', () => {
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const { r, g } = stubbed({ motion: false }, tiles)
    r.setCamera(makeCamera(2, 2))
    const s = room(monster(5, 5))
    r.setScene(s)
    r.render()
    step(r, s, monster(6, 5))
    expect(r.animating).toBe(false)
    for (const p of drawn(g)) expect(p.x).toBeCloseTo(6.5, 6)
    r.destroy()
  })
})
