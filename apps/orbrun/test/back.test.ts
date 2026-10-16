// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { installBack } from '../src/back'

/** CloseWatcher as Chrome on Android keeps them: the newest one open takes the back, and is gone */
function watchers() {
  const open: Fake[] = []
  class Fake {
    onclose: ((ev: Event) => void) | null = null
    constructor() {
      open.push(this)
    }
    destroy() {
      open.splice(open.indexOf(this), 1)
    }
  }
  /** the system's back: the newest watcher closes, or with none open the browser has it (false) */
  const back = (): boolean => {
    const w = open.pop()
    if (!w) return false
    w.onclose?.(new Event('close'))
    return true
  }
  return { open, back, CloseWatcher: Fake }
}

describe("Android's back", () => {
  it('is answered while there is somewhere to go, again and again with no tap between', () => {
    const sys = watchers()
    const back = vi.fn()
    const sync = installBack(() => true, back, { CloseWatcher: sys.CloseWatcher, android: true })
    sync()
    expect(sys.back()).toBe(true)
    expect(sys.back()).toBe(true)
    expect(back).toHaveBeenCalledTimes(2)
    expect(sys.open).toHaveLength(1)
  })

  it('is let through on the bare home screen, to leave the app', () => {
    const sys = watchers()
    let armed = true
    const sync = installBack(() => armed, () => {}, { CloseWatcher: sys.CloseWatcher, android: true })
    sync()
    armed = false
    sync()
    expect(sys.open).toHaveLength(0)
    expect(sys.back()).toBe(false)
  })

  it('stops being answered by the back that reaches the bare home screen', () => {
    const sys = watchers()
    let armed = true
    const sync = installBack(() => armed, () => { armed = false }, { CloseWatcher: sys.CloseWatcher, android: true })
    sync()
    expect(sys.back()).toBe(true)
    expect(sys.back()).toBe(false)
  })

  it('leaves an Escape to the keyboard, though Android sends it on as a back', () => {
    const sys = watchers()
    const back = vi.fn()
    const sync = installBack(() => true, back, { CloseWatcher: sys.CloseWatcher, android: true })
    sync()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    sys.back()
    expect(back).not.toHaveBeenCalled()
    expect(sys.open).toHaveLength(1)
  })

  it('is left alone off Android, and where the browser has no CloseWatcher', () => {
    const sys = watchers()
    installBack(() => true, () => {}, { CloseWatcher: sys.CloseWatcher, android: false })()
    expect(sys.open).toHaveLength(0)
    expect(() => installBack(() => true, () => {}, { android: true })()).not.toThrow()
  })
})
