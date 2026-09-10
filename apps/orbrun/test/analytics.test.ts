// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installAnalytics } from '../src/analytics'

const SRC = 'https://static.cloudflareinsights.com/beacon.min.js'

/**
 * The beacon is the one third-party request the app makes, so the rules are
 * pinned: nothing without a token, nothing in dev, and never twice.
 */
describe('cloudflare web analytics beacon', () => {
  // a detached document, so happy-dom does not try to fetch the beacon
  let doc: Document
  beforeEach(() => {
    doc = document.implementation.createHTMLDocument('t')
    vi.stubEnv('DEV', false)
  })
  afterEach(() => vi.unstubAllEnvs())

  const beacons = () => Array.from(doc.head.querySelectorAll(`script[src="${SRC}"]`))

  it('adds a deferred beacon carrying the token', () => {
    vi.stubEnv('VITE_CF_BEACON_TOKEN', 'abc123')
    expect(installAnalytics(doc)).not.toBeNull()
    const [script] = beacons() as HTMLScriptElement[]
    expect(script.defer).toBe(true)
    expect(script.getAttribute('data-cf-beacon')).toBe('{"token":"abc123"}')
  })

  it('adds nothing when no token is configured', () => {
    vi.stubEnv('VITE_CF_BEACON_TOKEN', '')
    expect(installAnalytics(doc)).toBeNull()
    expect(beacons()).toHaveLength(0)
  })

  it('adds nothing on a dev server', () => {
    vi.stubEnv('DEV', true)
    vi.stubEnv('VITE_CF_BEACON_TOKEN', 'abc123')
    expect(installAnalytics(doc)).toBeNull()
    expect(beacons()).toHaveLength(0)
  })

  it('is added once however often it is called', () => {
    vi.stubEnv('VITE_CF_BEACON_TOKEN', 'abc123')
    installAnalytics(doc)
    expect(installAnalytics(doc)).toBeNull()
    expect(beacons()).toHaveLength(1)
  })
})
