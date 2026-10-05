// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cm, initialState } from '@orbrun/webtiles'
import { GamepadHints } from '../src/gamepad-hints'
import { GameScreen } from '../src/game'
import { HOLD_MS, LEVEL_MAP, type Action } from '../src/bindings'
import type { Context } from '../src/context'
import type { Button, PadEvent } from '../src/gamepad'

/** X from the map: crawl's spell menu, `z` (its `*` follows once `z` asks, game.ts trackActions) */
const SPELLS: Action = { kind: 'keys', label: 'Spells', seq: [{ text: 'z' }] }

/** An inventory with sections: X describes its rows and the bumpers jump between them. */
const SECTIONED = { menu: { tag: 'inventory', items: [], flags: 0 } as never, hoverable: [], arrowsSelect: true, multiselect: false, wrap: false, filter: false, sections: true, anyMarked: false }

/** Exercise the real input routing without constructing a WebGL renderer or connecting. */
function harness() {
  const held = new Set<Button>()
  const execute = vi.fn<(a: Action) => void>()
  const send = vi.fn()
  const step = vi.fn()
  const ctx: Context = { mode: 'command', layer: 'micro', ahead: { kind: 'none', label: '' }, under: { kind: 'none', label: '' }, hostilesInView: 0 }
  const overlays = { hasClientOverlay: false, openMenu: null as string | null, clientOverlayInput: vi.fn(), showActionTabs: vi.fn(), showPalette: vi.fn(), showSystem: vi.fn(), menuKey: () => false, focusInfo: () => null }
  const state = initialState()
  const hints = new GamepadHints()
  const screen = Object.assign(Object.create(GameScreen.prototype), {
    ctx, hooks: { settings: () => ({}), gamepad: { isHeld: (b: Button) => held.has(b) } },
    session: { watching: false, state, server: {} }, runner: { execute, send, step }, overlays, padHints: hints,
    chat: { capturing: false }, pressTimes: new Map(), holdFired: new Set(), tapArmed: new Set(),
    holding: null,
    // This input-only harness bypasses the constructor and has no frame loop or renderer.
    wake: vi.fn(),
    lastInput: 'pad', pointerLive: false, actionTabUp: 'spells',
  }) as { pad(ev: PadEvent): void; fireHolds(t: number): void; holding: { button: Button; fraction: number } | null; onKeyDown(ev: KeyboardEvent): void; uiOp(op: string): void }
  const event = (ev: PadEvent) => {
    if (ev.type === 'press') held.add(ev.button)
    if (ev.type === 'release') held.delete(ev.button)
    screen.pad(ev)
  }
  return { screen, ctx, execute, send, step, overlays, event, state, hints }
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
    // a fire's aim, which has a quiver to cycle (crawl's hint names "Q - select action")
    h.ctx.aimQuiver = true
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
          : mode === 'more' ? { kind: 'keys', seq: [{ key: 27 }], label: 'Skip' }
          // a yes/no's B is its No, whatever crawl's default
          : mode === 'yesno' ? { kind: 'prompt', hotkey: 'N' }
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
      h.ctx.menu = SECTIONED
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

  it('X examining a menu cannot open the actions after it closes', () => {
    for (const held of [100, HOLD_MS * 2]) {
      const h = harness()
      h.ctx.mode = 'menu'
      h.ctx.menu = SECTIONED
      h.event({ type: 'press', button: 'X', t: 0 })
      expect(h.execute).toHaveBeenCalledExactlyOnceWith({ kind: 'menu', op: 'examine' })
      h.execute.mockClear()
      h.ctx.mode = 'command'
      h.screen.fireHolds(held)
      h.event({ type: 'release', button: 'X', t: held, held })
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

  it('holding RT keeps autofighting, and releasing adds nothing', () => {
    const h = harness()
    h.event({ type: 'press', button: 'RT', t: 0 })
    h.event({ type: 'repeat', button: 'RT', n: 1 })
    h.event({ type: 'repeat', button: 'RT', n: 2 })
    h.event({ type: 'release', button: 'RT', t: 1000, held: 1000 })
    expect(h.execute).toHaveBeenCalledTimes(3)
    for (const call of h.execute.mock.calls) expect(call[0]).toEqual({ kind: 'fight' })
  })

  it('a held RT never confirms what the swing opened: the repeat is read against the mode of the moment', () => {
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

  it.each([
    ['START', { kind: 'ui', op: 'system' }],
    ['X', { kind: 'ui', op: 'commands' }],
  ] as const)('%s opens its menu and the same button puts it away', (button, action) => {
    const h = harness()
    // the real uiOp opens the overlay; the mocked runner stands in for it
    h.execute.mockImplementation(() => { h.overlays.hasClientOverlay = true })
    h.event({ type: 'press', button, t: 0 })
    h.event({ type: 'release', button, t: 100, held: 100 })
    expect(h.execute).toHaveBeenCalledExactlyOnceWith(action)
    h.event({ type: 'press', button, t: 200 })
    expect(h.overlays.clientOverlayInput).toHaveBeenCalledExactlyOnceWith('close')
    expect(h.execute).toHaveBeenCalledOnce()
  })

  it('a screen reached from inside the Start menu still closes with Start, not with A', () => {
    const h = harness()
    h.execute.mockImplementation(() => { h.overlays.hasClientOverlay = true })
    h.event({ type: 'press', button: 'START', t: 0 })
    // A opens the settings page inside the menu: the opener is still Start
    h.event({ type: 'press', button: 'A', t: 100 })
    expect(h.overlays.clientOverlayInput).toHaveBeenLastCalledWith('select')
    h.event({ type: 'press', button: 'START', t: 200 })
    expect(h.overlays.clientOverlayInput).toHaveBeenLastCalledWith('close')
  })

  it('forgets the opener once the menu is gone, so the next press opens again', () => {
    const h = harness()
    h.execute.mockImplementation(() => { h.overlays.hasClientOverlay = true })
    h.event({ type: 'press', button: 'START', t: 0 })
    h.overlays.clientOverlayInput.mockImplementation(() => { h.overlays.hasClientOverlay = false })
    h.event({ type: 'press', button: 'START', t: 100 })
    h.execute.mockClear()
    h.event({ type: 'press', button: 'START', t: 200 })
    expect(h.execute).toHaveBeenCalledExactlyOnceWith({ kind: 'ui', op: 'system' })
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

  it('Select opens the level map, and there closes it, held or not', () => {
    const h = harness()
    h.execute.mockImplementation((a) => { if (a.kind === 'ui') h.screen.uiOp(a.op) })
    h.event({ type: 'press', button: 'SELECT', t: 0 })
    h.event({ type: 'release', button: 'SELECT', t: 100, held: 100 })
    expect(h.execute).toHaveBeenLastCalledWith(LEVEL_MAP)
    expect(h.execute).not.toHaveBeenCalledWith(SPELLS)
    h.ctx.mode = 'levelmap'
    h.event({ type: 'press', button: 'SELECT', t: 200 })
    h.event({ type: 'release', button: 'SELECT', t: 300, held: 100 })
    expect(h.execute).toHaveBeenLastCalledWith({ kind: 'keys', seq: [{ key: 27 }], label: 'Close' })
    h.event({ type: 'press', button: 'SELECT', t: 400 })
    h.screen.fireHolds(400 + HOLD_MS)
    h.event({ type: 'release', button: 'SELECT', t: 400 + HOLD_MS + 100, held: HOLD_MS + 100 })
    expect(h.execute).toHaveBeenLastCalledWith({ kind: 'keys', seq: [{ key: 27 }], label: 'Close' })
    expect(h.overlays.showPalette).not.toHaveBeenCalled()
  })

  it("X opens the actions on crawl's own menu; Y opens the pack itself", () => {
    const h = harness()
    h.execute.mockImplementation((a) => { if (a.kind === 'ui') h.screen.uiOp(a.op) })
    h.event({ type: 'press', button: 'X', t: 0 })
    expect(h.execute).toHaveBeenLastCalledWith(SPELLS)
    // the frame lights the tab at once, and crawl's menu takes its place when it comes
    expect(h.overlays.showActionTabs).toHaveBeenCalledExactlyOnceWith('spells', null)
    h.event({ type: 'press', button: 'Y', t: 2 })
    expect(h.execute).toHaveBeenLastCalledWith({ kind: 'keys', label: 'Inventory', seq: [{ text: 'i' }] })
  })

  it('F2 opens the level map as Select does; native command keys still reach Crawl', () => {
    const h = harness()
    const f2 = new KeyboardEvent('keydown', { key: 'F2', code: 'F2', cancelable: true })
    h.screen.onKeyDown(f2)
    expect(f2.defaultPrevented).toBe(true)
    expect(h.execute).toHaveBeenCalledExactlyOnceWith(LEVEL_MAP)
    expect(h.send).not.toHaveBeenCalled()
    for (const key of ['q', 'r', 'z', 'm', 'g', 'G', '>', '<']) h.screen.onKeyDown(new KeyboardEvent('keydown', { key, cancelable: true }))
    expect(h.send.mock.calls.map(([m]) => m.text ?? m.keycode)).toEqual(['q', 'r', 'z', 'm', 'g', 'G', '>', '<'])
  })

  it('F2 to F5 open the four menus the pad opens, each key closing its own and switching from another', () => {
    const h = harness()
    const press = (key: string) => {
      const ev = new KeyboardEvent('keydown', { key, code: key, cancelable: true })
      h.screen.onKeyDown(ev)
      expect(ev.defaultPrevented).toBe(true)
    }
    press('F3')
    expect(h.execute).toHaveBeenLastCalledWith(SPELLS)
    press('F4')
    expect(h.execute).toHaveBeenLastCalledWith({ kind: 'keys', label: 'Inventory', seq: [{ text: 'i' }] })
    press('F5')
    expect(h.overlays.showSystem).toHaveBeenCalledOnce()
    // the actions are open: F2 puts them away for the level map, which F2 puts away again
    h.overlays.hasClientOverlay = true
    h.overlays.openMenu = 'battle'
    press('F2')
    expect(h.overlays.clientOverlayInput).toHaveBeenCalledExactlyOnceWith('close')
    expect(h.execute).toHaveBeenLastCalledWith(LEVEL_MAP)
    h.overlays.hasClientOverlay = false
    h.overlays.openMenu = null
    h.ctx.mode = 'levelmap'
    press('F2')
    expect(h.execute).toHaveBeenLastCalledWith({ kind: 'keys', label: 'Cancel', seq: [{ key: 27 }] })
    expect(h.send).not.toHaveBeenCalled()
  })

  it('off the map F3 and F4 open nothing, and F2 the palette, which no button opens', () => {
    const h = harness()
    h.ctx.mode = 'targeting'
    for (const key of ['F3', 'F4']) h.screen.onKeyDown(new KeyboardEvent('keydown', { key, code: key, cancelable: true }))
    expect(h.execute).not.toHaveBeenCalled()
    h.screen.onKeyDown(new KeyboardEvent('keydown', { key: 'F2', code: 'F2', cancelable: true }))
    expect(h.overlays.showPalette).toHaveBeenCalledExactlyOnceWith('targeting')
    expect(h.send).not.toHaveBeenCalled()
  })

  it('a direction letter reaches a prompt raw, and is a facing-relative step only in command mode', () => {
    // the faded altar reads `b` as "learn about the second god" (god-prayer.cc `_prompt_ecu_worship`)
    const h = harness()
    h.ctx.mode = 'prompt'
    h.screen.onKeyDown(new KeyboardEvent('keydown', { key: 'b', cancelable: true }))
    expect(h.send).toHaveBeenCalledExactlyOnceWith(cm.input('b'))
    expect(h.step).not.toHaveBeenCalled()
    h.ctx.mode = 'command'
    h.screen.onKeyDown(new KeyboardEvent('keydown', { key: 'b', cancelable: true }))
    expect(h.send).toHaveBeenCalledOnce()
    expect(h.step).toHaveBeenCalledOnce()
  })

  it('F1 is left to Crawl, which binds it to the game menu', () => {
    const h = harness()
    h.screen.onKeyDown(new KeyboardEvent('keydown', { key: 'F1', code: 'F1', cancelable: true }))
    expect(h.execute).not.toHaveBeenCalled()
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

describe('mouse and the aim cursor', () => {
  /** The frame-level target sync with a mouse that hovered a cell before the aim opened. */
  function aimHarness() {
    const send = vi.fn()
    const ctx: Context = { mode: 'command', layer: 'micro', ahead: { kind: 'none', label: '' }, under: { kind: 'none', label: '' }, hostilesInView: 0 }
    const screen = Object.assign(Object.create(GameScreen.prototype), {
      ctx, session: { watching: false, state: initialState() }, runner: { send },
      renderer: { pick: () => (3 + 512) | ((4 + 512) << 10) },
      hover: { x: 10, y: 10 }, hoverMoved: true, lastTargetSent: -1,
    }) as { syncTarget(): void; hoverMoved: boolean }
    return { screen, ctx, send }
  }

  it('a mouse resting on the view does not move the cursor of the aim that opens next', () => {
    const h = aimHarness()
    h.screen.syncTarget()
    h.ctx.mode = 'targeting'
    h.screen.syncTarget()
    expect(h.send).not.toHaveBeenCalled()
  })

  it('a mouse moving while the aim is up moves its cursor', () => {
    const h = aimHarness()
    h.screen.syncTarget()
    h.ctx.mode = 'targeting'
    h.screen.hoverMoved = true
    h.screen.syncTarget()
    expect(h.send).toHaveBeenCalledExactlyOnceWith(cm.targetCursor(3, 4))
  })
})

describe('the right stick', () => {
  it('is free look', () => {
    const h = harness()
    const cam = { look: vi.fn() }
    Object.assign(h.screen, { cam, mapPan: { x: 0, y: 0 }, hooks: { ...(h.screen as unknown as { hooks: object }).hooks, settings: () => ({ lookSensitivity: 1, invertLook: false }) } })
    h.event({ type: 'look', dx: 0.8, dy: 0.1 })
    expect(cam.look).toHaveBeenLastCalledWith(0.8, 0.1, 1, false)
  })
})
