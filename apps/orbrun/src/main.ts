import { cm } from '@orbrun/webtiles'
import { installAnalytics } from './analytics'
import { h } from './dom'
import { Session } from './session'
import { FrontEnd, type Intent } from './menu'
import type { GameScreen, InputDevice } from './game'
import { GamepadInput, installPadKeys, isPadActivity } from './gamepad'
import { findServer, gamedataBaseFor, gameTitle, getChosenAccount, getLast, getSettings, getToken, parseRoute, setGames, setLast, setMorgueDir, setRoute, setToken, type Account, type Route, type ServerInfo } from './servers'
import { gamedataUrls } from '@orbrun/gamedata'
import { morgueDirOf } from './whereis'
import { settingsPanel } from './settings-panel'

const app = document.getElementById('app')!
const gamepad = new GamepadInput()
let lastInput: InputDevice = 'keyboard'
let session: Session | null = null
let lobby: FrontEnd | null = null
let game: GameScreen | null = null
/**
 * The game screen, and three.js with it, is a chunk of its own: the front
 * end draws without it, and fetches it once the first screen is up, so a
 * Play is still instant and the account list never waits on the renderer.
 */
const gameModule = () => import('./game')
/** the chunk being fetched for a game that has already started, so a second `game_client` does not start it twice */
let starting: Promise<void> | null = null
/** what a fresh connection should do once it is logged in (play) or open (watch) */
let intent: Intent | null = null
/**
 * The screen a `#play-`/`#watch-` address stands on while its connection is
 * made: no front end is built for it, so a reload into a game never flashes
 * the account list and the lobby on the way (showBoot).
 */
let boot: HTMLElement | null = null
/** the timer for the next try at the warm connection after it dropped, and how many tries have gone unanswered */
let retry: ReturnType<typeof setTimeout> | null = null
let retries = 0
/** the wait before a retry doubles from RETRY_MS up to RETRY_MAX_MS while the server stays out of reach */
const RETRY_MS = 1000
const RETRY_MAX_MS = 30_000
document.documentElement.style.setProperty('--ui-scale', String(getSettings().uiScale))
/** The tab's title as the page loaded, restored once out of a game. */
const BASE_TITLE = document.title || 'Orbrun'
/** What a character's tab title ends in: the site title's first words, so a game in progress reads as "caeo the Chiller | Vine Stalker - Orbrun". */
const SHORT_TITLE = BASE_TITLE.split(/\s[—–-]\s/)[0] || 'Orbrun'

/**
 * The tab says whose game this is (playing or watching), from the game's
 * `player` updates; the plain title otherwise. Any phase but the lobby counts:
 * a server may name the character before `game_started` says the game is on.
 */
function updateTitle(s: Session | null) {
  const p = s?.state.player
  const t = p?.name && s && s.state.phase !== 'lobby' && s.state.phase !== 'ended'
    ? gameTitle({ name: p.name, title: p.title || '', species: p.species_display_name || p.species || '', god: p.god || '', xl: p.xl, place: p.place || '', depth: p.depth || 0 }, SHORT_TITLE)
    : BASE_TITLE
  if (document.title !== t) document.title = t
}

function play(s: Session, gameId: string) {
  // which version was played last, so the home screen leads with it; who waits in it is the server's to say
  setLast({ serverId: s.server.id, gameId, username: s.state.lobby.username || undefined })
  s.send(cm.play(gameId))
  const account = accountOf(s)
  if (account) setRoute({ kind: 'play', account, gameId })
}

/** The account a session belongs to: the one it logged in as, or failing that the one whose lobby it was opened from. */
function accountOf(s: Session): Account | null {
  if (s.username) return { serverId: s.server.id, username: s.username }
  const chosen = getChosenAccount()
  return chosen && chosen.serverId === s.server.id ? chosen : null
}

/** The URL for what a session is doing now, or is about to do once connected. */
function routeFor(s: Session): Route {
  const account = accountOf(s)
  // an account being added has no name yet: the home screen is where the player is until the login lands
  if (!account) return { kind: 'home' }
  if (s.state.watching) return { kind: 'watch', account, username: s.state.watching.username }
  if (intent?.kind === 'play') return { kind: 'play', account, gameId: intent.gameId }
  if (s.playing || s.state.phase === 'loading') {
    const gameId = s.state.version.gameId ?? getLast()?.gameId
    if (gameId) return { kind: 'play', account, gameId }
  }
  if (intent?.kind === 'watch') return { kind: 'watch', account, username: intent.username }
  // idle on a front-end screen: the one the address bar already names (the Watch screen's `#lobby`), else home
  return { kind: parseRoute().kind === 'lobby' ? 'lobby' : 'home', account }
}

