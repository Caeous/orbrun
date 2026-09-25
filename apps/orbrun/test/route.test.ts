// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { addServer, formatRoute, parseRoute, setChosenAccount, setRoute, type Account, type Route } from '../src/servers'

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
 * The path says what, where and who: `/play/cdi/orbrun/dcss-0.34`,
 * `/watch/cdi/bob`, so a link opens the same thing on another device; the
 * front end's screens have addresses of their own, and the root is the home
 * screen.
 */
describe('routes', () => {
  const orbrun: Account = { serverId: 'cdi', username: 'orbrun' }
  const someone: Account = { serverId: 'cko', username: 'someone' }
  beforeEach(() => {
    store.clear()
    // an account list, so the chosen one is one of them
    store.set('orbrun.accounts', JSON.stringify([orbrun, someone]))
    setChosenAccount(null)
  })

  it('the root is home, whatever the query says', () => {
    expect(parseRoute(base)).toEqual({ kind: 'home' })
    expect(parseRoute(base + '?server=crawl.dcss.io')).toEqual({ kind: 'home' })
  })

  it('watches on a server with no account at all, so a link to a game opens anywhere', () => {
    expect(parseRoute(base + 'watch/cdi')).toEqual({ kind: 'lobby', serverId: 'cdi', account: null })
    expect(parseRoute(base + 'watch/cdi/bob')).toEqual({ kind: 'watch', serverId: 'cdi', account: null, username: 'bob' })
    // by host as well as by id, in any case
    expect(parseRoute(base + 'watch/crawl.dcss.io/bob')).toEqual({ kind: 'watch', serverId: 'cdi', account: null, username: 'bob' })
    expect(parseRoute(base + 'Watch/CDI/bob')).toEqual({ kind: 'watch', serverId: 'cdi', account: null, username: 'bob' })
    // as the chosen account, when it is on that server
    setChosenAccount(orbrun)
    expect(parseRoute(base + 'watch/cdi/bob')).toEqual({ kind: 'watch', serverId: 'cdi', account: orbrun, username: 'bob' })
    expect(parseRoute(base + 'watch/cko')).toEqual({ kind: 'lobby', serverId: 'cko', account: null })
  })

  it('plays as the account it names, or asks for a login there', () => {
    expect(parseRoute(base + 'play/cdi/orbrun/dcss-0.34')).toEqual({ kind: 'play', account: orbrun, gameId: 'dcss-0.34' })
    expect(parseRoute(base + 'play/cdi/ORBRUN/dcss-0.34')).toEqual({ kind: 'play', account: orbrun, gameId: 'dcss-0.34' })
    expect(parseRoute(base + 'play/cdi/stranger/dcss-0.34')).toEqual({ kind: 'menu', path: 'login', serverId: 'cdi', username: 'stranger' })
  })

  it('gives the front end’s screens addresses of their own', () => {
    for (const path of ['settings', 'settings/camera', 'settings/controls/gamepad', 'accounts', 'accounts/add', 'accounts/add/server', 'watch', 'watch/add', 'about', 'about/new', 'about/steam', 'about/orbrun']) {
      expect(parseRoute(base + path)).toEqual({ kind: 'menu', path })
      expect(parseRoute(base + path + '/')).toEqual({ kind: 'menu', path })
    }
    expect(parseRoute(base + 'Settings/Camera')).toEqual({ kind: 'menu', path: 'settings/camera' })
    expect(parseRoute(base + 'login/cdi')).toEqual({ kind: 'menu', path: 'login', serverId: 'cdi' })
    expect(parseRoute(base + 'register/cdi')).toEqual({ kind: 'menu', path: 'register', serverId: 'cdi' })
    expect(parseRoute(base + 'login/cdi/ORBRUN')).toEqual({ kind: 'menu', path: 'login', serverId: 'cdi', username: 'orbrun' })
  })

  it('ignores paths it does not know', () => {
    for (const path of ['nowhere', 'play', 'play/cdi', 'play/cdi/orbrun', 'play/cdi/orbrun/dcss-0.34/more', 'watch/nowhere.example', 'watch/cdi/bob/more', 'lobby/cdi', 'about/nowhere', 'login/cdi/orbrun/more'])
      expect(parseRoute(base + path)).toEqual({ kind: 'home' })
  })

  it('leaves `offline-` out of the games on this device', () => {
    // offline is not offered under test (servers.ts offlineOffered)
    vi.stubEnv('MODE', 'development')
    const marc: Account = { serverId: 'offline', username: 'Marc' }
    store.set('orbrun.accounts', JSON.stringify([orbrun, marc]))
    const play: Route = { kind: 'play', account: marc, gameId: 'offline-0.34' }
    expect(formatRoute(play)).toBe('/play/offline/Marc/0.34')
    expect(parseRoute(base + 'play/offline/marc/0.34')).toEqual(play)
    expect(parseRoute(base + 'play/offline/Marc/trunk')).toEqual({ ...play, gameId: 'offline-trunk' })
    expect(formatRoute({ kind: 'menu', path: 'login', serverId: 'offline' })).toBe('/login/offline')
    // nobody else plays on this device
    expect(parseRoute(base + 'watch/offline')).toEqual({ kind: 'home' })
    expect(parseRoute(base + 'watch/offline/bob')).toEqual({ kind: 'home' })
    vi.unstubAllEnvs()
  })

  it('round-trips through formatRoute, encoding each name whole', () => {
    expect(formatRoute({ kind: 'play', account: orbrun, gameId: 'seeded-web-trunk' })).toBe('/play/cdi/orbrun/seeded-web-trunk')
    expect(formatRoute({ kind: 'watch', serverId: 'cdi', account: null, username: 'a b' })).toBe('/watch/cdi/a%20b')
    expect(formatRoute({ kind: 'lobby', serverId: 'cko', account: someone })).toBe('/watch/cko')
    setChosenAccount(orbrun)
    // names with what a path or a URL would otherwise take apart: spaces, slashes, a query, a fragment, escapes, pluses
    const odd = ['a b', 'a/b', 'a?b', 'a#b', '100%', 'a+b', 'a%20b', 'ünï cödé', 'a@b', 'a.b', '..b']
    const custom: Account = { serverId: addServer('http://crawl.example.org:8080').id, username: 'a b/c' }
    store.set('orbrun.accounts', JSON.stringify([orbrun, someone, ...odd.map((username) => ({ serverId: 'cdi', username })), custom]))
    const routes: Route[] = [
      { kind: 'play', account: orbrun, gameId: 'seeded-web-trunk' },
      { kind: 'watch', serverId: 'cdi', account: orbrun, username: 'someone' },
      { kind: 'lobby', serverId: 'cko', account: null },
      { kind: 'lobby', serverId: 'cdi', account: orbrun },
      { kind: 'menu', path: 'settings/interface' },
      { kind: 'menu', path: 'login', serverId: 'cko', username: 'someone' },
      { kind: 'play', account: custom, gameId: 'dcss-0.34' },
      { kind: 'watch', serverId: custom.serverId, account: null, username: 'bob' },
      ...odd.flatMap((name): Route[] => [
        { kind: 'play', account: { serverId: 'cdi', username: name }, gameId: name },
        { kind: 'watch', serverId: 'cdi', account: orbrun, username: name },
        { kind: 'menu', path: 'login', serverId: 'cdi', username: name },
      ]),
    ]
    for (const r of routes) expect(parseRoute(new URL(formatRoute(r), base).href)).toEqual(r)
    expect(formatRoute({ kind: 'home' })).toBe('/')
  })

  it('carries the query through, so the flags set at launch survive a Play', () => {
    setChosenAccount(orbrun)
    history.replaceState(null, '', '/?fullscreen&perf')
    try {
      expect(formatRoute({ kind: 'home' })).toBe('/?fullscreen&perf')
      expect(formatRoute({ kind: 'play', account: orbrun, gameId: 'dcss-web-trunk' })).toBe('/play/cdi/orbrun/dcss-web-trunk?fullscreen&perf')
      setRoute({ kind: 'play', account: orbrun, gameId: 'dcss-web-trunk' })
      expect(window.location.search).toBe('?fullscreen&perf')
      expect(window.location.pathname).toBe('/play/cdi/orbrun/dcss-web-trunk')
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
      setChosenAccount(orbrun)
      history.replaceState(null, '', '/')
    })

    it('adds one entry leaving home, so Back is the way out of a game, straight to the root', () => {
      const before = history.length
      setRoute({ kind: 'lobby', serverId: 'cdi', account: orbrun })
      setRoute({ kind: 'play', account: orbrun, gameId: 'dcss-0.34' })
      expect(window.location.pathname).toBe('/play/cdi/orbrun/dcss-0.34')
      expect(history.length).toBe(before + 1)
    })

    it('rewrites the entry coming back up, so Back never returns to the game just left', () => {
      setRoute({ kind: 'lobby', serverId: 'cdi', account: orbrun })
      setRoute({ kind: 'play', account: orbrun, gameId: 'dcss-0.34' })
      const deep = history.length
      setRoute({ kind: 'lobby', serverId: 'cdi', account: orbrun })
      setRoute({ kind: 'home' })
      expect(window.location.pathname).toBe('/')
      expect(history.length).toBe(deep)
    })

    it('names the tab after the page it moves to, and leaves a game’s to the game', () => {
      setRoute({ kind: 'menu', path: 'about/steam' })
      expect(document.title).toBe('Add Orbrun to Steam and the Steam Deck')
      setRoute({ kind: 'play', account: orbrun, gameId: 'dcss-0.34' })
      expect(document.title).toBe('Add Orbrun to Steam and the Steam Deck')
      setRoute({ kind: 'menu', path: 'settings' })
      expect(document.title).toBe('Orbrun - Dungeon Crawl Stone Soup in first person')
    })

    it('leaves the address alone when it already says this', () => {
      setRoute({ kind: 'lobby', serverId: 'cdi', account: orbrun })
      const len = history.length
      setRoute({ kind: 'lobby', serverId: 'cdi', account: orbrun })
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
        setRoute({ kind: 'lobby', serverId: 'cdi', account: orbrun })
        setRoute({ kind: 'play', account: orbrun, gameId: 'dcss-0.34' })
        expect(window.location.pathname).toBe('/play/cdi/orbrun/dcss-0.34')
        expect(history.length).toBe(before)
      } finally {
        history.replaceState(null, '', '/')
      }
    })

    it('does not stack an entry per game: one spectate to the next replaces it', () => {
      setRoute({ kind: 'lobby', serverId: 'cdi', account: orbrun })
      setRoute({ kind: 'watch', serverId: 'cdi', account: orbrun, username: 'someone' })
      const len = history.length
      setRoute({ kind: 'watch', serverId: 'cdi', account: orbrun, username: 'other' })
      expect(window.location.pathname).toBe('/watch/cdi/other')
      expect(history.length).toBe(len)
    })
  })
})
