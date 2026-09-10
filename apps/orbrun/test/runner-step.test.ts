import { describe, it, expect } from 'vitest'
import { emptyScene } from '@orbrun/scene'
import { OWN_STEP_WINDOW_MS, Runner, stepIsOurs, type LastStep, type RunnerHooks } from '../src/runner'
import type { Session } from '../src/session'
import type { CameraController } from '../src/camera'

const step = (over: Partial<LastStep> = {}): LastStep => ({ dir: 2, turned: true, t: 1000, ...over })

describe('stepIsOurs', () => {
  it('claims a one-cell move in the direction the step was sent', () => {
    expect(stepIsOurs(step(), 1, 0, 1200)).toBe(true)
  })

  it('does not claim a move that went another way: a one-cell explore after a keyed step', () => {
    // stepped east, then `o` walked north-east and a monster came into view
    expect(stepIsOurs(step(), 1, -1, 1200)).toBe(false)
    // a pad step has the same rule
    expect(stepIsOurs(step({ dir: 0 }), 1, -1, 1200)).toBe(false)
  })

  it('forgets a step once the window has passed', () => {
    expect(stepIsOurs(step(), 1, 0, 1000 + OWN_STEP_WINDOW_MS)).toBe(false)
    expect(stepIsOurs(step(), 1, 0, 1000 + OWN_STEP_WINDOW_MS - 1)).toBe(true)
  })

  it('claims several echoed hops that all went the way the step was sent: a held stick, batched in one frame', () => {
    // strafing east on the stick, two echoes landed in the same scene update
    expect(stepIsOurs(step(), 2, 0, 1200, [{ dx: 1, dy: 0 }, { dx: 1, dy: 0 }])).toBe(true)
    // one of the hops went another way: a walk, not ours
    expect(stepIsOurs(step(), 2, -1, 1200, [{ dx: 1, dy: 0 }, { dx: 1, dy: -1 }])).toBe(false)
    // a multi-cell displacement without hops is still a jump
    expect(stepIsOurs(step(), 2, 0, 1200)).toBe(false)
  })

  it('never claims a jump or no step at all', () => {
    expect(stepIsOurs(step(), 5, -6, 1200)).toBe(false)
    expect(stepIsOurs(null, 1, 0, 1200)).toBe(false)
  })
})

describe('explore and the last step', () => {
  function runner() {
    const sent: unknown[] = []
    const faced: number[] = []
    const session = { watching: false, scene: emptyScene(), send: (m: unknown) => sent.push(m) } as unknown as Session
    const cam = { faceBlocker: () => (faced.push(1), false) } as unknown as CameraController
    const hooks = { context: () => ({ mode: 'command' }), now: () => 1000 } as unknown as RunnerHooks
    return { r: new Runner(session, cam, hooks), sent, faced }
  }

  it('sending `o` forgets the last step, so the explore’s first cell is path-driven', () => {
    const { r, sent, faced } = runner()
    r.lastStep = step()
    r.send({ msg: 'key', keycode: 'o'.charCodeAt(0) })
    expect(r.lastStep).toBeNull()
    expect(sent).toHaveLength(1)
    // with an unsafe monster in view the refusal is the event: the camera was asked to face the nearest blocker
    expect(faced).toHaveLength(1)
  })

  it('other keys keep the last step', () => {
    const { r } = runner()
    r.lastStep = step()
    r.send({ msg: 'key', keycode: 'i'.charCodeAt(0) })
    expect(r.lastStep).not.toBeNull()
  })
})