/** The open session on `server` for `username`, when that is what it is: the warm connection, or the game's. */
function sessionOn(server: ServerInfo, username: string | null): Session | null {
  const s = session
  return s && !s.closed && s.server.id === server.id && (s.username ?? null) === username ? s : null
}

// --------------------------------------------------------------------- flow

/**
 * Do what the address bar says: on load, and when the player edits the hash
 * or uses the back button (`hashchange`). Mirrors client.js `handle_hash`.
 */
function applyRoute(r: Route) {
  if (r.kind === 'home') {
    // Back out of a game to the home screen it was started from: `go_lobby` stops the process, which saves it as a
    // dropped connection does (ws_handler.py go_lobby, process_handler.py stop: SIGHUP)
    intent = null
    if (session && !session.closed && (game || boot)) session.send(cm.goLobby())
    showHome()
    return
  }
  const server = findServer(r.account.serverId)
  if (!server) {
    // the account's server is gone (a custom one the device no longer has): the account list
    intent = null
    showHome()
    return
  }
  const same = sessionOn(server, r.account.username)
  if (r.kind === 'lobby') {
    // `#lobby` is the Watch screen: the server's lobby roster. Back out of a spectate (or one still starting) to
    // it: `go_lobby` stops the process, and the server's own `go_lobby` puts the roster up
    intent = null
    if (same && (game || boot)) {
      same.send(cm.goLobby())
      // a spectate that has not drawn yet has no screen to wait on: the roster now, rather than a dark boot screen
      if (!game) showWatchFor(same)
    } else if (same) showWatchFor(same)
    else frontEnd().showWatch()
    return
  }
  const i: Intent = r.kind === 'play' ? { kind: 'play', gameId: r.gameId } : { kind: 'watch', username: r.username }
  if (same && !game && same.conn.open) {
    // already in this account's lobby: act directly
    if (i.kind === 'watch') same.send(cm.watch(i.username))
    else if (same.state.lobby.username) play(same, i.gameId)
    else intent = i
    return
  }
  if (same) return // already in a game or spectate here; leave it alone
  // a play with no token in hand waits on a login form, so it takes the front end as it always has;
  // spectating needs no account at all
  if (i.kind === 'play' && !getToken(r.account.serverId, r.account.username)) {
    frontEnd().connectTo(r.account, i)
    return
  }
  // straight to it: the connection is opened here rather than through the lobby screen, and the dark
  // boot screen stands until the game does. A refused login (or a dropped socket) brings the front end up.
  openSession(server, r.account.username, i)
  const last = getLast()
  if (!last || last.serverId !== server.id) setLast({ serverId: server.id, username: r.account.username })
  showBoot()
}

/**
 * Open a session on `server` for `username` (none while an account is being
 * added: the login form says who), replacing whatever was open. The account's
 * token login goes out as soon as the socket is up; `i` says what to do after
 * that.
 */
