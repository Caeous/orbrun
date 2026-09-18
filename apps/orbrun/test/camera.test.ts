import { describe, it, expect } from 'vitest'
import { REST_PITCH, cellKey, emptyScene, type Billboard, type Scene, type SceneCell } from '@orbrun/scene'
import { CameraController, MAP_TURNS_DIAGONAL, trailStep } from '../src/camera'

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
    // the ground and the view make the same turn at the same rate, so they
    // swing as one; on quarters the map runs a little ahead and settles first
    if (MAP_TURNS_DIAGONAL) expect(c.mapYaw).toBe(c.camera.yaw)
    else expect(c.mapYaw).toBeGreaterThan(c.camera.yaw)
    for (let i = 0; i < 100; i++) c.update(0.02)
    expect(c.mapYaw).toBeCloseTo(Math.PI / 2)
    expect(c.update(0.02)).toBe(false)
    // east to south-east: the view turns 45 degrees, and the map's ground
    // goes with it only under MAP_TURNS_DIAGONAL — otherwise a diagonal
    // stands on its left-hand compass heading and the map stays put
    c.setFacing(3)
    for (let i = 0; i < 100; i++) c.update(0.02)
    expect(c.camera.yaw).toBeCloseTo((3 * Math.PI) / 4)
    expect(c.mapYaw).toBeCloseTo(MAP_TURNS_DIAGONAL ? (3 * Math.PI) / 4 : Math.PI / 2)
    // a look turns the view to headings between the detents: where the
    // ground turns with the view it goes there too, at once, so what is
    // ahead in the scene is up the map on every frame
    c.lookBy(0.3, 0)
    expect(c.camera.yaw).toBeCloseTo((3 * Math.PI) / 4 + 0.3)
    expect(c.mapYaw).toBeCloseTo(MAP_TURNS_DIAGONAL ? (3 * Math.PI) / 4 + 0.3 : Math.PI / 2)
    c.update(0.02)
    expect(c.mapYaw).toBeCloseTo(MAP_TURNS_DIAGONAL ? (3 * Math.PI) / 4 + 0.3 : Math.PI / 2)
    c.endDrag()
    // reduced motion: straight there
    const r = cam(0)
    r.setFacing(4)
    expect(r.mapYaw).toBeCloseTo(Math.PI)
    // a restored view starts the map on its heading with no easing: the
    // view's own yaw where the ground turns with it, its quarter otherwise
    const b = new CameraController()
    b.restore({ yaw: 1.9, pitch: 0 })
    expect(b.mapYaw).toBeCloseTo(MAP_TURNS_DIAGONAL ? 1.9 : Math.PI / 2)
    expect(b.update(0.1)).toBe(false)
  })

  it('stands what is on the ground against the grid heading, and the lean never passes a half-quarter', () => {
    /** how far what stands on the ground leans, in radians */
    const lean = (c: CameraController) => {
      let d = c.mapYaw - c.mapUprightYaw
      while (d > Math.PI) d -= 2 * Math.PI
      while (d < -Math.PI) d += 2 * Math.PI
      return d
    }
    const c = new CameraController()
    c.setFacing(0, true)
    expect(lean(c)).toBe(0)
    // the ground never parts from the view it stands for
    if (MAP_TURNS_DIAGONAL) {
      c.setFacing(2)
      for (let i = 0; i < 6; i++) {
        c.update(0.02)
        expect(c.mapYaw).toBe(c.camera.yaw)
      }
      for (let i = 0; i < 100; i++) c.update(0.02)
      c.setFacing(0, true)
    }
    // onto a diagonal: the ground turns 45 degrees, the sprites lean with it
    c.setFacing(1)
    for (let i = 0; i < 100; i++) c.update(0.02)
    expect(c.mapYaw).toBeCloseTo(MAP_TURNS_DIAGONAL ? Math.PI / 4 : 0)
    expect(c.mapUprightYaw).toBeCloseTo(0)
    // on off the diagonal: both head for east together, so the lean falls
    // away rather than flipping to the other side on the way
    let worst = 0
    c.setFacing(2)
    for (let i = 0; i < 100; i++) {
      c.update(0.02)
      worst = Math.max(worst, Math.abs(lean(c)))
    }
    expect(worst).toBeLessThanOrEqual(Math.PI / 4 + 1e-6)
    expect(c.mapUprightYaw).toBeCloseTo(Math.PI / 2)
    expect(lean(c)).toBeCloseTo(0)
  })
})