describe('autofight and the camera', () => {
  function runner(inReach: boolean) {
    const sent: unknown[] = []
    let swings = 0
    let asked = 0
    const session = { watching: false, scene: emptyScene(), send: (m: unknown) => sent.push(m) } as unknown as Session
    const cam = { autofight: () => (asked++, inReach) } as unknown as CameraController
    const hooks = { context: () => ({ mode: 'command' }), now: () => 1000, swing: () => swings++ } as unknown as RunnerHooks
    return { r: new Runner(session, cam, hooks), sent, swing: () => swings, asked: () => asked }
  }

  it('Tab hands the camera the autofight, and swings only when the threat is in reach', () => {
    const near = runner(true)
    near.r.send({ msg: 'key', keycode: 9 })
    expect(near.asked()).toBe(1)
    expect(near.swing()).toBe(1)
    expect(near.sent).toHaveLength(1)
    // out of reach: autofight walks, the camera closes on the threat, nothing is swung
    const far = runner(false)
    far.r.send({ msg: 'key', keycode: 9 })
    expect(far.asked()).toBe(1)
    expect(far.swing()).toBe(0)
    expect(far.sent).toHaveLength(1)
  })
})

describe('left and right in command mode', () => {
  function runner(watching = false) {
    const sent: { text: string }[] = []
    const turns: number[] = []
    const scene = emptyScene()
    scene.player = { ...scene.player, x: 5, y: 5 }
    const session = { watching, scene, send: (m: unknown) => sent.push(m as { text: string }) } as unknown as Session
    const faced: number[] = []
    let swung = 0
    const cam = { facing: 0, turn: (by: number) => turns.push(by), setFacing: (d: number) => faced.push(d), stopClosing: () => {} } as unknown as CameraController
    const hooks = { context: () => ({ mode: 'command' }), now: () => 1000, swing: () => swung++ } as unknown as RunnerHooks
    return { r: new Runner(session, cam, hooks), sent, turns, faced, swings: () => swung, scene }
  }

  it('the stick strafes: a sideways step is sent and the camera keeps its heading', () => {
    const { r, sent, turns } = runner()
    r.step(2)
    r.step(6)
    expect(turns).toEqual([])
    // facing north: right is east (l), left is west (h)
    expect(sent.map((m) => m.text)).toEqual(['l', 'h'])
    expect(r.lastStep).toMatchObject({ dir: 6, turned: false })
  })

  it('a step back into a friendly is a swap, not a swing: the heading stays', () => {
    const { r, sent, faced, swings, scene } = runner()
    // facing north at 5,5: back is south, 5,6
    scene.billboards.push({ kind: 'monster', x: 5, y: 6, attitude: 'friendly', tile: 0 } as never)
    r.step(4)
    expect(sent.map((m) => m.text)).toEqual(['j'])
    expect(r.lastStep).toMatchObject({ dir: 4, turned: false })
    expect(faced).toEqual([])
    expect(swings()).toBe(0)
    // a hostile there is a swing, and the camera turns onto it
    scene.billboards[0] = { kind: 'monster', x: 5, y: 6, attitude: 'hostile', tile: 0 } as never
    r.step(4)
    expect(r.lastStep).toMatchObject({ dir: 4, turned: true })
    expect(faced).toEqual([4])
    expect(swings()).toBe(1)
  })

  it('the keyboard and the d-pad turn: nothing is sent', () => {
    const { r, sent, turns } = runner()
    r.step(2, { keyboard: true })
    r.step(6, { keyboard: true })
    r.step(2, { turns: true })
    r.step(6, { turns: true })
    expect(sent).toEqual([])
    expect(turns).toEqual([1, -1, 1, -1])
  })

  it('spectating: h and l still turn the view, and no step is ever ours', () => {
    const { r, sent, turns } = runner(true)
    r.step(2, { keyboard: true })
    r.step(6, { keyboard: true })
    expect(turns).toEqual([1, -1])
    // a direction key that is not a turn does nothing: the camera follows the
    // watched player's own movement instead of a step we never took
    r.step(0, { keyboard: true })
    r.step(4, { keyboard: true })
    expect(sent).toEqual([])
    expect(r.lastStep).toBe(null)
  })

  it('Shift and Ctrl with left / right step from the keyboard too', () => {
    const { r, sent, turns } = runner()
    r.step(2, { keyboard: true, run: true })
    r.step(6, { keyboard: true, attack: true })
    expect(turns).toEqual([])
    expect(sent).toHaveLength(2)
  })
})
