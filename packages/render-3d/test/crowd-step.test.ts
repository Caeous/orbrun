import { describe, it, expect, vi, afterEach } from 'vitest'
import * as THREE from 'three'
import { Render3d } from '../src/index.js'
import { STEP_SECONDS } from '../src/motion.js'
import { cellKey, emptyScene, makeCamera, type Billboard, type Scene, type TileRect, type TileSource } from '@orbrun/scene'

/**
 * A monster that steps glides after its cell (motion.ts), and the crowd's
 * bake is what that has to stay clear of: a sprite in flight stands as a
 * holder of its own, moved every frame for nothing, and goes back among the
 * baked chunks the moment it lands. These pin both halves, and that the host
 * is kept drawing frames for the step and let go of afterwards.
 */
const RECT: TileRect = { atlas: 'main', sx: 0, sy: 0, w: 32, h: 32, ox: 0, oy: 0, cell: 32 }
const tiles: TileSource = {
  tile: () => RECT,
  atlas: () => ({ width: 64, height: 64 }) as unknown as TexImageSource,
  atlasNames: () => ['main'],
}

type Guts = {
  renderer: unknown
  billboardGroup: THREE.Group
  records: Map<string, { holders: THREE.Object3D[]; moverId?: number }>
}

function stubbed(motion = true): { r: Render3d; g: Guts } {
  const r = new Render3d({ viewmodel: false, motion })
  const g = r as unknown as Guts
  let target: unknown = null
  g.renderer = {
    render: () => {},
    getDrawingBufferSize: (v: THREE.Vector2) => v.set(64, 32),
    getRenderTarget: () => target,
    setRenderTarget: (t: unknown) => void (target = t),
    clear: () => {},
    clearDepth: () => {},
    autoClear: true,
    dispose: () => {},
    setPixelRatio: () => {},
    setSize: () => {},
  }
  r.setTiles(tiles)
  return { r, g }
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
      s.cells.set(cellKey(x, y), { x, y, kind: wall ? 'wall' : 'floor', visibility: 'visible', occluder: wall, floorTile: 0, wallTile: wall ? 1 : undefined, flags: { water: false, lava: false, excluded: false, travelTrail: false, newStair: false, cursor: false, outOfRange: false, magicMapped: false } })
    }
  s.billboards = [mon]
  return s
}

const monster = (x: number, y: number): Billboard => ({ x, y, tile: 1, kind: 'monster', height: 1, attitude: 'hostile', ref: { id: 7 } })

/** The sprite's holder and its ghost's, as the renderer is standing them right now. */
function holders(g: Guts): THREE.Object3D[] {
  const out: THREE.Object3D[] = []
  for (const rec of g.records.values()) out.push(...rec.holders)
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
  it('glides from the cell it left, out of the crowd, and is baked back onto its cell when it lands', () => {
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const { r, g } = stubbed()
    r.setCamera(makeCamera(2, 2))
    const s = room(monster(5, 5))
    r.setScene(s)
    r.render()
    // standing still, it is in the crowd: the bake takes its holders out of the group
    expect(holders(g).every((h) => h.parent === null)).toBe(true)
    expect(r.animating).toBe(false)

    step(r, s, monster(6, 5))
    const mid = holders(g)
    expect(mid.length).toBe(2) // the sprite and its ghost
    // out of the crowd for the step, and standing a whole cell back from the one it is bound for
    expect(mid.every((h) => h.parent === g.billboardGroup)).toBe(true)
    for (const h of mid) {
      expect(h.position.x).toBeCloseTo(5.5, 6)
      expect(h.position.z).toBeCloseTo(5.5, 6)
    }
    expect(r.animating).toBe(true)

    // half way over it stands between the two cells, on no frame of its own: the scene has not changed
    now += (STEP_SECONDS / 2) * 1000
    r.render()
    for (const h of holders(g)) {
      expect(h.position.x).toBeGreaterThan(5.5)
      expect(h.position.x).toBeLessThan(6.5)
      expect(h.position.z).toBeCloseTo(5.5, 6)
    }

    // the frame after the step's time is up: the sprite is already exactly on its cell by then, so
    // going back into the crowd moves nothing
    now += (STEP_SECONDS / 2) * 1000 + 16
    r.render()
    // landed: back in the crowd, standing on the cell the server gave it, and the host is let go of
    const landed = holders(g)
    expect(landed.length).toBe(2)
    expect(landed.every((h) => h.parent === null)).toBe(true)
    for (const h of landed) {
      expect(h.position.x).toBeCloseTo(6.5, 6)
      expect(h.position.z).toBeCloseTo(5.5, 6)
    }
    expect(r.animating).toBe(false)
    r.destroy()
  })

  it('snaps a jump: a blink leaves nothing gliding', () => {
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const { r, g } = stubbed()
    r.setCamera(makeCamera(2, 2))
    const s = room(monster(5, 5))
    r.setScene(s)
    r.render()
    step(r, s, monster(8, 8))
    expect(r.animating).toBe(false)
    for (const h of holders(g)) {
      expect(h.parent).toBe(null)
      expect(h.position.x).toBeCloseTo(8.5, 6)
    }
    r.destroy()
  })

  it('stands every monster on its cell with motion off, as reduced motion asks', () => {
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const { r, g } = stubbed(false)
    r.setCamera(makeCamera(2, 2))
    const s = room(monster(5, 5))
    r.setScene(s)
    r.render()
    step(r, s, monster(6, 5))
    expect(r.animating).toBe(false)
    for (const h of holders(g)) {
      expect(h.parent).toBe(null)
      expect(h.position.x).toBeCloseTo(6.5, 6)
    }
    r.destroy()
  })
})
