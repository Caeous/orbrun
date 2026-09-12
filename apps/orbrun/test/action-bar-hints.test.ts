// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { Hud } from '../src/hud'
import type { Context } from '../src/context'
import type { PadKind } from '../src/gamepad'

const ctx = (over: Partial<Context>): Context => ({
  mode: 'command',
  layer: 'micro',
  ahead: { kind: 'none', label: '' },
  under: { kind: 'none', label: '' },
  hostilesInView: 0,
  ...over,
})

/** the prompt bar after one render, for whichever device spoke last */
function bar(c: Context, device: 'pad' | 'keyboard' | 'mouse' = 'pad', { kind = 'xbox', spectating = false, hints = true }: { kind?: PadKind; spectating?: boolean; hints?: boolean } = {}): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  const hud = new Hud(host, { onSelectMonster() {}, onBarAction() {}, onMinimapClick() {}, onPanelItem() {}, onPanelShow() {} })
  const inner = hud as unknown as { renderBar(c: Context, k: string, spectating: boolean, device: string, hints: boolean): void; actionbar: HTMLElement }
  inner.renderBar(c, kind, spectating, device, hints)
  return inner.actionbar
}

describe('forward attack hints', () => {
  const goblin: Context['ahead'] = { kind: 'monster', monster: { name: 'goblin' } as never, hostile: true, label: 'goblin' }
  const facing = ctx({ ahead: goblin, hostilesInView: 1 })

  it.each(['xbox', 'playstation', 'nintendo', 'steamdeck', 'generic'] as const)('shows left stick forward, not a stick click, on %s', (kind) => {
    const pad = bar(facing, 'pad', { kind })
    const attack = pad.querySelector('.chip.LSTICK_UP')!
    expect(attack.getAttribute('title')).toBe('Left stick forward')
    expect(attack.querySelector('.label')?.textContent).toBe('Attack goblin')
    expect(attack.querySelector('svg')).not.toBeNull()
    expect(pad.querySelector('.chip.L3')).toBeNull()
    // autofight is a lesson of the hints, not a chip the situation creates
    expect(pad.querySelector('.chip.RT')).toBeNull()
  })

  it('shows nothing to the keyboard or the mouse, with hints off, or to a spectator', () => {
    for (const hidden of [bar(facing, 'keyboard'), bar(facing, 'mouse'), bar(facing, 'pad', { hints: false }), bar(facing, 'pad', { spectating: true })]) {
      expect(hidden.hidden).toBe(true)
      expect(hidden.querySelector('.chip')).toBeNull()
      expect(hidden.querySelector('kbd')).toBeNull()
    }
  })

  it('updates the target name and removes the hint when turning away', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const hud = new Hud(host, { onSelectMonster() {}, onBarAction() {}, onMinimapClick() {}, onPanelItem() {}, onPanelShow() {} })
    const inner = hud as unknown as { renderBar(c: Context, k: string, spectating: boolean, device: string, hints: boolean): void; actionbar: HTMLElement }
    inner.renderBar(facing, 'xbox', false, 'pad', true)
    inner.renderBar(ctx({ ahead: { ...goblin, label: 'orc' } }), 'xbox', false, 'pad', true)
    expect(inner.actionbar.querySelector('.chip.LSTICK_UP .label')?.textContent).toBe('Attack orc')
    inner.renderBar(ctx({ hostilesInView: 1 }), 'xbox', false, 'pad', true)
    expect(inner.actionbar.querySelector('.chip.LSTICK_UP')).toBeNull()
    expect(inner.actionbar.querySelector('.chip.RT')).toBeNull()
  })
})

/**
 * The pile underfoot is the log's line, not a sentence of the client's: a
 * staff of alchemy on the floor prints "You see here <lightgreen>a staff of
 * alchemy" in the message pane, and the prompt on A says the same words
 * in the same green (webtiles state.ts `floorItemsLabel`, format.ts
 * `formattedStringToHtml`, styles.css `.fg10`).
 */
