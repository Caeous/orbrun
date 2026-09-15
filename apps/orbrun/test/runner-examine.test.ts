import { describe, it, expect, vi } from 'vitest'
import { emptyScene } from '@orbrun/scene'
import { MouseMode } from '@orbrun/webtiles'
import { LOOK_WINDOW_MS, ORBIT_WINDOW_MS, Runner, type RunnerHooks } from '../src/runner'
import type { Session, SessionEvent } from '../src/session'
import type { CameraController } from '../src/camera'
import type { Context } from '../src/context'

/**
 * R3: examine. Crawl's look mode (directn.cc `_look_around_target`) starts
 * its cursor on the player, so the runner sends `x`, and, once the server
 * has opened the mode with its cursor on the player, one direction key
 * moves it to the cell ahead, so A (`v`, CMD_TARGET_DESCRIBE) describes what
 * LB was pointed at. The cell is sent as a `target_cursor` message, the
 * mouse's hover while aiming, which is inert outside an aim: so it goes out
 * with `x` itself, a round trip early, and again on the cursor's arrival
 * should the first have missed. The view is not turned as `x` goes out:
 * the cell is the one faced. The same start
 * serves every aim (`f`, a spell, a wand): only a cursor the server put on
 * the player is moved, a default target is kept.
 */
function harness(facing = 0, ahead: Context['ahead'] = { kind: 'monster', monster: {} as never, hostile: true, label: 'goblin' }) {
  const sent: { msg: string; text?: string }[] = []
  const listeners: ((e: SessionEvent) => void)[] = []
  const state = { inputMode: MouseMode.COMMAND, messages: { more: false }, menus: [], ui: [], textInput: null, cursors: [] as ({ x: number; y: number } | null)[] }
  const scene = emptyScene()
  scene.player = { x: 10, y: 10 }
  scene.playerOnLevel = true
  const session = {
    watching: false,
    scene,
    state,
    send: (m: { msg: string; text?: string }) => sent.push(m),
    on: (fn: (e: SessionEvent) => void) => (listeners.push(fn), () => listeners.splice(listeners.indexOf(fn), 1)),
  } as unknown as Session
  const cam = {
    facing,
    // the camera's rule: a diagonal facing reads its left-hand axis as north
    get gridFacing() {
      return this.facing % 2 === 0 ? this.facing : (this.facing + 7) % 8
    },
  } as unknown as CameraController & { facing: number }
  const ctx = { mode: 'command', under: { kind: 'none' }, ahead, hostilesInView: 0 } as unknown as Context
  let now = 1000
  const hooks = { context: () => ctx, now: () => now, status: () => {}, confirmDangerous: () => false } as unknown as RunnerHooks
  const r = new Runner(session, cam, hooks)
  const emit = (e: SessionEvent) => listeners.slice().forEach((fn) => fn(e))
  // the server opens a mode: its cursor (id 0) lands on the player unless placed elsewhere; then a frame runs
  const mode = (m: number, cursor: { x: number; y: number } | null = m === MouseMode.COMMAND ? null : { x: 10, y: 10 }) => {
    state.inputMode = m
    state.cursors = cursor ? [cursor] : []
    ctx.mode = m === MouseMode.COMMAND ? 'command' : 'targeting'
    emit({ type: 'state', msg: { msg: 'input_mode', mode: m } })
    frame()
  }
  const frame = () => {
    ctx.examining = r.examining(ctx.mode)
    r.startAimAhead(ctx.mode)
  }
  // what went out: a key's text, or `@x,y` for a target_cursor
  const keys = () => sent.map((m) => (m.msg === 'target_cursor' ? `@${(m as { x: number }).x},${(m as { y: number }).y}` : m.text))
  // the server's cursor, with the runner's own walk settled: a cell put
  // there by anything but a walk of ours (the mouse, the aim opening) with
  // no step of ours still in flight
  const cursor = (c: { x: number; y: number }) => {
    state.cursors = [c]
    now += ORBIT_WINDOW_MS + 1
  }
  return { r, sent, ctx, cam, mode, frame, state, keys, cursor, tick: (ms: number) => (now += ms) }
}

/** the step each movement key takes, x east and y south */
const DIRS = { k: [0, -1], u: [1, -1], l: [1, 0], n: [1, 1], j: [0, 1], b: [-1, 1], h: [-1, 0], y: [-1, -1] } as const

