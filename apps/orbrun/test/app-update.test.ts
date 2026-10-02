import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/servers', async (orig) => ({ ...(await orig<object>()), offlineOffered: () => true, offlineRuns: () => true }))

/** a page with a service worker (`controlled` when one already answers it), and how often it reloaded */
async function page(controlled: boolean) {
  vi.resetModules()
  const listeners: (() => void)[] = []
  const update = vi.fn(async () => {})
  const sw = {
    controller: controlled ? {} : null,
    register: async () => ({}),
    getRegistration: async () => ({ update }),
    addEventListener: (_: string, f: () => void) => listeners.push(f),
  }
  const reload = vi.fn()
  vi.stubGlobal('navigator', { serviceWorker: sw })
  vi.stubGlobal('location', { href: 'https://orbrun.app/', reload })
  const { keepEngines, updateApp } = await import('../src/engines')
  const p = { busy: false, resting: true }
  keepEngines(() => p.busy, () => p.resting)
  return Object.assign(p, { updateApp, reload, update, takeOver: () => listeners.forEach((f) => f()) })
}

describe('switching to a new version of the app', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('reloads when a new version takes over while the player rests on the home screen', async () => {
    const p = await page(true)
    p.takeOver()
    expect(p.reload).toHaveBeenCalledTimes(1)
  })

  it('does not reload for the first install, which runs the version already on the page', async () => {
    const p = await page(false)
    p.takeOver()
    expect(p.reload).not.toHaveBeenCalled()
    p.takeOver()
    expect(p.reload).toHaveBeenCalledTimes(1)
  })

  it('waits for the home screen when the player is busy, in a game or anywhere else', async () => {
    const p = await page(true)
    p.busy = true
    p.takeOver()
    p.busy = false
    p.resting = false
    p.updateApp()
    expect(p.reload).not.toHaveBeenCalled()
    p.resting = true
    p.updateApp()
    expect(p.reload).toHaveBeenCalledTimes(1)
  })

  it('asks after a new version from the home screen, no more than every few minutes', async () => {
    const p = await page(true)
    p.updateApp()
    expect(p.update).not.toHaveBeenCalled()
    vi.advanceTimersByTime(5 * 60_000 + 1)
    p.updateApp()
    p.updateApp()
    await vi.waitFor(() => expect(p.update).toHaveBeenCalledTimes(1))
  })
})
