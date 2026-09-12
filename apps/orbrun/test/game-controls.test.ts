// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cm, initialState } from '@orbrun/webtiles'
import { GamepadHints } from '../src/gamepad-hints'
import { GameScreen } from '../src/game'
import { HOLD_MS, type Action } from '../src/bindings'
import type { Context } from '../src/context'
import type { Button, PadEvent } from '../src/gamepad'

/** Exercise the real input routing without constructing a WebGL renderer or connecting. */
function harness() {
  const held = new Set<Button>()
  const execute = vi.fn<(a: Action) => void>()
  const send = vi.fn()
  const ctx: Context = { mode: 'command', layer: 'micro', ahead: { kind: 'none', label: '' }, under: { kind: 'none', label: '' }, hostilesInView: 0 }
  const overlays = { hasClientOverlay: false, clientOverlayInput: vi.fn(), showCommands: vi.fn(), showPalette: vi.fn(), menuKey: () => false, focusInfo: () => null }
  const state = initialState()
  const hints = new GamepadHints()
  const screen = Object.assign(Object.create(GameScreen.prototype), {
    ctx, hooks: { settings: () => ({}), gamepad: { isHeld: (b: Button) => held.has(b) } },
    session: { watching: false, state }, runner: { execute, send }, overlays, padHints: hints,
    chat: { capturing: false }, pressTimes: new Map(), holdFired: new Set(), tapArmed: new Set(),
    holding: null,
    lastInput: 'pad', pointerLive: false,
  }) as { pad(ev: PadEvent): void; fireHolds(t: number): void; holding: { button: Button; fraction: number } | null; onKeyDown(ev: KeyboardEvent): void; uiOp(op: string): void }
  const event = (ev: PadEvent) => {
    if (ev.type === 'press') held.add(ev.button)
    if (ev.type === 'release') held.delete(ev.button)
    screen.pad(ev)
  }
  return { screen, ctx, execute, send, overlays, event, state, hints }
}

beforeEach(() => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) } })
})