describe('LB opens look mode on the cell ahead', () => {
  it('sends x and the cell faced together, then the cell again once the server shows its cursor on the player', () => {
    // facing north-east: the goblin is on the diagonal
    const h = harness(1)
    h.r.examine()
    // the target went out with x, in the same burst, before any round trip
    expect(h.keys()).toEqual(['x', '@11,9'])
    // the view did not turn as x went out
    expect(h.cam.facing).toBe(1)
    // the server opened the look with its cursor on the player: the same cell again, in case the first missed
    h.mode(MouseMode.TARGET)
    expect(h.keys()).toEqual(['x', '@11,9', '@11,9'])
  })

  it('needs no second send when the cursor arrives already ahead', () => {
    const h = harness(1)
    h.r.examine()
    h.mode(MouseMode.TARGET, { x: 11, y: 9 })
    expect(h.keys()).toEqual(['x', '@11,9'])
  })

  it('starts on the cell ahead whatever stands there: empty floor and unexplored ground too', () => {
    for (const ahead of [
      { kind: 'none', label: 'floor' },
      { kind: 'unknown', label: 'unexplored' },
      { kind: 'item', label: 'a dagger' },
      { kind: 'door-closed', label: 'closed door' },
    ] as Context['ahead'][]) {
      const h = harness(4, ahead)
      h.r.examine()
      h.mode(MouseMode.TARGET)
      expect(h.keys()).toEqual(['x', '@10,11', '@10,11'])
    }
  })

  it('never sends a direction key: the target message is a redraw wherever x failed to open a look', () => {
    const h = harness(0)
    h.r.examine()
    h.frame()
    h.mode(MouseMode.TARGET, null)
    h.state.cursors = [{ x: 10, y: 10 }]
    h.frame()
    expect(h.sent.every((m) => m.msg === 'target_cursor' || m.text === 'x')).toBe(true)
    expect(h.keys()).toEqual(['x', '@10,9', '@10,9'])
  })

  it('moves the cursor once per look: walked back onto the player it stays, and a description popup does not restart it', () => {
    const h = harness(0)
    h.r.examine()
    h.mode(MouseMode.TARGET)
    expect(h.keys()).toEqual(['x', '@10,9', '@10,9'])
    // the player brought the cursor home
    h.frame()
    h.frame()
    expect(h.keys()).toEqual(['x', '@10,9', '@10,9'])
    // v opened a description over the look, then the look resumed with the cursor where it was
    h.ctx.mode = 'popup'
    h.frame()
    h.ctx.mode = 'targeting'
    h.frame()
    expect(h.keys()).toEqual(['x', '@10,9', '@10,9'])
    // the look ended; the next one starts ahead again
    h.mode(MouseMode.COMMAND)
    h.r.examine()
    h.mode(MouseMode.TARGET)
    expect(h.keys()).toEqual(['x', '@10,9', '@10,9', 'x', '@10,9', '@10,9'])
  })

  it('in look mode A describes the cell under the cursor with v', () => {
    const h = harness(0)
    h.r.examine()
    h.mode(MouseMode.TARGET)
    expect(h.r.examining('targeting')).toBe(true)
    h.ctx.examining = true
    h.r.examine()
    expect(h.keys()).toEqual(['x', '@10,9', '@10,9', 'v'])
  })
})

