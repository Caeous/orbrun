import { describe, expect, it, vi } from 'vitest'
import { emptyScene } from '@orbrun/scene'
import { initialState, MouseMode } from '@orbrun/webtiles'
import { CameraController } from '../src/camera'
import { GameScreen } from '../src/game'
import { Runner, type RunnerHooks } from '../src/runner'
import type { Session } from '../src/session'

/** Real input, hop tracking and scene-to-camera routing; no socket, DOM or renderer. */
function harness() {
  const state = initialState()
  state.inputMode = MouseMode.COMMAND
  const scene = emptyScene()
  scene.playerOnLevel = true
  const send = vi.fn()
  const session = { watching: false, state, scene, send } as unknown as Session
  const cam = new CameraController()
  const swing = vi.fn()
  const runner = new Runner(session, cam, {
    context: () => ({ mode: 'command' }), now: () => performance.now(), swing,
  } as unknown as RunnerHooks)
  const screen = Object.assign(Object.create(GameScreen.prototype), {
    session, cam, runner, wake: vi.fn(), lastPos: { x: 0, y: 0 }, hopPos: { x: 0, y: 0 },
    hops: [], jumped: false, lastLevel: `${state.player.place}:${state.player.depth}`,
    lastMonsters: new Set(), padStep: null, arrivalPending: false,
  }) as { trackHop(): void; onScene(): void }
  const position = (x: number, y: number) => {
    state.player.pos = { x, y }
    scene.player = { ...scene.player, x, y }
    screen.trackHop()
  }
  const echo = (x: number, y: number) => {
    position(x, y)
    screen.onScene()
  }
  return { cam, runner, state, scene, send, swing, position, echo, flush: () => screen.onScene() }
}

