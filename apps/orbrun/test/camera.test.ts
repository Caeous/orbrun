import { describe, it, expect } from 'vitest'
import { REST_PITCH, cellKey, emptyScene, type Billboard, type Scene, type SceneCell } from '@orbrun/scene'
import { CameraController, trailStep } from '../src/camera'

function cell(x: number, y: number, kind: SceneCell['kind']): SceneCell {
  return {
    x,
    y,
    kind,
    visibility: 'visible',
    occluder: kind === 'wall' || kind === 'unknown',
    floorTile: 1,
    wallTile: kind === 'wall' ? 2 : undefined,
    flags: { water: false, lava: false, excluded: false, travelTrail: false, newStair: false, cursor: false },
  }
}

/** # wall, . floor, @ player (on floor), space never seen. */
function sceneFrom(rows: string[]): Scene {
  const s = emptyScene()
  s.playerOnLevel = true
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x]
      if (ch === ' ') continue
      const c = cell(x, y, ch === '#' ? 'wall' : 'floor')
      if (ch === '@') s.player = { x, y }
      s.cells.set(cellKey(c.x, c.y), c)
    }
  }
  return s
}

function hostile(s: Scene, x: number, y: number, id: number) {
  s.billboards.push({ kind: 'monster', x, y, attitude: 'hostile', ref: { id } } as unknown as Billboard)
}

function cam(facing = 0) {
  const c = new CameraController()
  c.reducedMotion = true
  c.setFacing(facing as never, true)
  return c
}

