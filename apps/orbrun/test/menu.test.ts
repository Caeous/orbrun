// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { initialState, type GameState, type LobbyEntry } from '@orbrun/webtiles'
import { FrontEnd, navDir, loginWord, exitReasonMessage, type Intent } from '../src/menu'
import { settingsPanel } from '../src/settings-panel'
import type { Session } from '../src/session'
import { XOM_SPLASHES } from '../src/splash'
import { findServer, setGames, setToken, type Account, type ServerInfo } from '../src/servers'
import changelogText from '../../../CHANGELOG.md?raw'

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

const cdi = findServer('cdi')!
const cko = findServer('cko')!
const caeo: Account = { serverId: 'cdi', username: 'caeo' }
const kelbi: Account = { serverId: 'cko', username: 'caeo' }

/** A connection that says what a lobby says, without a socket. */
function fakeSession(server: ServerInfo, username: string | null, lobby: Partial<GameState['lobby']> = {}, open = true): Session {
  const state = initialState()
  Object.assign(state.lobby, lobby)
  const listeners: ((e: unknown) => void)[] = []
  const s = {
    server,
    username,
    closed: false,
    conn: { open },
    state,
    send: vi.fn(),
    on: (fn: (e: unknown) => void) => {
      listeners.push(fn)
      return () => listeners.splice(listeners.indexOf(fn), 1)
    },
    emit: (e: unknown) => listeners.forEach((fn) => fn(e)),
  }
  return s as unknown as Session
}

function playing(username: string, more: Partial<LobbyEntry> = {}): LobbyEntry {
  return { id: username.length, username, game_id: 'dcss-web-trunk', char: 'MiBe', xl: '12', place: 'Lair:3', ...more } as LobbyEntry
}

/** The focus id of a player's roster row: the row stands for the lobby entry, not the name. */
function at(username: string): string {
  return 'watch:' + playing(username).id
}

interface Made {
  screen: FrontEnd
  connect: ReturnType<typeof vi.fn>
  watch: ReturnType<typeof vi.fn>
  play: ReturnType<typeof vi.fn>
  logout: ReturnType<typeof vi.fn>
}

const made: FrontEnd[] = []
afterEach(() => {
  for (const s of made.splice(0)) s.destroy()
})

/** The front end on a screen, with no session up unless `session` gives one. */
function make(session?: (server: ServerInfo, username: string | null) => Session | null, padConnected = false): Made {
  const host = document.createElement('div')
  document.body.append(host)
  const connect = vi.fn((server: ServerInfo, username: string | null, _intent?: Intent) => session?.(server, username) ?? fakeSession(server, username))
  const watch = vi.fn()
  const play = vi.fn()
  const logout = vi.fn()
  const screen = new FrontEnd(host, { connect, session: (s, u) => session?.(s, u) ?? null, logout, play, watch, leave: () => {}, padConnected: () => padConnected })
  made.push(screen)
  return { screen, connect, watch, play, logout }
}

/** The rows of the screen's list: the label of each item, in order (the roster's rows by player). */
function labels(screen: FrontEnd): string[] {
  return Array.from(screen.root.querySelectorAll('.menu .item .label, table.roster tr.game td.col-user')).map((el) => el.textContent ?? '')
}

function sub(screen: FrontEnd, label: string): string | null {
  const item = Array.from(screen.root.querySelectorAll('.menu .item')).find((el) => el.querySelector('.label')?.textContent === label)
  return item?.querySelector('.sub, .val .v')?.textContent ?? null
}

/** The compact identity, with a status only when there is a problem. */
function conn(screen: FrontEnd): string | null {
  const item = screen.root.querySelector('.home-utilities .item[data-focus="account"]')
  return item ? [item.querySelector('.label')?.textContent, item.querySelector('.sub')?.textContent].filter(Boolean).join(' · ') : null
}

/** The colour of the dot before the account: up, wait, off or down, or null without one. */
function dot(screen: FrontEnd): string | null {
  const item = screen.root.querySelector('.home-utilities .item[data-focus="account"]')
  if (!item?.querySelector('.dot')) return null
  return ['up', 'wait', 'off', 'down'].find((c) => item.classList.contains(c)) ?? null
}

function pick(screen: FrontEnd, label: string) {
  const items = Array.from(screen.root.querySelectorAll('.menu .item, table.roster tr.game'))
  const item = items.find((el) => el.querySelector('.label')?.textContent === label) ?? items.find((el) => el.querySelector('td.col-user')?.textContent === label)
  if (!item) throw new Error(`no row "${label}" on the screen; there is ${JSON.stringify(labels(screen))}`)
  ;(item as HTMLElement).click()
}

function focused(screen: FrontEnd): string | undefined {
  return (screen.root.querySelector('.focused') as HTMLElement | null)?.dataset.focus
}

function press(screen: FrontEnd, key: string, target?: EventTarget) {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  if (target) Object.defineProperty(ev, 'target', { value: target })
  return screen.key(ev)
}

function pad(screen: FrontEnd, button: 'A' | 'B' | 'X' | 'Y' | 'LB' | 'RB' | 'START') {
  screen.pad({ type: 'press', button, t: 0 })
}

