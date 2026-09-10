// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import type { ClientMessage } from '@orbrun/webtiles'
import { Overlays } from '../src/overlays'

/**
 * The pause menu is a place, walked into and out of like a level, not a step
 * on the way somewhere. So it opens again on the row it was left on, and the
 * screens it leads to (the settings, the controls) come back to it rather
 * than dropping the player straight into the game — and back onto the row
 * that led away, so the way out is the way in, reversed.
 */
function setup() {
  const sent: ClientMessage[] = []
  const host = document.createElement('div')
  document.body.append(host)
  const panel = document.createElement('div')
  panel.className = 'settings-panel'
  const settingRow = document.createElement('div')
  settingRow.className = 'row'
  panel.append(settingRow)
  const ov = new Overlays(host, { send: (m) => sent.push(m), gamedata: () => null, watching: () => false, onClientOverlayChange: () => {}, onSystemAction: () => {}, settingsPanel: () => panel })
  const rows = () => Array.from(host.querySelectorAll('.sysmenu li')).map((li) => li.querySelector('.label')?.textContent ?? '')
  const focused = () => (host.querySelector('.sysmenu li.focused .label') as HTMLElement | null)?.textContent ?? null
  return { ov, host, rows, focused }
}

const inGame = { spectating: false, inGame: true }

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('the pause menu', () => {
  it('opens again on the row it was left on', () => {
    const { ov, focused } = setup()
    ov.showSystem(inGame)
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
    const { ov, host, rows, focused } = setup()
    ov.showSystem(inGame)
    ov.clientOverlayInput('next')
    while (focused() !== 'Settings') ov.clientOverlayInput('next')
    ov.clientOverlayInput('select')
    expect(host.querySelector('.settings-panel')).toBeTruthy()
    expect(host.querySelector('.sysmenu')).toBeNull()
    ov.clientOverlayInput('cancel')
    expect(host.querySelector('.settings-panel')?.isConnected).toBeFalsy()
    expect(rows()).toContain('Settings')
    expect(focused()).toBe('Settings')
  })

  it('comes back to it from the controls too, and the game is reached in one more press', () => {
    const { ov, host, focused } = setup()
    ov.showSystem(inGame)
    while (focused() !== 'Gamepad') ov.clientOverlayInput('next')
    ov.clientOverlayInput('select')
    expect(host.querySelector('.bindings-sheet')).toBeTruthy()
    ov.clientOverlayInput('cancel')
    expect(focused()).toBe('Gamepad')
    ov.clientOverlayInput('cancel')
    expect(host.querySelector('.sysmenu')).toBeNull()
  })

  it('leaves the settings opened from anywhere else with no way back', () => {
    const { ov, host } = setup()
    ov.showSettings()
    ov.clientOverlayInput('cancel')
    expect(host.querySelector('.sysmenu')).toBeNull()
    expect(host.querySelector('.settings-panel')?.isConnected).toBeFalsy()
  })
})