describe('camera facing while travelling', () => {
  it('walking north into unexplored darkness keeps facing north', () => {
    // explored corridor behind, nothing known ahead
    const s = sceneFrom(['     ', '  @  ', ' ... ', ' ... '])
    const c = cam(4)
    c.faceAfterMove(s, 0, -1)
    expect(c.facing).toBe(0)
  })

  it('a known wall ahead turns the camera no more than a quarter turn', () => {
    // dead end to the north with an opening east; came from the south
    const s = sceneFrom(['#####', '#.@..', '#.#.#', '#...#'])
    const c = cam(4)
    c.faceAfterMove(s, 0, -1)
    expect(c.facing).toBe(2)
  })

  it('in a dead end the only way not to face a wall is back the way we came', () => {
    const s = sceneFrom(['#####', '##@##', '##.##', '##.##'])
    const c = cam(4)
    c.faceAfterMove(s, 0, -1)
    expect(c.facing).toBe(4)
  })

  it('a wall two cells ahead still counts as facing a wall', () => {
    // corridor north ends one cell on; the corridor east runs on
    const s = sceneFrom(['#####', '#.###', '#.@..', '#.#.#', '#...#'])
    const c = cam(4)
    c.faceAfterMove(s, 0, -1)
    expect(c.facing).toBe(2)
  })

  it('a diagonal between two wall corners is facing a wall', () => {
    // north-east is floor but north and east are walls; north-west is the nearest open heading
    const s = sceneFrom(['...#.', '...#.', '...@#', '..###', '.....'])
    const c = cam(1)
    expect(c.faceAfterArrival(s)).toBe(true)
    expect(c.facing).toBe(7)
  })

  it('arriving somewhere new may turn all the way round to leave a wall', () => {
    const s = sceneFrom(['#####', '##@##', '##.##', '##.##'])
    const c = cam(0)
    expect(c.faceAfterArrival(s)).toBe(true)
    expect(c.facing).toBe(4)
  })

  it('arriving faces the threat before the road', () => {
    const s = sceneFrom(['#####', '##@##', '##.##', '##.##'])
    hostile(s, 2, 2, 1)
    const c = cam(0)
    c.faceAfterArrival(s)
    expect(c.facing).toBe(4)
  })

  it('arriving before the level has arrived asks to be called again', () => {
    const s = sceneFrom(['     ', '  @  ', '     '])
    const c = cam(0)
    expect(c.faceAfterArrival(s)).toBe(false)
    expect(c.facing).toBe(0)
  })

  it('a hostile in view outranks the road: face the nearest one', () => {
    // exploring north, an orc east and a rat closer to the south-west
    const s = sceneFrom(['.....', '.....', '..@..', '.....', '.....'])
    hostile(s, 4, 2, 1)
    hostile(s, 1, 3, 2)
    const c = cam(4)
    c.faceAfterMove(s, 0, -1)
    expect(c.facing).toBe(5)
  })

  it('a fight in place turns toward the adjacent hostile only', () => {
    const s = sceneFrom(['.....', '.....', '..@..', '.....', '.....'])
    hostile(s, 4, 2, 1)
    const c = cam(0)
    expect(c.faceAdjacentHostile(s)).toBe(false)
    expect(c.facing).toBe(0)
    hostile(s, 2, 3, 2)
    expect(c.faceAdjacentHostile(s)).toBe(true)
    expect(c.facing).toBe(4)
  })

  it('sticks with the threat it has until another hostile is strictly closer', () => {
    // two monsters both two cells away: east and west
    const s = sceneFrom(['.....', '.....', '..@..', '.....', '.....'])
    hostile(s, 4, 2, 1)
    const c = cam(0)
    c.faceHostile(s)
    expect(c.facing).toBe(2)
    // a second one equally far: no flip
    hostile(s, 0, 2, 2)
    c.faceHostile(s)
    expect(c.facing).toBe(2)
    // it closes in: now it is the threat
    s.billboards[1].x = 1
    c.faceHostile(s)
    expect(c.facing).toBe(6)
    // the first one gone, the held one moved: follow it, not stale memory
    s.billboards.splice(0, 1)
    s.billboards[0].y = 0
    c.faceHostile(s)
    expect(c.facing).toBe(7)
  })

  it('an autofight walk keeps closing on its threat, whatever gets closer meanwhile', () => {
    // a gnoll three cells east; Tab walks toward it
    const s = sceneFrom(['.......', '.......', '.......', '...@...', '.......', '.......', '.......'])
    hostile(s, 6, 3, 1)
    const c = cam(0)
    expect(c.autofight(s)).toBe(false)
    expect(c.facing).toBe(2)
    // a rat turns up two cells north-west, strictly closer: the walk is not abandoned
    hostile(s, 1, 1, 2)
    c.faceHostile(s)
    expect(c.facing).toBe(2)
    // the step lands (path-driven): still the gnoll
    s.player.x = 4
    c.faceAfterMove(s, 1, 0)
    expect(c.facing).toBe(2)
    // the rat comes within reach: autofight swings at what it can hit (compare_monster_info: can_attack before distance)
    s.billboards[1].x = 3
    s.billboards[1].y = 2
    c.faceHostile(s)
    expect(c.facing).toBe(7)
  })

  it('reaching the threat ends the hold: the nearest hostile rules again', () => {
    const s = sceneFrom(['.......', '.......', '.......', '...@...', '.......', '.......', '.......'])
    hostile(s, 5, 3, 1)
    const c = cam(0)
    expect(c.autofight(s)).toBe(false)
    s.player.x = 4
    c.faceAfterMove(s, 1, 0)
    // in reach now: the press swings
    expect(c.autofight(s)).toBe(true)
    expect(c.facing).toBe(2)
    // it steps back out of reach while a second hostile is closer: no walk is under way, so the closer one is the threat
    s.billboards[0].x = 6
    hostile(s, 4, 2, 2)
    c.faceHostile(s)
    expect(c.facing).toBe(0)
  })

  it('a move of the player’s own ends the hold; so does the threat leaving view', () => {
    const s = sceneFrom(['.......', '.......', '.......', '...@...', '.......', '.......', '.......'])
    hostile(s, 6, 3, 1)
    const c = cam(0)
    c.autofight(s)
    hostile(s, 3, 1, 2)
    c.stopClosing()
    c.faceHostile(s)
    expect(c.facing).toBe(0)
    // walking again toward the rat; the gnoll leaves view, then a bat lands closer than the rat
    s.billboards.splice(0, 1)
    expect(c.autofight(s)).toBe(false)
    hostile(s, 5, 4, 3)
    c.faceHostile(s)
    expect(c.facing).toBe(0)
    s.billboards.splice(0, 1)
    c.faceHostile(s)
    expect(c.facing).toBe(3)
  })
})

