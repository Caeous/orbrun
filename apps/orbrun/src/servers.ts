import type { HintMode } from './gamepad-hints'
import type { GameLink } from '@orbrun/webtiles'
import bundled from '../data/servers.json'
import { canQuit } from './quit'
import { DEFAULT_PROFILE } from '@orbrun/offline'

export interface ServerInfo {
  id: string
  name: string
  region?: string
  ws: string
  http: string
  host: string
  custom?: boolean
  /** Games on this device (@orbrun/offline): no socket, no proxies, gamedata from ENGINE_BASE. */
  offline?: boolean
}

/** Where the offline engine's files are served (engine/dist; the dev server's /engine route). */
export const ENGINE_BASE = '/engine'

/**
 * The server that is this device: the offline engine. Its accounts are
 * profiles, each with saves of its own (@orbrun/offline `profileSaveDir`),
 * made with a name and no password; the server list offers it first when an
 * account is being added, and never for watching.
 */
export const OFFLINE_SERVER: ServerInfo = { id: 'offline', name: 'This device', ws: '', http: '', host: 'this device', offline: true }

/** The profile listed until the device has one of its own, so there is always one to play offline with. */
export const DEFAULT_OFFLINE_ACCOUNT: Account = { serverId: OFFLINE_SERVER.id, username: DEFAULT_PROFILE }

/**
 * Whether Offline is offered: everywhere but under test, where no engine is
 * served (the dev server serves a local engine/build.sh through
 * engine-files.ts, a deploy the published one through the ENGINE binding).
 * Read on each call, so a test can stub the environment.
 */
export function offlineOffered(): boolean {
  return import.meta.env.MODE !== 'test'
}

const KEY = 'orbrun.servers'
const TOKEN_KEY = 'orbrun.tokens'
const LAST_KEY = 'orbrun.last'
const GAMES_KEY = 'orbrun.games'

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

export function listServers(): ServerInfo[] {
  const custom = load<ServerInfo[]>(KEY, [])
  return [...(bundled as ServerInfo[]), ...custom]
}

export function addServer(url: string): ServerInfo {
  const u = new URL(url.includes('://') ? url : 'https://' + url)
  const host = u.host
  const ws = (u.protocol === 'http:' ? 'ws://' : 'wss://') + host + '/socket'
  const info: ServerInfo = { id: host, name: host, ws, http: u.origin, host, custom: true }
  const custom = load<ServerInfo[]>(KEY, []).filter((s) => s.id !== info.id)
  custom.push(info)
  save(KEY, custom)
  return info
}

// ------------------------------------------------------------------ accounts

/**
 * An account: a name on a server. The home screen lists them, one gateway
 * each; the player picks one to reach that server's lobby, or adds another
 * (a server from the list, then the lobby page's login or register). What
 * is kept for each is the server's login token (never the password), as
 * the official client keeps its login cookie, so the token login goes out
 * on the next connection (session.ts).
 *
 * The token's life follows the official client's (client.js `start_login`,
 * `set_login_cookie`): the server burns a token the moment it is used
 * (ws_handler.py `token_login` calls `forget_login_cookie` first), so it is
 * dropped here as it goes out and the fresh one `login_cookie` answers with
 * takes its place. The server also forgets tokens older than its
 * `login_token_lifetime` (7 days by default), which `login_cookie` reports
 * in `expires`; a token past that is dropped here without being tried.
 * Unlike the official client, which holds one server's token, this device
 * holds one per account, so nothing is kept a moment longer than it works.
 */
export interface Account {
  serverId: string
  username: string
}

const ACCOUNTS_KEY = 'orbrun.accounts'
const ACCOUNT_KEY = 'orbrun.account'
/** when each account was last picked (ms since the epoch), by tokenKey */
const USED_KEY = 'orbrun.accountUsed'
/** older builds: one token per server, and the server chosen on its own */
const OLD_SERVER_KEY = 'orbrun.server'

/** The key an account's token is filed under: the server, then the name (the server takes it in any case). */
function tokenKey(serverId: string, username: string): string {
  return serverId + '/' + username.toLowerCase()
}