describe('an aim reads its keys against the grid in view', () => {
  it('gridFacing is a compass facing itself, and a diagonal one is read from its left-hand axis', () => {
    for (const f of [0, 2, 4, 6] as const) expect(cam(f).gridFacing).toBe(f)
    // facing north-east: north runs up the left of the view (k), east up the
    // right (l). The keys keep their quarters however the map's ground turns.
    expect(cam(1).gridFacing).toBe(0)
    expect(cam(3).gridFacing).toBe(2)
    expect(cam(5).gridFacing).toBe(4)
    expect(cam(7).gridFacing).toBe(6)
    // the view itself is not turned
    const c = cam(1)
    void c.gridFacing
    expect(c.facing).toBe(1)
  })

  it('the cursor walking in front of the player, off every ray, never turns the view', () => {
    const s = sceneFrom(['.......', '.......', '.......', '...@...', '.......', '.......', '.......'])
    const c = cam(0)
    for (const [x, y] of [
      [3, 2],
      [4, 1],
      [2, 1],
      [5, 2],
      [1, 2],
      [6, 1],
      [0, 1],
    ]) {
      c.faceCursorBehind(s, x, y)
      expect(c.facing).toBe(0)
    }
  })

  it('a cursor stepping onto a ray from the player turns to that heading, in front or not', () => {
    const s = sceneFrom(['.......', '.......', '.......', '...@...', '.......', '.......', '.......'])
    const c = cam(0)
    // the north-east diagonal, still in front of a north facing
    c.faceCursorBehind(s, 5, 1)
    expect(c.facing).toBe(1)
    // off the ray again, and in front of north-east: kept
    c.faceCursorBehind(s, 5, 2)
    expect(c.facing).toBe(1)
    // due east: an aim opened on a diagonal turns to the compass heading as
    // soon as the cursor steps onto its line, not once it falls behind
    c.faceCursorBehind(s, 5, 3)
    expect(c.facing).toBe(2)
    c.faceCursorBehind(s, 3, 6)
    expect(c.facing).toBe(4)
    c.faceCursorBehind(s, 1, 1)
    expect(c.facing).toBe(7)
  })

  it('a cursor beside or behind turns to the heading nearest it, diagonals included', () => {
    const s = sceneFrom(['.......', '.......', '.......', '...@...', '.......', '.......', '.......'])
    const c = cam(0)
    // beside, off every ray
    c.faceCursorBehind(s, 6, 4)
    expect(c.facing).toBe(2)
    // still in front now: kept
    c.faceCursorBehind(s, 5, 2)
    expect(c.facing).toBe(2)
    c.faceCursorBehind(s, 2, 5)
    expect(c.facing).toBe(5)
    // the player's own cell says nothing
    c.faceCursorBehind(s, 3, 3)
    expect(c.facing).toBe(5)
  })

  it('a diagonal facing keeps the cursor walking in front of it, off every ray', () => {
    const s = sceneFrom(['.......', '.......', '.......', '...@...', '.......', '.......', '.......'])
    const c = cam(1)
    // ahead of the line across the shoulders (north-west to south-east)
    for (const [x, y] of [[4, 1], [5, 2], [6, 2], [2, 1], [6, 1]]) {
      c.faceCursorBehind(s, x, y)
      expect(c.facing).toBe(1)
    }
    c.faceCursorBehind(s, 2, 5)
    expect(c.facing).toBe(5)
  })
})

