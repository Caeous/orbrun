import { describe, it, expect, vi } from 'vitest'
import { emptyScene } from '@orbrun/scene'
import { MouseMode } from '@orbrun/webtiles'
import { Runner, type RunnerHooks } from '../src/runner'
import type { Session, SessionEvent } from '../src/session'
import type { CameraController } from '../src/camera'

/**
 * A: close the open door ahead. Crawl (movement.cc close_door_action) closes a
 * lone adjacent door on `C` alone when easy_door is on (the default), and
 * prompts "Which direction?" in MOUSE_MODE_TARGET_DIR otherwise
 * (target-compass.cc prompt_compass_direction). The rc is not published to
 * the client, so the direction goes out only when that mode arrives.
 */
function harness(facing = 0) {
  const sent: { msg: string; text?: string }[] = []
  const listeners: ((e: SessionEvent) => void)[] = []
  const state = { inputMode: MouseMode.COMMAND, messages: { more: false }, menus: [], ui: [], textInput: null }
  const session = {
    watching: false,
    scene: emptyScene(),
    state,
    send: (m: { msg: string; text?: string }) => sent.push(m),
    on: (fn: (e: SessionEvent) => void) => (listeners.push(fn), () => listeners.splice(listeners.indexOf(fn), 1)),
  } as unknown as Session
  const cam = { facing } as unknown as CameraController
  const ctx = { mode: 'command', under: { kind: 'none' }, ahead: { kind: 'feature', feature: { type: 'door', state: 'open' }, label: 'open door' }, hostilesInView: 0 }
  const hooks = { context: () => ctx, now: () => 1000, status: () => {}, confirmDangerous: () => false } as unknown as RunnerHooks
  const r = new Runner(session, cam, hooks)
  const emit = (e: SessionEvent) => listeners.slice().forEach((fn) => fn(e))
  const mode = (m: number) => {
    state.inputMode = m
    emit({ type: 'state', msg: { msg: 'input_mode', mode: m } })
  }
  return { r, sent, state, emit, mode, keys: () => sent.map((m) => m.text) }
}

describe('A closes the door ahead', () => {
  it('sends C alone, and the direction only once the server asks for one', () => {
    const h = harness(2)
    h.r.contextual()
    expect(h.keys()).toEqual(['C'])
    // "Which direction?": the server enters MOUSE_MODE_TARGET_DIR
    h.mode(MouseMode.TARGET_DIR)
    // facing east: the direction is `l`, as a step would be
    expect(h.keys()).toEqual(['C', 'l'])
    // back in command mode nothing more goes out
    h.mode(MouseMode.COMMAND)
    h.emit({ type: 'scene', scene: emptyScene() })
    expect(h.keys()).toEqual(['C', 'l'])
  })

  it('with easy_door the door closes on C alone: the map moves on and no direction is sent', () => {
    const h = harness(0)
    h.r.contextual()
    expect(h.keys()).toEqual(['C'])
    h.emit({ type: 'state', msg: { msg: 'msgs' } })
    h.emit({ type: 'scene', scene: emptyScene() })
    // a later prompt is some other command's, not ours
    h.mode(MouseMode.TARGET_DIR)
    expect(h.keys()).toEqual(['C'])
  })

  it('gives up quietly when nothing comes back', () => {
    vi.useFakeTimers()
    const h = harness(0)
    h.r.contextual()
    vi.advanceTimersByTime(2000)
    h.mode(MouseMode.TARGET_DIR)
    expect(h.keys()).toEqual(['C'])
    vi.useRealTimers()
  })
})