export function sameAccount(a: Account | null | undefined, b: Account | null | undefined): boolean {
  return !!a && !!b && a.serverId === b.serverId && a.username.toLowerCase() === b.username.toLowerCase()
}

/**
 * Older builds kept one token per server (`orbrun.tokens[serverId]`) and the
 * chosen server on its own; the name was in `orbrun.last`. Those make one
 * account, chosen, and the token is filed under it. Runs once.
 */
function migrateAccounts() {
  if (localStorageHas(ACCOUNTS_KEY)) return
  const tokens = readTokens()
  const last = load<LastPlayed | null>(LAST_KEY, null)
  const accounts: Account[] = []
  for (const [serverId, token] of Object.entries(tokens)) {
    if (serverId.includes('/') || !findServer(serverId)) continue
    const username = last && last.serverId === serverId && last.username ? last.username : null
    delete tokens[serverId]
    if (!username) continue
    tokens[tokenKey(serverId, username)] = token
    accounts.push({ serverId, username })
  }
  save(TOKEN_KEY, tokens)
  save(ACCOUNTS_KEY, accounts)
  const chosenServer = load<string | null>(OLD_SERVER_KEY, null)
  const chosen = accounts.find((a) => a.serverId === chosenServer) ?? accounts[0] ?? null
  if (chosen) save(ACCOUNT_KEY, chosen)
}

function localStorageHas(key: string): boolean {
  try {
    return localStorage.getItem(key) !== null
  } catch {
    return false
  }
}

/**
 * The accounts on this device, the one picked last first, then the ones
 * never picked in the order they were added; offline profiles only where
 * Offline is offered, and the default one when there is no other.
 */
export function listAccounts(): Account[] {
  const stored = storedAccounts()
  const all = !offlineOffered()
    ? stored.filter((a) => a.serverId !== OFFLINE_SERVER.id)
    : stored.some((a) => a.serverId === OFFLINE_SERVER.id)
      ? stored
      : [...stored, DEFAULT_OFFLINE_ACCOUNT]
  const used = load<Record<string, number>>(USED_KEY, {})
  const at = (a: Account) => used[tokenKey(a.serverId, a.username)] ?? 0
  return all.sort((a, b) => at(b) - at(a))
}

function storedAccounts(): Account[] {
  migrateAccounts()
  return load<Account[]>(ACCOUNTS_KEY, []).filter((a) => a && a.serverId && a.username)
}

/** Whether `a` was added on this device, and is not just the default offline profile standing in for one. */
export function isStoredAccount(a: Account): boolean {
  return storedAccounts().some((x) => sameAccount(x, a))
}

/** Add `a` (or spell its name as the server does, if it is already there). */
export function addAccount(a: Account) {
  const all = storedAccounts().filter((x) => !sameAccount(x, a))
  all.push({ serverId: a.serverId, username: a.username })
  save(ACCOUNTS_KEY, all)
}

/** Forget `a`: the account and its token; the chosen account too, if it was this one. */
export function removeAccount(a: Account) {
  save(
    ACCOUNTS_KEY,
    storedAccounts().filter((x) => !sameAccount(x, a)),
  )
  setToken(a.serverId, a.username, null)
  const used = load<Record<string, number>>(USED_KEY, {})
  delete used[tokenKey(a.serverId, a.username)]
  save(USED_KEY, used)
  if (sameAccount(getChosenAccount(), a)) setChosenAccount(null)
}

/** The account last picked on the home screen: the one the `#lobby` (Watch screen), play and watch routes mean. */
export function getChosenAccount(): Account | null {
  migrateAccounts()
  const a = load<Account | null>(ACCOUNT_KEY, null)
  return a && a.serverId && a.username && findServer(a.serverId) ? a : null
}

/** Choose `a`, and mark it used now: listAccounts puts it first. */
export function setChosenAccount(a: Account | null, now = Date.now()) {
  save(ACCOUNT_KEY, a ? { serverId: a.serverId, username: a.username } : null)
  if (!a) return
  const used = load<Record<string, number>>(USED_KEY, {})
  used[tokenKey(a.serverId, a.username)] = now
  save(USED_KEY, used)
}