describe('direct game input', () => {
  it('B sends Escape once on press, never waits or rests', () => {
    const h = harness()
    h.event({ type: 'press', button: 'B', t: 0 })
    h.screen.fireHolds(HOLD_MS)
    h.event({ type: 'repeat', button: 'B', n: 1 })
    h.event({ type: 'release', button: 'B', t: 1000, held: 1000 })
    expect(h.execute).toHaveBeenCalledExactlyOnceWith({ kind: 'keys', seq: [{ key: 27 }], label: 'Cancel' })
  })

  it('B cancels a pending LB rest without spending a turn', () => {
    const h = harness()
    h.event({ type: 'press', button: 'LB', t: 0 })
    h.event({ type: 'press', button: 'B', t: 100 })
    h.screen.fireHolds(HOLD_MS)
    h.event({ type: 'release', button: 'LB', t: 500, held: 500 })
    expect(h.execute).toHaveBeenCalledExactlyOnceWith({ kind: 'keys', seq: [{ key: 27 }], label: 'Cancel' })
  })

  it('R3 opens examine without repeating into the resulting targeting mode', () => {
    const h = harness()
    h.event({ type: 'press', button: 'R3', t: 0 })
    h.ctx.mode = 'targeting'
    h.ctx.examining = true
    h.event({ type: 'repeat', button: 'R3', n: 1 })
    h.event({ type: 'release', button: 'R3', t: 1000, held: 1000 })
    expect(h.execute).toHaveBeenCalledExactlyOnceWith({ kind: 'examine' })
  })

  it('waits on LB release, never on press', () => {
    const h = harness()
    h.event({ type: 'press', button: 'LB', t: 0 })
    h.screen.fireHolds(100)
    expect(h.execute).not.toHaveBeenCalled()
    h.event({ type: 'release', button: 'LB', t: 150, held: 150 })
    expect(h.execute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ seq: [{ text: '.' }] }))
  })

  it('reports how far a held LB has come towards the rest, for its corner prompt, and nothing once released or fired', () => {
    const h = harness()
    h.event({ type: 'press', button: 'LB', t: 0 })
    h.screen.fireHolds(HOLD_MS / 4)
    expect(h.screen.holding).toEqual({ button: 'LB', fraction: 0.25 })
    h.screen.fireHolds(HOLD_MS)
    expect(h.screen.holding).toBeNull()
    h.event({ type: 'release', button: 'LB', t: HOLD_MS, held: HOLD_MS })
    h.event({ type: 'press', button: 'LB', t: 1000 })
    h.screen.fireHolds(1100)
    expect(h.screen.holding).not.toBeNull()
    h.event({ type: 'release', button: 'LB', t: 1150, held: 150 })
    expect(h.screen.holding).toBeNull()
  })

  it('rests once at the hold threshold, with no wait before or after it', () => {
    const h = harness()
    h.event({ type: 'press', button: 'LB', t: 0 })
    h.screen.fireHolds(HOLD_MS - 1)
    expect(h.execute).not.toHaveBeenCalled()
    h.screen.fireHolds(HOLD_MS)
    h.screen.fireHolds(HOLD_MS * 2)
    h.event({ type: 'release', button: 'LB', t: 1000, held: 1000 })
    expect(h.execute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ seq: [{ text: '5' }] }))
  })

  it('a tap-or-hold outside command mode still acts: Y in an aim cycles the quiver either way', () => {
    const h = harness()
    h.ctx.mode = 'targeting'
    h.event({ type: 'press', button: 'Y', t: 0 })
    h.screen.fireHolds(100)
    expect(h.execute).not.toHaveBeenCalled()
    h.event({ type: 'release', button: 'Y', t: 150, held: 150 })
    expect(h.execute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ seq: [{ text: ')' }] }))
    h.execute.mockClear()
    h.event({ type: 'press', button: 'Y', t: 1000 })
    h.screen.fireHolds(1000 + HOLD_MS)
    expect(h.execute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ seq: [{ text: '(' }] }))
    h.event({ type: 'release', button: 'Y', t: 2000, held: 1000 })
    expect(h.execute).toHaveBeenCalledOnce()
  })

  it('a mode change cancels a pending rest instead of turning a prompt into gameplay', () => {
    const h = harness()
    h.event({ type: 'press', button: 'LB', t: 0 })
    h.ctx.mode = 'menu'
    h.screen.fireHolds(HOLD_MS)
    h.ctx.mode = 'command'
    h.event({ type: 'release', button: 'LB', t: 200, held: 200 })
    expect(h.execute).not.toHaveBeenCalled()
  })

  it('another action cancels a pending hold', () => {
    const h = harness()
    h.event({ type: 'press', button: 'LB', t: 0 })
    h.event({ type: 'press', button: 'RT', t: 100 })
    h.screen.fireHolds(HOLD_MS)
    h.event({ type: 'release', button: 'LB', t: 500, held: 500 })
    expect(h.execute).toHaveBeenCalledExactlyOnceWith({ kind: 'fight' })
  })

  it.each(['menu', 'targeting', 'levelmap', 'prompt', 'yesno', 'popup', 'dialog', 'more'] as const)(
    'B backs out or continues in %s without waiting/resting after it closes', (mode) => {
      for (const held of [100, HOLD_MS * 2]) {
        const h = harness()
        h.ctx.mode = mode
        h.event({ type: 'press', button: 'B', t: 0 })
        const expected: Action = mode === 'menu' ? { kind: 'menu', op: 'cancel' }
          : mode === 'targeting' || mode === 'levelmap' ? { kind: 'keys', seq: [{ key: 27 }], label: 'Cancel' }
          : mode === 'more' ? { kind: 'keys', seq: [{ key: 32 }], label: 'Continue' }
          : { kind: 'focus', op: 'cancel' }
        expect(h.execute).toHaveBeenCalledExactlyOnceWith(expected)
        h.ctx.mode = 'command'
        h.screen.fireHolds(held)
        h.event({ type: 'release', button: 'B', t: held, held })
        expect(h.execute).toHaveBeenCalledTimes(1)
      }
    },
  )

  it.each([false, true])('LB paging a menu cannot wait or rest after it closes (client: %s)', (client) => {
    for (const held of [100, HOLD_MS * 2]) {
      const h = harness()
      h.overlays.hasClientOverlay = client
      h.ctx.mode = client ? 'command' : 'menu'
      h.event({ type: 'press', button: 'LB', t: 0 })
      if (client) expect(h.overlays.clientOverlayInput).toHaveBeenCalledExactlyOnceWith('bumperPrev')
      else expect(h.execute).toHaveBeenCalledExactlyOnceWith({ kind: 'menu', op: 'sectionPrev' })
      h.execute.mockClear()
      h.overlays.hasClientOverlay = false
      h.ctx.mode = 'command'
      h.screen.fireHolds(held)
      h.event({ type: 'release', button: 'LB', t: held, held })
      expect(h.execute).not.toHaveBeenCalled()
    }
  })

  it('B closing a client menu cannot wait or rest on release', () => {
    const h = harness()
    h.overlays.hasClientOverlay = true
    h.event({ type: 'press', button: 'B', t: 0 })
    expect(h.overlays.clientOverlayInput).toHaveBeenCalledExactlyOnceWith('cancel')
    h.overlays.hasClientOverlay = false
    h.screen.fireHolds(HOLD_MS)
    h.event({ type: 'release', button: 'B', t: HOLD_MS, held: HOLD_MS })
    expect(h.execute).not.toHaveBeenCalled()
  })

  it('holding RT neither repeats autofight nor confirms the resulting target/menu', () => {
    const h = harness()
    h.event({ type: 'press', button: 'RT', t: 0 })
    h.ctx.mode = 'targeting'
    h.event({ type: 'repeat', button: 'RT', n: 3 })
    h.event({ type: 'release', button: 'RT', t: 1000, held: 1000 })
    expect(h.execute).toHaveBeenCalledExactlyOnceWith({ kind: 'fight' })
  })

  it('Start opens the Orbrun menu on press in play (the way to Save and exit from the pad); holding or releasing adds nothing', () => {
    const h = harness()
    h.event({ type: 'press', button: 'START', t: 0 })
    expect(h.execute).toHaveBeenCalledExactlyOnceWith({ kind: 'ui', op: 'system' })
    h.screen.fireHolds(HOLD_MS)
    h.event({ type: 'release', button: 'START', t: 1000, held: 1000 })
    expect(h.execute).toHaveBeenCalledOnce()
  })

  it('Start submits a client menu or keyboard; only B cancels it', () => {
    const h = harness()
    h.overlays.hasClientOverlay = true
    h.event({ type: 'press', button: 'START', t: 0 })
    expect(h.overlays.clientOverlayInput).toHaveBeenLastCalledWith('submit')
    h.event({ type: 'press', button: 'B', t: 1 })
    expect(h.overlays.clientOverlayInput).toHaveBeenLastCalledWith('cancel')
    expect(h.execute).not.toHaveBeenCalled()
  })

  it('routes client-overlay bumpers separately from keyboard paging', () => {
    const h = harness()
    h.overlays.hasClientOverlay = true
    h.event({ type: 'press', button: 'RB', t: 0 })
    expect(h.overlays.clientOverlayInput).toHaveBeenLastCalledWith('bumperNext')
    h.event({ type: 'press', button: 'LB', t: 1 })
    expect(h.overlays.clientOverlayInput).toHaveBeenLastCalledWith('bumperPrev')
    h.screen.onKeyDown(new KeyboardEvent('keydown', { key: 'PageDown', cancelable: true }))
    expect(h.overlays.clientOverlayInput).toHaveBeenLastCalledWith('pageNext')
    h.screen.onKeyDown(new KeyboardEvent('keydown', { key: 'PageUp', cancelable: true }))
    expect(h.overlays.clientOverlayInput).toHaveBeenLastCalledWith('pagePrev')
    expect(h.execute).not.toHaveBeenCalled()
    expect(h.send).not.toHaveBeenCalled()
  })

  it('RB opens battle actions and Select opens the other commands', () => {
    const h = harness()
    h.execute.mockImplementation((a) => { if (a.kind === 'ui') h.screen.uiOp(a.op) })
    h.event({ type: 'press', button: 'RB', t: 0 })
    expect(h.overlays.showCommands).toHaveBeenLastCalledWith(expect.any(Function), 'battle')
    h.event({ type: 'press', button: 'SELECT', t: 1 })
    expect(h.overlays.showCommands).toHaveBeenLastCalledWith(expect.any(Function), 'select')
    expect(h.send).not.toHaveBeenCalled()
  })

  it('F2 opens commands without forwarding a key; native command keys still reach Crawl', () => {
    const h = harness()
    const f2 = new KeyboardEvent('keydown', { key: 'F2', code: 'F2', cancelable: true })
    h.screen.onKeyDown(f2)
    expect(f2.defaultPrevented).toBe(true)
    expect(h.overlays.showCommands).toHaveBeenCalledExactlyOnceWith(expect.any(Function), 'select')
    expect(h.send).not.toHaveBeenCalled()
    for (const key of ['q', 'r', 'z', 'm', 'g', 'G', '>', '<']) h.screen.onKeyDown(new KeyboardEvent('keydown', { key, cancelable: true }))
    expect(h.send.mock.calls.map(([m]) => m.text ?? m.keycode)).toEqual(['q', 'r', 'z', 'm', 'g', 'G', '>', '<'])
  })

  it('F1 is left to Crawl, which binds it to the game menu', () => {
    const h = harness()
    h.screen.onKeyDown(new KeyboardEvent('keydown', { key: 'F1', code: 'F1', cancelable: true }))
    expect(h.overlays.showCommands).not.toHaveBeenCalled()
    expect(h.overlays.showPalette).not.toHaveBeenCalled()
    expect(h.send).toHaveBeenCalledExactlyOnceWith(cm.key(-265))
  })
})

describe('viewmodel sync', () => {
  /** The hands rebuild on the player message, and again on the map that carries the paperdoll's shield. */
  function vmHarness() {
    const state = initialState()
    const setViewmodel = vi.fn()
    const screen = Object.assign(Object.create(GameScreen.prototype), {
      is3d: true, viewmodelRev: '', renderer: { setViewmodel }, session: { state, gamedata: undefined },
    }) as { syncViewmodel(st: typeof state): void }
    return { state, screen, setViewmodel }
  }

  it('rebuilds the hands when the map changes, since the shield rides the paperdoll on the player cell', () => {
    const h = vmHarness()
    h.state.rev.player++
    h.screen.syncViewmodel(h.state)
    expect(h.setViewmodel).toHaveBeenCalledTimes(1)
    h.state.rev.map++
    h.screen.syncViewmodel(h.state)
    expect(h.setViewmodel).toHaveBeenCalledTimes(2)
  })

  it('leaves the hands alone while neither message has changed', () => {
    const h = vmHarness()
    h.screen.syncViewmodel(h.state)
    h.screen.syncViewmodel(h.state)
    expect(h.setViewmodel).toHaveBeenCalledTimes(1)
  })
})
