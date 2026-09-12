import { describe, it, expect } from 'vitest'
import { blocksExplore, cameraApproach, cellKey, emptyScene, cellAhead, isThreat, nearestBlocker, nearestHostile, orbitShot, rotateDir, yawToDir, dirToYaw, cellLayoutEquals, sceneLayoutEquals, shadeOf, MEMORY_SHADE, type Billboard, type SceneCell, type Scene } from '../src/index.js'

function cell(x: number, y: number, kind: SceneCell['kind'], visibility: SceneCell['visibility'] = 'visible'): SceneCell {
  return {
    x,
    y,
    kind,
    visibility,
    occluder: kind === 'wall' || kind === 'door' || kind === 'unknown',
    floorTile: 1,
    wallTile: kind === 'wall' ? 2 : undefined,
    flags: { water: false, lava: false, excluded: false, travelTrail: false, newStair: false, cursor: false },
  }
}

/** Build a scene from an ASCII map: # wall, . floor, @ player, r remembered floor, W remembered wall, space void. */
function sceneFrom(rows: string[]): Scene {
  const s = emptyScene()
  s.playerOnLevel = true
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x]
      if (ch === ' ') continue
      let c: SceneCell
      if (ch === '#') c = cell(x, y, 'wall')
      else if (ch === 'W') c = cell(x, y, 'wall', 'remembered')
      else if (ch === 'r') c = cell(x, y, 'floor', 'remembered')
      else c = cell(x, y, 'floor')
      if (ch === '@') s.player = { x, y }
      s.cells.set(cellKey(x, y), c)
    }
  }
  s.bounds = { left: 0, top: 0, right: rows[0].length - 1, bottom: rows.length - 1 }
  return s
}

describe('directions', () => {
  it('rotates and quantises', () => {
    expect(rotateDir(0, 1)).toBe(1)
    expect(rotateDir(0, -1)).toBe(7)
    expect(yawToDir(dirToYaw(3))).toBe(3)
    expect(yawToDir(Math.PI * 2 - 0.1)).toBe(0)
  })
  it('finds the cell ahead', () => {
    const s = sceneFrom(['...', '.@.', '...'])
    expect(cellAhead(s, 0)?.y).toBe(0)
    expect(cellAhead(s, 2)?.x).toBe(2)
  })
})

describe('third-person shot (rendering-3d.md II.11)', () => {
  it('stands two cells straight behind the player, against facing, cutting nothing in open ground', () => {
    const s = sceneFrom(['.....', '.....', '..@..', '.....', '.....'])
    const shot = orbitShot(s, 0) // facing north: camera is south
    expect(shot).toEqual({ x: 2, y: 4, back: 2, cut: [] })
  })
  it('lowers the walls it stands in and looks across after a corner', () => {
    // corridor from the west turning north: facing north, both cells behind are rock
    const s = sceneFrom(['#.#', '#@#', '.##', '###'])
    const shot = orbitShot(s, 0)
    expect(shot).toEqual({ x: 1, y: 3, back: 2, cut: [cellKey(1, 2), cellKey(1, 3)] })
  })
  it('cuts only the occluders on the way, not open floor', () => {
    const s = sceneFrom(['@', '.', '#'])
    expect(orbitShot(s, 0)).toEqual({ x: 0, y: 2, back: 2, cut: [cellKey(0, 2)] })
  })
  it('comes in to one cell when the far cell was never seen', () => {
    const s = sceneFrom(['@', '.', ' '])
    expect(orbitShot(s, 0)).toEqual({ x: 0, y: 1, back: 1, cut: [] })
  })
  it('does not stand past a never-seen cell even if its own cell is known', () => {
    const s = sceneFrom(['@', ' ', '.'])
    expect(orbitShot(s, 0)).toBeNull()
  })
  it('is null when nothing behind is known, or the player is off the level', () => {
    expect(orbitShot(sceneFrom(['@', ' ']), 0)).toBeNull()
    const s = sceneFrom(['.....', '..@..', '.....'])
    s.playerOnLevel = false
    expect(orbitShot(s, 0)).toBeNull()
  })
  it('follows diagonal facings along the diagonal', () => {
    const s = sceneFrom(['.....', '.....', '..@..', '.....', '.....'])
    expect(orbitShot(s, 1)).toMatchObject({ x: 0, y: 4, back: 2 }) // facing NE: camera SW
  })
})

