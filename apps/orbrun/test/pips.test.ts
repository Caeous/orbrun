import { describe, it, expect } from 'vitest'
import { edgePlace, PIP_MIN_PX, pipSizeInView, placePips, pipTargets, type EdgePlace } from '../src/pips'
import { cellKey, type Billboard, type Scene, type SceneCell } from '@orbrun/scene'

// a 90° vertical lens on a square view: tan(45°) = 1, so camera-space x/-z and y/-z are the NDC directly
const LENS = { tanHalfY: 1, aspect: 1 }

describe('edgePlace: which edge a camera-space point rides', () => {
  it('frames what is in front and inside the lens: no pip', () => {
    expect(edgePlace({ x: 0, y: 0, z: -3 }, LENS)).toBeNull()
    expect(edgePlace({ x: 2.9, y: -1, z: -3 }, LENS)).toBeNull()
  })
  it('puts a thing just outside the right of the lens on the right edge', () => {
    const p = edgePlace({ x: 6, y: 0, z: -3 }, LENS)!
    expect(p.u).toBe(1)
    expect(p.v).toBeCloseTo(0.5)
  })
  it('puts a thing above the lens on the top edge', () => {
    const p = edgePlace({ x: 0, y: 6, z: -3 }, LENS)!
    expect(p.v).toBe(0)
    expect(p.u).toBeCloseTo(0.5)
  })
  it('puts a thing just behind the left shoulder low on the left edge, whatever its height', () => {
    const p = edgePlace({ x: -3, y: -0.4, z: 1 }, LENS)!
    expect(p.u).toBe(0)
    expect(p.v).toBeGreaterThan(0.5)
    expect(p.v).toBeLessThan(1)
    expect(edgePlace({ x: -3, y: 2, z: 1 }, LENS)).toEqual(p)
  })
  it('puts a thing behind and to the right on the bottom edge, right of centre', () => {
    const p = edgePlace({ x: 1, y: -0.4, z: 3 }, LENS)!
    expect(p.v).toBe(1)
    expect(p.u).toBeGreaterThan(0.5)
    expect(p.u).toBeLessThan(1)
  })
  it('puts a thing straight behind at the bottom centre', () => {
    const p = edgePlace({ x: 0, y: -0.4, z: 3 }, LENS)!
    expect(p.v).toBe(1)
    expect(p.u).toBeCloseTo(0.5)
  })
  it('walks the perimeter without a jump at exactly beside', () => {
    const p = edgePlace({ x: 3, y: -0.4, z: 0 }, LENS)!
    expect(p.u).toBe(1)
    expect(p.v).toBeCloseTo(0.5)
  })
  it('slides to the middle of the side edge as a thing swings abeam, rather than snapping there', () => {
    // a monster below the eye, a cell to the right: the clamp in front once held its height all the way round and
    // then stepped to the middle of the edge as it passed abeam, which on a cell-aligned monster is the moment the
    // yaw crosses the middle of a heading
    const lens = { tanHalfY: Math.tan((85 * Math.PI) / 360), aspect: 1.6 }
    let prev: EdgePlace | null = null
    let worst = 0
    for (let deg = -60; deg <= 60; deg += 0.25) {
      const yaw = (deg * Math.PI) / 180
      // the monster stands one cell east; the camera turns under it
      const at = edgePlace({ x: Math.cos(yaw), y: -0.2, z: -Math.sin(yaw) }, lens)
      if (at && prev) worst = Math.max(worst, Math.hypot(at.u - prev.u, at.v - prev.v))
      prev = at
    }
    // a quarter degree of turn moves a pip a fraction of a percent of the view, not the sixth of it it used to jump
    expect(worst).toBeLessThan(0.01)
  })
  it('a wide lens frames more: aspect 2 keeps what a square lens would push off the side', () => {
    expect(edgePlace({ x: 5, y: 0, z: -3 }, { tanHalfY: 1, aspect: 2 })).toBeNull()
    expect(edgePlace({ x: 5, y: 0, z: -3 }, LENS)).not.toBeNull()
  })
})

const RECT = { left: 100, top: 50, width: 800, height: 600 }
const at = (u: number, v: number): EdgePlace => ({ u, v })