/**
 * A stored token: the cookie string and when the server will have forgotten
 * it (ms since the epoch), or a bare string from a build that kept no expiry
 * (2026-09-18), read as a token that has not expired.
 */
type StoredToken = string | { token: string; until?: number }

function readTokens(): Record<string, StoredToken> {
  const t = load<unknown>(TOKEN_KEY, {})
  return t && typeof t === 'object' && !Array.isArray(t) ? (t as Record<string, StoredToken>) : {}
}

const DAY_MS = 24 * 60 * 60 * 1000

/** The account's token, or null when there is none or the server will have forgotten it (it is dropped then). */
export function getToken(serverId: string, username: string, now = Date.now()): string | null {
  const all = readTokens()
  const key = tokenKey(serverId, username)
  const v = all[key]
  if (typeof v === 'string') return v || null
  if (!v || typeof v !== 'object' || typeof v.token !== 'string' || !v.token) return null
  if (typeof v.until === 'number' && now >= v.until) {
    delete all[key]
    save(TOKEN_KEY, all)
    return null
  }
  return v.token
}

/**
 * File `token` under the account, or forget it (`null`). `expiresDays` is the
 * `login_cookie` message's `expires`: how many days the server keeps the token
 * (ws_handler.py `set_login_cookie` sends `login_token_lifetime`).
 */
export function setToken(serverId: string, username: string, token: string | null, expiresDays?: number, now = Date.now()) {
  const all = readTokens()
  const key = tokenKey(serverId, username)
  if (token) {
    const until = typeof expiresDays === 'number' && isFinite(expiresDays) && expiresDays > 0 ? now + expiresDays * DAY_MS : undefined
    all[key] = until === undefined ? { token } : { token, until }
  } else delete all[key]
  save(TOKEN_KEY, all)
}

/**
 * Where an account stands in its server's lobby: `in` (the lobby said who),
 * `pending` (a token is stored and its login not yet answered; a refused one
 * is dropped, so this cannot last), or `out` (nobody, and nothing to try).
 * The server sends its "Play now" lines only once logged in (ws_handler.py
 * `send_lobby_html`: `if not self.username: return`), so `out` is when the
 * lobby screen offers Log in instead of Play.
 */
export type LoginState = 'in' | 'pending' | 'out'

export function loginState(account: Account | null, loggedIn: string | null | undefined, loggingIn = false): LoginState {
  if (loggedIn) return 'in'
  // its token already sent (and so forgotten), its answer still to come
  if (loggingIn) return 'pending'
  // an offline profile's token is its name (session.ts), never stored and never refused
  if (account && (account.serverId === OFFLINE_SERVER.id || getToken(account.serverId, account.username))) return 'pending'
  return 'out'
}

/**
 * A character as a roster line or a lobby's save info describes them: the
 * stats screen's first lines (grid/stats.ts), as the home screen's Continue
 * and the browser tab speak them.
 */
export interface LastCharacter {
  name: string
  /** "the Severer", or ", the ..." when the title carries its own comma (stats.ts) */
  title: string
  species: string
  /** "Vehumet"; '' for a character without a god (the `player` message's `god`, the roster's) */
  god?: string
  xl: number
  /** "Dungeon", "Snake Pit"; `depth` 0 for a branch without one */
  place: string
  depth: number
}

export interface LastPlayed {
  serverId: string
  gameId?: string
  username?: string
  /**
   * The gamedata version (a sha1) the last game on this server ran on, from its `game_client`: what the
   * next visit warms the cache with before Play is pressed (main.ts `warmGamedata`). Only ever learned
   * in play, so a version can lag behind a server upgrade by one game; the warm-up then fetches a set
   * that is still served, and the new one loads as it always has.
   */
  gamedataVersion?: string
}