describe('LT fires', () => {
  it('sends f to open the aim and f again to confirm it, whichever side of the round trip the tap lands', () => {
    const h = harness(0)
    h.ctx.hostilesInView = 1
    h.r.fire()
    // the second tap arrives before the server has reported the aim: still f, which confirms the shot
    h.r.fire()
    // the aim opened on its default target, a monster: the cursor is left on it
    h.mode(MouseMode.TARGET_PATH, { x: 13, y: 8 })
    h.r.fire()
    expect(h.keys()).toEqual(['f', 'f', 'f'])
    expect(h.r.examining('targeting')).toBe(false)
  })

  it('holds the view as f locks onto its target, and releases it on the first cursor step, read against the grid in view', () => {
    const h = harness(1)
    h.ctx.hostilesInView = 1
    h.r.fire()
    // nothing turned as f went out: the lock is crawl's, not a move of the player's
    expect(h.cam.facing).toBe(1)
    expect(h.r.holdingView('command')).toBe(false)
    // the aim opened on a monster behind: the view is held there too (game.ts faceCursor)
    h.mode(MouseMode.TARGET_PATH, { x: 8, y: 12 })
    expect(h.r.holdingView('targeting')).toBe(true)
    // confirming the shot inside the aim, or a typed f there, turns nothing
    h.r.fire()
    expect(h.cam.facing).toBe(1)
    // the first step of the cursor releases the hold and walks the grid in
    // view: facing north-east, k is north, up the left-hand edge of the view
    h.r.step(0)
    expect(h.cam.facing).toBe(1)
    expect(h.keys()).toEqual(['f', 'f', 'k'])
    expect(h.r.holdingView('targeting')).toBe(false)
    // u is straight ahead, up the right-hand edge of the grid in view
    h.r.step(1)
    // left and right walk the ring the cursor is on instead (`orbitStep`):
    // it stands two cells south-west of the player, the ring's corner, so
    // right turns the walk north up the ring's west side. Left then walks
    // back down it: the walk steps from where our own last step sent the
    // cursor, not from the cursor the server last reported (`orbitFrom`)
    h.r.step(2)
    h.r.step(6)
    expect(h.keys()).toEqual(['f', 'f', 'k', 'u', 'k', 'j'])
  })

  it('the hold ends with the aim, and any other command drops one a refused f left behind', () => {
    const h = harness(0)
    h.ctx.hostilesInView = 1
    h.r.fire()
    h.mode(MouseMode.TARGET_PATH, { x: 13, y: 8 })
    expect(h.r.holdingView('targeting')).toBe(true)
    // a --more-- over the aim keeps it
    expect(h.r.holdingView('more')).toBe(false)
    expect(h.r.holdingView('targeting')).toBe(true)
    h.mode(MouseMode.COMMAND)
    expect(h.r.holdingView('command')).toBe(false)
    expect(h.r.holdingView('targeting')).toBe(false)
    // f refused (nothing quivered): the x that follows is a look, not a held fire
    h.r.fire()
    h.r.examine()
    h.mode(MouseMode.TARGET)
    expect(h.r.holdingView('targeting')).toBe(false)
    // and one nothing followed within the window is forgotten
    const e = harness(0)
    e.r.fire()
    e.tick(LOOK_WINDOW_MS + 1)
    expect(e.r.holdingView('command')).toBe(false)
    e.ctx.mode = 'targeting'
    expect(e.r.holdingView('targeting')).toBe(false)
  })

  it('with nothing for crawl to pick, the cell ahead goes out with f, in the direction faced as f went out', () => {
    const h = harness(3)
    h.ctx.readiedAction = 'a stone'
    h.r.fire()
    expect(h.keys()).toEqual(['f', '@11,11'])
    // the view did not turn as f went out; the cell is the one faced
    expect(h.cam.facing).toBe(3)
    // the view turned on before the server answered; the aim still starts where f was aimed
    h.cam.facing = 6
    h.mode(MouseMode.TARGET_PATH, { x: 11, y: 11 })
    expect(h.keys()).toEqual(['f', '@11,11'])
  })

  it('with a hostile in view, or nothing quivered, f goes out alone; a cursor that still lands on the player is moved after', () => {
    const h = harness(3)
    h.ctx.readiedAction = 'a stone'
    h.ctx.hostilesInView = 2
    h.r.fire()
    expect(h.keys()).toEqual(['f'])
    // the hostile was out of range: crawl opened on the player
    h.mode(MouseMode.TARGET_PATH)
    expect(h.keys()).toEqual(['f', '@11,11'])
    const e = harness(3)
    e.r.fire()
    expect(e.keys()).toEqual(['f'])
  })

  it('a typed z (a spell), or any key, gets the start once its aim is up; the compass prompt has no cursor and is left alone', () => {
    const h = harness(2)
    h.r.send({ msg: 'input', text: 'z' })
    h.r.send({ msg: 'input', text: 'a' })
    // the spell prompt would take a stray target message as a redraw, but nothing is sent until the aim shows
    expect(h.keys()).toEqual(['z', 'a'])
    h.mode(MouseMode.TARGET)
    expect(h.keys()).toEqual(['z', 'a', '@11,10'])
    const d = harness(2)
    d.r.send({ msg: 'input', text: 'C' })
    d.mode(MouseMode.TARGET_DIR, null)
    expect(d.keys()).toEqual(['C'])
  })

  it('nothing while spectating: the cursor is the player being watched', () => {
    const h = harness(0)
    ;(h.r as unknown as { session: { watching: boolean } }).session.watching = true
    h.mode(MouseMode.TARGET)
    expect(h.keys()).toEqual([])
  })

  it('does nothing in look mode: the look is not an aim', () => {
    const h = harness(0, { kind: 'none', label: 'floor' })
    h.r.examine()
    h.mode(MouseMode.TARGET)
    h.r.fire()
    expect(h.keys()).toEqual(['x', '@10,9', '@10,9'])
  })
})

