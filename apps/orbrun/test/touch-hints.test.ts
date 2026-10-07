// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TouchHints, touchHints, type TouchHintEvidence } from '../src/touch-hints'
import type { Context } from '../src/context'
import { defaultSettings, getSettings, saveSettings } from '../src/servers'
import { settingsPanel } from '../src/settings-panel'

const ctx = (over: Partial<Context> = {}): Context => ({
  mode: 'command', layer: 'micro', ahead: { kind: 'none', label: '' }, under: { kind: 'none', label: '' }, hostilesInView: 0, ...over,
})
const on = (over: Partial<TouchHintEvidence> = {}): TouchHintEvidence => ({ mode: 'command', clientOverlay: false, ...over })
const shown = (h: TouchHints, c = ctx()) => h.shown(c, 'adaptive', false)

beforeEach(() => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    clear: () => store.clear(),
  })
  touchHints().reset()
})

describe('touch lessons', () => {
  it('teaches the stats pane and the minimap together, each until used', () => {
    const h = new TouchHints()
    expect(shown(h)).toEqual(['menu', 'map'])
    h.attempt('menu', on(), 0)
    h.observe(on({ clientOverlay: true }), 10)
    expect(shown(h)).toEqual(['map'])
    h.attempt('map', on(), 20)
    h.observe(on({ mode: 'levelmap' }), 30)
    expect(shown(h)).toEqual([])
    // across runs: the device remembers
    expect(new TouchHints().knows('map')).toBe(true)
  })

  it('learns only from what the tap opened', () => {
    const h = new TouchHints()
    h.attempt('menu', on(), 0)
    h.observe(on(), 10)
    expect(h.knows('menu')).toBe(false)
    // too late to be the tap's
    h.observe(on({ clientOverlay: true }), 5000)
    expect(h.knows('menu')).toBe(false)
    expect(h.waiting).toBe(false)
  })

  it('stands only at quiet moments on Adaptive', () => {
    const h = new TouchHints()
    expect(shown(h, ctx({ hostilesInView: 1 }))).toEqual([])
    expect(shown(h, ctx({ mode: 'menu' }))).toEqual([])
    expect(h.shown(ctx(), 'adaptive', true)).toEqual([])
    expect(h.shown(ctx(), 'contextual', false)).toEqual([])
    expect(h.shown(ctx(), 'off', false)).toEqual([])
  })

  it('Replay tips teaches them again', () => {
    const h = touchHints()
    h.attempt('menu', on(), 0)
    h.observe(on({ clientOverlay: true }), 10)
    saveSettings({ ...defaultSettings, hints: 'off' })
    settingsPanel('Controls', {}).el.querySelector<HTMLElement>('[data-focus="replay-gamepad-tips"]')!.click()
    expect(h.knows('menu')).toBe(false)
    expect(getSettings().hints).toBe('adaptive')
  })
})