describe('forward input and confirmed camera motion', () => {
  it('moves in the intended grid direction during a turn, without waiting for the animation', () => {
    const h = harness()
    h.cam.turn(1)
    h.cam.update(1 / 60)
    expect(h.cam.camera.yaw).toBeLessThan(Math.PI / 8)
    h.runner.step(0)
    expect(h.send).toHaveBeenCalledExactlyOnceWith({ msg: 'input', text: 'u' })
    expect(h.cam.camera.eyeX).toBe(0)
    expect(h.cam.camera.eyeY).toBe(0)
    h.echo(1, -1)
    expect(h.cam.camera.x).toBe(1)
    expect(h.cam.camera.eyeX).toBe(0)
    const pitch = h.cam.camera.pitch
    h.cam.update(0.18)
    expect(h.cam.camera.eyeX).toBe(1)
    expect(h.cam.camera.eyeY).toBe(-1)
    expect(h.cam.camera.pitch).toBe(pitch)
    expect(h.cam.facing).toBe(1)
  })

  it('keeps a newer turn when an older forward reply arrives', () => {
    const h = harness()
    h.runner.step(0)
    h.runner.step(2, { turns: true })
    expect(h.send).toHaveBeenCalledTimes(1) // turning is local and costs no game turn
    h.cam.update(0.04)
    const yaw = h.cam.camera.yaw
    h.echo(0, -1)
    expect(h.cam.facing).toBe(1)
    expect(h.cam.camera.yaw).toBe(yaw)
    h.cam.update(0.18)
    expect(h.cam.camera.yaw).toBeGreaterThan(yaw)
    expect(h.cam.camera.eyeY).toBe(-1)
  })

  it('accepts a turn during a glide even when another old forward step is in flight', () => {
    const h = harness()
    h.runner.step(0)
    h.echo(0, -1)
    h.cam.update(0.04)
    h.runner.step(0)
    h.runner.execute({ kind: 'turn', dir: 'left' })
    h.echo(0, -2)
    expect(h.cam.facing).toBe(7)
    h.cam.update(0.18)
    expect(h.cam.camera.eyeY).toBe(-2)
    h.cam.update(1)
    expect(h.cam.camera.yaw).toBeCloseTo(7 * Math.PI / 4, 3)
  })

  it('does not mistake an older reply for travel after forward is pressed in the new heading', () => {
    const h = harness()
    h.runner.step(0)
    h.runner.step(2, { turns: true })
    h.runner.step(0)
    expect(h.send.mock.calls.map(([m]) => m.text)).toEqual(['k', 'u'])
    h.echo(0, -1) // first forward arrives after the next forward was already sent
    expect(h.cam.facing).toBe(1)
    h.echo(1, -2)
    expect(h.cam.facing).toBe(1)
    h.cam.update(0.18)
    expect(h.cam.camera.eyeX).toBe(1)
    expect(h.cam.camera.eyeY).toBe(-2)
  })

  it('preserves a turn when differently directed manual steps arrive in one frame', () => {
    const h = harness()
    h.runner.step(0)
    h.runner.step(2, { turns: true })
    h.runner.step(0)
    h.runner.step(2, { turns: true }) // face east, while north then north-east are still in flight
    h.position(0, -1)
    h.position(1, -2)
    h.flush()
    expect(h.cam.facing).toBe(2)
    h.cam.update(0.18)
    expect(h.cam.camera.eyeX).toBe(1)
    expect(h.cam.camera.eyeY).toBe(-2)
  })

  it('aligns a mixed batch to its final manual step, not the net displacement', () => {
    const h = harness()
    h.runner.step(0)
    h.runner.step(2, { turns: true })
    h.runner.step(0)
    h.position(0, -1)
    h.position(1, -2)
    h.flush()
    expect(h.cam.facing).toBe(1) // north-east, not the net vector's nearest heading (north)
  })

  it('forgets old movement intents on explore and does not claim unmatched or expired replies', () => {
    const h = harness()
    h.runner.step(0)
    h.runner.step(2, { turns: false })
    const now = h.runner.lastStep!.t
    expect(h.runner.stepForMove(0, -1, now)).not.toBeNull()
    expect(h.runner.stepForMove(0, 1, now)).toBeNull()
    expect(h.runner.stepForMove(2, 0, now)).toBeNull() // no invented intermediate hops
    expect(h.runner.stepForMove(1, 0, now + 1500)).toBeNull()
    expect(h.runner.stepForMove(1, 1, now, [{ dx: 1, dy: 0 }, { dx: 0, dy: 1 }])).toBeNull()
    h.runner.send({ msg: 'input', text: 'o' })
    expect(h.runner.stepForMove(0, -1, now)).toBeNull()
    h.runner.step(2, { turns: false })
    expect(h.runner.stepForMove(0, -1, h.runner.lastStep!.t)).toBeNull()
  })

  it.each(['drag', 'stick'] as const)('keeps a newer %s look even after it is released before the reply', (input) => {
    const h = harness()
    h.runner.step(0)
    if (input === 'drag') {
      h.cam.lookBy(0.3, 0.1)
      h.cam.endDrag()
    } else {
      h.cam.look(1, 0.5)
      h.cam.update(0.1)
      h.cam.look(0, 0)
    }
    const view = h.cam.view
    h.echo(0, -1)
    h.cam.update(0.18)
    expect(h.cam.view).toEqual(view)
    expect(h.cam.camera.eyeY).toBe(-1)
  })

  it('keeps free look until the step is confirmed, then aligns to the actual step', () => {
    const h = harness()
    const yaw = 20 * Math.PI / 180
    h.cam.lookBy(yaw, 0)
    h.cam.endDrag()
    h.runner.step(0)
    expect(h.send).toHaveBeenCalledExactlyOnceWith({ msg: 'input', text: 'k' })
    h.cam.update(0.1)
    expect(h.cam.camera.yaw).toBe(yaw)
    expect(h.cam.camera.eyeY).toBe(0)
    h.echo(0, -1)
    expect(h.cam.camera.yaw).toBe(yaw) // no snap when the reply arrives
    h.cam.update(0.02)
    expect(h.cam.camera.yaw).toBeGreaterThan(0)
    expect(h.cam.camera.yaw).toBeLessThan(yaw)
    expect(h.cam.camera.eyeY).toBeLessThan(0)
  })

  it('does not override an active drag when a movement reply arrives', () => {
    const h = harness()
    h.runner.step(0)
    h.cam.lookBy(0.2, 0.1)
    const view = h.cam.view
    h.echo(0, -1)
    h.cam.update(0.18)
    expect(h.cam.view).toEqual(view)
    expect(h.cam.camera.eyeY).toBe(-1)
  })

  it('does not predict a walk for an attack or a blocked forward press', () => {
    const h = harness()
    h.runner.step(0)
    h.flush() // no position change: a wall, door, or refused action
    expect(h.cam.update(0.2)).toBe(false)
    expect(h.cam.camera.eyeY).toBe(0)
    h.scene.billboards.push({ kind: 'monster', x: 0, y: -1, attitude: 'hostile', tile: 0 })
    h.runner.step(0)
    h.flush()
    expect(h.swing).toHaveBeenCalledOnce()
    expect(h.cam.update(0.2)).toBe(false)
    expect(h.cam.camera.eyeY).toBe(0)
  })

  it('sends held steps without waiting for replies, but only glides over confirmed positions', () => {
    const h = harness()
    for (let i = 0; i < 3; i++) h.runner.execute({ kind: 'step', dir: 0, held: true })
    expect(h.send).toHaveBeenCalledTimes(3)
    h.cam.update(0.8) // delayed replies: no speculative movement
    expect(h.cam.camera.eyeY).toBe(0)
    h.position(0, -1)
    h.position(0, -2)
    h.position(0, -3)
    h.flush()
    expect(h.cam.camera.y).toBe(-3)
    expect(h.cam.camera.eyeY).toBe(0)
    h.cam.update(0.02)
    expect(h.cam.camera.eyeY).toBeGreaterThan(-3)
    expect(h.cam.camera.eyeY).toBeLessThanOrEqual(-1)
    h.cam.update(0.16)
    expect(h.cam.camera.eyeY).toBe(-3)
    expect(h.cam.update(0.1)).toBe(false)
    expect(h.send).toHaveBeenCalledTimes(3) // finishing the glide never sends another step
  })

  it('lets the next command through while the previous confirmed step is still gliding', () => {
    const h = harness()
    h.runner.step(0)
    h.echo(0, -1)
    h.cam.update(0.05)
    const eye = h.cam.camera.eyeY
    h.runner.step(0)
    expect(h.send).toHaveBeenCalledTimes(2)
    expect(h.cam.camera.eyeY).toBe(eye)
    h.echo(0, -2)
    expect(h.cam.camera.eyeY).toBe(eye)
    h.cam.update(0.18)
    expect(h.cam.camera.eyeY).toBe(-2)
  })

  it('keeps strafe facing across a batch of replies', () => {
    const h = harness()
    h.runner.step(2, { turns: false })
    h.position(1, 0)
    h.position(2, 0)
    h.flush()
    h.cam.update(0.18)
    expect(h.cam.camera.eyeX).toBe(2)
    expect(h.cam.camera.yaw).toBe(0)
  })

  it('snaps unknown jumps and level changes, dropping any old glide', () => {
    const h = harness()
    h.echo(0, -1)
    h.cam.update(0.02)
    h.echo(10, 10)
    expect(h.cam.camera.eyeX).toBe(10)
    expect(h.cam.camera.eyeY).toBe(10)
    h.echo(11, 10)
    h.cam.update(0.02)
    h.state.player.depth++
    h.echo(11, 11) // even an adjacent arrival is not a walk between levels
    expect(h.cam.camera.eyeX).toBe(11)
    expect(h.cam.camera.eyeY).toBe(11)
    h.cam.update(1)
    expect(h.cam.camera.eyeX).toBe(11)
    expect(h.cam.camera.eyeY).toBe(11)
  })
})
