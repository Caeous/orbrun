// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { formatRoute, parseRoute, setChosenAccount, setRoute, type Account } from '../src/servers'

const base = 'http://localhost:5173/'

// happy-dom's localStorage has no working methods; give servers.ts a plain one
const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  },
})

/**
 * The hash is the official client's (`#lobby`, `#play-<game_id>`,
 * `#watch-<username>`); who it means is the account chosen on the home
 * screen, kept in storage, never in the URL. With none chosen the URL means
 * the home screen, the account list itself.
 */
describe('routes', () => {
  const caeo: Account = { serverId: 'cdi', username: 'caeo' }
  beforeEach(() => {
    store.clear()
    // an account list, so the chosen one is one of them
    store.set('orbrun.accounts', JSON.stringify([caeo, { serverId: 'cko', username: 'someone' }]))
    setChosenAccount(null)
  })

  it('an empty hash is home, whatever the query says', () => {
    expect(parseRoute(base)).toEqual({ kind: 'home' })
    expect(parseRoute(base + '?server=crawl.dcss.io')).toEqual({ kind: 'home' })
  })

  it('follows the official client hash scheme, as the chosen account', () => {
    setChosenAccount(caeo)
    expect(parseRoute(base + '#lobby')).toEqual({ kind: 'lobby', account: caeo })
    expect(parseRoute(base + '#play-dcss-web-trunk')).toEqual({ kind: 'play', account: caeo, gameId: 'dcss-web-trunk' })
    expect(parseRoute(base + '#watch-orbruntest')).toEqual({ kind: 'watch', account: caeo, username: 'orbruntest' })
  })

  it('is home when no account has been chosen, and ignores a server in the query', () => {
    expect(parseRoute(base + '#lobby')).toEqual({ kind: 'home' })
    expect(parseRoute(base + '?server=crawl.dcss.io#lobby')).toEqual({ kind: 'home' })
    setChosenAccount({ serverId: 'cko', username: 'someone' })
    expect(parseRoute(base + '?server=crawl.dcss.io#watch-someone')).toMatchObject({ kind: 'watch', account: { serverId: 'cko' } })
  })

  it('is home when the chosen account names a server this device no longer has', () => {
    setChosenAccount({ serverId: 'nowhere.example', username: 'caeo' })
    expect(parseRoute(base + '#lobby')).toEqual({ kind: 'home' })
  })

  it('ignores hashes it does not know', () => {
    setChosenAccount(caeo)
    expect(parseRoute(base + '#register')).toEqual({ kind: 'home' })
    expect(parseRoute(base + '#play-')).toEqual({ kind: 'home' })
  })

  it('round-trips through formatRoute, encoding the game id and leaving the account out', () => {
    setChosenAccount(caeo)
    const url = formatRoute({ kind: 'play', account: caeo, gameId: 'seeded-web-trunk' })
    expect(url).toBe('/#play-seeded-web-trunk')
    expect(parseRoute(base + url.slice(1))).toEqual({ kind: 'play', account: caeo, gameId: 'seeded-web-trunk' })
    expect(parseRoute(base + formatRoute({ kind: 'watch', account: caeo, username: 'a b' }).slice(1))).toEqual({ kind: 'watch', account: caeo, username: 'a b' })
    expect(formatRoute({ kind: 'home' })).toBe('/')
  })

  /**
   * The address bar is also the way back: opening a game leaves the screen it
   * was opened from in the history, so the browser's Back (and a handheld's
   * back gesture) returns to the lobby, or to the account list if that is
   * where the game was started from.
   */
  describe('history', () => {
    beforeEach(() => {
      setChosenAccount(caeo)
      history.replaceState(null, '', '/')
    })

    it('adds one entry leaving home, so Back is the way out of a game, straight to the root', () => {
      const before = history.length
      setRoute({ kind: 'lobby', account: caeo })
      setRoute({ kind: 'play', account: caeo, gameId: 'dcss-0.34' })
      expect(window.location.hash).toBe('#play-dcss-0.34')
      expect(history.length).toBe(before + 1)
    })

    it('rewrites the entry coming back up, so Back never returns to the game just left', () => {
      setRoute({ kind: 'lobby', account: caeo })
      setRoute({ kind: 'play', account: caeo, gameId: 'dcss-0.34' })
      const deep = history.length
      setRoute({ kind: 'lobby', account: caeo })
      setRoute({ kind: 'home' })
      expect(window.location.hash).toBe('')
      expect(history.length).toBe(deep)
    })

    it('leaves the address alone when it already says this', () => {
      setRoute({ kind: 'lobby', account: caeo })
      const len = history.length
      setRoute({ kind: 'lobby', account: caeo })
      expect(history.length).toBe(len)
    })

    it('does not stack an entry per game: one spectate to the next replaces it', () => {
      setRoute({ kind: 'lobby', account: caeo })
      setRoute({ kind: 'watch', account: caeo, username: 'someone' })
      const len = history.length
      setRoute({ kind: 'watch', account: caeo, username: 'other' })
      expect(window.location.hash).toBe('#watch-other')
      expect(history.length).toBe(len)
    })
  })
})
