import { describe, it, expect, vi } from 'vitest'
import { emptyScene } from '@orbrun/scene'
import { MouseMode } from '@orbrun/webtiles'
import { LOOK_WINDOW_MS, Runner, type RunnerHooks } from '../src/runner'
import type { Session, SessionEvent } from '../src/session'
import type { CameraController } from '../src/camera'
import type { Context } from '../src/context'

/**
 * LB: examine. Crawl's look mode (directn.cc `_look_around_target`) starts
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
  return { r, sent, ctx, cam, mode, frame, state, keys, tick: (ms: number) => (now += ms) }
}

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
    // l is east, up the right-hand edge; u is straight ahead
    h.r.step(2)
    h.r.step(1)
    expect(h.keys()).toEqual(['f', 'f', 'k', 'l', 'u'])
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
