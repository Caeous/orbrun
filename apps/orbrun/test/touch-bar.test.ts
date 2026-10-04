// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest'
import { Hud } from '../src/hud'
import { CONTINUE, type TouchLabel } from '../src/bindings'
import { GameScreen } from '../src/game'
import type { PadEvent } from '../src/gamepad'

/**
 * The touch bar's buttons under a finger (hud.ts renderTouchBar): a press
 * lasts until the finger lifts, whatever the screen changes meanwhile, unless
 * the screen takes that very button away.
 */
const lab = (button: string, label: string): TouchLabel => ({ button, cell: button, label, action: { kind: 'keys', label, seq: [] }, contextual: false }) as TouchLabel

function bar() {
  const host = document.createElement('div')
  document.body.append(host)
  const onTouchButton = vi.fn()
  const onBarAction = vi.fn()
  const hud = new Hud(host, { onSelectMonster() {}, onBarAction, onMinimapClick() {}, onPanelItem() {}, onPanelShow() {}, onStatsClick() {}, onTouchButton } as never)
  const inner = hud as unknown as { renderTouchBar(l: TouchLabel[] | null, gd: null): void; touchbar: HTMLElement; messages: HTMLElement }
  const cell = (c: string) => inner.touchbar.querySelector<HTMLElement>(`[data-cell="${c}"]`)!
  const finger = (el: HTMLElement, type: 'pointerdown' | 'pointerup') => el.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'touch' }))
  return { render: (l: TouchLabel[] | null) => inner.renderTouchBar(l, null), cell, finger, onTouchButton, onBarAction, messages: inner.messages }
}

afterEach(() => document.body.replaceChildren())

describe('a finger held on the touch bar', () => {
  it('keeps its press while a word changes under it: an arrow held through a menu, the lit row naming A anew', () => {
    const b = bar()
    b.render([lab('A', 'Select'), lab('B', 'Back'), lab('DD', 'Down')])
    const down = b.cell('DD')
    b.finger(down, 'pointerdown')
    expect(b.onTouchButton).toHaveBeenLastCalledWith('DD', true)
    b.render([lab('A', 'Wield'), lab('B', 'Back'), lab('DD', 'Down')])
    expect(b.cell('DD')).toBe(down)
    expect(down.classList.contains('down')).toBe(true)
    expect(b.cell('A').getAttribute('aria-label')).toBe('Wield')
    expect(b.onTouchButton).toHaveBeenCalledTimes(1)
    b.finger(down, 'pointerup')
    expect(b.onTouchButton).toHaveBeenLastCalledWith('DD', false)
    expect(b.onTouchButton).toHaveBeenCalledTimes(2)
  })
  it('keeps Wait held to Rest while the hold\'s word comes and goes', () => {
    const b = bar()
    b.render([{ ...lab('LB', 'Wait'), hold: 'Rest' }, lab('B', 'Back')])
    const lb = b.cell('LB')
    b.finger(lb, 'pointerdown')
    b.render([lab('LB', 'Wait'), lab('B', 'Back')])
    expect(b.cell('LB')).toBe(lb)
    expect(lb.classList.contains('has-hold')).toBe(false)
    expect(b.onTouchButton).toHaveBeenCalledTimes(1)
  })
  it('lets go when the screen takes its button away, or puts the bar away', () => {
    const b = bar()
    b.render([lab('A', 'Interact'), lab('B', 'Back'), lab('LB', 'Wait')])
    b.finger(b.cell('LB'), 'pointerdown')
    b.render([lab('A', 'Interact'), lab('B', 'Back')])
    expect(b.onTouchButton).toHaveBeenLastCalledWith('LB', false)
    expect(b.cell('LB').classList.contains('empty')).toBe(true)
    b.finger(b.cell('A'), 'pointerdown')
    b.render(null)
    expect(b.onTouchButton).toHaveBeenLastCalledWith('A', false)
  })
})

describe('the message pane under a mouse', () => {
  it('takes a click as space on a --more-- the player can dismiss, and as nothing otherwise', () => {
    const b = bar()
    b.messages.click()
    expect(b.onBarAction).not.toHaveBeenCalled()
    b.messages.classList.add('dismissable')
    b.messages.click()
    expect(b.onBarAction).toHaveBeenCalledWith(CONTINUE)
  })
})

describe('a game torn down under a finger (a reconnect)', () => {
  it('lets go of what the touch bar held, and the releases do nothing in the game that is gone', () => {
    const noop = () => {}
    const wake = vi.fn()
    const screen = Object.assign(Object.create(GameScreen.prototype), {
      wake, saveView: noop, raf: 0, idleTimer: 0, tooltipTimer: 0, onKeyDown: noop, onResize: noop, unsub: [],
      runner: { abortSequence: noop }, hud: { destroy: noop }, overlays: { destroy: noop }, perf: { destroy: noop },
      grid: { destroy: noop }, renderer: { destroy: noop }, park: { clear: noop }, root: { remove: noop },
    }) as { destroy(): void; pad(ev: PadEvent): void; hooks: unknown }
    // the pad hands the releases straight back to the game, as main.ts routes them
    const virtualRelease = vi.fn(() => screen.pad({ type: 'release', button: 'LB', t: 0, held: 100, touch: true }))
    screen.hooks = { gamepad: { virtualRelease } }
    screen.destroy()
    expect(virtualRelease).toHaveBeenCalledTimes(1)
    expect(wake).not.toHaveBeenCalled()
  })
})
