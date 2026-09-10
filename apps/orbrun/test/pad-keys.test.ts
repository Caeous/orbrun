// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { GamepadInput, installPadKeys, type PadEvent } from '../src/gamepad'

let uninstall: (() => void) | null = null

function shim() {
  const pad = new GamepadInput()
  const events: PadEvent[] = []
  pad.on((e) => events.push(e))
  uninstall = installPadKeys(pad)
  return { pad, events }
}

const key = (type: 'keydown' | 'keyup', code: string, init: KeyboardEventInit = {}) => {
  const ev = new KeyboardEvent(type, { code, shiftKey: type === 'keydown', cancelable: true, ...init })
  window.dispatchEvent(ev)
  return ev
}

afterEach(() => {
  uninstall?.()
  uninstall = null
})

describe('keyboard stand-ins for the pad', () => {
  it('presses and releases RB on Shift+F1', () => {
    const { pad, events } = shim()
    key('keydown', 'F1')
    expect(events.map((e) => e.type)).toEqual(['press'])
    expect(pad.isHeld('RB')).toBe(true)
    key('keyup', 'F1', { shiftKey: false })
    expect(events[1]).toMatchObject({ type: 'release', button: 'RB' })
    expect(pad.isHeld('RB')).toBe(false)
  })

  it('holds through the key repeat, so a held key is one long press', () => {
    const { events } = shim()
    key('keydown', 'F1')
    key('keydown', 'F1', { repeat: true })
    key('keydown', 'F1', { repeat: true })
    expect(events.filter((e) => e.type === 'press')).toHaveLength(1)
  })

  it('leaves native Crawl punctuation alone, even with Shift', () => {
    const { events } = shim()
    expect(key('keydown', 'Backquote').defaultPrevented).toBe(false)
    expect(key('keydown', 'Backslash').defaultPrevented).toBe(false)
    expect(events).toEqual([])
  })

  it('leaves a bare F1 and the other keys alone', () => {
    const { events } = shim()
    const bare = key('keydown', 'F1', { shiftKey: false })
    key('keydown', 'F3')
    expect(events).toEqual([])
    expect(bare.defaultPrevented).toBe(false)
  })

  it('lets go when the window loses focus', () => {
    const { pad, events } = shim()
    key('keydown', 'F2')
    expect(pad.isHeld('SELECT')).toBe(true)
    window.dispatchEvent(new Event('blur'))
    expect(pad.isHeld('SELECT')).toBe(false)
    expect(events[1]).toMatchObject({ type: 'release', button: 'SELECT' })
  })
})