describe('the prompt for a pile underfoot reads as its line in the message log', () => {
  it('keeps the server’s words and colours on the pad chip', () => {
    const pad = bar(ctx({ under: { kind: 'item', label: '<lightgreen>a staff of alchemy' } }))
    expect(pad.querySelector('.chip.A .label')?.innerHTML).toBe("<span class=\"fg10\">a staff of alchemy</span>")
    expect(pad.querySelector('.chip.A .label')?.textContent).toBe('a staff of alchemy')
  })
  it('offers an interaction chooser on items over stairs', () => {
    const c = ctx({ under: { kind: 'feature', feature: { type: 'stairs', dir: 'down' }, label: 'stairs down', items: '<darkgrey>) [ ((' } })
    const chip = bar(c).querySelector('.chip.A')!
    expect(chip.querySelector('.label')?.textContent).toBe('Interact')
    expect(chip.querySelector('.hold')).toBeNull()
  })
  it('draws a label with no colour tags as its own plain words', () => {
    const pad = bar(ctx({ ahead: { kind: 'door-closed', label: 'closed door' } }))
    expect(pad.querySelector('.chip.A .label')?.innerHTML).toBe('Open door')
  })
})

/** The hold's progress lives on the button's own prompt (hud.ts showHold), not on a strip of its own. */
describe('a hold in progress fills its prompt', () => {
  it('marks the held chip with the fraction and clears it when the hold ends, without rebuilding the chip', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const hud = new Hud(host, { onSelectMonster() {}, onBarAction() {}, onMinimapClick() {}, onPanelItem() {}, onPanelShow() {} })
    const inner = hud as unknown as { renderBar(c: Context, k: string, spectating: boolean, device: string, hints: boolean): void; showHold(h: { button: string; fraction: number } | null): void; actionbar: HTMLElement }
    inner.renderBar(ctx({ injured: true }), 'xbox', false, 'pad', true)
    const chip = inner.actionbar.querySelector('.chip.LB') as HTMLElement
    expect(chip.querySelector('.hold')?.textContent).toBe('Rest')
    expect(chip.querySelector('.hold path')?.getAttribute('pathLength')).toBe('1')
    inner.showHold({ button: 'LB', fraction: 0.5 })
    expect(chip.classList.contains('holding')).toBe(true)
    expect(chip.style.getPropertyValue('--hold')).toBe('0.5')
    inner.showHold({ button: 'LB', fraction: 1.5 })
    expect(chip.style.getPropertyValue('--hold')).toBe('1')
    inner.showHold(null)
    expect(chip.classList.contains('holding')).toBe(false)
    expect(chip.style.getPropertyValue('--hold')).toBe('')
    expect(inner.actionbar.querySelector('.chip.LB')).toBe(chip)
  })
})

describe('the stack under a centred panel', () => {
  it('lies down in a row under a menu, a crt screen or a popup, and stands as a column in play', () => {
    for (const mode of ['menu', 'crt', 'popup', 'dialog', 'newgame', 'ended'] as const) {
      expect(bar(ctx({ mode })).classList.contains('row'), mode).toBe(true)
    }
    for (const mode of ['command', 'targeting', 'levelmap', 'yesno', 'prompt'] as const) {
      expect(bar(ctx({ mode })).classList.contains('row'), mode).toBe(false)
    }
  })

  it('stands back up when the menu closes', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const hud = new Hud(host, { onSelectMonster() {}, onBarAction() {}, onMinimapClick() {}, onPanelItem() {}, onPanelShow() {} })
    const inner = hud as unknown as { renderBar(c: Context, k: string, spectating: boolean, device: string, hints: boolean): void; actionbar: HTMLElement }
    inner.renderBar(ctx({ mode: 'menu' }), 'xbox', false, 'pad', true)
    expect(inner.actionbar.classList.contains('row')).toBe(true)
    inner.renderBar(ctx({ mode: 'command' }), 'xbox', false, 'pad', true)
    expect(inner.actionbar.classList.contains('row')).toBe(false)
  })
})
