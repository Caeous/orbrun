// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import type { ClientMessage } from '@orbrun/webtiles'
import { Overlays } from '../src/overlays'

/**
 * The Start menu is a place, walked into and out of like a level, not a step
 * on the way somewhere. So it opens again on the tab and row it was left on,
 * and the screens it leads to (the settings, the controls) come back to it
 * rather than dropping the player straight into the game — and back onto the
 * row that led away, so the way out is the way in, reversed.
 */
function setup() {
  const sent: ClientMessage[] = []
  const host = document.createElement('div')
  document.body.append(host)
  // the settings pages are the real ones (settings-panel.ts); this stands for one
  const panel = document.createElement('div')
  panel.className = 'settings-panel'
  const settingRow = document.createElement('div')
  settingRow.className = 'row'
  panel.append(settingRow)
  const ov = new Overlays(host, { send: (m) => sent.push(m), gamedata: () => null, watching: () => false, onClientOverlayChange: () => {}, onSystemAction: () => {}, settingsPanel: (_group, back) => {
    settingRow.onclick = back
    return { el: panel, rows: [settingRow] }
  } })
  const rows = () => Array.from(host.querySelectorAll('.sysrows li')).map((li) => li.querySelector('.label')?.textContent ?? '')
  const focused = () => (host.querySelector('.sysmenu li.focused .label') as HTMLElement | null)?.textContent ?? null
  // the menu opens on its Character tab; these are the System rows, one bumper over
  const options = () => ov.clientOverlayInput('catNext')
  const groupRows = () => Array.from(host.querySelectorAll('.settings-groups li')).map((li) => li.querySelector('.label')?.textContent ?? '')
  const groupFocused = () => (host.querySelector('.settings-groups li.focused .label') as HTMLElement | null)?.textContent ?? null
  return { ov, host, rows, focused, groupRows, groupFocused, options }
}

const inGame = { spectating: false, inGame: true, run: () => {} }

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('the pause menu', () => {
  it('opens again on the tab and row it was left on', () => {
    const { ov, focused, options } = setup()
    ov.showSystem(inGame)
    // the tab it opens on first is the character's; the game's options are the other one
    expect(focused()).toBe('Skills')
    options()
    expect(focused()).toBe('Resume')
    ov.clientOverlayInput('next')
    ov.clientOverlayInput('next')
    const row = focused()!
    expect(row).not.toBe('Resume')
    ov.clientOverlayInput('cancel')
    ov.showSystem(inGame)
    expect(focused()).toBe(row)
  })

  it('comes back to it from the settings, on the row that opened them', () => {
    const { ov, host, rows, focused, groupRows, groupFocused, options } = setup()
    ov.showSystem(inGame)
    options()
    ov.clientOverlayInput('next')
    while (focused() !== 'Settings') ov.clientOverlayInput('next')
    ov.clientOverlayInput('select')
    // the settings are the groups, each its own page under a Back, as the Gamepad sheet is
    expect(host.querySelector('.sysmenu')).toBeNull()
    expect(groupRows()).toEqual(['Camera', 'Controls', 'Interface', 'Back'])
    while (groupFocused() !== 'Camera') ov.clientOverlayInput('next')
    ov.clientOverlayInput('select')
    expect(host.querySelector('.settings-panel')).toBeTruthy()
    // back out of the page: the group list again, on the group that was opened
    ov.clientOverlayInput('cancel')
    expect(host.querySelector('.settings-panel')?.isConnected).toBeFalsy()
    expect(groupFocused()).toBe('Camera')
    ov.clientOverlayInput('cancel')
    expect(rows()).toContain('Settings')
    expect(focused()).toBe('Settings')
  })

  it('leaves a settings page by its own Back, to the group list', () => {
    const { ov, host, groupFocused } = setup()
    ov.showSettings()
    while (groupFocused() !== 'Controls') ov.clientOverlayInput('next')
    ov.clientOverlayInput('select')
    expect(host.querySelector('.settings-panel')).toBeTruthy()
    // the page's own Back, the one the panel was given
    ;(host.querySelector('.settings-panel .row') as HTMLElement).click()
    expect(groupFocused()).toBe('Controls')
  })

  it('comes back to it from the controls too, and the game is reached in one more press', () => {
    const { ov, host, focused, options } = setup()
    ov.showSystem(inGame)
    options()
    while (focused() !== 'Gamepad controls') ov.clientOverlayInput('next')
    ov.clientOverlayInput('select')
    expect(host.querySelector('.bindings-sheet')).toBeTruthy()
    ov.clientOverlayInput('cancel')
    expect(focused()).toBe('Gamepad controls')
    ov.clientOverlayInput('cancel')
    expect(host.querySelector('.sysmenu')).toBeNull()
  })

  it('leaves the settings opened from anywhere else with no way back', () => {
    const { ov, host } = setup()
    ov.showSettings()
    ov.clientOverlayInput('cancel')
    expect(host.querySelector('.sysmenu')).toBeNull()
    expect(host.querySelector('.settings-groups')?.isConnected).toBeFalsy()
    expect(host.querySelector('.settings-panel')?.isConnected).toBeFalsy()
  })
})

/**
 * The pad and the mouse share one cursor, but the pad gets the last word: a
 * move scrolls the list under a resting pointer, and the `mouseenter` that
 * fires would otherwise pull the cursor straight back to the mouse.
 */
describe('the pointer and the pad on one list', () => {
  const hover = (el: HTMLElement) => el.dispatchEvent(new MouseEvent('mouseenter'))
  const mouseTo = (ov: { root: HTMLElement }, x: number, y: number) =>
    ov.root.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', clientX: x, clientY: y, bubbles: true } as PointerEventInit))

  it('a hover takes the cursor, and stops taking it once the pad has moved', () => {
    const { ov, host, focused, options } = setup()
    ov.showSystem(inGame)
    options()
    const rows = Array.from(host.querySelectorAll('.sysrows li')) as HTMLElement[]
    // the mouse is live from the start: the row it crosses is the cursor's
    mouseTo(ov, 10, 10)
    hover(rows[2])
    expect(focused()).toBe(rows[2].querySelector('.label')!.textContent)
    // the pad moves on; the list scrolling under the still mouse hovers a row again, and the cursor stays where the pad put it
    ov.clientOverlayInput('next')
    const after = focused()
    expect(after).toBe(rows[3].querySelector('.label')!.textContent)
    hover(rows[2])
    expect(focused()).toBe(after)
    // moving the mouse for real gives it the cursor back
    mouseTo(ov, 11, 12)
    hover(rows[2])
    expect(focused()).toBe(rows[2].querySelector('.label')!.textContent)
  })
})
