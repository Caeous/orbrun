import { describe, it, expect } from 'vitest'
import { LevelGrid } from '../src/grid.js'
import { BB_DEPTH, LIE_LIFT, MODE_BILLBOARD, MODE_FACE_EYE, MODE_LIE, MODE_THICK, STAIR_H, STAIR_SWAY, fixtureInstances } from '../src/sprites.js'
import { cellKey, emptyScene, type Scene, type TileRect } from '@orbrun/scene'

const RECT: TileRect = { atlas: 'main', sx: 64, sy: 96, w: 17, h: 32, ox: 7, oy: 0, cell: 32 }
/**
 * Five steps of three columns, an empty column either side: the first step
 * from row 1 with its side from row 17 (one stray column saying 9), the
 * second from row 4 with its side from row 20, and so on down.
 */
const STEPS = {
  top: [-1, 1, 1, 1, 4, 4, 4, 7, 7, 7, 10, 10, 10, 14, 14, 14, -1],
  side: [32, 17, 9, 17, 20, 20, 20, 23, 23, 23, 26, 26, 26, 29, 29, 29, 32],
  open: [32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32],
}

/** A 3x3 room, the middle row floor, a way up on (2, 1). */
function room(dir: 'up' | 'down' = 'up', type: 'stairs' | 'hatch' = 'stairs'): Scene {
  const s = emptyScene()
  s.bounds = { left: 0, top: 0, right: 2, bottom: 2 }
  for (let y = 0; y <= 2; y++) {
    for (let x = 0; x <= 2; x++) {
      const floor = y === 1
      const stairs = floor && x === 2
      s.cells.set(cellKey(x, y), {
        x,
        y,
        kind: floor ? 'floor' : 'wall',
        visibility: 'visible',
        occluder: !floor,
        floorTile: 0,
        wallTile: floor ? undefined : 1,
        featureTile: stairs ? 5 : undefined,
        feature: stairs ? { type, dir } : undefined,
        stance: stairs ? 'upright' : undefined,
      })
    }
  }
  return s
}

function build(s: Scene, art?: { top: number[]; side: number[]; open: number[] }) {
  const grid = new LevelGrid(s)
  return fixtureInstances(s, () => RECT, grid.framed, grid.occupied, art && (() => art))
}

describe('a way up is folded where its steps meet its side', () => {
  const k = STAIR_H / 32
  const [side1, block1, step1, side2, block2, step2] = build(room(), STEPS)

  it('as thick boards facing the eye where it stands, swaying only a little the way it looks, the side standing and the steps lying', () => {
    for (const b of [side1, block1, step1, side2, block2, step2]) expect(b.misc[0] & (MODE_BILLBOARD | MODE_FACE_EYE | MODE_THICK)).toBe(MODE_FACE_EYE | MODE_THICK)
    // swaying only a share of the camera's turn
    for (const b of [side1, block1, step1, side2, block2, step2]) expect(b.misc[3]).toBe(STAIR_SWAY)
    expect(STAIR_SWAY).toBeGreaterThan(0)
    expect(STAIR_SWAY).toBeLessThan(1)
    for (const b of [side1, block1, side2, block2]) expect(b.misc[0] & MODE_LIE).toBe(0)
    for (const b of [step1, step2]) expect(b.misc[0] & MODE_LIE).toBeTruthy()
  })

  it('each step cut where its side starts, the empty column beside it and the empty row above kept for the ink', () => {
    expect(side1.texel).toEqual([64, 96 + 17, 4, 32 - 17])
    expect(step1.texel).toEqual([64, 96, 4, 17])
    expect(side2.texel).toEqual([68, 96 + 20, 3, 32 - 20])
    expect(step2.texel).toEqual([68, 96 + 3, 3, 20 - 3])
    // the block behind the side has no ink, so none of the empty columns either
    expect(block1.texel).toEqual([65, 96 + 17, 3, 32 - 17])
    expect(block2.texel).toEqual([68, 96 + 20, 3, 32 - 20])
    for (const b of [block1, block2]) expect(b.misc[1]).toBe(0)
    for (const b of [side1, step1, side2, step2]) expect(b.misc[1]).toBe(1)
  })

  it('centred on the cell, the side in front of its middle, a block behind it reaching back under the step lying on its top', () => {
    const [plain] = build(room())
    const [, py, , ph] = plain.quad
    const [, sy, , sh] = side1.quad
    expect(sy - sh).toBeCloseTo(py - ph)
    // the deepest step 16 texels: the block from 8 in front of the middle to 8 behind, so no corner of it,
    // turned any way, reaches a wall
    expect(block1.z[0]).toBeCloseTo(8 * k)
    expect(block1.z[1]).toBeCloseTo(16 * k)
    expect(Math.hypot(8 * k, 16 * k)).toBeLessThan(0.5)
    // the side a hair forward of the block, clear of the steps' fronts behind it
    expect(side1.z[0]).toBeGreaterThan(block1.z[0])
    expect(side1.z[0] - block1.z[0]).toBeLessThan(BB_DEPTH * k)
    // the block's end between one step and the next is the riser
    expect(block2.z[0]).toBeCloseTo(block1.z[0])
    expect(block1.quad).toEqual([expect.any(Number), sy, expect.any(Number), sh])
    // lying, a board a texel thick on the side's top
    expect(step1.anchor[1] + LIE_LIFT).toBeCloseTo(sy + sh)
    expect(step1.z[1]).toBeCloseTo(BB_DEPTH * k)
    // lying, the frame's y runs away from the eye: the near edge is the fold, at the block's front
    const [, ty, , th] = step1.quad
    expect(ty - th).toBeCloseTo(-block1.z[0])
    expect(2 * th).toBeCloseTo(17 * k)
  })

  it('stands whole where the art is no steps or cannot be read, and a way down is left lying', () => {
    expect(build(room())).toHaveLength(1)
    // one run (sealed stairs), and runs that fall again (an arch)
    expect(build(room(), { ...STEPS, top: STEPS.top.map((t) => (t < 0 ? t : 1)) })).toHaveLength(1)
    expect(build(room(), { ...STEPS, top: [-1, 7, 7, 7, 1, 1, 1, 7, 7, 7, 1, 1, 1, 7, 7, 7, -1] })).toHaveLength(1)
    // four steps (the Orcish Mines' palisade)
    expect(build(room(), { ...STEPS, top: STEPS.top.map((t) => (t === 14 ? 10 : t)) })).toHaveLength(1)
    expect(build(room('down'), STEPS)).toHaveLength(1)
  })

  it('folds the escape hatch up too, a step-ladder of four, only the band under each step reaching back, to see its legs between', () => {
    // the art opens two rows under the first step's side
    const four = { ...STEPS, top: STEPS.top.map((t) => (t === 14 ? 10 : t)), open: STEPS.open.map((o, i) => (i >= 1 && i <= 3 ? 19 : o)) }
    const [legs, band, step] = build(room('up', 'hatch'), four)
    expect(legs.texel).toEqual([64, 96 + 17, 4, 32 - 17])
    expect(band.texel).toEqual([65, 96 + 17, 3, 19 - 17])
    expect(band.z[1]).toBeGreaterThan(BB_DEPTH * band.misc[2])
    expect(step.misc[0] & MODE_LIE).toBeTruthy()
    const [, ly, , lh] = legs.quad
    expect(step.anchor[1] + LIE_LIFT).toBeCloseTo(ly + lh)
    expect(build(room('down', 'hatch'), four)).toHaveLength(1)
  })
})
