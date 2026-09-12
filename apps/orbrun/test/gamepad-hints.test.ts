// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GamepadHints, gamepadHints, padLesson, type PadHintEvidence } from '../src/gamepad-hints'
import { bindingTable, type Action } from '../src/bindings'
import type { Context } from '../src/context'
import { defaultSettings, getSettings, saveSettings } from '../src/servers'
import { settingsPanel } from '../src/settings-panel'
import { isPadActivity } from '../src/gamepad'

const ctx = (over: Partial<Context> = {}): Context => ({
  mode: 'command', layer: 'micro', ahead: { kind: 'none', label: '' }, under: { kind: 'none', label: '' }, hostilesInView: 0, ...over,
})
const evidence = (over: Partial<PadHintEvidence> = {}): PadHintEvidence => ({
  mode: 'command', x: 10, y: 10, turn: 1, cursor: '', focus: -1, clientOverlay: false, ...over,
})
const keys = (text: string): Action => ({ kind: 'keys', label: text, seq: [{ text }] })
const teaching = (h: GamepadHints, c = ctx()) => h.prompts(c, 'adaptive').filter((l) => l.teaching)
const basics = (h: GamepadHints) => { h.moved(3); h.lookedBy(0.4) }

beforeEach(() => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    clear: () => store.clear(),
  })
  gamepadHints().reset()
})

describe('adaptive gamepad teaching', () => {
  it('starts with two basic actions, not the entire binding table', () => {
    const h = new GamepadHints()
    expect(teaching(h).map((l) => [l.button, l.label])).toEqual([['LSTICK', 'Move'], ['RSTICK', 'Look around']])
    h.moved()
    h.moved()
    expect(h.knows('move')).toBe(false)
    h.moved() // three successful steps, with no direction checklist
    expect(teaching(h).map((l) => l.button)).toEqual(['RSTICK'])
    h.lookedBy(0.01)
    expect(h.knows('look')).toBe(false)
    h.lookedBy(0.3)
    expect(teaching(h).map((l) => l.button)).toEqual(['LB'])
  })

  it('remembers learned actions across screens, runs and controller families', () => {
    const h = new GamepadHints()
    basics(h)
    const nextRun = new GamepadHints()
    expect(nextRun.knows('move')).toBe(true)
    expect(nextRun.knows('look')).toBe(true)
    expect(teaching(nextRun).map((l) => l.button)).toEqual(['LB'])
    nextRun.reset()
    expect(teaching(new GamepadHints()).map((l) => l.button)).toEqual(['LSTICK', 'RSTICK'])
  })

  it('never retires contextual interactions and does not stack unrelated lessons during combat', () => {
    const h = new GamepadHints()
    basics(h)
    const door = ctx({ ahead: { kind: 'door-closed', label: 'door' } })
    expect(h.prompts(door, 'adaptive').find((l) => l.button === 'A')?.label).toBe('Open door')
    expect(h.prompts(door, 'contextual').map((l) => l.label)).toEqual(['Open door'])
    expect(h.prompts(door, 'off')).toEqual([])
    expect(teaching(h, ctx({ hostilesInView: 1 }))).toEqual([])
    expect(teaching(h).map((l) => l.button)).toEqual(['LB']) // switching modes did not erase progress
  })

  it.each(['spectating', 'lobby', 'ended', 'macro', 'text'] as const)('does not teach in %s', (mode) => {
    expect(new GamepadHints().prompts(ctx({ mode }), 'adaptive')).toEqual([])
  })

  it('keeps targeting confirmation and cancel even when gameplay hints are off', () => {
    const h = new GamepadHints()
    const targeting = ctx({ mode: 'targeting' })
    expect(h.prompts(targeting, 'off').map((l) => [l.button, l.label])).toEqual([['A', 'Fire'], ['B', 'Cancel']])
    expect(teaching(h, targeting).map((l) => l.label)).toEqual(['Move cursor'])
  })

  it('learns actions by meaning and context, not button usage', () => {
    const h = new GamepadHints()
    expect(padLesson(bindingTable(ctx({ mode: 'menu' })).B!, ctx({ mode: 'menu' }))).toBeNull()
    h.attempt(keys('.'), ctx(), evidence(), 0)
    h.observe(evidence({ turn: 2 }), 10)
    expect(h.knows('wait')).toBe(true)
    expect(h.knows('rest')).toBe(false)
    h.attempt(keys('5'), ctx(), evidence({ turn: 2 }), 20)
    h.observe(evidence({ turn: 3 }), 30)
    expect(h.knows('rest')).toBe(true)
    expect(h.knows('navigate')).toBe(false)
  })
})