describe('placePips: pixels on the free view', () => {
  it('insets a pip by half its size so it is whole on screen', () => {
    const [p] = placePips([at(1, 0.5)], RECT, 24)
    expect(p.x).toBe(100 + 800 - 12)
    expect(p.y).toBe(50 + 300)
    expect(p.edge).toBe('right')
  })
  it('a corner rides the vertical edge', () => {
    expect(placePips([at(0, 0)], RECT, 24)[0].edge).toBe('left')
  })
  it('sizes each pip on its own and lets neighbours of different sizes just touch', () => {
    const ps = placePips([at(0, 0.5), at(0, 0.5)], RECT, [40, 20])
    expect(ps[0].size).toBe(40)
    expect(ps[1].size).toBe(20)
    // the big one sits inset by its own half, and the small one clears it by half of each
    expect(ps[0].y).toBe(50 + 300)
    expect(ps[1].y).toBe(50 + 300 + 30)
  })
  it('spreads pips that share a spot along their edge and keeps the run on screen', () => {
    const ps = placePips([at(0.5, 1), at(0.5, 1), at(0.5, 1)], RECT, 20)
    const xs = ps.map((p) => p.x).sort((a, b) => a - b)
    expect(xs[1] - xs[0]).toBeGreaterThanOrEqual(20)
    expect(xs[2] - xs[1]).toBeGreaterThanOrEqual(20)
    for (const p of ps) expect(p.y).toBe(50 + 600 - 10)
    const end = placePips([at(1, 0.99), at(1, 1), at(1, 1)], RECT, 20)
    for (const p of end) expect(p.y).toBeLessThanOrEqual(50 + 600 - 10)
    const ys = end.map((p) => p.y).sort((a, b) => a - b)
    expect(ys[2] - ys[1]).toBeGreaterThanOrEqual(20)
  })
  it('steps off a pane in the top-left corner: right of it on the top edge, below it on the left edge', () => {
    const stats = { left: 100, top: 50, width: 300, height: 200 }
    const [top] = placePips([at(0.1, 0)], RECT, 24, [stats])
    expect(top.x).toBe(400 + 12)
    expect(top.y).toBe(50 + 12)
    const [left] = placePips([at(0, 0.1)], RECT, 24, [stats])
    expect(left.x).toBe(100 + 12)
    expect(left.y).toBe(250 + 12)
  })
  it('goes round the minimap on the right edge, and on past the monster list under it', () => {
    // the view runs under the sidebar column: a pip beside the minimap steps below it, and below the list when that follows
    const minimap = { left: 700, top: 50, width: 200, height: 150 }
    const list = { left: 700, top: 200, width: 200, height: 100 }
    const [alone] = placePips([at(1, 0.1)], RECT, 24, [minimap])
    expect(alone.x).toBe(100 + 800 - 12)
    expect(alone.y).toBe(200 + 12)
    const [past] = placePips([at(1, 0.1)], RECT, 24, [minimap, list])
    expect(past.x).toBe(100 + 800 - 12)
    expect(past.y).toBe(300 + 12)
    // exactly beside the minimap's foot is left alone
    const [clear] = placePips([at(1, 0.5)], RECT, 24, [minimap])
    expect(clear.y).toBe(50 + 300)
  })
  it('steps off the action panel in the middle of the top edge on the side the pip came from', () => {
    // the panel stands in the strip between the stats pane and the minimap, so both sides of it are top edge
    const panel = { left: 400, top: 50, width: 200, height: 40 }
    expect(placePips([at(0.44, 0)], RECT, 24, [panel])[0].x).toBe(400 - 12)
    expect(placePips([at(0.6, 0)], RECT, 24, [panel])[0].x).toBe(600 + 12)
    // clear of it, a top pip stays where it landed
    expect(placePips([at(0.1, 0)], RECT, 24, [panel])[0].x).toBe(100 + 12 + 0.1 * 776)
  })
  it('steps off the prompt stack in the bottom-right corner: left of it, or above it', () => {
    const bar = { left: 700, top: 550, width: 200, height: 100 }
    const [bottom] = placePips([at(0.9, 1)], RECT, 24, [bar])
    expect(bottom.x).toBe(700 - 12)
    const [right] = placePips([at(1, 0.95)], RECT, 24, [bar])
    expect(right.y).toBe(550 - 12)
  })
})

function scene(): Scene {
  const cells = new Map<string, SceneCell>()
  const cell = (x: number, y: number, visibility: SceneCell['visibility']) =>
    cells.set(cellKey(x, y), { x, y, kind: 'floor', visibility, occluder: false, floorTile: 0, flags: { water: false, lava: false, excluded: false, travelTrail: false, newStair: false, cursor: false, outOfRange: false, magicMapped: false } } as SceneCell)
  cell(5, 5, 'visible')
  cell(6, 5, 'visible')
  cell(7, 5, 'visible')
  cell(8, 5, 'remembered')
  cell(9, 5, 'visible')
  cell(4, 5, 'visible')
  cell(3, 5, 'visible')
  const mon = (x: number, y: number, extra: Partial<Billboard> = {}): Billboard => ({ x, y, tile: 1, kind: 'monster', height: 0.8, attitude: 'hostile', ref: { name: 'jackal', att: 0, typedata: {} }, ...extra })
  const item = (x: number, y: number, extra: Partial<Billboard> = {}): Billboard => ({ x, y, tile: 2, kind: 'item', height: 0.4, name: 'dagger', ...extra })
  return {
    bounds: { x: 0, y: 0, w: 20, h: 20 },
    cells,
    player: { x: 5, y: 5 },
    playerOnLevel: true,
    billboards: [mon(6, 5), mon(7, 5, { scenery: true }), mon(4, 5, { attitude: 'friendly', ref: { name: 'foxfire', att: 4, typedata: { no_exp: true } } }), mon(8, 5, { attitude: 'friendly', ref: { name: 'foxfire', att: 4, typedata: { no_exp: true } } }), item(7, 5), item(8, 5), item(9, 5), item(5, 5), item(9, 5, { scenery: true }), item(4, 5, { name: 'jackal corpse' }), item(3, 5, { name: 'rat skeleton' })],
    level: { ceilingTile: null, sky: 'none', tint: { r: 1, g: 1, b: 1 } },
    revision: 1,
  }
}

