// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { formatRoute, parseRoute, setChosenAccount, setRoute, type Account, type Route } from '../src/servers'

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
 * The hash is the official client's (`lobby`, `play-<game_id>`,
 * `watch-<username>`) scoped by who is doing it (`caeo@cdi/play-…`), or by
 * the server alone for what needs no account (`cdi/watch-…`), so a link
 * opens the same thing on another device; the bare hashes read as the
 * account chosen on the home screen. The front end's screens have addresses
 * of their own. An empty hash is the home screen.
 */
describe('routes', () => {
  const caeo: Account = { serverId: 'cdi', username: 'caeo' }
  const someone: Account = { serverId: 'cko', username: 'someone' }
  beforeEach(() => {
    store.clear()
    // an account list, so the chosen one is one of them
    store.set('orbrun.accounts', JSON.stringify([caeo, someone]))
    setChosenAccount(null)
  })

  it('an empty hash is home, whatever the query says', () => {
    expect(parseRoute(base)).toEqual({ kind: 'home' })
    expect(parseRoute(base + '?server=crawl.dcss.io')).toEqual({ kind: 'home' })
  })

  it('reads the official client hash scheme as the chosen account', () => {
    setChosenAccount(caeo)
    expect(parseRoute(base + '#lobby')).toEqual({ kind: 'lobby', serverId: 'cdi', account: caeo })
    expect(parseRoute(base + '#play-dcss-web-trunk')).toEqual({ kind: 'play', account: caeo, gameId: 'dcss-web-trunk' })
    expect(parseRoute(base + '#watch-orbruntest')).toEqual({ kind: 'watch', serverId: 'cdi', account: caeo, username: 'orbruntest' })
  })

  it('reads the bare hashes as home when no account has been chosen, and ignores a server in the query', () => {
    expect(parseRoute(base + '#lobby')).toEqual({ kind: 'home' })
    expect(parseRoute(base + '?server=crawl.dcss.io#lobby')).toEqual({ kind: 'home' })
    setChosenAccount(someone)
    expect(parseRoute(base + '?server=crawl.dcss.io#watch-someone')).toMatchObject({ kind: 'watch', serverId: 'cko' })
  })

  it('is home when the chosen account names a server this device no longer has', () => {
    setChosenAccount({ serverId: 'nowhere.example', username: 'caeo' })
    expect(parseRoute(base + '#lobby')).toEqual({ kind: 'home' })
  })

  it('ignores hashes it does not know', () => {
    setChosenAccount(caeo)
    expect(parseRoute(base + '#register')).toEqual({ kind: 'home' })
    expect(parseRoute(base + '#play-')).toEqual({ kind: 'home' })
    expect(parseRoute(base + '#nowhere.example/lobby')).toEqual({ kind: 'home' })
    expect(parseRoute(base + '#cdi/somewhere')).toEqual({ kind: 'home' })
    expect(parseRoute(base + '#about/nowhere')).toEqual({ kind: 'home' })
  })

  it('watches on a server with no account at all, so a link to a game opens anywhere', () => {
    expect(parseRoute(base + '#cdi/lobby')).toEqual({ kind: 'lobby', serverId: 'cdi', account: null })
    expect(parseRoute(base + '#cdi/watch-bob')).toEqual({ kind: 'watch', serverId: 'cdi', account: null, username: 'bob' })
    // by host as well as by id
    expect(parseRoute(base + '#crawl.dcss.io/watch-bob')).toEqual({ kind: 'watch', serverId: 'cdi', account: null, username: 'bob' })
    // as an account this device has; one it does not have watches without
    expect(parseRoute(base + '#CAEO@cdi/watch-bob')).toEqual({ kind: 'watch', serverId: 'cdi', account: caeo, username: 'bob' })
    expect(parseRoute(base + '#stranger@cdi/watch-bob')).toEqual({ kind: 'watch', serverId: 'cdi', account: null, username: 'bob' })
  })

  it('plays as the account it names, or any on the server, or asks for a login there', () => {
    expect(parseRoute(base + '#caeo@cdi/play-dcss-0.34')).toEqual({ kind: 'play', account: caeo, gameId: 'dcss-0.34' })
    expect(parseRoute(base + '#cko/play-dcss-0.34')).toEqual({ kind: 'play', account: someone, gameId: 'dcss-0.34' })
    expect(parseRoute(base + '#stranger@cdi/play-dcss-0.34')).toEqual({ kind: 'menu', path: 'login', serverId: 'cdi', username: 'stranger' })
    expect(parseRoute(base + '#cbro/play-dcss-0.34')).toEqual({ kind: 'menu', path: 'login', serverId: 'cbro' })
  })

  it('gives the front end’s screens addresses of their own', () => {
    for (const path of ['settings', 'settings/camera', 'settings/controls/gamepad', 'accounts', 'accounts/add', 'watch', 'about', 'about/new', 'about/steam', 'about/orbrun'])
      expect(parseRoute(base + '#' + path)).toEqual({ kind: 'menu', path })
    expect(parseRoute(base + '#cdi/login')).toEqual({ kind: 'menu', path: 'login', serverId: 'cdi' })
    expect(parseRoute(base + '#cdi/register')).toEqual({ kind: 'menu', path: 'register', serverId: 'cdi' })
    expect(parseRoute(base + '#caeo@cdi/login')).toEqual({ kind: 'menu', path: 'login', serverId: 'cdi', username: 'caeo' })
  })

  it('round-trips through formatRoute, encoding the names and saying who', () => {
    const url = formatRoute({ kind: 'play', account: caeo, gameId: 'seeded-web-trunk' })
    expect(url).toBe('/#caeo@cdi/play-seeded-web-trunk')
    const routes: Route[] = [
      { kind: 'play', account: caeo, gameId: 'seeded-web-trunk' },
      { kind: 'watch', serverId: 'cdi', account: caeo, username: 'a b' },
      { kind: 'watch', serverId: 'cdi', account: null, username: 'a/b' },
      { kind: 'lobby', serverId: 'cko', account: null },
      { kind: 'lobby', serverId: 'cko', account: someone },
      { kind: 'menu', path: 'settings/interface' },
      { kind: 'menu', path: 'login', serverId: 'cko', username: 'someone' },
    ]
    for (const r of routes) expect(parseRoute(base + formatRoute(r).slice(1))).toEqual(r)
    expect(formatRoute({ kind: 'home' })).toBe('/')
  })

  it('carries the query through, so the flags set at launch survive a Play', () => {
    setChosenAccount(caeo)
    history.replaceState(null, '', '/?fullscreen&perf')
    try {
      expect(formatRoute({ kind: 'home' })).toBe('/?fullscreen&perf')
      expect(formatRoute({ kind: 'play', account: caeo, gameId: 'dcss-web-trunk' })).toBe('/?fullscreen&perf#caeo@cdi/play-dcss-web-trunk')
      setRoute({ kind: 'play', account: caeo, gameId: 'dcss-web-trunk' })
      expect(window.location.search).toBe('?fullscreen&perf')
      expect(window.location.hash).toBe('#caeo@cdi/play-dcss-web-trunk')
    } finally {
      history.replaceState(null, '', '/')
    }
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
      setRoute({ kind: 'lobby', serverId: 'cdi', account: caeo })
      setRoute({ kind: 'play', account: caeo, gameId: 'dcss-0.34' })
      expect(window.location.hash).toBe('#caeo@cdi/play-dcss-0.34')
      expect(history.length).toBe(before + 1)
    })

    it('rewrites the entry coming back up, so Back never returns to the game just left', () => {
      setRoute({ kind: 'lobby', serverId: 'cdi', account: caeo })
      setRoute({ kind: 'play', account: caeo, gameId: 'dcss-0.34' })
      const deep = history.length
      setRoute({ kind: 'lobby', serverId: 'cdi', account: caeo })
      setRoute({ kind: 'home' })
      expect(window.location.hash).toBe('')
      expect(history.length).toBe(deep)
    })

    it('leaves the address alone when it already says this', () => {
      setRoute({ kind: 'lobby', serverId: 'cdi', account: caeo })
      const len = history.length
      setRoute({ kind: 'lobby', serverId: 'cdi', account: caeo })
      expect(history.length).toBe(len)
    })

    /**
     * A window of our own has no Back to serve, and Chrome refuses to close a
     * window a script did not open once its history holds more than one
     * entry — so an entry here would cost the Quit row (quit.ts).
     */
    it('adds no entry in a window of its own, so Quit can still close it', () => {
      history.replaceState(null, '', '/?fullscreen')
      try {
        const before = history.length
        setRoute({ kind: 'lobby', serverId: 'cdi', account: caeo })
        setRoute({ kind: 'play', account: caeo, gameId: 'dcss-0.34' })
        expect(window.location.hash).toBe('#caeo@cdi/play-dcss-0.34')
        expect(history.length).toBe(before)
      } finally {
        history.replaceState(null, '', '/')
      }
    })

    it('does not stack an entry per game: one spectate to the next replaces it', () => {
      setRoute({ kind: 'lobby', serverId: 'cdi', account: caeo })
      setRoute({ kind: 'watch', serverId: 'cdi', account: caeo, username: 'someone' })
      const len = history.length
      setRoute({ kind: 'watch', serverId: 'cdi', account: caeo, username: 'other' })
      expect(window.location.hash).toBe('#caeo@cdi/watch-other')
      expect(history.length).toBe(len)
    })
  })
})