describe('nothing standing: only the context and the lessons', () => {
  const standing = (h: GamepadHints, c = ctx()) => h.prompts(c, 'adaptive').filter((l) => !l.contextual && !l.teaching)

  it('never adds Autoexplore, Actions or Inventory on their own, before or after learning them', () => {
    const h = new GamepadHints()
    expect(standing(h)).toEqual([])
    basics(h)
    h.attempt({ kind: 'ui', op: 'commands' }, ctx(), evidence(), 0)
    h.observe(evidence({ clientOverlay: true }), 10)
    h.attempt(keys('i'), ctx(), evidence(), 20)
    h.observe(evidence({ mode: 'menu' }), 30)
    h.attempt(keys('o'), ctx(), evidence(), 40)
    h.observe(evidence({ x: 11 }), 50)
    for (const id of ['commands', 'inventory', 'explore'] as const) expect(h.knows(id)).toBe(true)
    expect(standing(h)).toEqual([])
    expect(h.prompts(ctx(), 'adaptive').every((l) => l.teaching)).toBe(true)
  })

  it('keeps contextual actions first, then the lessons, including during combat', () => {
    const h = new GamepadHints()
    const door = ctx({ ahead: { kind: 'door-closed', label: 'door' } })
    const atDoor = h.prompts(door, 'adaptive')
    expect(atDoor[0].label).toBe('Open door')
    expect(atDoor.slice(1).every((l) => l.teaching)).toBe(true)
    const combat = ctx({ hostilesInView: 1, ahead: { kind: 'monster', label: 'orc', hostile: true } })
    const prompts = h.prompts(combat, 'adaptive')
    expect(prompts.some((l) => l.label === 'Attack orc')).toBe(true)
    expect(prompts.every((l) => l.contextual || l.teaching)).toBe(true)
    expect(new Set(prompts.map((l) => l.button)).size).toBe(prompts.length)
  })

  it('shows nothing in Contextual only or Off with nothing in front of you', () => {
    const h = new GamepadHints()
    expect(h.prompts(ctx(), 'contextual')).toEqual([])
    expect(h.prompts(ctx(), 'off')).toEqual([])
  })
})

describe('successful outcomes, not button presses', () => {
  it.each([
    ['commands', { kind: 'ui', op: 'commands' }, { clientOverlay: true }],
    ['travel', { kind: 'ui', op: 'travel' }, { clientOverlay: true }],
    ['inventory', keys('i'), { mode: 'menu' }],
    ['examine', { kind: 'examine' }, { mode: 'targeting' }],
    ['explore', keys('o'), { x: 11 }],
    ['wait', keys('.'), { turn: 2 }],
    ['rest', keys('5'), { turn: 2 }],
  ] as const)('only learns %s after its outcome', (id, a, outcome) => {
    const h = new GamepadHints()
    h.attempt(a, ctx(), evidence(), 0)
    h.observe(evidence(), 10)
    expect(h.knows(id)).toBe(false)
    h.observe(evidence(outcome), 100)
    expect(h.knows(id)).toBe(true)
  })

  it('does not mistake a refusal or a --more-- for opening inventory', () => {
    const h = new GamepadHints()
    h.attempt(keys('i'), ctx(), evidence(), 0)
    h.observe(evidence({ mode: 'more' }), 10)
    h.observe(evidence({ mode: 'menu' }), 2000)
    expect(h.knows('inventory')).toBe(false)
  })

  it('switching input devices or taking another action cancels pending attribution', () => {
    const h = new GamepadHints()
    h.attempt(keys('i'), ctx(), evidence(), 0)
    h.cancel()
    h.observe(evidence({ mode: 'menu' }), 10)
    expect(h.knows('inventory')).toBe(false)
    h.attempt(keys('o'), ctx(), evidence(), 20)
    h.attempt({ kind: 'step', dir: 0 }, ctx(), evidence(), 21)
    h.observe(evidence({ x: 11 }), 30)
    expect(h.knows('explore')).toBe(false)
  })

  it('learns navigation separately and only when focus actually moves', () => {
    const h = new GamepadHints()
    const c = ctx({ mode: 'menu' })
    const b = evidence({ mode: 'menu', focus: 0 })
    h.attempt({ kind: 'menu', op: 'next' }, c, b, 0)
    h.observe(b, 10) // pressed at the edge: no movement
    expect(h.knows('navigate')).toBe(false)
    h.attempt({ kind: 'menu', op: 'next' }, c, b, 20) // held input retains baseline
    h.observe({ ...b, focus: 1 }, 30)
    expect(h.knows('navigate')).toBe(true)
    expect(h.knows('move')).toBe(false)
  })

  it('moving a targeting cursor is not walking or learning the level map', () => {
    const h = new GamepadHints()
    const c = ctx({ mode: 'targeting' })
    const b = evidence({ mode: 'targeting', cursor: '1,1' })
    h.attempt({ kind: 'cursor', dir: 2 }, c, b, 0)
    h.observe({ ...b, cursor: '2,1' }, 10)
    expect(h.knows('target-cursor')).toBe(true)
    expect(h.knows('move')).toBe(false)
    expect(h.knows('map-cursor')).toBe(false)
  })

  it('ignores malformed storage and tolerates blocked writes', () => {
    localStorage.setItem('orbrun.gamepad-learning.v1', '{broken')
    expect(new GamepadHints().knows('move')).toBe(false)
    localStorage.setItem('orbrun.gamepad-learning.v1', '["look","not-a-lesson",4]')
    const h = new GamepadHints()
    expect(h.knows('look')).toBe(true)
    const fail = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw Error('blocked') })
    expect(() => h.moved(3)).not.toThrow()
    expect(h.knows('move')).toBe(true)
    fail.mockRestore()
  })
})

