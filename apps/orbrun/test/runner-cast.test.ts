import { describe, it, expect, vi } from 'vitest'
import { emptyScene } from '@orbrun/scene'
import { MouseMode, MSGCH } from '@orbrun/webtiles'
import { Runner, type RunnerHooks } from '../src/runner'
import type { Session, SessionEvent } from '../src/session'
import type { CameraController } from '../src/camera'

/**
 * RT + A casts spell `a`: `z`, then the letter once the server has asked.
 * Crawl asks "Cast which spell? (? or * to list)" as an MSGCH_PROMPT line
 * and reads the key with `get_ch`, the mouse mode still MOUSE_MODE_COMMAND
 * (spl-cast.cc `cast_a_spell`); with `spell_menu` the spell list opens as a
 * menu instead. With no spells it prints "You don't know any spells." and
 * the letter must never go out as a command of its own (`a` is abilities).
 */
function harness() {
  const sent: { msg: string; text?: string }[] = []
  const listeners: ((e: SessionEvent) => void)[] = []
  const state = { inputMode: MouseMode.COMMAND, messages: { more: false, lines: [] as { text: string; channel?: number }[] }, menus: [] as unknown[], ui: [], textInput: null, rev: { messages: 0 } }
  const session = {
    watching: false,
    scene: emptyScene(),
    state,
    send: (m: { msg: string; text?: string }) => sent.push(m),
    on: (fn: (e: SessionEvent) => void) => (listeners.push(fn), () => listeners.splice(listeners.indexOf(fn), 1)),
  } as unknown as Session
  const cam = { facing: 0 } as unknown as CameraController
  const ctx = { mode: 'command', under: { kind: 'none' }, ahead: { kind: 'none' }, hostilesInView: 0 }
  const hooks = { context: () => ctx, now: () => 1000, status: () => {}, confirmDangerous: () => false } as unknown as RunnerHooks
  const r = new Runner(session, cam, hooks)
  const emit = (e: SessionEvent) => listeners.slice().forEach((fn) => fn(e))
  const message = (text: string, channel: number) => {
    state.messages.lines.push({ text, channel })
    state.rev.messages++
    emit({ type: 'state', msg: { msg: 'msgs' } })
  }
  return { r, sent, state, emit, message, keys: () => sent.map((m) => m.text) }
}

const CAST_A = [{ text: 'z' }, { text: 'a', await: 'prompt' as const }]

describe('casting from the pad', () => {
  it('sends the letter once "Cast which spell?" is printed, though the mouse mode never changes', () => {
    const h = harness()
    h.r.sendKeys(CAST_A)
    expect(h.keys()).toEqual(['z'])
    h.message('Cast which spell? (? or * to list) ', MSGCH.PROMPT)
    expect(h.keys()).toEqual(['z', 'a'])
  })

  it('a prompt line already on screen from before does not count', () => {
    const h = harness()
    h.state.messages.lines.push({ text: 'Cast which spell? (? or * to list) ', channel: MSGCH.PROMPT })
    h.r.sendKeys(CAST_A)
    expect(h.keys()).toEqual(['z'])
    h.message('Cast which spell? (? or * to list) ', MSGCH.PROMPT)
    expect(h.keys()).toEqual(['z', 'a'])
  })

  it('with spell_menu the list opens as a menu and the letter goes to it', () => {
    const h = harness()
    h.r.sendKeys(CAST_A)
    h.state.menus.push({})
    h.emit({ type: 'state', msg: { msg: 'menu' } })
    expect(h.keys()).toEqual(['z', 'a'])
  })

  it('with no spells the letter is dropped: "You don\'t know any spells." is not a prompt', () => {
    vi.useFakeTimers()
    const h = harness()
    h.r.sendKeys(CAST_A)
    h.message("You don't know any spells.", MSGCH.PLAIN)
    expect(h.keys()).toEqual(['z'])
    vi.advanceTimersByTime(2000)
    h.message('Cast which spell? (? or * to list) ', MSGCH.PROMPT)
    expect(h.keys()).toEqual(['z'])
    vi.useRealTimers()
  })
})