describe('camera view between sessions', () => {
  it('restores yaw and pitch exactly, with facing on the nearest heading', () => {
    const a = cam()
    a.lookBy(1.9, 0.4)
    const b = cam()
    b.restore(a.view)
    expect(b.camera.yaw).toBeCloseTo(1.9)
    expect(b.camera.pitch).toBeCloseTo(REST_PITCH + 0.4)
    expect(b.facing).toBe(a.facing)
    // nothing is easing: the camera stays put
    expect(b.update(0.1)).toBe(false)
    expect(b.camera.yaw).toBeCloseTo(1.9)
    // arriving in open ground keeps the exact yaw rather than snapping to a heading
    const s = sceneFrom(['.....', '.....', '..@..', '.....', '.....'])
    expect(b.faceAfterArrival(s)).toBe(true)
    b.update(0.1)
    expect(b.camera.yaw).toBeCloseTo(1.9)
  })

  it('keeps a restored view inside the pitch limit and the yaw range', () => {
    const c = cam()
    c.restore({ yaw: -1, pitch: 9 })
    expect(c.camera.yaw).toBeCloseTo(Math.PI * 2 - 1)
    expect(c.camera.pitch).toBeLessThan(Math.PI / 2)
    expect(c.camera.pitch).toBeGreaterThan(0)
  })
})

describe('rest pitch (the Camera angle setting)', () => {
  it('starts a little under the horizon, and a new angle tilts the view with it', () => {
    const c = cam(0)
    expect(REST_PITCH).toBeCloseTo(-(Math.PI / 180) * 5, 6)
    expect(c.camera.pitch).toBeCloseTo(REST_PITCH)
    c.setRestPitch(-(Math.PI / 180) * 25)
    expect(c.camera.pitch).toBeCloseTo(-(Math.PI / 180) * 25)
    // a glance off the rest angle is kept, and moves with the next change
    c.lookBy(0, 0.2)
    c.setRestPitch(0)
    expect(c.camera.pitch).toBeCloseTo(0.2)
  })

  it('carries the third-person window with it', () => {
    const c = cam(0)
    c.thirdPerson = true
    c.setRestPitch(-(Math.PI / 180) * 30)
    c.lookBy(0, -Math.PI / 2)
    expect(c.camera.pitch).toBeCloseTo(-(Math.PI / 180) * 60, 5)
    c.lookBy(0, Math.PI)
    expect(c.camera.pitch).toBeCloseTo(0, 5)
  })
})

describe('third-person glance', () => {
  it('clamps pitch to the window under the lid, and frees it again in first person', () => {
    const c = cam(0)
    c.thirdPerson = true
    c.lookBy(0, -Math.PI / 2)
    expect(c.camera.pitch).toBeCloseTo(REST_PITCH - (Math.PI / 180) * 30, 5)
    c.lookBy(0, Math.PI)
    expect(c.camera.pitch).toBeCloseTo(REST_PITCH + (Math.PI / 180) * 30, 5)
    c.thirdPerson = false
    c.lookBy(0, -Math.PI / 2)
    expect(c.camera.pitch).toBeLessThan(-(Math.PI / 180) * 60)
  })
  it('restores a saved view within the third-person window', () => {
    const c = cam(0)
    c.thirdPerson = true
    c.restore({ yaw: 0, pitch: -1.4 })
    expect(c.camera.pitch).toBeCloseTo(REST_PITCH - (Math.PI / 180) * 30, 5)
  })
})

describe('camera facing after a keyboard step', () => {
  it('turns to the exact step vector, walls and hostiles notwithstanding', () => {
    // a strafe back-left into a dead end: the camera still goes the way the feet went
    const s = sceneFrom(['#####', '#.@..', '#.#.#', '#...#'])
    const c = cam(0)
    void s
    c.faceStep(-1, 1)
    expect(c.facing).toBe(5)
    c.faceStep(0, 1)
    expect(c.facing).toBe(4)
  })

  it('ignores a zero displacement', () => {
    const c = cam(2)
    c.faceStep(0, 0)
    expect(c.facing).toBe(2)
  })
})

describe('steering with a drag', () => {
  it('stays steering until it is released', () => {
    const c = cam()
    c.lookBy(0.1, 0)
    c.update(1)
    expect(c.steering).toBe(true)
    c.endDrag()
    expect(c.steering).toBe(false)
  })
})