describe('third-person camera approach (rendering-3d.md II.11)', () => {
  const N = 0
  it('cuts nothing at rest in open ground', () => {
    const s = sceneFrom(['.....', '.....', '..@..', '.....', '.....'])
    expect(cameraApproach(s, dirToYaw(N), 1.5, 0.5)).toEqual({ back: 1.5, cut: [] })
  })
  it('cuts the diagonal rock the arc sweeps through mid-turn at a corridor corner', () => {
    // corridor from the west turning north; the camera is halfway between facing N and facing E
    const s = sceneFrom(['#.#', '#@#', '###', '###'])
    const yaw = (dirToYaw(N) + dirToYaw(rotateDir(N, 2))) / 2 // NE, 45 degrees into the turn: the eye is SW, in (0,2)
    const a = cameraApproach(s, yaw, 1.5, 0.5)
    expect(a.back).toBe(1.5)
    expect(a.cut).toContain(cellKey(0, 2))
    expect(a.cut).not.toContain(cellKey(1, 1))
  })
  it('cuts the wall a free look parks the camera beside, and the wall it looks across', () => {
    // facing east after a free look, in a north-south corridor: the camera stands in the west wall
    const s = sceneFrom(['##.#', '##@#', '##.#'])
    const a = cameraApproach(s, dirToYaw(rotateDir(N, 2)), 1.5, 0.5)
    expect(a.back).toBe(1.5)
    expect(a.cut).toEqual([cellKey(0, 1), cellKey(1, 1)])
  })
  it('at the near end still lowers the wall whose face the eye touches, never the player cell', () => {
    const s = sceneFrom(['##.#', '##@#', '##.#'])
    const a = cameraApproach(s, dirToYaw(rotateDir(N, 2)), 0.5, 0.5)
    expect(a.cut).toEqual([cellKey(1, 1)])
  })
  it('pulls in toward the player until the way is clear of never-seen void', () => {
    const s = sceneFrom(['@', '.', ' '])
    const a = cameraApproach(s, dirToYaw(N), 1.5, 0.5)
    expect(a.back).toBeLessThan(1.5)
    expect(a.back).toBeGreaterThanOrEqual(0.5)
    expect(a.cut).toEqual([])
  })
  it('stops at the near end even when that is void', () => {
    const s = sceneFrom(['@', ' '])
    expect(cameraApproach(s, dirToYaw(N), 1.5, 0.5).back).toBe(0.5)
  })
})

describe('explore blockers (nearby-danger.cc i_feel_safe)', () => {
  const bb = (x: number, y: number, attitude: string, scenery = false) => ({ kind: 'monster', x, y, attitude, scenery: scenery || undefined, height: 1, tile: 1 }) as unknown as Billboard

  it('hostile and neutral block; friendly, good neutral and plants do not', () => {
    expect(blocksExplore(bb(1, 1, 'hostile'))).toBe(true)
    expect(blocksExplore(bb(1, 1, 'neutral'))).toBe(true)
    expect(blocksExplore(bb(1, 1, 'good_neutral'))).toBe(false)
    expect(blocksExplore(bb(1, 1, 'friendly'))).toBe(false)
    expect(blocksExplore(bb(1, 1, 'hostile', true))).toBe(false)
  })

  it('nearestBlocker prefers a hostile to a neutral at the same king distance, and nearer to farther', () => {
    const s = emptyScene()
    s.playerOnLevel = true
    s.player = { x: 5, y: 5 }
    const floor = (x: number, y: number): SceneCell => ({ x, y, kind: 'floor', visibility: 'visible', occluder: false, floorTile: 1, flags: { water: false, lava: false, excluded: false, travelTrail: false, newStair: false, cursor: false } })
    for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) s.cells.set(cellKey(x, y), floor(x, y))
    const neutralNear = bb(5, 3, 'neutral')
    const hostileNear = bb(3, 5, 'hostile')
    const hostileFar = bb(5, 9, 'hostile')
    s.billboards.push(hostileFar, neutralNear, hostileNear)
    expect(nearestBlocker(s)).toBe(hostileNear)
    s.billboards = [hostileFar, neutralNear]
    expect(nearestBlocker(s)).toBe(neutralNear)
    // the hostile-only query still ignores the neutral
    expect(nearestHostile(s)).toBe(hostileFar)
  })

  it('a plant is a hostile autofight never attacks (l-autofight.cc MB_FIREWOOD): not the nearest hostile', () => {
    const s = emptyScene()
    s.playerOnLevel = true
    s.player = { x: 5, y: 5 }
    const floor = (x: number, y: number): SceneCell => ({ x, y, kind: 'floor', visibility: 'visible', occluder: false, floorTile: 1, flags: { water: false, lava: false, excluded: false, travelTrail: false, newStair: false, cursor: false } })
    for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) s.cells.set(cellKey(x, y), floor(x, y))
    const plant = bb(6, 5, 'hostile', true)
    const rat = bb(5, 9, 'hostile')
    s.billboards.push(plant, rat)
    expect(isThreat(plant)).toBe(false)
    expect(isThreat(rat)).toBe(true)
    expect(nearestHostile(s)).toBe(rat)
    s.billboards = [plant]
    expect(nearestHostile(s)).toBeNull()
  })
})