describe('the eye glides after a step', () => {
  const onPath = (c: CameraController, ax: number, ay: number, bx: number, by: number) => {
    const { eyeX, eyeY } = c.camera
    // on the segment a..b: collinear and between
    const cross = (bx - ax) * (eyeY - ay) - (by - ay) * (eyeX - ax)
    const dot = (eyeX - ax) * (bx - ax) + (eyeY - ay) * (by - ay)
    return Math.abs(cross) < 1e-9 && dot >= -1e-9 && dot <= (bx - ax) ** 2 + (by - ay) ** 2 + 1e-9
  }
  it('eases a single step from the old cell to the new one, and rests there', () => {
    const c = new CameraController()
    c.snapTo(3, 3)
    c.walkTo(4, 3, [{ dx: 1, dy: 0 }])
    // the cell is the goal at once; the eye is still on the old cell
    expect(c.camera.x).toBe(4)
    expect(c.camera.eyeX).toBe(3)
    expect(c.update(0.02)).toBe(true)
    expect(c.camera.eyeX).toBeGreaterThan(3)
    expect(c.camera.eyeX).toBeLessThan(4)
    expect(c.camera.eyeY).toBe(3)
    for (let i = 0; i < 100; i++) c.update(0.02)
    expect(c.camera.eyeX).toBe(4)
    expect(c.update(0.02)).toBe(false)
  })
  it('follows the hops round a corner rather than the straight line through it', () => {
    const c = new CameraController()
    c.snapTo(0, 0)
    // east then north: the corner cell (1,0) is passed, the diagonal never taken
    c.walkTo(1, -1, [{ dx: 1, dy: 0 }, { dx: 0, dy: -1 }])
    let seenCorner = false
    for (let i = 0; i < 100; i++) {
      c.update(0.01)
      const leg1 = onPath(c, 0, 0, 1, 0)
      const leg2 = onPath(c, 1, 0, 1, -1)
      expect(leg1 || leg2).toBe(true)
      if (leg2 && c.camera.eyeY < 0) seenCorner = true
    }
    expect(seenCorner).toBe(true)
    expect(c.camera.eyeX).toBe(1)
    expect(c.camera.eyeY).toBe(-1)
  })
  it('bounds fast travel to two grid steps behind and lands within 180 ms of its final update', () => {
    const c = new CameraController()
    c.snapTo(0, 0)
    // a cell every frame, as `travel_delay 20` sends them
    for (let i = 1; i <= 20; i++) {
      c.walkTo(i, 0, [{ dx: 1, dy: 0 }])
      c.update(0.02)
      expect(i - c.camera.eyeX).toBeLessThanOrEqual(2 + 1e-9)
      expect(c.camera.eyeX).toBeLessThanOrEqual(i)
    }
    // two hops in one frame: the same catch-up ceiling, not two full animations
    c.walkTo(22, 0, [{ dx: 1, dy: 0 }, { dx: 1, dy: 0 }])
    c.update(0.02)
    expect(22 - c.camera.eyeX).toBeLessThanOrEqual(2 + 1e-9)
    for (let i = 0; i < 8; i++) c.update(0.02)
    expect(c.camera.eyeX).toBe(22)
    expect(c.update(0.02)).toBe(false)
  })
  it('snaps a jump: several cells with no hops, hops that do not add up, a level change, reduced motion', () => {
    const c = new CameraController()
    c.snapTo(0, 0)
    c.walkTo(5, 0, [])
    expect(c.camera.eyeX).toBe(5)
    expect(c.update(0.02)).toBe(false)
    // hops that do not reach the destination: a single cell falls back to the straight line
    c.walkTo(6, 1, [{ dx: 0, dy: 1 }])
    c.update(0.02)
    expect(c.camera.eyeX).toBeGreaterThan(5)
    expect(c.camera.eyeX).toBeLessThan(6)
    for (let i = 0; i < 100; i++) c.update(0.02)
    // ...and a longer one is a jump
    c.walkTo(9, 1, [{ dx: 1, dy: 0 }])
    expect(c.camera.eyeX).toBe(9)
    // a snap mid-glide drops the rest of the path
    c.walkTo(10, 1, [{ dx: 1, dy: 0 }])
    c.snapTo(20, 20)
    expect(c.update(0.02)).toBe(false)
    expect(c.camera.eyeX).toBe(20)
    const r = cam(0)
    r.snapTo(0, 0)
    r.walkTo(1, 0, [{ dx: 1, dy: 0 }])
    expect(r.camera.eyeX).toBe(1)
    expect(r.update(0.02)).toBe(false)
  })
})