describe('the one Hints preference, and activation', () => {
  it('defaults to adaptive', () => {
    expect(getSettings().hints).toBe('adaptive')
    saveSettings({ ...defaultSettings, hints: 'contextual' })
    expect(getSettings().hints).toBe('contextual')
  })

  it('carries over the old split settings and validates unknown modes', () => {
    // the old keyboard opt-out alone (older still: the global one) means off
    localStorage.setItem('orbrun.settings', JSON.stringify({ keyHints: false }))
    expect(getSettings().hints).toBe('off')
    // an old pad mode wins over the old keyboard flag
    localStorage.setItem('orbrun.settings', JSON.stringify({ gamepadHints: 'contextual', keyHints: false }))
    expect(getSettings().hints).toBe('contextual')
    localStorage.setItem('orbrun.settings', JSON.stringify({ gamepadHints: 'everything' }))
    expect(getSettings().hints).toBe('adaptive')
    localStorage.setItem('orbrun.settings', JSON.stringify({ hints: 'nope' }))
    expect(getSettings().hints).toBe('adaptive')
  })

  it('offers explicit replay, resetting learning and selecting Adaptive', () => {
    basics(gamepadHints())
    saveSettings({ ...defaultSettings, hints: 'off' })
    const change = vi.fn()
    const panel = settingsPanel({ onchange: change })
    panel.el.querySelector<HTMLElement>('[data-focus="replay-gamepad-tips"]')!.click()
    expect(gamepadHints().knows('move')).toBe(false)
    expect(getSettings().hints).toBe('adaptive')
    expect(change).toHaveBeenCalledOnce()
  })

  it('only deliberate pad events activate hints, not releases or centred sticks', () => {
    expect(isPadActivity({ type: 'look', dx: 0, dy: 0 })).toBe(false)
    expect(isPadActivity({ type: 'dir', source: 'lstick', dir: null })).toBe(false)
    expect(isPadActivity({ type: 'release', button: 'A', t: 100, held: 100 })).toBe(false)
    expect(isPadActivity({ type: 'press', button: 'A', t: 0 })).toBe(true)
    expect(isPadActivity({ type: 'dir', source: 'lstick', dir: 6 })).toBe(true)
    // the continuation of something already counted is not a fresh choice of the pad
    expect(isPadActivity({ type: 'look', dx: 0.5, dy: 0, start: true })).toBe(true)
    expect(isPadActivity({ type: 'look', dx: 0.5, dy: 0 })).toBe(false)
    expect(isPadActivity({ type: 'dirRepeat', source: 'lstick', dir: 6, n: 1 })).toBe(false)
    expect(isPadActivity({ type: 'repeat', button: 'A', n: 1 })).toBe(false)
  })
})
