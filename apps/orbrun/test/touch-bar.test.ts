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
const lab = (button: string, cell: string, label: string): TouchLabel => ({ button, cell, label, action: { kind: 'keys', label, seq: [] }, contextual: false }) as TouchLabel

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
    b.render([lab('A', 'select', 'Select'), lab('B', 'esc', 'Back'), lab('DD', 'down', 'Down')])
    const down = b.cell('down')
    b.finger(down, 'pointerdown')
    expect(b.onTouchButton).toHaveBeenLastCalledWith('DD', true)
    b.render([lab('A', 'select', 'Wield'), lab('B', 'esc', 'Back'), lab('DD', 'down', 'Down')])
    expect(b.cell('down')).toBe(down)
    expect(down.classList.contains('down')).toBe(true)
    expect(b.cell('select').getAttribute('aria-label')).toBe('Wield')
    expect(b.onTouchButton).toHaveBeenCalledTimes(1)
    b.finger(down, 'pointerup')
    expect(b.onTouchButton).toHaveBeenLastCalledWith('DD', false)
    expect(b.onTouchButton).toHaveBeenCalledTimes(2)
  })
  it('keeps Wait held to Rest while the hold\'s word comes and goes', () => {
    const b = bar()
    b.render([{ ...lab('LB', 'wait', 'Wait'), hold: 'Rest' }, lab('B', 'esc', 'Back')])
    const lb = b.cell('wait')
    b.finger(lb, 'pointerdown')
    b.render([lab('LB', 'wait', 'Wait'), lab('B', 'esc', 'Back')])
    expect(b.cell('wait')).toBe(lb)
    expect(lb.classList.contains('has-hold')).toBe(false)
    expect(b.onTouchButton).toHaveBeenCalledTimes(1)
  })
  it('lets go when the screen takes its button away, or puts the bar away', () => {
    const b = bar()
    b.render([lab('A', 'select', 'Interact'), lab('B', 'esc', 'Back'), lab('LB', 'wait', 'Wait')])
    b.finger(b.cell('wait'), 'pointerdown')
    b.render([lab('A', 'select', 'Interact'), lab('B', 'esc', 'Back')])
    expect(b.onTouchButton).toHaveBeenLastCalledWith('LB', false)
    expect(b.cell('wait').classList.contains('empty')).toBe(true)
    b.finger(b.cell('select'), 'pointerdown')
    b.render(null)
    expect(b.onTouchButton).toHaveBeenLastCalledWith('A', false)
  })
})

describe('the touch bar keeps one keypad\'s shape', () => {
  it('an anchor with nothing to do stands dim under its word and presses nothing; any other cell left over is empty', () => {
    const b = bar()
    b.render([lab('A', 'select', 'Continue'), lab('B', 'esc', 'Skip')])
    for (const c of ['examine', 'up', 'left', 'down', 'right']) expect(b.cell(c).classList.contains('idle')).toBe(true)
    expect(b.cell('examine').textContent).toBe('Examine')
    expect(b.cell('up').querySelector('svg.arrow')).not.toBeNull()
    for (const c of ['corner', 'wait', 'actions', 'gear']) expect(b.cell(c).classList.contains('empty')).toBe(true)
    b.finger(b.cell('up'), 'pointerdown')
    expect(b.onTouchButton).not.toHaveBeenCalled()
    // Esc with nothing to do (the stat gain) is still where Esc is
    b.render([lab('A', 'select', 'Strength')])
    expect(b.cell('esc').classList.contains('idle')).toBe(true)
    expect(b.cell('esc').textContent).toBe('Esc')
  })
  it('a button two cells wide covers both, and is the verb where it covers Select\'s: the aim\'s Fire', () => {
    const b = bar()
    const fire = (word: string) => ({ ...lab('RB', 'quiver', word), span: 2 })
    b.render([fire('Fire'), lab('B', 'esc', 'Cancel')])
    const wide = b.cell('quiver')
    expect(b.cell('select')).toBeNull()
    expect(wide.classList.contains('at-quiver') && wide.classList.contains('at-select')).toBe(true)
    // held while the cursor walks to a target and the word follows it
    b.finger(wide, 'pointerdown')
    b.render([fire('Fire at goblin'), lab('B', 'esc', 'Cancel')])
    expect(b.cell('quiver')).toBe(wide)
    expect(b.onTouchButton).toHaveBeenCalledTimes(1)
    // the aim over, Select's cell is back, in its place
    b.render([lab('RB', 'quiver', 'Fire'), lab('B', 'esc', 'Cancel')])
    expect(b.cell('select').classList.contains('idle')).toBe(true)
    expect(Array.from(b.cell('quiver').parentElement!.children).map((el) => (el as HTMLElement).dataset.cell).slice(0, 5)).toEqual(['corner', 'wait', 'examine', 'quiver', 'select'])
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