function openSession(server: ServerInfo, username: string | null, i?: Intent): Session {
  session?.close()
  intent = i ?? null
  const s = (session = new Session(server, username))
  s.on((e) => {
    if (e.type === 'open' && intent?.kind === 'watch') {
      // spectating needs no account: go as soon as the socket is up
      s.send(cm.watch(intent.username))
      intent = null
    }
    if (e.type === 'state') {
      const m = e.msg.msg
      if (m === 'login_success' && intent?.kind === 'play') {
        // the server refuses `play` before login; the token login (or a manual one) just finished
        play(s, intent.gameId)
        intent = null
      }
      if (m === 'game_started' || m === 'watching_started') setRoute(routeFor(s))
      if ((m === 'game_client' || m === 'watching_started' || m === 'game_started') && !game) startGame()
      if (m === 'game_client' && typeof e.msg.version === 'string') {
        // the version this server's games run on, so the next visit can fetch its tiles before Play
        const last = getLast()
        if (last?.serverId === server.id && last.gamedataVersion !== e.msg.version) setLast({ ...last, gamedataVersion: e.msg.version })
      }
      if (m === 'player') updateTitle(s)
      if (m === 'game_ended') {
        // the dump handed back names the morgue directory this server keeps for the account ("/crawl/morgue/caeo/"),
        // which is where the home screen reads `<player>.where` from (whereis.ts) instead of guessing the layout
        const who = s.state.lobby.username || s.username
        const dir = who && e.msg.dump ? morgueDirOf(server, String(e.msg.dump)) : null
        if (who && dir) setMorgueDir(server.id, who, dir)
      }
      if (m === 'go_lobby' && (game || boot)) {
        // out of a game (death, save, quit): the home screen, where Continue and Play are. Out of a spectate (the
        // player left, or Back went to `#lobby`): the Watch screen it was picked from
        const r = parseRoute()
        if (r.kind === 'watch' || r.kind === 'lobby') showWatchFor(s)
        else showLobbyFor(s)
      }
      if (m === 'login_fail' && intent?.kind === 'play' && !game) {
        // a Continue/Play (or a reload) whose token was refused: the login form comes up, as the official page's does
        // (client.js login_failed), and the intent waits for it
        frontEnd().showLogin()
      } else if (m === 'login_success' || m === 'login_fail') lobby?.refresh()
      if (m === 'set_game_links') {
        // the lobby screen's Play entries come from this list; keep it for next time, before the connection is up
        setGames(server.id, s.state.lobby.games)
        lobby?.refresh()
      }
    }
    if (e.type === 'open') retries = 0
    // the front end's connection dropped (the network went, the laptop slept, the server restarted): open it again,
    // waiting longer each time the server does not answer, so Play and the roster come back without a reload
    if (e.type === 'closed' && !game && !boot && s === session) scheduleRetry(s)
    if (e.type === 'open' || e.type === 'closed') lobby?.refresh()
    // a drop mid-game keeps the play route, so a refresh rejoins the saved game
    if (e.type === 'closed' && (game || boot) && s === session) leaveGame()
  })
  return s
}

/**
 * The warm connection dropped while a front-end screen was up: a fresh one
 * for the same account, with the same intent, after a wait that doubles for
 * each try the server has not answered. Only the chosen account's connection
 * is retried (a logout closes its own and forgets it first, so that one is
 * never reopened); a network back up (`online`) tries at once.
 */
function scheduleRetry(s: Session) {
  const account = accountOf(s)
  const chosen = getChosenAccount()
  if (!account || !chosen || chosen.serverId !== account.serverId || chosen.username !== account.username) return
  clearRetry()
  const wait = Math.min(RETRY_MS * 2 ** retries, RETRY_MAX_MS)
  retries++
  retry = setTimeout(() => {
    retry = null
    reconnect(s)
  }, wait)
}

function clearRetry() {
  if (retry) clearTimeout(retry)
  retry = null
}

/** Open the connection `s` stood for again, unless something else has taken its place meanwhile. */
function reconnect(s: Session) {
  if (s !== session || game || boot) return
  const account = accountOf(s)
  if (!account) return
  const server = findServer(account.serverId)
  if (!server) return
  openSession(server, account.username, intent ?? undefined)
  lobby?.refresh()
}

/** whether a dropped front-end connection will be tried again on its own */
function retrying(): boolean {
  return retry !== null
}

window.addEventListener('online', () => {
  // the network is back: no point waiting out the rest of the backoff
  if (retry && session) {
    clearRetry()
    reconnect(session)
  }
})

/**
 * Connect as the chosen account while the front end is up, so its token login
 * has already happened when its lobby comes up: the game links and the roster
 * are there at once, and Play is instant. Nothing to warm before an account
 * has been picked (a first visit, or one just logged out).
 */
function warm() {
  const account = getChosenAccount()
  const server = account ? findServer(account.serverId) : null
  if (!account || !server) return
  if (sessionOn(server, account.username)) return
  openSession(server, account.username)
}

/**
 * A reload straight into a game or a spectate: hold the screen dark until the
 * game screen is up, rather than drawing the account list and the lobby the
 * player never asked for. Any front end already up is dropped, so an address
 * typed by hand does the same as a reload.
 */
function showBoot() {
  lobby?.destroy()
  lobby = null
  if (!boot) app.append((boot = h('div', { class: 'screen boot' }, h('div', { class: 'loading' }, 'Entering the dungeon\u2026'))))
}

function hideBoot() {
  boot?.remove()
  boot = null
}