describe('movement timing', () => {
  function walking(dx = 1, dy = 0) {
    const c = new CameraController()
    c.snapTo(0, 0)
    c.walkTo(dx, dy, [{ dx, dy }])
    return c
  }

  it.each([30, 60, 120, 144])('lands within one frame of 180 ms at %i Hz, without overshoot', (fps) => {
    const c = walking()
    let previous = 0
    for (let i = 1; i <= Math.ceil(0.18 * fps); i++) {
      c.update(1 / fps)
      expect(c.camera.eyeX).toBeGreaterThanOrEqual(previous)
      expect(c.camera.eyeX).toBeLessThanOrEqual(1)
      if (i / fps < 0.18) expect(c.camera.eyeX).toBeLessThan(1)
      previous = c.camera.eyeX
    }
    expect(c.camera.eyeX).toBe(1)
    expect(c.update(1 / fps)).toBe(false)
  })

  it('keeps a prompt start but brakes to zero, without a long settling tail', () => {
    const c = walking()
    c.update(1 / 60)
    expect(c.camera.eyeX).toBeGreaterThan(0.2)
    expect(c.camera.eyeX).toBeLessThan(0.3)
    c.update(0.12 - 1 / 60)
    expect(c.camera.eyeX).toBeGreaterThan(0.95)
    c.update(0.05)
    const beforeLanding = c.camera.eyeX
    c.update(0.01)
    expect(1 - beforeLanding).toBeLessThan(0.001)
    expect(c.camera.eyeX).toBe(1)
  })

  it('has the same trajectory at equal times, regardless of frame partitions', () => {
    const reference = walking()
    reference.update(0.1)
    for (const frames of [[0.05, 0.05], Array(6).fill(1 / 60), Array(12).fill(1 / 120), [0.01, 0.03, 0.005, 0.055]]) {
      const c = walking()
      for (const dt of frames) c.update(dt)
      expect(c.camera.eyeX).toBeCloseTo(reference.camera.eyeX, 12)
    }
  })

  it.each([[1, 1], [1, -1], [-1, 1], [-1, -1]])('paces the diagonal (%i,%i) like one cardinal step', (dx, dy) => {
    const cardinal = walking()
    const diagonal = walking(dx, dy)
    for (let i = 0; i < 12; i++) {
      cardinal.update(1 / 60)
      diagonal.update(1 / 60)
      expect(diagonal.camera.eyeX / dx).toBeCloseTo(cardinal.camera.eyeX, 12)
      expect(diagonal.camera.eyeY / dy).toBeCloseTo(cardinal.camera.eyeX, 12)
    }
  })

  it('carries velocity through a new confirmed step, then lands on the new deadline', () => {
    const c = walking()
    const epsilon = 1e-6
    c.update(0.1 - epsilon)
    const before = c.camera.eyeX
    c.update(epsilon)
    const atReply = c.camera.eyeX
    const speedBefore = (atReply - before) / epsilon
    c.walkTo(2, 0, [{ dx: 1, dy: 0 }])
    expect(c.camera.eyeX).toBe(atReply)
    c.update(epsilon)
    const speedAfter = (c.camera.eyeX - atReply) / epsilon
    expect(speedAfter).toBeCloseTo(speedBefore, 2)
    c.update(0.18 - epsilon)
    expect(c.camera.eyeX).toBe(2)
    expect(c.update(0.01)).toBe(false)
  })

  it('retargets consistently across frame rates without restarting on duplicate updates', () => {
    function run(dt: number) {
      const c = walking()
      for (let i = 0; i < Math.round(0.1 / dt); i++) c.update(dt)
      c.walkTo(2, 0, [{ dx: 1, dy: 0 }])
      for (let i = 0; i < Math.round(0.1 / dt); i++) {
        c.walkTo(2, 0, [])
        c.update(dt)
      }
      return c
    }
    const a = run(1 / 30)
    const b = run(1 / 120)
    expect(a.camera.eyeX).toBeCloseTo(b.camera.eyeX, 12)
    a.update(0.08)
    b.update(0.08)
    expect(a.camera.eyeX).toBe(2)
    expect(b.camera.eyeX).toBe(2)
  })

  it('keeps a reversal on the confirmed out-and-back path, without overshooting it', () => {
    const c = walking()
    c.update(0.06)
    c.walkTo(0, 0, [{ dx: -1, dy: 0 }])
    const before = c.camera.eyeX
    c.update(0.001)
    expect(c.camera.eyeX).toBeGreaterThan(before) // finish the outward leg first
    for (let i = 0; i < 18; i++) {
      c.update(0.01)
      expect(c.camera.eyeX).toBeGreaterThanOrEqual(0)
      expect(c.camera.eyeX).toBeLessThanOrEqual(1)
    }
    expect(c.camera.eyeX).toBe(0)
    expect(c.update(0.01)).toBe(false)
  })

  it('bounds delayed diagonal batches in grid steps and finishes the whole batch in 180 ms', () => {
    const c = new CameraController()
    c.walkTo(20, -20, Array.from({ length: 20 }, () => ({ dx: 1, dy: -1 })))
    c.update(0.01)
    expect(20 - c.camera.eyeX).toBeLessThanOrEqual(2 + 1e-9)
    let previous = c.camera.eyeX
    for (let i = 0; i < 17; i++) {
      c.update(0.01)
      expect(c.camera.eyeX).toBeGreaterThanOrEqual(previous)
      expect(c.camera.eyeX).toBeLessThanOrEqual(20)
      expect(c.camera.eyeY).toBeCloseTo(-c.camera.eyeX, 12)
      previous = c.camera.eyeX
    }
    expect(c.camera.eyeX).toBe(20)
    expect(c.update(0.01)).toBe(false)
  })

  it('does not move on a zero/invalid frame, and finishes after a long frame', () => {
    const c = walking()
    for (const dt of [0, -1, NaN, Infinity]) expect(c.update(dt)).toBe(false)
    expect(c.camera.eyeX).toBe(0)
    c.update(1)
    expect(c.camera.eyeX).toBe(1)
    expect(c.update(0.01)).toBe(false)
  })

  it('ignores zero hops, and honours reduced motion enabled during a glide', () => {
    const c = walking()
    c.update(0.05)
    c.walkTo(1, 0, [{ dx: 0, dy: 0 }])
    c.update(0.13)
    expect(c.update(0.01)).toBe(false)
    c.walkTo(2, 0, [{ dx: 1, dy: 0 }])
    c.update(0.02)
    c.reducedMotion = true
    expect(c.update(0.01)).toBe(true)
    expect(c.camera.eyeX).toBe(2)
    expect(c.update(0.01)).toBe(false)
  })

  it('drops a malformed hop list rather than accepting a valid prefix', () => {
    const c = walking()
    c.walkTo(3, 0, [{ dx: 1, dy: 0 }, { dx: 1, dy: 0 }, { dx: NaN, dy: 0 }])
    expect(c.camera.eyeX).toBe(3)
    expect(c.update(0.01)).toBe(false)
  })
})