describe('camera facing after a jump', () => {
  // explore with travel_delay -1 arrives as one position update; the trail knows the walk
  it('reads the last step from the trail arrow on the player cell', () => {
    const s = sceneFrom(['#####', '#...#', '#.@.#', '#...#', '#####'])
    s.cells.get(cellKey(2, 2))!.trail = { from: 6 }
    expect(trailStep(s)).toEqual({ dx: -1, dy: 0 })
    const c = cam(2)
    // the straight line from where we were points north; the feet went west
    c.faceAfterJump(s, -3, -3)
    expect(c.facing).toBe(6)
  })

  it('reads the last step from the neighbour whose arrow leaves toward the player', () => {
    const s = sceneFrom(['#####', '#...#', '#.@.#', '#...#', '#####'])
    s.cells.get(cellKey(2, 3))!.trail = { from: 2, to: 0 }
    expect(trailStep(s)).toEqual({ dx: 0, dy: -1 })
  })

  it('ignores a neighbour whose arrow leaves elsewhere', () => {
    const s = sceneFrom(['#####', '#...#', '#.@.#', '#...#', '#####'])
    s.cells.get(cellKey(2, 3))!.trail = { from: 2, to: 2 }
    expect(trailStep(s)).toBeNull()
  })

  it('falls back to the displacement without a trail', () => {
    const s = sceneFrom(['#####', '#...#', '#.@.#', '#...#', '#####'])
    const c = cam(2)
    c.faceAfterJump(s, -5, 0)
    expect(c.facing).toBe(6)
  })
})

describe('facing what stopped the walk (nearby-danger.cc mons_is_safe)', () => {
  function monster(s: Scene, x: number, y: number, id: number, attitude: Billboard['attitude'], scenery = false) {
    const b = { kind: 'monster', x, y, attitude, scenery: scenery || undefined, ref: { id } } as unknown as Billboard
    s.billboards.push(b)
    return b
  }
  const room = () => sceneFrom(['.........', '.........', '.........', '....@....', '.........', '.........', '.........'])

  it('a neutral blocks explore too, so it is faced when nothing else is in view', () => {
    const s = room()
    monster(s, 4, 0, 1, 'neutral')
    const c = cam(4)
    expect(c.faceBlocker(s)).toBe(true)
    expect(c.facing).toBe(0)
  })

  it('a plant never blocks explore: it is not faced even when nearest', () => {
    const s = room()
    monster(s, 5, 3, 1, 'hostile', true)
    monster(s, 4, 6, 2, 'hostile')
    const c = cam(0)
    c.faceBlocker(s)
    expect(c.facing).toBe(4)
  })

  it('autofight beside a plant faces the monster, not the plant (l-autofight.cc rejects MB_FIREWOOD)', () => {
    // a plant east, adjacent; a rat three cells south: Tab walks toward the rat
    const s = room()
    monster(s, 5, 3, 1, 'hostile', true)
    monster(s, 4, 6, 2, 'hostile')
    const c = cam(0)
    expect(c.autofight(s)).toBe(false)
    expect(c.facing).toBe(4)
    // the fight in place: the plant beside us is no adjacent hostile
    const c2 = cam(0)
    expect(c2.faceAdjacentHostile(s)).toBe(false)
    expect(c2.facing).toBe(0)
    // only the plant in view: nothing to face at all
    s.billboards = s.billboards.slice(0, 1)
    expect(c2.faceHostile(s)).toBe(false)
    expect(c2.autofight(s)).toBe(false)
    expect(c2.facing).toBe(0)
  })

  it('a hostile outranks a neutral at the same distance', () => {
    const s = room()
    monster(s, 4, 1, 1, 'neutral')
    monster(s, 4, 5, 2, 'hostile')
    const c = cam(0)
    c.faceBlocker(s)
    expect(c.facing).toBe(4)
  })

  it('friendly and good-neutral company is not a blocker', () => {
    const s = room()
    monster(s, 4, 1, 1, 'friendly')
    monster(s, 4, 5, 2, 'good_neutral')
    const c = cam(2)
    expect(c.faceBlocker(s)).toBe(false)
    expect(c.facing).toBe(2)
  })

  it('the monster the server named wins over the nearest one', () => {
    const s = room()
    monster(s, 5, 3, 1, 'hostile')
    const named = monster(s, 0, 3, 2, 'hostile')
    const c = cam(0)
    c.faceBlocker(s, named)
    expect(c.facing).toBe(6)
  })
})