describe('the front end: the home screen', () => {
  beforeEach(() => {
    store.clear()
    document.body.replaceChildren()
  })

  it('with no account: leads with Play and keeps information outside the main actions', () => {
    const { screen } = make()
    expect(labels(screen)).toEqual(['Play', 'Watch', 'Settings', 'About & credits'])
    expect(focused(screen)).toBe('account')
    expect(screen.root.querySelector('.head .place')?.textContent).toBe('Orbrun')
    expect(screen.root.querySelector('.head .lede')?.textContent).toBe('An unofficial first-person client for Dungeon Crawl Stone Soup.')
    expect(XOM_SPLASHES.map((s) => s.text)).toContain(screen.root.querySelector('.head .splash')?.textContent)
    expect(screen.root.querySelector('.home-footer')?.textContent).toBe('About & credits')
    expect(screen.root.querySelectorAll('a')).toHaveLength(0)
    expect(sub(screen, 'Play')).toBeNull()
  })

  it('reserves home help space for every row and footer hint as focus changes', () => {
    const { screen } = make()
    const help = screen.root.querySelector('.home-menu-help')!
    const live = help.querySelector('[aria-live="polite"]')!
    const reserve = help.querySelector('.menu-msg-reserve')!
    const hints = Array.from(reserve.children, (el) => el.textContent)
    expect(reserve.getAttribute('aria-hidden')).toBe('true')
    expect(hints).toHaveLength(4)
    expect(hints).toContain(live.textContent)
    const first = live.textContent
    press(screen, 'ArrowDown')
    expect(live.textContent).not.toBe(first)
    expect(hints).toContain(live.textContent)
    expect(hints).toContain('About Orbrun, what’s new, and the people behind the game.')
    expect(Array.from(reserve.children, (el) => el.textContent)).toEqual(hints)
  })

  it('with an account: the way in first, the utilities under it, and Log in in Play’s place before the login', () => {
    localStorage.setItem('orbrun.accounts', JSON.stringify([caeo]))
    localStorage.setItem('orbrun.account', JSON.stringify(caeo))
    const { screen } = make()
    expect(labels(screen)).toEqual(['Log in', 'Watch', 'Settings', 'caeo · CDI', 'About & credits'])
    expect(conn(screen)).toBe('caeo · CDI')
    expect(focused(screen)).toBe('login')
  })

  it('Play on the home screen leaves the screen standing until the game comes, rather than sliding it in again', () => {
    localStorage.setItem('orbrun.accounts', JSON.stringify([caeo]))
    localStorage.setItem('orbrun.account', JSON.stringify(caeo))
    const s = fakeSession(cdi, 'caeo', { username: 'caeo', complete: true, games: [{ id: 'dcss-web-0.34', label: 'DCSS 0.34' }] })
    const { screen, connect } = make(() => s)
    const frame = screen.root.querySelector('.frame')
    const menu = screen.root.querySelector('.menu')
    pick(screen, 'Play DCSS 0.34')
    expect(connect).toHaveBeenCalledWith(cdi, 'caeo', { kind: 'play', gameId: 'dcss-web-0.34' })
    expect(screen.view).toBe('home')
    expect(screen.root.querySelector('.frame')).toBe(frame)
    expect(screen.root.querySelector('.menu')).toBe(menu)
    expect(focused(screen)).toBe('play:dcss-web-0.34')
    // the lobby's news lands meanwhile: the screen is drawn again in place, not as a new one
    s.state.lobby.entries = new Map([[1, playing('alice')]])
    screen.refresh()
    expect(sub(screen, 'Watch')).toBe('1 playing')
    expect(screen.root.querySelector('.frame')?.classList.contains('still')).toBe(true)
  })

  it('the roster count changing under the cursor keeps the hint standing, not fading in again', () => {
    localStorage.setItem('orbrun.accounts', JSON.stringify([caeo]))
    localStorage.setItem('orbrun.account', JSON.stringify(caeo))
    const s = fakeSession(cdi, 'caeo', { username: 'caeo', complete: true, games: [{ id: 'dcss-web-0.34', label: 'DCSS 0.34' }] })
    const { screen } = make(() => s)
    const msg = () => screen.root.querySelector('.menu-msg')!
    const hint = msg().textContent
    expect(hint).toBe('DCSS 0.34 on crawl.dcss.io. A game of yours already waiting there continues instead.')
    expect(msg().classList.contains('said')).toBe(true)
    // each watcher arriving redraws the home screen: the same words on a fresh line, without the fade-in
    for (let n = 1; n <= 3; n++) {
      s.state.lobby.entries = new Map(Array.from({ length: n }, (_, i) => [i + 1, playing('p' + i)] as const))
      screen.refresh()
      expect(sub(screen, 'Watch')).toBe(`${n} playing`)
      expect(msg().textContent).toBe(hint)
      expect(msg().classList.contains('said')).toBe(false)
    }
    // moving the cursor still says the new row with the fade-in
    press(screen, 'ArrowDown')
    expect(msg().textContent).not.toBe(hint)
    expect(msg().classList.contains('said')).toBe(true)
  })

  it('once logged in: versions are on home, Continue stands first, Watch counts players', () => {
    localStorage.setItem('orbrun.accounts', JSON.stringify([caeo]))
    localStorage.setItem('orbrun.account', JSON.stringify(caeo))
    localStorage.setItem('orbrun.last', JSON.stringify({ serverId: 'cdi', username: 'caeo', gameId: 'dcss-web-trunk' }))
    const s = fakeSession(cdi, 'caeo', {
      username: 'caeo',
      complete: true,
      games: [
        { id: 'dcss-web-0.34', label: 'DCSS 0.34' },
        { id: 'dcss-web-trunk', label: 'DCSS trunk', save: 'caeo, a level 9 Minotaur Berserker of Trog' },
      ],
      entries: new Map([[1, playing('alice')]]),
    })
    const { screen } = make(() => s)
    expect(labels(screen)).toEqual(['Continue DCSS trunk', 'Play DCSS 0.34', 'Watch', 'Settings', 'caeo · CDI', 'About & credits'])
    expect(sub(screen, 'Continue DCSS trunk')).toBe('a level 9 Minotaur Berserker of Trog')
    expect(sub(screen, 'Play DCSS 0.34')).toBeNull()
    expect(sub(screen, 'Watch')).toBe('1 playing')
    expect(conn(screen)).toBe('caeo · CDI')
    expect(focused(screen)).toBe('play:dcss-web-trunk')
    const lines = Array.from(screen.root.querySelectorAll('.home-actions > .line'))
    expect(lines.map((line) => line.firstElementChild?.getAttribute('data-focus'))).toEqual(['play:dcss-web-trunk', 'play:dcss-web-0.34', 'watch', 'settings'])
    expect(lines.map((line) => line.children.length)).toEqual([1, 1, 1, 1])
    press(screen, 'ArrowDown')
    press(screen, 'ArrowDown')
    expect(focused(screen)).toBe('watch')
    press(screen, 'ArrowRight')
    expect(focused(screen)).toBe('watch')
    press(screen, 'ArrowDown')
    expect(focused(screen)).toBe('settings')
    press(screen, 'ArrowRight')
    expect(focused(screen)).toBe('settings')
  })

  it('shows how the last game ended on a screen of its own, as the official lobby’s exit dialog, until closed', () => {
    // another client took over the account: the server hung this game up, crawl saved, and game_ended said so
    localStorage.setItem('orbrun.accounts', JSON.stringify([caeo]))
    localStorage.setItem('orbrun.account', JSON.stringify(caeo))
    const s = fakeSession(cdi, 'caeo', { username: 'caeo', complete: true, games: [{ id: 'dcss-web-0.34', label: 'DCSS 0.34' }] })
    s.state.exit = { reason: 'disconnect', message: 'Game saved, see you later!\n', dump: 'https://crawl.dcss.io/morgue/caeo/caeo' }
    const { screen } = make(() => s)
    // the front waits behind it: no Play or Watch row while the report is up
    expect(screen.view).toBe('exit')
    expect(screen.root.querySelector('.frame.exit-list')).not.toBeNull()
    expect(screen.root.querySelector('h1')?.textContent).toBe('Disconnected')
    const report = screen.root.querySelector('.exit-report')!
    expect(report.querySelector('p')?.textContent).toBe('You have been disconnected.')
    expect(report.querySelector('pre')?.textContent).toBe('Game saved, see you later!')
    // the morgue file is a row, read here rather than in a tab
    expect(report.querySelector('a')).toBeNull()
    expect(labels(screen)).toEqual(['Close', 'Morgue file'])
    expect(focused(screen)).toBe('exit:close')
    // the cursor reaches the row, and Escape (B) closes the report from anywhere on it
    press(screen, 'ArrowDown')
    expect(focused(screen)).toBe('exit:dump')
    press(screen, 'Escape')
    expect(s.state.exit).toBeNull()
    expect(screen.view).toBe('home')
    expect(screen.root.querySelector('.exit-report')).toBeNull()
    expect(labels(screen)).toContain('Play DCSS 0.34')
    // Close does the same
    s.state.exit = { reason: 'crash', dump: 'https://crawl.dcss.io/morgue/caeo/crash' }
    screen.showHome()
    expect(screen.view).toBe('exit')
    expect(screen.root.querySelector('h1')?.textContent).toBe('Your game crashed')
    expect(labels(screen)).toEqual(['Close', 'Crash log'])
    ;(screen.root.querySelector('[data-focus="exit:close"]') as HTMLButtonElement).click()
    expect(s.state.exit).toBeNull()
    expect(screen.view).toBe('home')
    // a plain save with nothing to say shows nothing, as client.js go_lobby skips normal exits
    s.state.exit = { reason: 'saved' }
    screen.showHome()
    expect(screen.view).toBe('home')
    expect(s.state.exit).toBeNull()
    expect(screen.root.querySelector('.exit-report')).toBeNull()
  })

  it('reads the morgue file here through the shell’s proxy, and falls back to a link when it cannot', async () => {
    localStorage.setItem('orbrun.accounts', JSON.stringify([caeo]))
    localStorage.setItem('orbrun.account', JSON.stringify(caeo))
    const s = fakeSession(cdi, 'caeo', { username: 'caeo', complete: true, games: [{ id: 'dcss-web-0.34', label: 'DCSS 0.34' }] })
    // the server hands the file as a path of its own, less the `.txt`, as CDI does
    s.state.exit = { reason: 'dead', message: 'You die...\n', dump: '/crawl/morgue/caeo/morgue-caeo-20260910-120000' }
    const fetched = vi.fn(async (_url: string) => new Response(' Dungeon Crawl Stone Soup version 0.34\n\n123 caeo the Vexing (level 1, 0/12 HPs)\n', { status: 200 }))
    vi.stubGlobal('fetch', fetched)
    try {
      const { screen } = make(() => s)
      expect(screen.view).toBe('exit')
      pick(screen, 'Morgue file')
      expect(screen.view).toBe('doc')
      expect(screen.root.querySelector('.head .place')?.textContent).toBe('Morgue file')
      expect(fetched).toHaveBeenCalledWith('/morgue-proxy/crawl.dcss.io/crawl/morgue/caeo/morgue-caeo-20260910-120000.txt')
      expect(screen.root.querySelector('.doc-scroll')?.textContent).toBe('Loading…')
      await vi.waitFor(() => expect(screen.root.querySelector('.doc-scroll .doc-text')?.textContent).toContain('caeo the Vexing'))
      // no link out while it reads here
      expect(screen.root.querySelector('.about-links')).toBeNull()
      // Back returns to the report, with the game's end still on show
      pad(screen, 'B')
      expect(screen.view).toBe('exit')
      expect(s.state.exit).not.toBeNull()
      expect(focused(screen)).toBe('exit:dump')

      // a file the server will not give: the words say so, and the link out stands in
      fetched.mockImplementation(async () => new Response('gone', { status: 404 }))
      pad(screen, 'A')
      expect(screen.view).toBe('doc')
      await vi.waitFor(() => expect(screen.root.querySelector('.doc-scroll .doc-failed')?.textContent).toBe('Could not read it here (HTTP 404).'))
      const link = screen.root.querySelector<HTMLAnchorElement>('.about-links a')!
      expect(link.href).toBe('https://crawl.dcss.io/crawl/morgue/caeo/morgue-caeo-20260910-120000.txt')
      expect(link.target).toBe('_blank')
      expect(focused(screen)).toBe('link:0')
      press(screen, 'Escape')
      expect(screen.view).toBe('exit')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('cancels the stale-process purge on any key, as client.js handle_keydown does', () => {
    localStorage.setItem('orbrun.accounts', JSON.stringify([caeo]))
    localStorage.setItem('orbrun.account', JSON.stringify(caeo))
    const s = fakeSession(cdi, 'caeo', { username: 'caeo', complete: true, games: [{ id: 'dcss-web-0.34', label: 'DCSS 0.34' }], staleProcesses: { game: 'DCSS 0.34', timeout: 10 } })
    const { screen } = make(() => s)
    expect(screen.root.querySelector('.notice.dialog')?.textContent).toContain('There are some stale DCSS 0.34 processes.')
    expect(press(screen, 'ArrowDown')).toBe(true)
    expect(s.send).toHaveBeenCalledWith({ msg: 'stop_stale_process_purge' })
    expect(s.state.lobby.staleProcesses).toBeNull()
    expect(screen.root.querySelector('.notice.dialog')).toBeNull()
  })

  it('names the account’s own game from the roster when the server’s links keep the save to themselves', () => {
    // CDI (2026-09-09) sends plain links for every game even with a save waiting; the roster still lists a game of
    // yours that is open on the server, with the character, so that version reads Continue and says who
    localStorage.setItem('orbrun.accounts', JSON.stringify([caeo]))
    localStorage.setItem('orbrun.account', JSON.stringify(caeo))
    const s = fakeSession(cdi, 'caeo', {
      username: 'caeo',
      complete: true,
      games: [
        { id: 'dcss-0.34', label: 'DCSS 0.34' },
        { id: 'dcss-git', label: 'DCSS trunk' },
      ],
      entries: new Map([[1, playing('alice')], [2, playing('Caeo', { game_id: 'dcss-git', char: 'VSIE', xl: '2', place: 'D:2', title: 'Chiller' })]]),
    })
    const { screen } = make(() => s)
    expect(labels(screen).slice(0, 2)).toEqual(['Continue DCSS trunk', 'Play DCSS 0.34'])
    expect(sub(screen, 'Continue DCSS trunk')).toBe('Caeo the Chiller, VSIE XL2')
    expect(screen.root.querySelector('.menu-msg')?.textContent).toBe('Down the stairs to your game, still open on the server. D:2 lies below.')
    // Play on such a server is not surely a new game, and its hint does not promise one
    press(screen, 'ArrowDown')
    expect(focused(screen)).toBe('play:dcss-0.34')
    expect(screen.root.querySelector('.menu-msg')?.textContent).toBe('DCSS 0.34 on crawl.dcss.io. A game of yours already waiting there continues instead.')
    // the roster line goes (the server stopped the process): what this device remembered of the game stands in
    localStorage.setItem('orbrun.characters', JSON.stringify({ cdi: { 'dcss-git': { name: 'caeo', title: 'the Chiller', species: 'Vine Stalker', xl: 2, place: 'Dungeon', depth: 2 } } }))
    s.state.lobby.entries = new Map([[1, playing('alice')]])
    screen.refresh()
    expect(labels(screen).slice(0, 2)).toEqual(['Continue DCSS trunk', 'Play DCSS 0.34'])
    expect(sub(screen, 'Continue DCSS trunk')).toBe('caeo the Chiller, Vine Stalker XL2')
  })

  it('keeps the footer in keyboard and pad order, and restores its cursor after Back', () => {
    localStorage.setItem('orbrun.accounts', JSON.stringify([caeo]))
    localStorage.setItem('orbrun.account', JSON.stringify(caeo))
    const s = fakeSession(cdi, 'caeo', { username: 'caeo', games: [{ id: 'dcss-web-0.34', label: 'DCSS 0.34' }] })
    const { screen } = make(() => s)
    expect(Array.from(screen.root.querySelectorAll('.brand > .menu .label'), (el) => el.textContent)).toEqual(['Play DCSS 0.34', 'Watch', 'Settings'])
    press(screen, 'ArrowDown')
    press(screen, 'ArrowDown')
    press(screen, 'ArrowDown')
    expect(focused(screen)).toBe('account')
    pad(screen, 'A')
    expect(screen.view).toBe('accounts')
    expect(sub(screen, 'caeo')).toContain('crawl.dcss.io')
    expect(sub(screen, 'caeo')).toContain('logged in')
    pad(screen, 'B')
    expect(focused(screen)).toBe('account')
    press(screen, 'ArrowRight')
    expect(focused(screen)).toBe('about')
    pad(screen, 'A')
    expect(screen.view).toBe('about')
    pad(screen, 'RB')
    expect(screen.view).toBe('about')
    pad(screen, 'B')
    expect(focused(screen)).toBe('about')
    press(screen, 'ArrowLeft')
    expect(focused(screen)).toBe('account')
    press(screen, 'ArrowDown')
    expect(focused(screen)).toBe('play:dcss-web-0.34')
  })

  it('reads About and What’s new here, and keeps only the source and the game’s site as links out', () => {
    const { screen, connect } = make()
    pick(screen, 'About & credits')
    expect(screen.view).toBe('about')
    expect(labels(screen)).toEqual(['Back', 'About Orbrun', 'What’s new'])
    expect(screen.root.querySelector('.about-copy')?.textContent).toContain('Not affiliated with the DCSS team.')
    const links = Array.from(screen.root.querySelectorAll<HTMLAnchorElement>('.about-links a'))
    expect(links.map((el) => el.href)).toEqual(['https://github.com/Caeous/orbrun', 'https://crawl.develz.org/'])
    for (const link of links) {
      expect(link.target).toBe('_blank')
      expect(link.rel).toBe('noopener noreferrer')
    }
    expect(focused(screen)).toBe('about:doc')
    press(screen, 'ArrowDown')
    press(screen, 'ArrowDown')
    expect(focused(screen)).toBe('link:0')
    const click = vi.spyOn(links[0], 'click').mockImplementation(() => {})
    pad(screen, 'A')
    expect(click).toHaveBeenCalledOnce()
    // Native links handle Enter themselves, rather than activating twice.
    expect(press(screen, 'Enter', links[0])).toBe(false)
    links[1].focus()
    expect(focused(screen)).toBe('link:1')
    expect(screen.root.querySelector('.menu-msg')?.textContent).toBe('Opens in a new tab. Your game stays here.')
    press(screen, 'Escape')
    expect(screen.view).toBe('home')
    expect(focused(screen)).toBe('about')
    expect(connect).not.toHaveBeenCalled()
  })

  it('shows About Orbrun and What’s new as documents of their own, scrolled by up and down, and comes back to About', () => {
    const { screen } = make()
    pick(screen, 'About & credits')
    pick(screen, 'About Orbrun')
    expect(screen.view).toBe('doc')
    expect(screen.root.querySelector('.frame.doc-list')).not.toBeNull()
    expect(screen.root.querySelector('.head .place')?.textContent).toBe('About Orbrun')
    const doc = screen.root.querySelector('.doc-scroll .doc')!
    // the head names the document; its own title is not said twice
    expect(doc.querySelector('h2')).toBeNull()
    expect(doc.querySelector('h3')?.textContent).toBe('Getting started')
    expect(doc.textContent).toContain('Orbrun is an unofficial')
    // the document's own links go out, in a new tab; nothing of the repository's own html is drawn
    for (const a of Array.from(doc.querySelectorAll('a'))) expect(a.getAttribute('target')).toBe('_blank')
    expect(doc.querySelector('img')).toBeNull()
    // up and down move the document, not the cursor: Back is the one row and stays under it
    const scroller = screen.root.querySelector('.doc-scroll') as HTMLElement
    Object.defineProperty(scroller, 'clientHeight', { value: 500 })
    scroller.scrollTop = 0
    expect(press(screen, 'ArrowDown')).toBe(true)
    expect(scroller.scrollTop).toBe(100)
    screen.pad({ type: 'dir', source: 'dpad', dir: 4 })
    expect(scroller.scrollTop).toBe(200)
    screen.pad({ type: 'look', dx: 0, dy: 5 })
    expect(scroller.scrollTop).toBe(260)
    press(screen, 'ArrowUp')
    expect(scroller.scrollTop).toBe(160)
    press(screen, 'PageDown')
    expect(scroller.scrollTop).toBe(612)
    press(screen, 'Home')
    expect(scroller.scrollTop).toBe(0)
    expect(focused(screen)).toBe('back')
    pad(screen, 'B')
    expect(screen.view).toBe('about')
    expect(focused(screen)).toBe('about:doc')
    pick(screen, 'What’s new')
    expect(screen.root.querySelector('.head .place')?.textContent).toBe('What’s new')
    expect(screen.root.querySelector('.doc-scroll .doc h2')).toBeNull()
    // the first release heading of CHANGELOG.md, whatever it reads at the time
    expect(screen.root.querySelector('.doc-scroll .doc h3')?.textContent).toBe(/^## (.*)$/m.exec(changelogText)?.[1])
    press(screen, 'Escape')
    expect(screen.view).toBe('about')
    expect(focused(screen)).toBe('about:new')
    press(screen, 'Escape')
    expect(screen.view).toBe('home')
  })

  it('shows connection problems without moving the footer cursor, then clears them after login', () => {
    localStorage.setItem('orbrun.accounts', JSON.stringify([caeo]))
    localStorage.setItem('orbrun.account', JSON.stringify(caeo))
    const s = fakeSession(cdi, 'caeo', { username: 'caeo' })
    const { screen } = make(() => s)
    screen.root.querySelector<HTMLElement>('[data-focus="account"]')!.focus()
    Object.defineProperty(s, 'closed', { value: true, configurable: true })
    ;(s.conn as { open: boolean }).open = false
    screen.refresh()
    expect(conn(screen)).toBe('caeo · CDI · Disconnected')
    expect(focused(screen)).toBe('account')
    Object.defineProperty(s, 'closed', { value: false })
    ;(s.conn as { open: boolean }).open = true
    s.state.lobby.username = ''
    screen.refresh()
    expect(conn(screen)).toBe('caeo · CDI · Not logged in')
    expect(focused(screen)).toBe('account')
    s.state.lobby.username = 'caeo'
    screen.refresh()
    expect(conn(screen)).toBe('caeo · CDI')
    expect(focused(screen)).toBe('account')
    expect(dot(screen)).toBe('up')
  })

  it('a dropped connection the app is retrying says so, one it is not says why it closed', () => {
    localStorage.setItem('orbrun.accounts', JSON.stringify([caeo]))
    localStorage.setItem('orbrun.account', JSON.stringify(caeo))
    const s = fakeSession(cdi, 'caeo', { username: 'caeo' })
    const { screen } = make(() => s)
    ;(s as unknown as { emit(e: unknown): void }).emit({ type: 'closed', reason: 'the connection dropped' })
    expect(screen.root.querySelector('.error')?.textContent).toBe('Connection closed: the connection dropped')
    const host = document.createElement('div')
    document.body.append(host)
    const retrying = new FrontEnd(host, { connect: () => s, session: () => s, retrying: () => true, logout: () => {}, play: () => {}, watch: () => {}, leave: () => {} })
    made.push(retrying)
    retrying.showHome()
    ;(s as unknown as { emit(e: unknown): void }).emit({ type: 'closed', reason: 'the connection dropped' })
    expect(retrying.root.querySelector('.error')?.textContent).toBe('Connection lost. Reconnecting…')
  })

  it('the dot before the account is green logged in, gray logged out, gold on the way and red when the line is down', () => {
    localStorage.setItem('orbrun.accounts', JSON.stringify([caeo]))
    localStorage.setItem('orbrun.account', JSON.stringify(caeo))
    const s = fakeSession(cdi, 'caeo', { username: 'caeo' })
    const { screen } = make(() => s)
    expect(dot(screen)).toBe('up')
    s.state.lobby.username = ''
    screen.refresh()
    expect(dot(screen)).toBe('off')
    ;(s.conn as { open: boolean }).open = false
    screen.refresh()
    expect(dot(screen)).toBe('wait')
    Object.defineProperty(s, 'closed', { value: true, configurable: true })
    screen.refresh()
    expect(dot(screen)).toBe('down')
  })

  it('X opens the settings, Y does nothing on the front, and the controls sit only in the settings', () => {
    const { screen } = make()
    while (focused(screen) !== 'settings') press(screen, 'ArrowDown')
    press(screen, 'ArrowRight')
    expect(focused(screen)).toBe('settings')
    pad(screen, 'Y')
    expect(screen.view).toBe('home')
    pad(screen, 'X')
    expect(screen.view).toBe('settings')
    pick(screen, 'Gamepad')
    expect(screen.view).toBe('controls')
    pad(screen, 'B')
    expect(screen.view).toBe('settings')
  })

  it('never announces the controller in the footer', () => {
    expect(make(undefined, true).screen.root.querySelector('.pad-note')).toBeNull()
  })

  it('leaves the screen alone while it would read the same, and keeps the cursor where it stands on a redraw', () => {
    localStorage.setItem('orbrun.accounts', JSON.stringify([caeo]))
    localStorage.setItem('orbrun.account', JSON.stringify(caeo))
    const s = fakeSession(cdi, 'caeo', {}, false)
    const { screen } = make(() => s)
    const before = screen.root.querySelector('.menu')
    while (focused(screen) !== 'settings') press(screen, 'ArrowDown')
    screen.refresh()
    expect(screen.root.querySelector('.menu')).toBe(before)
    // the login lands: the line changes, the screen is drawn again in place, the cursor stays on Settings
    ;(s.conn as { open: boolean }).open = true
    s.state.lobby.username = 'caeo'
    screen.refresh()
    expect(screen.root.querySelector('.menu')).not.toBe(before)
    expect(conn(screen)).toBe('caeo · CDI')
    expect(focused(screen)).toBe('settings')
    expect(screen.root.querySelector('.frame')?.classList.contains('still')).toBe(true)
  })

  it('sets every word of a login in the same room, so the line never changes length', () => {
    const open = fakeSession(cdi, 'caeo', { username: 'caeo' })
    const failed = fakeSession(cdi, 'caeo', { loginFailed: 'no' })
    const pending = fakeSession(cdi, 'caeo')
    const closed = fakeSession(cdi, 'caeo', {}, false)
    const words = [loginWord(open, true), loginWord(failed, true), loginWord(pending, true), loginWord(closed, true), loginWord(null, true)]
    expect(words.map((w) => w.trim())).toEqual(['logged in', 'not logged in', 'logging in…', 'connecting…', 'connecting…'])
    expect(new Set(words.map((w) => w.length)).size).toBe(1)
    expect(loginWord(null, false)).toBe('')
  })

  it('words a game’s end as client.js exit_reason_message does', () => {
    expect(exitReasonMessage('saved', null)).toBeNull()
    expect(exitReasonMessage('dead', null)).toBeNull()
    expect(exitReasonMessage('disconnect', null)).toBe('You have been disconnected.')
    expect(exitReasonMessage('crash', null)).toBe('Unfortunately your game crashed.')
    expect(exitReasonMessage('weird', null)).toBe('Unfortunately your game ended unexpectedly. (weird)')
    expect(exitReasonMessage('unknown', null)).toBe('Unfortunately your game ended unexpectedly.')
    expect(exitReasonMessage('dead', 'alice')).toBeNull()
    expect(exitReasonMessage('saved', 'alice')).toBe('alice stopped playing (saved).')
    expect(exitReasonMessage('crash', 'Chris')).toBe("Chris' game crashed.")
    expect(exitReasonMessage('disconnect', 'alice')).toBe('alice has been disconnected.')
  })
})

describe('the front end: accounts and servers', () => {
  beforeEach(() => {
    store.clear()
    document.body.replaceChildren()
  })

  it('Play leads to the servers, then a login, and Back walks up the same way', () => {
    const { screen } = make()
    pick(screen, 'Play')
    expect(screen.view).toBe('servers')
    expect(labels(screen)).toEqual(['Back', 'CDI', 'CBR2', 'CKO', 'CAO', 'CUE', 'CXC', 'CWZ', 'Add a server'])
    expect(screen.root.querySelector('.head .place')?.textContent).toBe('Add an account')
    pick(screen, 'CKO')
    expect(screen.view).toBe('login')
    expect(labels(screen)).toEqual(['Back', 'Name', 'Password', 'Log in', 'Register'])
    expect((screen.root.querySelector('input[name=username]') as HTMLInputElement).value).toBe('')
    expect(focused(screen)).toBe('username')
    press(screen, 'Escape')
    expect(screen.view).toBe('servers')
    // the list was opened from the front screen, so B goes back there rather than to the accounts
    press(screen, 'Escape')
    expect(screen.view).toBe('home')
  })

  it('Start chooses a row, then submits a focused login field like Enter', () => {
    const { screen } = make()
    pad(screen, 'START')
    expect(screen.view).toBe('servers')
    pick(screen, 'CKO')
    const name = screen.root.querySelector<HTMLInputElement>('input[name=username]')!
    name.value = 'caeo'
    screen.root.querySelector<HTMLInputElement>('input[name=password]')!.value = 'pw'
    name.focus()
    const submit = vi.spyOn(name.form!, 'requestSubmit').mockImplementation(() => {})
    pad(screen, 'START')
    expect(submit).toHaveBeenCalledOnce()
    expect(screen.root.querySelector('.osk')).toBeNull()
  })

  it('the account row leads to the accounts, and adding one there is a server then its login', () => {
    localStorage.setItem('orbrun.accounts', JSON.stringify([caeo]))
    localStorage.setItem('orbrun.account', JSON.stringify(caeo))
    const { screen } = make()
    pick(screen, 'caeo · CDI')
    expect(screen.view).toBe('accounts')
    pick(screen, 'Add an account')
    expect(screen.view).toBe('servers')
    press(screen, 'Escape')
    expect(screen.view).toBe('accounts')
    press(screen, 'Escape')
    expect(screen.view).toBe('home')
  })

  it('an account picked is chosen, opens its own connection, and the home screen is its', () => {
    localStorage.setItem('orbrun.accounts', JSON.stringify([caeo, kelbi]))
    localStorage.setItem('orbrun.account', JSON.stringify(caeo))
    const { screen, connect } = make()
    pick(screen, 'caeo · CDI')
    expect(screen.view).toBe('accounts')
    expect(labels(screen)).toEqual(['Back', 'caeo', '(log out)', 'caeo', '(log out)', 'Add an account'])
    expect(sub(screen, 'caeo')).toContain('crawl.dcss.io')
    screen.root.querySelector<HTMLElement>('[data-focus="account:cko/caeo"]')!.click()
    expect(connect).toHaveBeenCalledWith(cko, 'caeo', undefined)
    expect(JSON.parse(localStorage.getItem('orbrun.account')!)).toEqual(kelbi)
    expect(screen.view).toBe('home')
    expect(labels(screen)[0]).toBe('Log in')
    expect(conn(screen)).toBe('caeo · CKO · Not logged in')
  })

  it('logging out forgets the account and comes back to the front without it', () => {
    localStorage.setItem('orbrun.accounts', JSON.stringify([caeo]))
    localStorage.setItem('orbrun.account', JSON.stringify(caeo))
    localStorage.setItem('orbrun.tokens', JSON.stringify({ 'cdi/caeo': 'tok' }))
    const { screen, logout } = make()
    pick(screen, 'caeo · CDI')
    ;(screen.root.querySelector('[data-focus="logout:cdi/caeo"]') as HTMLElement).click()
    expect(logout).toHaveBeenCalledWith(caeo)
    expect(localStorage.getItem('orbrun.account')).toBe('null')
    expect(JSON.parse(localStorage.getItem('orbrun.accounts')!)).toEqual([])
    expect(screen.view).toBe('home')
    expect(labels(screen)[0]).toBe('Play')
  })

  it('Watch without an account asks for a server, then watches on it without a login', () => {
    const { screen, connect } = make()
    pick(screen, 'Watch')
    expect(screen.view).toBe('servers')
    expect(screen.root.querySelector('.head .place')?.textContent).toBe('Watch')
    pick(screen, 'CDI')
    expect(screen.view).toBe('watch')
    expect(connect).toHaveBeenCalledWith(cdi, null)
  })

  it('a login that lands keeps the account, chooses it, and comes home', () => {
    const s = fakeSession(cko, null)
    const { screen } = make()
    pick(screen, 'Play')
    pick(screen, 'CKO')
    ;(screen.root.querySelector('input[name=username]') as HTMLInputElement).value = 'Caeo'
    ;(screen.root.querySelector('input[name=password]') as HTMLInputElement).value = 'pw'
    ;(screen.root.querySelector('form') as HTMLFormElement).requestSubmit()
    // the connection the form used answers
    const sess = (screen as unknown as { session: Session }).session
    expect(sess.send).toHaveBeenCalledWith({ msg: 'login', username: 'Caeo', password: 'pw' })
    sess.state.lobby.username = 'Caeo'
    ;(sess as unknown as { emit(e: unknown): void }).emit({ type: 'state', msg: { msg: 'login_success' } })
    expect(JSON.parse(localStorage.getItem('orbrun.accounts')!)).toEqual([{ serverId: 'cko', username: 'Caeo' }])
    expect(screen.view).toBe('home')
    expect(labels(screen)[0]).toBe('Log in')
    expect(conn(screen)).toBe('Caeo · CKO')
    void s
  })
})

describe('the front end: Play and Watch', () => {
  beforeEach(() => {
    store.clear()
    document.body.replaceChildren()
    localStorage.setItem('orbrun.accounts', JSON.stringify([caeo]))
    localStorage.setItem('orbrun.account', JSON.stringify(caeo))
  })

  function loggedIn(entries: LobbyEntry[] = [playing('alice')]): Session {
    return fakeSession(cdi, 'caeo', {
      username: 'caeo',
      complete: true,
      games: [
        { id: 'dcss-web-0.34', label: 'DCSS 0.34' },
        { id: 'dcss-web-trunk', label: 'DCSS trunk', save: 'caeo, a level 9 Minotaur Berserker of Trog' },
      ],
      entries: new Map(entries.map((e) => [e.id, e])),
    })
  }

  it('home lists each version once, with its save, and launches it directly', () => {
    const s = loggedIn()
    const { screen, connect } = make(() => s)
    expect(screen.view).toBe('home')
    expect(labels(screen)).toEqual(['Continue DCSS trunk', 'Play DCSS 0.34', 'Watch', 'Settings', 'caeo · CDI', 'About & credits'])
    expect(focused(screen)).toBe('play:dcss-web-trunk')
    press(screen, 'ArrowDown')
    expect(focused(screen)).toBe('play:dcss-web-0.34')
    press(screen, 'ArrowRight')
    expect(focused(screen)).toBe('play:dcss-web-0.34')
    pad(screen, 'A')
    expect(connect).toHaveBeenLastCalledWith(cdi, 'caeo', { kind: 'play', gameId: 'dcss-web-0.34' })
    pick(screen, 'Continue DCSS trunk')
    expect(connect).toHaveBeenLastCalledWith(cdi, 'caeo', { kind: 'play', gameId: 'dcss-web-trunk' })
  })

  it('tells the address bar where it stands: #lobby is the Watch screen, home is home', () => {
    const s = loggedIn()
    const leave = vi.fn()
    const host = document.createElement('div')
    document.body.append(host)
    const screen = new FrontEnd(host, { connect: () => s, session: () => s, logout: () => {}, play: () => {}, watch: () => {}, leave, padConnected: () => false })
    made.push(screen)
    pick(screen, 'Watch')
    expect(screen.view).toBe('watch')
    expect(leave).toHaveBeenLastCalledWith('lobby')
    // redraws of the roster do not say it again
    leave.mockClear()
    screen.refresh()
    expect(leave).not.toHaveBeenCalled()
    press(screen, 'Escape')
    expect(screen.view).toBe('home')
    expect(leave).toHaveBeenLastCalledWith('home')
    // after a spectate: the roster; after a game: home
    screen.watchFor(s)
    expect(screen.view).toBe('watch')
    expect(leave).toHaveBeenLastCalledWith('lobby')
    screen.attach(s)
    expect(screen.view).toBe('home')
    expect(leave).toHaveBeenLastCalledWith('home')
  })

  it('adds arriving versions on home without stealing focus', async () => {
    const s = fakeSession(cdi, 'caeo', { username: 'caeo' })
    const { screen } = make(() => s)
    expect(screen.view).toBe('home')
    expect(labels(screen)).toEqual(['Watch', 'Settings', 'caeo · CDI', 'About & credits'])
    expect(screen.root.textContent).toContain('Loading game versions…')
    expect(focused(screen)).toBe('watch')
    s.state.lobby.complete = true
    s.state.lobby.games = [
      { id: 'dcss-web-0.34', label: 'DCSS 0.34' },
      { id: 'dcss-web-trunk', label: 'DCSS trunk' },
    ]
    ;(s as unknown as { emit(e: unknown): void }).emit({ type: 'state', msg: { msg: 'set_game_links' } })
    await new Promise((r) => requestAnimationFrame(r))
    expect(labels(screen)).toEqual(['Play DCSS 0.34', 'Play DCSS trunk', 'Watch', 'Settings', 'caeo · CDI', 'About & credits'])
    expect(focused(screen)).toBe('watch')
    expect(screen.root.textContent).not.toContain('Loading game versions…')
  })

  it('keeps a last-played older save first and never offers a disabled slot', () => {
    const s = loggedIn()
    localStorage.setItem('orbrun.last', JSON.stringify({ serverId: 'cdi', gameId: 'dcss-web-0.33' }))
    s.state.lobby.games.push(
      { id: 'dcss-web-0.33', label: 'DCSS 0.33', save: 'caeo, a level 5 Gargoyle Fighter' },
      { id: 'other-game', label: 'Other game', save: 'slot full', disabled: true },
    )
    const { screen } = make(() => s)
    expect(labels(screen).slice(0, 3)).toEqual(['Continue DCSS 0.33', 'Play DCSS 0.34', 'Continue DCSS trunk'])
    expect(focused(screen)).toBe('play:dcss-web-0.33')
    expect(labels(screen).some((label) => label.includes('Other game'))).toBe(false)
    s.state.lobby.games.find((g) => g.id === 'dcss-web-0.33')!.disabled = true
    screen.refresh()
    expect(labels(screen)).not.toContain('Continue DCSS 0.33')
  })

  it('Watch is the roster, by player, and a row picked spectates them', () => {
    const s = loggedIn([playing('bob'), playing('alice', { god: 'Trog', turn: '12143', spectator_count: 1 })])
    const { screen, watch } = make(() => s)
    pick(screen, 'Watch')
    expect(screen.view).toBe('watch')
    expect(labels(screen)).toEqual(['Back', 'alice', 'bob'])
    expect(focused(screen)).toBe(at('alice'))
    expect(screen.root.querySelector('.menu-msg')?.textContent).toBe('You see here alice (MiBe, XL12, Lair:3), a worshipper of Trog, turn 12143, 1 watching.')
    pad(screen, 'A')
    expect(watch).toHaveBeenCalledWith(s, 'alice')
  })

  it('draws the roster once a frame however many messages the server sends', async () => {
    const s = loggedIn([])
    const { screen } = make(() => s)
    pick(screen, 'Watch')
    const draws = vi.spyOn(screen, 'refresh')
    for (const name of ['a', 'b', 'c', 'd', 'e']) {
      const id = name.length + name.charCodeAt(0)
      s.state.lobby.entries.set(id, { ...playing(name), id })
      ;(s as unknown as { emit(e: unknown): void }).emit({ type: 'state', msg: { msg: 'lobby_entry' } })
    }
    expect(draws).toHaveBeenCalledTimes(0)
    await new Promise((r) => requestAnimationFrame(r))
    expect(draws).toHaveBeenCalledTimes(1)
    // the first draw of the table shows whoever is there
    expect(screen.root.querySelectorAll('table.roster tr.game').length).toBe(5)
  })

  it('holds arrivals back until Y, and lets departures go at once, so rows never move under the cursor', async () => {
    const s = loggedIn([playing('bob'), playing('dave')])
    const { screen } = make(() => s)
    pick(screen, 'Watch')
    press(screen, 'ArrowDown')
    expect(focused(screen)).toBe(at('dave'))
    s.state.lobby.entries.set(99, { ...playing('alice'), id: 99 })
    s.state.lobby.entries.delete(playing('bob').id)
    ;(s as unknown as { emit(e: unknown): void }).emit({ type: 'state', msg: { msg: 'lobby_entry' } })
    await new Promise((r) => requestAnimationFrame(r))
    expect(labels(screen)).toEqual(['Back', 'dave'])
    expect(screen.root.querySelector('.held')?.textContent).toBe('1 new · press Y to bring them in')
    expect(focused(screen)).toBe(at('dave'))
    pad(screen, 'Y')
    expect(labels(screen)).toEqual(['Back', 'alice', 'dave'])
    expect(screen.root.querySelector('.held')?.textContent).toBe('')
    expect(focused(screen)).toBe(at('dave'))
  })

  it('a player in a game of each version has a row for each', () => {
    const s = loggedIn([playing('bob'), { ...playing('bob'), id: 77, game_id: 'dcss-web-0.34', char: 'DsFi' }])
    const { screen, watch } = make(() => s)
    pick(screen, 'Watch')
    expect(labels(screen)).toEqual(['Back', 'bob', 'bob'])
    press(screen, 'ArrowDown')
    expect(focused(screen)).toBe('watch:77')
    pad(screen, 'A')
    expect(watch).toHaveBeenCalledWith(s, 'bob')
  })

  it('the arrivals come in on the keyboard’s Y and on a press of the line that counts them, and the line goes when there are none', async () => {
    const s = loggedIn([playing('bob')])
    const { screen } = make(() => s)
    pick(screen, 'Watch')
    const held = screen.root.querySelector('.held') as HTMLButtonElement
    expect(held.hidden).toBe(true)
    s.state.lobby.entries.set(99, { ...playing('alice'), id: 99 })
    ;(s as unknown as { emit(e: unknown): void }).emit({ type: 'state', msg: { msg: 'lobby_entry' } })
    await new Promise((r) => requestAnimationFrame(r))
    expect(held.hidden).toBe(false)
    expect(press(screen, 'y')).toBe(true)
    expect(labels(screen)).toEqual(['Back', 'alice', 'bob'])
    expect(held.hidden).toBe(true)
    s.state.lobby.entries.set(98, { ...playing('carol'), id: 98 })
    ;(s as unknown as { emit(e: unknown): void }).emit({ type: 'state', msg: { msg: 'lobby_entry' } })
    await new Promise((r) => requestAnimationFrame(r))
    expect(labels(screen)).toEqual(['Back', 'alice', 'bob'])
    held.click()
    expect(labels(screen)).toEqual(['Back', 'alice', 'bob', 'carol'])
  })

  it('right opens a row’s details and left closes them', () => {
    const s = loggedIn([playing('alice', { god: 'Trog' })])
    const { screen } = make(() => s)
    pick(screen, 'Watch')
    const tr = screen.root.querySelector('tr.game') as HTMLElement
    const dt = tr.nextElementSibling as HTMLElement
    expect(dt.classList.contains('details')).toBe(true)
    expect(dt.hidden).toBe(true)
    press(screen, 'ArrowRight')
    expect(tr.classList.contains('open')).toBe(true)
    expect(dt.hidden).toBe(false)
    expect(dt.querySelector('td.details')?.textContent).toContain('God Trog')
    press(screen, 'ArrowLeft')
    expect(tr.classList.contains('open')).toBe(false)
    expect(dt.hidden).toBe(true)
  })

  it('the shoulders walk Play, Watch and Settings, and Back comes home from each', () => {
    const s = loggedIn()
    const { screen } = make(() => s)
    pad(screen, 'RB')
    expect(screen.view).toBe('watch')
    pad(screen, 'RB')
    expect(screen.view).toBe('settings')
    pad(screen, 'RB')
    expect(screen.view).toBe('home')
    pad(screen, 'LB')
    expect(screen.view).toBe('settings')
    pad(screen, 'B')
    expect(screen.view).toBe('home')
    // not from a flow
    pick(screen, 'caeo · CDI')
    pad(screen, 'RB')
    expect(screen.view).toBe('accounts')
  })
})

describe('the front end: settings and marks', () => {
  beforeEach(() => {
    store.clear()
    document.body.replaceChildren()
  })

  it('uses the shared front-end controls without changing the in-game settings panel', () => {
    const { screen } = make()
    pick(screen, 'Settings')
    expect(screen.root.querySelector('.menu-actions [data-focus="back"]')).not.toBeNull()
    const row = screen.root.querySelector<HTMLElement>('[data-focus="setting:Hands"]')!
    expect(row.classList.contains('item')).toBe(true)
    expect(row.querySelector('.marker')?.getAttribute('aria-hidden')).toBe('true')
    row.querySelector<HTMLElement>('.arrow:last-child')!.click()
    expect(focused(screen)).toBe('setting:Hands')
    expect(row.querySelector('.val')?.textContent).toBe('Hidden')
    // The same setting changes once, not once for the arrow and again for the row.
    expect(JSON.parse(localStorage.getItem('orbrun.settings')!).viewmodel).toBe(false)
    const inGame = settingsPanel()
    expect(inGame.el.querySelector('.front-setting, .item, .marker')).toBeNull()
    expect(inGame.el.querySelector('.hotkey')).not.toBeNull()
  })

  it('turns a setting on h and l, and the value reads at once', () => {
    const { screen } = make()
    pick(screen, 'Settings')
    expect(screen.view).toBe('settings')
    // Controls first, then the panel the pause menu shares, in its groups
    expect(focused(screen)).toBe('controls')
    expect(Array.from(screen.root.querySelectorAll('li.group')).map((g) => g.textContent)).toEqual(['Display', 'Camera', 'Controls', 'Interface'])
    const value = (label: string) => (Array.from(screen.root.querySelectorAll('li.row')).find((r) => r.querySelector('.label')?.textContent === label)?.querySelector('.val') as HTMLElement).textContent
    expect(value('Field of view')).toBe('85°')
    while (focused(screen) !== 'setting:Field of view') press(screen, 'j')
    press(screen, 'l')
    expect(value('Field of view')).toBe('95°')
    press(screen, 'h')
    expect(value('Field of view')).toBe('85°')
    expect(JSON.parse(localStorage.getItem('orbrun.settings')!).fov).toBe(85)
    expect(screen.root.querySelector('.menu-msg')?.textContent).toBe('How wide the first-person view opens.')
    pick(screen, 'Gamepad')
    expect(screen.view).toBe('controls')
    expect(screen.root.querySelector('.bindings-sheet table')).toBeTruthy()
    pad(screen, 'B')
    expect(screen.view).toBe('settings')
    expect(focused(screen)).toBe('controls')
  })

  it('leaves the letters to a text field, and reads the four vim keys as directions and nothing else', () => {
    const { screen } = make()
    pick(screen, 'Play')
    const input = screen.root.querySelector('input') as HTMLInputElement
    expect(press(screen, 'j', input)).toBe(false)
    expect(press(screen, 'ArrowDown', input)).toBe(true)
    expect(press(screen, 'ArrowLeft', input)).toBe(false)
    expect(navDir({ key: 'k', ctrlKey: false, altKey: false, metaKey: false }, false)).toBe('up')
    expect(navDir({ key: 'x', ctrlKey: false, altKey: false, metaKey: false }, false)).toBe(null)
    expect(navDir({ key: 'k', ctrlKey: true, altKey: false, metaKey: false }, false)).toBe(null)
  })

  it('lands on Settings again when the settings are left, and opens them again on the row they were left on', () => {
    const { screen } = make()
    press(screen, 'ArrowDown')
    press(screen, 'ArrowDown')
    expect(focused(screen)).toBe('settings')
    pad(screen, 'A')
    expect(screen.view).toBe('settings')
    press(screen, 'ArrowDown')
    press(screen, 'ArrowDown')
    const row = focused(screen)
    expect(row).toBe('setting:UI scale')
    pad(screen, 'B')
    expect(screen.view).toBe('home')
    expect(focused(screen)).toBe('settings')
    pad(screen, 'A')
    expect(focused(screen)).toBe(row)
  })

  it('comes back to the Watch row it left when the settings are opened from the roster', () => {
    localStorage.setItem('orbrun.accounts', JSON.stringify([caeo]))
    localStorage.setItem('orbrun.account', JSON.stringify(caeo))
    const s = fakeSession(cdi, 'caeo', { username: 'caeo', complete: true, entries: new Map([[1, playing('alice')], [2, playing('bob')]]) })
    const { screen } = make(() => s)
    pick(screen, 'Watch')
    press(screen, 'ArrowDown')
    expect(focused(screen)).toBe(at('bob'))
    screen.showSettings()
    expect(screen.view).toBe('settings')
    pad(screen, 'B')
    expect(screen.view).toBe('watch')
    expect(focused(screen)).toBe(at('bob'))
  })
})