describe('layout revision (rendering-3d.md Part IV)', () => {
  const base = (): Scene => {
    const s = sceneFrom(['#####', '#.@.#', '#####'])
    s.bounds = { left: 0, top: 0, right: 4, bottom: 2 }
    return s
  }
  it('a cell that only changed visibility keeps its layout', () => {
    const a = base()
    const b = base()
    const c = b.cells.get(cellKey(1, 1))!
    c.visibility = 'remembered'
    expect(cellLayoutEquals(a.cells.get(cellKey(1, 1))!, c)).toBe(true)
    expect(sceneLayoutEquals(a, b)).toBe(true)
  })
  it('a wall, a decal or a lid changes the layout', () => {
    for (const change of [
      (c: SceneCell) => (c.wallTile = 9),
      (c: SceneCell) => (c.overlays = [7]),
      (c: SceneCell) => (c.icons = [3]),
      (c: SceneCell) => (c.ceilingTile = 5),
      (c: SceneCell) => ((c.kind = 'floor'), (c.occluder = false)),
    ]) {
      const a = base()
      const b = base()
      change(b.cells.get(cellKey(0, 0))!)
      expect(sceneLayoutEquals(a, b)).toBe(false)
    }
  })
  it('the player moving, the bounds growing or the lid changing is a new layout', () => {
    const a = base()
    let b = base()
    b.player = { x: 3, y: 1 }
    expect(sceneLayoutEquals(a, b)).toBe(false)
    b = base()
    b.bounds.right = 5
    expect(sceneLayoutEquals(a, b)).toBe(false)
    b = base()
    b.level.ceilingTile = 2
    expect(sceneLayoutEquals(a, b)).toBe(false)
    b = base()
    b.cells.set(cellKey(9, 9), cell(9, 9, 'floor'))
    expect(sceneLayoutEquals(a, b)).toBe(false)
  })
  it('the tint and the flash are colours, not layout', () => {
    const a = base()
    let b = base()
    b.level.tint = { r: 0.5, g: 1, b: 0.5 }
    expect(sceneLayoutEquals(a, b)).toBe(true)
    // paralysis washes every cell blue; the level it washes stands unchanged
    b = base()
    b.cells.get(cellKey(1, 1))!.flash = { r: 64, g: 64, b: 255, a: 100 }
    expect(sceneLayoutEquals(a, b)).toBe(true)
  })
  it('shades by sight and by distance from the player, never to black', () => {
    const s = base()
    const near = s.cells.get(cellKey(1, 1))!
    const under = s.cells.get(cellKey(2, 1))!
    expect(shadeOf(under, s)).toBe(1)
    expect(shadeOf(near, s)).toBeLessThan(1)
    expect(shadeOf(undefined, s)).toBe(1)
    const far = cell(30, 1, 'floor', 'remembered')
    expect(shadeOf(far, s)).toBeCloseTo(0.55 * MEMORY_SHADE, 6)
    expect(shadeOf(far, s)).toBeGreaterThan(0)
  })
})