describe('the minimap heading', () => {
  it('eases toward the grid heading in step with the view, snapping only under reduced motion', () => {
    const c = new CameraController()
    c.setFacing(0, true)
    expect(c.mapYaw).toBe(0)
    // a quarter turn east: the map lags the same way the view does
    c.setFacing(2)
    expect(c.mapYaw).toBe(0)
    expect(c.update(0.02)).toBe(true)
    // a little ahead of the view, so it settles first
    expect(c.mapYaw).toBeGreaterThan(c.camera.yaw)
    for (let i = 0; i < 100; i++) c.update(0.02)
    expect(c.mapYaw).toBeCloseTo(Math.PI / 2)
    expect(c.update(0.02)).toBe(false)
    // a diagonal reads its left-hand compass heading up the map: from east to
    // south-east the view turns 45 degrees and the map stays put
    c.setFacing(3)
    for (let i = 0; i < 100; i++) c.update(0.02)
    expect(c.camera.yaw).toBeCloseTo((3 * Math.PI) / 4)
    expect(c.mapYaw).toBeCloseTo(Math.PI / 2)
    // reduced motion: straight there
    const r = cam(0)
    r.setFacing(4)
    expect(r.mapYaw).toBeCloseTo(Math.PI)
    // a restored view starts the map on its heading with no easing
    const b = new CameraController()
    b.restore({ yaw: 1.9, pitch: 0 })
    expect(b.mapYaw).toBeCloseTo(Math.PI / 2)
    expect(b.update(0.1)).toBe(false)
  })
})

describe('an aim reads its keys against the grid in view', () => {
  it('gridFacing is a compass facing itself, and a diagonal one is read from its left-hand axis', () => {
    for (const f of [0, 2, 4, 6] as const) expect(cam(f).gridFacing).toBe(f)
    // facing north-east: north runs up the left of the view (k), east up the right (l)
    expect(cam(1).gridFacing).toBe(0)
    expect(cam(3).gridFacing).toBe(2)
    expect(cam(5).gridFacing).toBe(4)
    expect(cam(7).gridFacing).toBe(6)
    // the view itself is not turned
    const c = cam(1)
    void c.gridFacing
    expect(c.facing).toBe(1)
  })

  it('the cursor walking in front of the player never turns the view', () => {
    const s = sceneFrom(['.....', '.....', '..@..', '.....', '.....'])
    const c = cam(0)
    for (const [x, y] of [
      [2, 1],
      [3, 1],
      [1, 1],
      [4, 0],
      [0, 0],
    ]) {
      c.faceCursorBehind(s, x, y)
      expect(c.facing).toBe(0)
    }
  })

  it('a cursor beside or behind turns to the heading nearest it, diagonals included', () => {
    const s = sceneFrom(['.....', '.....', '..@..', '.....', '.....'])
    const c = cam(0)
    c.faceCursorBehind(s, 3, 2)
    expect(c.facing).toBe(2)
    // still in front now: kept
    c.faceCursorBehind(s, 3, 1)
    expect(c.facing).toBe(2)
    c.faceCursorBehind(s, 1, 3)
    expect(c.facing).toBe(5)
    // the player's own cell says nothing
    c.faceCursorBehind(s, 2, 2)
    expect(c.facing).toBe(5)
  })

  it('a diagonal facing keeps the cursor walking in front of it', () => {
    const s = sceneFrom(['.....', '.....', '..@..', '.....', '.....'])
    const c = cam(1)
    // ahead of the line across the shoulders (north-west to south-east)
    for (const [x, y] of [[3, 1], [2, 1], [3, 2], [4, 0], [1, 0]]) {
      c.faceCursorBehind(s, x, y)
      expect(c.facing).toBe(1)
    }
    c.faceCursorBehind(s, 1, 3)
    expect(c.facing).toBe(5)
  })
})