/**
 * The character a lobby roster line describes (`lobby_entry`: the game a
 * player has open on the server), as the home screen's Continue speaks one:
 * the title without its "the", the species and background as the roster's
 * four letters ("VSIE"), the place as the HUD abbreviates it ("D:2"). The
 * account's own line is a game of theirs still open on the server, left
 * through a dropped socket or in another tab.
 *
 * Everything here comes from the line itself, nothing from what this device
 * saw last: the same account can be played from anywhere, so a remembered
 * character may already be dead and would contradict the live line.
 */
export function characterOf(e: { username: string; char?: string; xl?: string; place?: string; title?: string; god?: string }): LastCharacter {
  const colon = e.place?.lastIndexOf(':') ?? -1
  const depth = colon > 0 ? Number(e.place!.slice(colon + 1)) : 0
  const place = colon > 0 && depth ? e.place!.slice(0, colon) : e.place ?? ''
  return {
    name: e.username,
    title: e.title ? 'the ' + e.title : '',
    species: e.char ?? '',
    god: e.god || '',
    xl: Number(e.xl) || 0,
    place,
    depth: depth || 0,
  }
}

/**
 * "Dwarfsong the Severer, Mountain Dwarf XL12": the character in a line, as
 * the lobby roster speaks one. Where they stand is a line of its own
 * (describePlace): the two together run past a handheld's width.
 */
export function describeCharacter(c: LastCharacter): string {
  const who = c.name + (c.title ? ((c.title[0] === ',' ? '' : ' ') + c.title) : '')
  const what = [c.species, c.xl ? `XL${c.xl}` : ''].filter(Boolean).join(' ')
  return [who, what].filter(Boolean).join(', ')
}

/** "Snake Pit:2", "Zot": where the character stands, as the HUD's place line says it; '' before the game has said. */
export function describePlace(c: LastCharacter): string {
  return c.place ? c.place + (c.depth ? ':' + c.depth : '') : ''
}

/**
 * "orbrun the Chiller | Vine Stalker of Vehumet - Orbrun": the browser tab's
 * title while in a game, so a tab (or a window in a taskbar) says whose game
 * it is. The species and god read as the HUD's second line does, and the site
 * follows a dash, as the page's own title has it.
 * `base` is the page's own title.
 */
export function gameTitle(c: LastCharacter, base: string): string {
  const who = c.name + (c.title ? ((c.title[0] === ',' ? '' : ' ') + c.title) : '')
  const what = c.species + (c.god ? (c.species ? ' of ' : 'of ') + c.god : '')
  const game = [who, what].filter(Boolean).join(' | ')
  return [game, base].filter(Boolean).join(' - ')
}

const MORGUE_KEY = 'orbrun.morgue'

/**
 * Where a server keeps an account's morgue directory ("/crawl/morgue/orbrun/"), once something has said: a
 * `game_ended` `dump` names the real one, and before that the home screen tries the layouts
 * dgamelaunch-config ships with (whereis.ts `morgueDirGuesses`) and keeps whichever answered. '' is a
 * server that answered none of them, kept so the tries are not made again on every redraw.
 */
export function getMorgueDir(serverId: string, username: string): string | null {
  const all = load<Record<string, string>>(MORGUE_KEY, {})
  return all[tokenKey(serverId, username)] ?? null
}

export function setMorgueDir(serverId: string, username: string, dir: string) {
  const all = load<Record<string, string>>(MORGUE_KEY, {})
  all[tokenKey(serverId, username)] = dir
  save(MORGUE_KEY, all)
}

export function getLast(): LastPlayed | null {
  return load<LastPlayed | null>(LAST_KEY, null)
}

export function setLast(l: LastPlayed) {
  save(LAST_KEY, l)
}

/** A game the server's lobby offers, as `set_game_links` lists it, with the save it reported waiting there. */
export type CachedGame = GameLink

/**
 * The game list a server's lobby sent last time, kept per server so the
 * home screen can offer "Play 0.34" and "Play trunk" before the connection
 * is up. The live list replaces it as soon as the lobby sends one.
 */
export function getGames(serverId: string): CachedGame[] | null {
  return load<Record<string, CachedGame[]>>(GAMES_KEY, {})[serverId] ?? null
}