/**
 * The front end, leaving the game screen behind: made on the first call, and
 * kept from then on. The screen it stands on is the caller's to choose
 * (`showHome`, `showLobbyFor`, or one of the FrontEnd's own).
 */
function frontEnd(): FrontEnd {
  hideBoot()
  game?.destroy()
  game = null
  if (!lobby) {
    lobby = new FrontEnd(app, {
      padConnected: () => gamepad.connected,
      padKind: () => gamepad.kind,
      connect(server: ServerInfo, username: string | null, i?: Intent) {
        const s = sessionOn(server, username)
        if (s) {
          // the warm session, this account's: act now if it is ready, else once it is
          intent = i ?? null
          if (i?.kind === 'watch' && s.conn.open) {
            s.send(cm.watch(i.username))
            intent = null
          } else if (i?.kind === 'play' && s.state.lobby.username) {
            play(s, i.gameId)
            intent = null
          }
          setRoute(routeFor(s))
          return s
        }
        const n = openSession(server, username, i)
        setRoute(routeFor(n))
        return n
      },
      session: (server: ServerInfo, username: string | null) => sessionOn(server, username),
      retrying,
      logout(account: Account) {
        // client.js logout: forget the token here and the cookie on the server, then drop the connection. The account
        // itself is already gone (lobby.ts), so nothing warms a connection to it again.
        setToken(account.serverId, account.username, null)
        const server = findServer(account.serverId)
        const s = server ? sessionOn(server, account.username) : null
        if (s) {
          const cookie = s.state.lobby.loginCookie
          if (cookie) s.send(cm.forgetLoginCookie(cookie.cookie))
          s.close()
          session = null
        }
        clearRetry()
        intent = null
        setRoute({ kind: 'home' })
      },
      play,
      watch(s, username) {
        s.send(cm.watch(username))
        const account = accountOf(s)
        setRoute(account ? { kind: 'watch', account, username } : { kind: 'home' })
      },
      leave(where) {
        // back on a front-end screen (home, or the Watch screen at `#lobby`): the connection stays up for the next
        // Play. A Continue or a reload waiting on a login keeps its own route, so a refresh mid-login still lands in
        // the game.
        if (intent) return
        const account = getChosenAccount()
        setRoute(where === 'lobby' && account ? { kind: 'lobby', account } : { kind: 'home' })
      },
    })
  }
  lobby.root.style.display = ''
  return lobby
}

/**
 * The home screen: the accounts on this device, one gateway each. The chosen
 * account's connection is warmed while it is up, and the screen follows it, so
 * each line says where its login stands.
 */
function showHome() {
  updateTitle(null)
  const l = frontEnd()
  // the connection first, then the screen: the chosen account's line then says "connecting…" in the frame it is
  // first drawn in, rather than growing a status a moment later and shifting the screen sideways
  warm()
  l.showHome()
}

/** The home screen of the account `s` belongs to, following that connection. */
function showLobbyFor(s: Session) {
  updateTitle(null)
  frontEnd().attach(s)
}

/** The Watch screen (the server's lobby roster, `#lobby`) on the connection `s`. */
function showWatchFor(s: Session) {
  updateTitle(null)
  frontEnd().watchFor(s)
}

/** Out of a game, by hand or because the socket dropped: this account's lobby, or the account list with no session left. */
function leaveGame() {
  if (session && !session.closed) showLobbyFor(session)
  else {
    session = null
    showHome()
  }
}

function startGame() {
  if (!session || game || starting) return
  const s = session
  starting = gameModule()
    .then(({ GameScreen }) => {
      starting = null
      // the game ended, or another connection took over, while the chunk was on its way
      if (game || s !== session || s.closed || s.state.phase === 'lobby') return
      lobby?.destroy()
      lobby = null
      game = makeGame(GameScreen, s)
      hideBoot()
    })
    .catch((e) => {
      // the chunk did not come (the network went, or a deploy moved it, reload_url follows): the next game_client tries again
      starting = null
      s.diag('game screen failed to load: ' + String(e))
      // nothing to stand on: the boot screen would sit dark for ever, so back to the front end
      if (boot) leaveGame()
    })
}