describe('the runner pairs its x with the targeting that follows', () => {
  it('is look mode from the targeting after x until that targeting ends', () => {
    const h = harness(0)
    expect(h.r.examining('command')).toBe(false)
    h.r.examine()
    expect(h.r.examining('command')).toBe(false)
    expect(h.r.examining('targeting')).toBe(true)
    expect(h.r.examining('targeting')).toBe(true)
    expect(h.r.examining('command')).toBe(false)
    // the next targeting is an aim, not a look
    expect(h.r.examining('targeting')).toBe(false)
  })

  it('survives a --more-- and the description popup: A must not turn into travel when the look resumes', () => {
    const h = harness(0)
    h.r.examine()
    expect(h.r.examining('targeting')).toBe(true)
    expect(h.r.examining('more')).toBe(false)
    expect(h.r.examining('targeting')).toBe(true)
    expect(h.r.examining('popup')).toBe(false)
    expect(h.r.examining('targeting')).toBe(true)
    // crawl ends the look after a description (directn.cc describe_target: force_cancel)
    expect(h.r.examining('command')).toBe(false)
    expect(h.r.examining('targeting')).toBe(false)
  })

  it('a look on a diagonal walks the cursor straight ahead and straight back, sides unchanged', () => {
    // facing north-east: the grid reads north as forward for every other aim
    const h = harness(1)
    h.r.examine()
    h.mode(MouseMode.TARGET)
    expect(h.ctx.examining).toBe(true)
    // forward runs along the facing itself: north-east, up the screen
    h.r.step(0)
    // and back along its opposite: south-west, down the screen
    h.r.step(4)
    expect(h.keys().slice(-2)).toEqual(['u', 'b'])
    // the diagonals still read against the grid: u is straight ahead, y is
    // north-west. The sides walk the ring the cursor stands on instead
    // (`orbitStep`); with the cursor still on the player there is no ring,
    // so they fall back to the grid: l is east, h is west
    h.r.step(2)
    h.r.step(6)
    h.r.step(1)
    h.r.step(7)
    expect(h.keys().slice(-4)).toEqual(['l', 'h', 'u', 'y'])
  })

  it('left and right walk the cursor round the player, keeping its distance, and turn at the diagonals', () => {
    const h = harness(1)
    h.r.examine()
    // the cursor stands two cells north-east of the player: the corner of
    // its ring. Right heads south down the ring's east side, left west
    // along its north side — mirror images, as they are at every cell
    h.mode(MouseMode.TARGET, { x: 12, y: 8 })
    h.r.step(2)
    expect(h.keys().slice(-1)).toEqual(['j'])
    h.cursor({ x: 12, y: 8 })
    h.r.step(6)
    expect(h.keys().slice(-1)).toEqual(['h'])
    // along a side of the ring the walk holds its heading: south all the way
    // down the east side, until the south-east corner turns it west
    for (const [at, right] of [
      [{ x: 12, y: 9 }, 'j'],
      [{ x: 12, y: 10 }, 'j'],
      [{ x: 12, y: 11 }, 'j'],
      [{ x: 12, y: 12 }, 'h'],
      [{ x: 11, y: 12 }, 'h'],
      [{ x: 8, y: 12 }, 'k'],
      [{ x: 8, y: 10 }, 'k'],
      [{ x: 8, y: 8 }, 'l'],
      [{ x: 10, y: 8 }, 'l'],
    ] as const) {
      h.cursor({ ...at })
      h.r.step(2)
      expect(h.keys().slice(-1)).toEqual([right])
    }
    // a whole lap of the ring: the cursor never leaves it, either way round
    for (const side of [2, 6] as const) {
      const at = { x: 12, y: 8 }
      h.cursor({ ...at })
      for (let i = 0; i < 16; i++) {
        h.state.cursors = [{ ...at }]
        h.r.step(side)
        const d = DIRS[h.keys()[h.keys().length - 1] as keyof typeof DIRS]
        at.x += d[0]
        at.y += d[1]
        expect(Math.max(Math.abs(at.x - 10), Math.abs(at.y - 10))).toBe(2)
      }
      // and comes back where it set out, a lap being 8 cells a ring-step out
      expect(at).toEqual({ x: 12, y: 8 })
    }
  })

  it('a held key keeps walking the ring while the server\'s cursor trails it', () => {
    const h = harness(1)
    h.r.examine()
    // the cursor stands two cells north-east of the player, on the corner of
    // its ring, and the key repeats faster than the round trip: every repeat
    // is walked from where our own last step sent it, never from the cursor
    // the server last reported, which has not moved yet
    h.mode(MouseMode.TARGET, { x: 12, y: 8 })
    const at = { x: 12, y: 8 }
    for (let i = 0; i < 12; i++) {
      h.r.step(2)
      const d = DIRS[h.keys()[h.keys().length - 1] as keyof typeof DIRS]
      at.x += d[0]
      at.y += d[1]
      // read against the stale cursor every repeat would send j, and the
      // cursor would walk straight off the ring down the column
      expect(Math.max(Math.abs(at.x - 10), Math.abs(at.y - 10))).toBe(2)
    }
    // three quarters of the way round the ring (16 cells to the lap), not
    // twelve cells south of where it started
    expect(at).toEqual({ x: 8, y: 8 })
  })

  it('takes the server\'s cursor as it catches up, and the rest of the walk with it', () => {
    const h = harness(1)
    h.r.examine()
    h.mode(MouseMode.TARGET, { x: 12, y: 8 })
    // four steps out, none echoed yet: the cursor is walked down the ring's
    // east side to its south-east corner, (12,12)
    h.r.step(2)
    h.r.step(2)
    h.r.step(2)
    h.r.step(2)
    expect(h.keys().slice(-4)).toEqual(['j', 'j', 'j', 'j'])
    // the server echoes the first of them: the three behind it are still in
    // flight, so the walk carries on from the corner and turns west. Rewound
    // to (12,9) it would head south down the side again
    h.state.cursors = [{ x: 12, y: 9 }]
    h.r.step(2)
    expect(h.keys().slice(-1)).toEqual(['h'])
  })

  it('gives the walk up and reads the server again when crawl never moves the cursor', () => {
    const h = harness(1)
    h.r.examine()
    // the walk runs off the level's edge, where crawl holds the cursor: our
    // own path is never echoed, and after the window the cursor the server
    // reports is believed again rather than drifting on under a held key
    h.mode(MouseMode.TARGET, { x: 12, y: 12 })
    h.r.step(2)
    expect(h.keys().slice(-1)).toEqual(['h'])
    h.tick(ORBIT_WINDOW_MS + 1)
    h.r.step(2)
    expect(h.keys().slice(-1)).toEqual(['h'])
  })

  it('drops the walk when anything else moves the cursor', () => {
    const h = harness(1)
    h.r.examine()
    h.mode(MouseMode.TARGET, { x: 12, y: 8 })
    h.r.step(2)
    expect(h.keys().slice(-1)).toEqual(['j'])
    // a click put the cursor somewhere of its own: the walk starts again
    // from what the server reports, not from where our step had sent it
    h.r.clickCell(8, 8, 1)
    h.state.cursors = [{ x: 8, y: 8 }]
    h.r.step(2)
    expect(h.keys().slice(-1)).toEqual(['l'])
  })

  it('a fire or an attack down a side is a direction, not a walk round the player', () => {
    const h = harness(1)
    h.r.examine()
    h.mode(MouseMode.TARGET, { x: 12, y: 8 })
    // Shift fires that way, Ctrl sends the ctrl key: both read against the
    // grid in view, as every aim's keys but the plain walk do
    h.r.step(2, { run: true })
    expect(h.keys().slice(-1)).toEqual(['L'])
    // ctrl-h: west, the grid's own left, not the ring's
    h.r.step(6, { attack: true })
    expect(h.sent[h.sent.length - 1]).toEqual({ msg: 'key', keycode: 'H'.charCodeAt(0) - 64 })
  })

  it('a look on a compass facing is unchanged: the facing is its own grid', () => {
    const h = harness(2)
    h.r.examine()
    h.mode(MouseMode.TARGET)
    h.r.step(0)
    h.r.step(4)
    h.r.step(2)
    expect(h.keys().slice(-3)).toEqual(['l', 'h', 'j'])
  })

  it('a typed x counts too: the keyboard gets the same look mode', () => {
    const h = harness(3)
    h.r.send({ msg: 'input', text: 'x' })
    expect(h.cam.facing).toBe(3)
    expect(h.r.examining('targeting')).toBe(true)
  })

  it('forgets an x nothing followed within the window', () => {
    const h = harness(0)
    h.r.examine()
    h.tick(LOOK_WINDOW_MS + 1)
    expect(h.r.examining('command')).toBe(false)
    expect(h.r.examining('targeting')).toBe(false)
  })

  it('an x sent outside command mode (cancel in targeting) is not a look', () => {
    const h = harness(0)
    h.ctx.mode = 'targeting'
    h.r.send({ msg: 'input', text: 'x' })
    expect(h.r.examining('targeting')).toBe(false)
  })
})