describe('pipTargets: what gets a pip', () => {
  it('off: nothing', () => {
    expect(pipTargets(scene(), 'off')).toEqual([])
  })
  it('monsters: the monster list, minus scenery, then your own no-XP minions the list drops (a foxfire), in sight only', () => {
    const t = pipTargets(scene(), 'monsters')
    expect(t.map((b) => [b.x, b.kind])).toEqual([
      [6, 'monster'],
      [4, 'monster'],
    ])
  })
  it('all: items on cells in sight too, one per cell, not underfoot, not remembered, not trees, not corpses', () => {
    const t = pipTargets(scene(), 'all')
    expect(t.map((b) => [b.x, b.kind])).toEqual([
      [6, 'monster'],
      [4, 'monster'],
      [7, 'item'],
      [9, 'item'],
    ])
  })
})

describe('pipSizeInView: a pip is the sprite at the size the frame would have drawn it', () => {
  // a 90° lens on an 800px-tall view: a 1-unit-tall thing one unit away spans half the view
  const LENS_PX = { tanHalfY: 1, height: 800 }
  it('is the perspective size the 3D view would have given the sprite', () => {
    expect(pipSizeInView({ x: 0, y: 0, z: -1 }, LENS_PX, 1, 1000)).toBe(400)
    expect(pipSizeInView({ x: 0, y: 0, z: -2 }, LENS_PX, 1, 1000)).toBe(200)
    // half as tall a thing, half as tall a pip
    expect(pipSizeInView({ x: 0, y: 0, z: -2 }, LENS_PX, 0.5, 1000)).toBe(100)
  })
  it('measures the distance to the lens, not the depth, so it keeps shrinking round the shoulder and behind', () => {
    const beside = pipSizeInView({ x: 2, y: 0, z: 0 }, LENS_PX, 1, 1000)
    const behind = pipSizeInView({ x: 0, y: 0, z: 4 }, LENS_PX, 1, 1000)
    expect(beside).toBe(200)
    expect(behind).toBe(100)
    // off to the side is further than the same depth straight ahead, so it draws smaller
    expect(pipSizeInView({ x: 4, y: 0, z: -3 }, LENS_PX, 1, 1000)).toBeLessThan(pipSizeInView({ x: 0, y: 0, z: -3 }, LENS_PX, 1, 1000))
  })
  it('bends a thing in your face toward the cap instead of pinning it there, and keeps the near range ordered', () => {
    // the knee starts at half the cap: under it the perspective size is untouched
    expect(pipSizeInView({ x: 0, y: 0, z: -4 }, LENS_PX, 1, 400)).toBe(100)
    // over it the curve bends over, approaching the cap without ever reaching it
    const close = pipSizeInView({ x: 0, y: 0, z: -0.01 }, LENS_PX, 1, 120)
    expect(close).toBeGreaterThan(60)
    expect(close).toBeLessThan(120)
    // and near things still sort by distance rather than all sitting on the cap
    const near = pipSizeInView({ x: 0, y: 0, z: -1 }, LENS_PX, 1, 120)
    const nearer = pipSizeInView({ x: 0, y: 0, z: -0.5 }, LENS_PX, 1, 120)
    expect(nearer).toBeGreaterThan(near)
    expect(near).toBeGreaterThan(pipSizeInView({ x: 0, y: 0, z: -3 }, LENS_PX, 1, 120))
  })

  it('never goes below the readable floor', () => {
    expect(pipSizeInView({ x: 0, y: 0, z: -400 }, LENS_PX, 1, 120)).toBe(PIP_MIN_PX)
    // a cap under the floor still leaves a pip you can see
    expect(pipSizeInView({ x: 0, y: 0, z: -400 }, LENS_PX, 1, 4)).toBe(PIP_MIN_PX)
  })
})