export function setGames(serverId: string, games: CachedGame[]) {
  const all = load<Record<string, CachedGame[]>>(GAMES_KEY, {})
  all[serverId] = games.map((g) => {
    const c: CachedGame = { id: g.id, label: g.label }
    if (g.save !== undefined) c.save = g.save
    if (g.disabled) c.disabled = true
    return c
  })
  save(GAMES_KEY, all)
}

/** Where gamedata is fetched from for a server, in this shell. */
export function gamedataBaseFor(server: ServerInfo): string {
  if (server.offline) return ENGINE_BASE
  return `/gamedata-proxy/${server.host}`
}

/**
 * Where a game's morgue file or character dump is read from, in this shell:
 * `game_ended` hands the file's URL less its `.txt`, absolute or as a path
 * on the server, and the server publishes it without CORS headers, so it is
 * read through the same-origin proxy. Null when the URL is not one the
 * proxy can carry (another scheme, a host the server picker would refuse).
 */
export function morgueUrlFor(server: ServerInfo, dump: string): string | null {
  if (server.offline) return null
  let u: URL
  try {
    u = new URL(dump + '.txt', server.http)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  return `/morgue-proxy/${u.host}${u.pathname}`
}

/**
 * What says what is around you (hud.md "What is around you"): the WebTiles
 * monster list on the sidebar, or Orbrun's edge pips on the 3D view's edge.
 * One or the other, never both: they answer the same question. In 2D the
 * list always shows, since there is no lens to be out of.
 */
type Nearby = 'list' | 'pips'

/**
 * What left and right do for one family of direction inputs: turn the camera
 * on the spot, or strafe — one step sideways, heading kept. Forward, back and
 * the diagonals are the same either way (runner.ts `step`).
 */
export type LeftRight = 'turn' | 'strafe'

/**
 * Where a direction came from: the three keyboard sets keys.ts `directionKey`
 * tells apart, and the pad's two direction sources (gamepad.ts `PadEvent`).
 * The five are reported apart but answered in two — the hand matters, the key
 * set does not (2026-09-15: there was a row per family, and five rows to read
 * for one question was worse than the mixed setups they bought).
 */
export type DirSource = 'arrows' | 'vim' | 'numpad' | 'dpad' | 'lstick'

/** The setting each source reads: one answer for the keyboard, one for the pad. */
const LEFT_RIGHT_KEYS: Record<DirSource, keyof Settings> = {
  arrows: 'leftRightKeys',
  vim: 'leftRightKeys',
  numpad: 'leftRightKeys',
  dpad: 'leftRightPad',
  lstick: 'leftRightPad',
}

/** Whether left and right turn (rather than strafe) for `source`. */
export function leftRightTurns(source: DirSource, s: Settings = getSettings()): boolean {
  return s[LEFT_RIGHT_KEYS[source]] === 'turn'
}

export interface Settings {
  renderer: '3d' | '2d'
  /** How high the eye stands, in cells: 0 is the floor, 1 the lid (rendering-3d.md II.11). */
  eyeHeight: number
  fov: number
  /** Where the camera points at rest, in degrees off the horizon: negative looks down, positive up (rendering-3d.md II.11). */
  restPitch: number
  uiScale: number
  invertLook: boolean
  lookSensitivity: number
  confirmStairs: boolean
  /** Draw the wielded weapon and off-hand item in the 3D view (rendering-3d.md II.7). */
  viewmodel: boolean
  /** What is around you: the monster list, or edge pips on the 3D view (hud.md "What is around you"). */
  nearby: Nearby
  /** How many tiles the minimap shows across (hud.md "Minimap"); 19 tiles reads at a glance and reaches a little past the reference layout's sidebar column. */
  minimapTiles: number
  /** How big a minimap tile is drawn, in css px (hud.md "Minimap"); 20 is the cell the map follows the player at. */
  minimapCell: number
  /** The gamepad prompts in the corner of the view (gamepad-hints.ts `HintMode`). */
  hints: HintMode
  /** Keyboard (arrows, h/l, numpad 4/6): what left and right do. */
  leftRightKeys: LeftRight
  /** Gamepad (d-pad and left stick): what left and right do. */
  leftRightPad: LeftRight
  /** The front room's idle turn behind the menus (room/view.ts DRIFT_RATE). */
  roomTurn: boolean
}

const HINT_MODES: readonly string[] = ['adaptive', 'contextual', 'off']

/**
 * What a saved settings object says about hints, in the one field or in the
 * two it used to be split into: `gamepadHints` (adaptive/contextual/off) and
 * `keyHints` (a boolean), merged 2026-09-09. An old pad mode carries over; a
 * keyboard opt-out alone was the older global opt-out and still means off.
 */
function hintsFrom(saved: Partial<Settings> & { gamepadHints?: unknown; keyHints?: unknown }): HintMode {
  for (const v of [saved.hints, saved.gamepadHints]) if (typeof v === 'string' && HINT_MODES.includes(v)) return v as HintMode
  if (saved.keyHints === false) return 'off'
  return 'adaptive'
}

/**
 * What a saved settings object says about left and right, in the two fields
 * or in the five it used to be split into — one per input family, merged
 * 2026-09-15 into one answer for the keyboard and one for the pad. An old
 * session that set any of a hand's families to strafe comes back strafing on
 * that whole hand.
 */
type OldLeftRight = Partial<Record<'leftRightArrows' | 'leftRightVim' | 'leftRightNumpad' | 'leftRightDpad' | 'leftRightStick', unknown>>
function leftRightFrom(saved: Partial<Settings> & OldLeftRight, now: keyof Settings, old: readonly (keyof OldLeftRight)[]): LeftRight {
  const v = saved[now]
  if (v === 'turn' || v === 'strafe') return v
  return old.some((k) => saved[k] === 'strafe') ? 'strafe' : 'turn'
}

const SETTINGS_KEY = 'orbrun.settings'
/**
 * Temporarily off (2026-09-06): the top-down (2D) view is not offered to the
 * player. It still works and is still built — the level map borrows the 2D
 * renderer — but nothing player-facing switches to it: the View settings row
 * is dropped (settings-rows.ts), the pause menu loses its toggle
 * (overlays.ts), and a session saved in 2D is read back as 3D
 * (`getSettings`). Set this to `true` to bring it back at once.
 */
export const VIEW_OPTIONS: boolean = false
/**
 * Truncated corners (rendering-3d.md II.1): how far every convex wall corner
 * is cut back, in cells. Fixed at one texel of a 32-texel wall — every corner
 * is chamfered, the player does not choose how much.
 */
export const CHAMFER = 1 / 32
/**
 * Inset walls (rendering-3d.md II.1): how far every wall face stands back
 * from the floor, in cells. Fixed at 12 texels of a 32-texel wall, so a
 * one-thick wall keeps an 8-texel core — the player does not choose the
 * thickness.
 */
export const WALL_INSET = 12 / 32
export const defaultSettings: Settings = {
  renderer: '3d',
  eyeHeight: 0.65,
  fov: 85,
  restPitch: -5,
  uiScale: 1,
  invertLook: false,
  lookSensitivity: 1,
  confirmStairs: false,
  viewmodel: true,
  nearby: 'pips',
  minimapTiles: 19,
  minimapCell: 20,
  hints: 'adaptive',
  leftRightKeys: 'turn',
  leftRightPad: 'turn',
  roomTurn: true,
}

export function getSettings(): Settings {
  const saved = load<Partial<Settings>>(SETTINGS_KEY, {})
  const s = { ...defaultSettings, ...saved }
  s.hints = hintsFrom(saved)
  s.leftRightKeys = leftRightFrom(saved, 'leftRightKeys', ['leftRightArrows', 'leftRightVim', 'leftRightNumpad'])
  s.leftRightPad = leftRightFrom(saved, 'leftRightPad', ['leftRightDpad', 'leftRightStick'])
  // while 2D is out, a session saved in it comes back in 3D
  if (!VIEW_OPTIONS) s.renderer = '3d'
  return s
}

/**
 * Only what the player changed is written down: a setting still at its
 * default is left out of storage, so a default we move later moves for
 * everyone who never touched that row. Settings the build has taken away
 * (`VIEW_OPTIONS`) keep whatever a saved session said — `getSettings` reads
 * it back as 3D, but the choice is not erased on the next save.
 */
export function saveSettings(s: Settings) {
  const saved = load<Partial<Settings>>(SETTINGS_KEY, {})
  const out: Partial<Settings> = {}
  for (const key of Object.keys(defaultSettings) as (keyof Settings)[]) {
    if (s[key] !== defaultSettings[key]) (out as Record<string, unknown>)[key] = s[key]
  }
  if (!VIEW_OPTIONS) {
    const was = saved.renderer
    if (was !== undefined && was !== defaultSettings.renderer) out.renderer = was
    else delete out.renderer
  }
  save(SETTINGS_KEY, out)
}

/**
 * Where the camera pointed when the game was last left: the yaw in radians.
 * The pitch is not kept: every session starts at the rest angle (the Camera
 * angle setting), so a look up or down does not carry over.
 */
export interface SavedView {
  yaw: number
}

const VIEW_KEY = 'orbrun.view'

export function getSavedView(): SavedView | null {
  const v = load<Partial<SavedView> | null>(VIEW_KEY, null)
  if (!v || typeof v.yaw !== 'number' || !isFinite(v.yaw)) return null
  return { yaw: v.yaw }
}

export function saveView(v: SavedView) {
  save(VIEW_KEY, { yaw: v.yaw })
}

// ------------------------------------------------------------------- servers

/** A server by id or host, from the bundled list or the custom ones, or this device's. */
export function findServer(idOrHost: string): ServerInfo | null {
  if (offlineOffered() && idOrHost === OFFLINE_SERVER.id) return OFFLINE_SERVER
  return listServers().find((s) => s.id === idOrHost || s.host === idOrHost) ?? null
}

// --------------------------------------------------------------------- route

/**
 * What the URL says we should be doing. The game hashes follow the official
 * webtiles client (`lobby`, `play-<game_id>`, `watch-<username>`), scoped
 * by who is doing it: `orbrun@cdi/play-dcss-0.34`, or a server alone for
 * what needs no account (`cdi/lobby`, `cdi/watch-bob`), so a link opens the
 * same thing on another device. The official client's bare hashes still
 * read, as the account chosen on the home screen. The front end's own
 * screens have addresses too (`#settings/camera`, `#about/new`,
 * `#cdi/login`); an empty hash is the home screen. `#lobby` is the Watch
 * screen: the server's lobby roster, as the official client's `#lobby`
 * shows. (`watch`'s `username` is the player being watched, not the
 * account's own.)
 */
export type Route =
  | { kind: 'home' }
  | MenuRoute
  | { kind: 'lobby'; serverId: string; account: Account | null }
  | { kind: 'play'; account: Account; gameId: string }
  | { kind: 'watch'; serverId: string; account: Account | null; username: string }

/**
 * A front-end screen: `path` is one of MENU_PATH's, or `login`/`register`
 * on `serverId` (as `username`, when the address names one).
 */
export interface MenuRoute {
  kind: 'menu'
  path: string
  serverId?: string
  username?: string
}

/** the front end's screens that belong to no server; a settings group is its name in lower case (settings-rows.ts) */
const MENU_PATH = /^(settings(\/[a-z]+)?|settings\/controls\/gamepad|accounts(\/add)?|watch|about(\/(orbrun|new|steam))?)$/

function decode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** `name` among the accounts on this device on `server`, spelled as it was added */
function knownAccount(serverId: string, name: string): Account | null {
  return listAccounts().find((a) => sameAccount(a, { serverId, username: name })) ?? null
}

export function parseRoute(href: string = window.location.href): Route {
  const raw = new URL(href).hash.replace(/^#/, '')
  if (!raw) return { kind: 'home' }
  if (MENU_PATH.test(raw)) return { kind: 'menu', path: raw }
  const slash = raw.indexOf('/')
  if (slash < 0) {
    // the official client's own hashes, as the chosen account
    const account = getChosenAccount()
    if (!account) return { kind: 'home' }
    const hash = decode(raw)
    if (hash === 'lobby') return { kind: 'lobby', serverId: account.serverId, account }
    if (hash.startsWith('play-') && hash.length > 5) return { kind: 'play', account, gameId: hash.slice(5) }
    if (hash.startsWith('watch-') && hash.length > 6) return { kind: 'watch', serverId: account.serverId, account, username: hash.slice(6) }
    return { kind: 'home' }
  }
  const who = decode(raw.slice(0, slash))
  const rest = decode(raw.slice(slash + 1))
  const at = who.lastIndexOf('@')
  const server = findServer(at < 0 ? who : who.slice(at + 1))
  if (!server) return { kind: 'home' }
  const serverId = server.id
  const named = at > 0 ? who.slice(0, at) : null
  const known = named ? knownAccount(serverId, named) : null
  if (rest === 'login' || rest === 'register') return { kind: 'menu', path: rest, serverId, ...(named ? { username: known?.username ?? named } : {}) }
  if (rest.startsWith('play-') && rest.length > 5) {
    // an unnamed play is the chosen account's, or any on that server; with none here, its login
    const chosen = getChosenAccount()
    const account = named ? known : chosen?.serverId === serverId ? chosen : (listAccounts().find((a) => a.serverId === serverId) ?? null)
    if (!account) return { kind: 'menu', path: 'login', serverId, ...(named ? { username: named } : {}) }
    return { kind: 'play', account, gameId: rest.slice(5) }
  }
  // nobody else plays on this device
  if (server.offline) return { kind: 'home' }
  // watching needs no account: one this device does not have watches without
  if (rest === 'lobby') return { kind: 'lobby', serverId, account: known }
  if (rest.startsWith('watch-') && rest.length > 6) return { kind: 'watch', serverId, account: known, username: rest.slice(6) }
  return { kind: 'home' }
}

/** who a route is as, in its address: `orbrun@cdi`, or the server alone */
function scope(serverId: string, username?: string | null): string {
  return (username ? encodeURIComponent(username) + '@' : '') + encodeURIComponent(serverId)
}

/**
 * The address for a route. The query is carried through unchanged: the flags
 * that live there (`?perf`, `?fullscreen`) are set once when the page is
 * opened — by a Steam shortcut's launch options, say — and a device with no
 * address bar could not put one back, so a Play must not drop them.
 */
export function formatRoute(r: Route): string {
  const base = window.location.pathname + window.location.search
  if (r.kind === 'home') return base
  const hash =
    r.kind === 'menu'
      ? (r.serverId ? scope(r.serverId, r.username) + '/' : '') + r.path
      : r.kind === 'lobby'
        ? scope(r.serverId, r.account?.username) + '/lobby'
        : r.kind === 'play'
          ? scope(r.account.serverId, r.account.username) + '/play-' + encodeURIComponent(r.gameId)
          : scope(r.serverId, r.account?.username) + '/watch-' + encodeURIComponent(r.username)
  return `${base}#${hash}`
}

/**
 * How deep in the front end a route is: the home screen, or anything else
 * (a menu, the Watch screen, a game, a spectate). Leaving home leaves one history
 * entry behind, so Back is always the way out to the home screen; moving
 * between the deeper screens, or coming back up, rewrites that entry in place.
 */
function routeDepth(r: Route): number {
  return r.kind === 'home' ? 0 : 1
}

/**
 * Put the route in the address bar. Neither push nor replace fires
 * `hashchange`, so this never comes back through `applyRoute`; only the
 * player's own Back, Forward or edit does.
 *
 * In a window of our own there is no Back to serve, and a second history
 * entry costs the way out: Chrome refuses `window.close()` on a window a
 * script did not open once the tab has more than one entry, so a Deck that
 * had played a game could no longer Quit (quit.ts). There the address is
 * only ever rewritten in place.
 */
export function setRoute(r: Route) {
  const next = formatRoute(r)
  const cur = window.location.pathname + window.location.search + window.location.hash
  if (cur === next) return
  if (!canQuit() && routeDepth(r) > routeDepth(parseRoute())) history.pushState(null, '', next)
  else history.replaceState(null, '', next)
}
