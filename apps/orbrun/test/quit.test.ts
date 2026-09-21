// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { canQuit, quit } from '../src/quit'

/** a browser that answers `display-mode` with `mode` and nothing else */
function displayMode(mode: string) {
  vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({ matches: q === `(display-mode: ${mode})` }) as MediaQueryList)
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  history.replaceState(null, '', '/')
})

describe('quitting', () => {
  it('is offered in a kiosk window and an installed app, where the browser shows no way out', () => {
    for (const mode of ['fullscreen', 'standalone', 'minimal-ui', 'window-controls-overlay']) {
      displayMode(mode)
      expect(canQuit()).toBe(true)
    }
  })

  it('is not offered in an ordinary tab, which has its own close button', () => {
    displayMode('browser')
    expect(canQuit()).toBe(false)
  })

  it('is offered in an iOS home-screen app, which reports no display mode', () => {
    displayMode('browser')
    const nav = navigator as { standalone?: boolean }
    nav.standalone = true
    try {
      expect(canQuit()).toBe(true)
    } finally {
      delete nav.standalone
    }
  })

  it('is offered in any tab with `?fullscreen`, for trying the row out', () => {
    displayMode('browser')
    history.replaceState(null, '', '/?fullscreen')
    expect(canQuit()).toBe(true)
    history.replaceState(null, '', '/?fullscreen=0')
    expect(canQuit()).toBe(false)
    history.replaceState(null, '', '/?fullscreen=1#play-dcss-web-trunk')
    expect(canQuit()).toBe(true)
  })

  it('closes the window, and says so when the browser refuses', () => {
    vi.useFakeTimers()
    const close = vi.spyOn(window, 'close').mockImplementation(() => {})
    const refused = vi.fn()
    quit(refused)
    expect(close).toHaveBeenCalled()
    expect(refused).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(refused).toHaveBeenCalledOnce()
  })

  it('says nothing when the window did go', () => {
    vi.useFakeTimers()
    vi.spyOn(window, 'close').mockImplementation(() => {})
    vi.spyOn(window, 'closed', 'get').mockReturnValue(true)
    const refused = vi.fn()
    quit(refused)
    vi.runAllTimers()
    expect(refused).not.toHaveBeenCalled()
  })
})