function makeGame(GameScreen: typeof import('./game').GameScreen, s: Session): GameScreen {
  return new GameScreen(app, s, {
    settings: getSettings,
    settingsPanel: (group, back) => settingsPanel(group, { onchange: () => game?.applySettings(), back }),
    gamepad,
    initialInput: lastInput,
    onSystem() {
      const account = accountOf(s)
      if (s.state.watching && account) {
        // Leave a spectate: back to the Watch screen it was picked from (`#lobby`), on the same connection.
        // `go_lobby` stops the spectate, and the server's own `go_lobby` puts the roster up (see applyRoute)
        setRoute({ kind: 'lobby', account })
        applyRoute({ kind: 'lobby', account })
        return
      }
      // Leave game: drop the connection; a save is not needed (crawl keeps the game across a dropped socket). The
      // account's lobby comes up and its token logs in again on the fresh connection, so Continue is there at once.
      if (session === s) session = null
      s.close()
      if (account) frontEnd().connectTo(account)
      else showHome()
    },
  })
}

// keyboard routing
// Shift+F1 / Shift+F2 stand in for RB / SELECT, so the pad's own screens can be
// tried from a keyboard (PAD_KEYS in gamepad.ts). Installed before the lobby's and the
// game's key handlers see the key.
installPadKeys(gamepad)

window.addEventListener('pointerdown', () => { lastInput = 'pointer' }, true)
window.addEventListener('keydown', (ev) => {
  lastInput = 'keyboard'
  if (lobby && !game) {
    if (lobby.key(ev)) ev.stopImmediatePropagation()
  }
}, true)

// gamepad loop: every frame while a pad is there; with none, a look every quarter second on a timer (navigator.getGamepads
// is not free, and a keyboard-only session should not pay it, or an animation frame, sixty times a second), and at once
// when one is plugged in
const IDLE_POLL_MS = 250
let pollTimer = 0
let pollFrame = 0
function tick(now: number) {
  pollFrame = 0
  gamepad.poll(now)
  lobby?.updateInputHints()
  if (gamepad.connected) pollFrame = requestAnimationFrame(tick)
  else pollTimer = window.setTimeout(() => { pollFrame = requestAnimationFrame(tick) }, IDLE_POLL_MS)
}
window.addEventListener('gamepadconnected', () => {
  clearTimeout(pollTimer)
  cancelAnimationFrame(pollFrame)
  pollFrame = requestAnimationFrame(tick)
})
gamepad.on((e) => {
  if (isPadActivity(e)) lastInput = 'pad'
  if (game) game.pad(e)
  else lobby?.pad(e)
})
pollFrame = requestAnimationFrame(tick)

window.addEventListener('beforeunload', (ev) => {
  if (session && session.playing) {
    ev.preventDefault()
    ev.returnValue = ''
  }
})

// the address bar is the record of where we are: `#lobby`, `#play-<game_id>`,
// `#watch-<username>` as in the official client; the server comes from storage
window.addEventListener('hashchange', () => applyRoute(parseRoute()))
applyRoute(parseRoute())

// last, so the beacon never delays the first screen (see analytics.ts)
installAnalytics()

// the game's chunk, fetched while the player is still on the front end, so it is cached by the time they press Play;
// then the tiles of the version they played last, which are the bulk of what Play would otherwise wait on
;(window.requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 1500)))(() => void gameModule().catch(() => {}).then(warmGamedata))

/**
 * Warm the HTTP cache with the gamedata of the version played last on this
 * device (some 5 MB of tile atlases behind an immutable, one-year
 * `Cache-Control` from the proxy), so a press on Play finds it on disk
 * instead of starting the download the "Loading game data" veil then stands
 * on. Only what a previous game already fetched once: a first visit has no
 * version to warm and pays at Play as before. Low priority, one file at a
 * time in the loader's own order (scripts, then atlases), and not at all
 * under the browser's data saver or once a game is under way.
 */
async function warmGamedata() {
  const last = getLast()
  const server = last?.gamedataVersion ? findServer(last.serverId) : null
  if (!server || !last?.gamedataVersion) return
  if ((navigator as { connection?: { saveData?: boolean } }).connection?.saveData) return
  for (const url of gamedataUrls(gamedataBaseFor(server), last.gamedataVersion)) {
    if (game || boot || starting) return
    try {
      // the body is read to the end so the cache keeps it; `priority` is Chrome's fetch hint, ignored elsewhere
      const r = await fetch(url, { priority: 'low' } as RequestInit)
      if (!r.ok) return
      await r.arrayBuffer()
    } catch {
      return
    }
  }
}