describe('frame-independent turning', () => {
  it('matches yaw and minimap rotation at equal elapsed times', () => {
    const a = new CameraController()
    const b = new CameraController()
    a.turn(2)
    b.turn(2)
    a.update(0.1)
    for (let i = 0; i < 12; i++) b.update(1 / 120)
    expect(a.camera.yaw).toBeCloseTo(b.camera.yaw, 12)
    expect(a.mapYaw).toBeCloseTo(b.mapYaw, 12)
    expect(a.mapUprightYaw).toBeCloseTo(b.mapUprightYaw, 12)
    expect(a.camera.yaw).toBeLessThan(Math.PI / 2) // a 100 ms hitch no longer snaps the turn
  })

  it('takes the short turn across north and retargets from the displayed yaw', () => {
    const c = new CameraController()
    c.restore({ yaw: 350 * Math.PI / 180, pitch: REST_PITCH })
    c.setFacing(0)
    c.update(0.02)
    expect(c.camera.yaw).toBeGreaterThan(350 * Math.PI / 180)
    const before = c.camera.yaw
    c.setFacing(7)
    expect(c.camera.yaw).toBe(before)
    c.update(0.02)
    expect(c.camera.yaw).toBeLessThan(before)
    expect(c.camera.yaw).toBeGreaterThan(315 * Math.PI / 180)
  })
})
