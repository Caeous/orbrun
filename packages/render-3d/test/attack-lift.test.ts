import { describe, it, expect, vi, afterEach } from 'vitest'
import type * as THREE from '@orbrun/gl'
import { Render3d } from '../src/index.js'
import { cellKey, emptyScene, makeCamera, type Scene, type TileRect, type TileSource } from '@orbrun/scene'

/**
 * The attack cue is a timer, and `animating` is what keeps the host's loop
 * drawing frames for it (game.ts `idle`). It has to end on the clock whatever
 * is on show: with the hands off, or empty, or in third person without a
 * doll, nothing draws the lift, and the timer must still run out.
 */
const RECT: TileRect = { atlas: 'main', sx: 4, sy: 8, w: 4, h: 4, ox: 0, oy: 0, cell: 32 }
const tiles: TileSource = {
  tile: () => RECT,
  atlas: () => ({ width: 16, height: 16 }) as unknown as TexImageSource,
  atlasNames: () => ['main'],
}

function stubbed(opts: ConstructorParameters<typeof Render3d>[0]): Render3d {
  const r = new Render3d({ motion: true, ...opts })
  let target: unknown = null
  ;(r as unknown as { renderer: unknown }).renderer = {
    render: () => {},
    getDrawingBufferSize: (v: THREE.Vector2) => v.set(64, 32),
    getRenderTarget: () => target,
    setRenderTarget: (t: unknown) => void (target = t),
    clear: () => {},
    clearDepth: () => {},
    autoClear: true,
    dispose: () => {},
  }
  r.setTiles(tiles)
  return r
}

function room(): Scene {
  const s = emptyScene()
  s.revision = s.layoutRevision = 1
  s.bounds = { left: 0, top: 0, right: 5, bottom: 5 }
  s.playerOnLevel = true
  s.player = { x: 2, y: 2 }
  for (let y = 0; y < 6; y++)
    for (let x = 0; x < 6; x++) {
      const wall = x === 0 || y === 0 || x === 5 || y === 5
      s.cells.set(cellKey(x, y), { x, y, kind: wall ? 'wall' : 'floor', visibility: 'visible', occluder: wall, floorTile: 0, wallTile: wall ? 1 : undefined, flags: { water: false, lava: false, excluded: false, travelTrail: false, newStair: false, cursor: false, outOfRange: false, magicMapped: false } })
    }
  return s
}

afterEach(() => vi.restoreAllMocks())

describe('the attack lift', () => {
  for (const [what, opts] of [
    ['the viewmodel is off', { viewmodel: false }],
    ['the hands are empty', { viewmodel: true }],
    ['the view is third person', { view: 'third' }],
  ] as const) {
    it(`runs out on the clock when ${what}, so the host is not kept rendering`, () => {
      let now = 1000
      vi.spyOn(performance, 'now').mockImplementation(() => now)
      const r = stubbed(opts as ConstructorParameters<typeof Render3d>[0])
      r.setCamera(makeCamera(2, 2))
      r.setScene(room())
      expect(r.animating).toBe(false)
      r.attack()
      expect(r.animating).toBe(true)
      now += 100
      r.render()
      expect(r.animating).toBe(true)
      now += 1000
      r.render()
      expect(r.animating).toBe(false)
      r.destroy()
    })
  }
  it('is no cue at all with motion off', () => {
    const r = stubbed({ motion: false })
    r.attack()
    expect(r.animating).toBe(false)
    r.destroy()
  })
})
