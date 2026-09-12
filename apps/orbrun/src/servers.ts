import type { ViewMode } from '@orbrun/scene'
import type { HintMode } from './gamepad-hints'
import type { GameLink } from '@orbrun/webtiles'
import bundled from '../data/servers.json'

export interface ServerInfo {
  id: string
  name: string
  region?: string
  ws: string
  http: string
  host: string
  custom?: boolean
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
 */
export interface Account {
  serverId: string
  username: string
}

const ACCOUNTS_KEY = 'orbrun.accounts'
const ACCOUNT_KEY = 'orbrun.account'
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
  const tokens = load<Record<string, string>>(TOKEN_KEY, {})
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

/** The accounts on this device, in the order they were added. */
export function listAccounts(): Account[] {
  migrateAccounts()
  return load<Account[]>(ACCOUNTS_KEY, []).filter((a) => a && a.serverId && a.username)
}

/** Add `a` (or spell its name as the server does, if it is already there). */
export function addAccount(a: Account) {
  const all = listAccounts().filter((x) => !sameAccount(x, a))
  all.push({ serverId: a.serverId, username: a.username })
  save(ACCOUNTS_KEY, all)
}

/** Forget `a`: the account and its token; the chosen account too, if it was this one. */
export function removeAccount(a: Account) {
  save(
    ACCOUNTS_KEY,
    listAccounts().filter((x) => !sameAccount(x, a)),
  )
  setToken(a.serverId, a.username, null)
  if (sameAccount(getChosenAccount(), a)) setChosenAccount(null)
}

/** The account last picked on the home screen: the one the `#lobby` (Watch screen), play and watch routes mean. */
export function getChosenAccount(): Account | null {
  migrateAccounts()
  const a = load<Account | null>(ACCOUNT_KEY, null)
  return a && a.serverId && a.username && findServer(a.serverId) ? a : null
}

export function setChosenAccount(a: Account | null) {
  save(ACCOUNT_KEY, a ? { serverId: a.serverId, username: a.username } : null)
}

export function getToken(serverId: string, username: string): string | null {
  return load<Record<string, string>>(TOKEN_KEY, {})[tokenKey(serverId, username)] ?? null
}

export function setToken(serverId: string, username: string, token: string | null) {
  const t = load<Record<string, string>>(TOKEN_KEY, {})
  if (token) t[tokenKey(serverId, username)] = token
  else delete t[tokenKey(serverId, username)]
  save(TOKEN_KEY, t)
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

export function loginState(account: Account | null, loggedIn: string | null | undefined): LoginState {
  if (loggedIn) return 'in'
  if (account && getToken(account.serverId, account.username)) return 'pending'
  return 'out'
}

/**
 * The character last played on a server, as its `player` messages last
 * described it, so the home screen's Continue can say who waits there before
 * the connection is up: the stats screen's first lines (grid/stats.ts).
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
  /** who was playing `gameId` when it was last left (older builds; now in `orbrun.characters`, see getCharacter) */
  character?: LastCharacter
}

const CHARACTERS_KEY = 'orbrun.characters'

/**
 * The character seen in each game of each server, as its `player` messages
 * last described them: who Continue 0.34 and Continue trunk lead to, on a
 * server whose lobby does not say (`show_save_info` off, so `set_game_links`
 * carries no save). Kept per device; dropped when `game_ended` says the
 * character is gone (main.ts).
 */
export function getCharacter(serverId: string, gameId: string): LastCharacter | null {
  const all = load<Record<string, Record<string, LastCharacter>>>(CHARACTERS_KEY, {})
  const c = all[serverId]?.[gameId]
  if (c) return c
  // a character remembered by an older build, on the last game played
  const last = getLast()
  return last && last.serverId === serverId && last.gameId === gameId && last.character ? last.character : null
}

export function setCharacter(serverId: string, gameId: string, c: LastCharacter | null) {
  const all = load<Record<string, Record<string, LastCharacter>>>(CHARACTERS_KEY, {})
  if (c) (all[serverId] ??= {})[gameId] = c
  else if (all[serverId]) delete all[serverId][gameId]
  save(CHARACTERS_KEY, all)
  const last = getLast()
  if (!c && last && last.serverId === serverId && last.gameId === gameId && last.character) setLast({ ...last, character: undefined })
}

/**
 * The character a lobby roster line describes (`lobby_entry`: the game a
 * player has open on the server), as the home screen's Continue speaks one:
 * the title without its "the", the species and background as the roster's
 * four letters ("VSIE"), the place as the HUD abbreviates it ("D:2"). The
 * account's own line is a game of theirs still open on the server, left
 * through a dropped socket or in another tab, which a server that keeps its
 * save info to itself says nothing else about. `stored` is what this device
 * remembered of the game (getCharacter): its fuller species name is kept when
 * it is the same character.
 */
export function characterOf(e: { username: string; char?: string; xl?: string; place?: string; title?: string; god?: string }, stored: LastCharacter | null = null): LastCharacter {
  const colon = e.place?.lastIndexOf(':') ?? -1
  const depth = colon > 0 ? Number(e.place!.slice(colon + 1)) : 0
  const place = colon > 0 && depth ? e.place!.slice(0, colon) : e.place ?? ''
  const same = stored?.name === e.username
  return {
    name: e.username,
    title: e.title ? 'the ' + e.title : same ? stored!.title : '',
    species: same && stored!.species ? stored!.species : e.char ?? '',
    god: e.god || (same ? stored!.god : '') || '',
    xl: Number(e.xl) || (same ? stored!.xl : 0),
    place,
    depth: depth || 0,
  }
}

/**
 * "KorlenTP the Severer, Mountain Dwarf XL12": the character in a line, as
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
 * "caeo the Chiller | Vine Stalker of Vehumet | Orbrun": the browser tab's
 * title while in a game, so a tab (or a window in a taskbar) says whose game
 * it is. The species and god read as the HUD's second line does.
 * `base` is the page's own title.
 */
export function gameTitle(c: LastCharacter, base: string): string {
  const who = c.name + (c.title ? ((c.title[0] === ',' ? '' : ' ') + c.title) : '')
  const what = c.species + (c.god ? (c.species ? ' of ' : 'of ') + c.god : '')
  return [who, what, base].filter(Boolean).join(' | ')
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

export interface Settings {
  renderer: '3d' | '2d'
  /** Where the 3D camera stands: in the eyes, or on a cell behind the player (rendering-3d.md II.11). */
  view: ViewMode
  /** Third person: how far behind the player the camera stands, in cells (rendering-3d.md II.11). */
  camDistance: number
  /** Third person: how high the camera stands, in cells: 0 is the floor, 1 the lid (rendering-3d.md II.11). */
  camHeight: number
  /** First person: how high the eye stands, in cells: 0 is the floor, 1 the lid (rendering-3d.md II.11). */
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

const SETTINGS_KEY = 'orbrun.settings'
/**
 * Temporarily off (2026-09-06): the top-down (2D) view and the third-person
 * camera are not offered to the player. Both still work and are still built —
 * the level map borrows the 2D renderer, and `view` / `camDistance` still
 * drive the camera — but nothing player-facing switches to them: the View,
 * Camera and Camera distance settings rows are dropped (settings-rows.ts), the
 * pause menu loses its two toggles (overlays.ts), Shift+F1 does nothing
 * (game.ts), and a session saved in either mode is read back as 3D first
 * person (`getSettings`). Set this to `true` to bring all of it back at once.
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
  view: 'first',
  camDistance: 0.7,
  camHeight: 0.75,
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
}

export function getSettings(): Settings {
  const saved = load<Partial<Settings>>(SETTINGS_KEY, {})
  const s = { ...defaultSettings, ...saved }
  s.hints = hintsFrom(saved)
  // while 2D and third person are out, a session saved in either comes back in 3D first person
  if (!VIEW_OPTIONS) {
    s.renderer = '3d'
    s.view = 'first'
  }
  return s
}

export function saveSettings(s: Settings) {
  save(SETTINGS_KEY, s)
}

/** Where the camera pointed when the game was last left: yaw and pitch in radians. */
export interface SavedView {
  yaw: number
  pitch: number
}

const VIEW_KEY = 'orbrun.view'

export function getSavedView(): SavedView | null {
  const v = load<Partial<SavedView> | null>(VIEW_KEY, null)
  if (!v || typeof v.yaw !== 'number' || typeof v.pitch !== 'number' || !isFinite(v.yaw) || !isFinite(v.pitch)) return null
  return { yaw: v.yaw, pitch: v.pitch }
}

export function saveView(v: SavedView) {
  save(VIEW_KEY, v)
}

// ------------------------------------------------------------------- servers

/** A server by id or host, from the bundled list or the custom ones. */
export function findServer(idOrHost: string): ServerInfo | null {
  return listServers().find((s) => s.id === idOrHost || s.host === idOrHost) ?? null
}

// --------------------------------------------------------------------- route

/**
 * What the URL says we should be doing. The hash follows the official
 * webtiles client (`#lobby`, `#play-<game_id>`, `#watch-<username>`); who it
 * is doing it as is the account chosen on the home screen, remembered in
 * storage, so an empty hash is the home screen, the account list itself.
 * `#lobby` is the Watch screen: the server's lobby roster, as the official
 * client's `#lobby` shows. (`watch`'s `username` is the player being watched,
 * not the account's own.)
 */
export type Route =
  | { kind: 'home' }
  | { kind: 'lobby'; account: Account }
  | { kind: 'play'; account: Account; gameId: string }
  | { kind: 'watch'; account: Account; username: string }

export function parseRoute(href: string = window.location.href): Route {
  const url = new URL(href)
  let hash = url.hash.replace(/^#/, '')
  try {
    hash = decodeURIComponent(hash)
  } catch {
    /* keep it raw */
  }
  if (!hash) return { kind: 'home' }
  const account = getChosenAccount()
  if (!account) return { kind: 'home' }
  if (hash === 'lobby') return { kind: 'lobby', account }
  if (hash.startsWith('play-') && hash.length > 5) return { kind: 'play', account, gameId: hash.slice(5) }
  if (hash.startsWith('watch-') && hash.length > 6) return { kind: 'watch', account, username: hash.slice(6) }
  return { kind: 'home' }
}

export function formatRoute(r: Route): string {
  if (r.kind === 'home') return window.location.pathname
  const hash = r.kind === 'lobby' ? 'lobby' : r.kind === 'play' ? 'play-' + encodeURIComponent(r.gameId) : 'watch-' + encodeURIComponent(r.username)
  return `${window.location.pathname}#${hash}`
}

/**
 * How deep in the front end a route is: the home screen, or anything else
 * (the Watch screen, a game, a spectate). Leaving home leaves one history
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
 */
export function setRoute(r: Route) {
  const next = formatRoute(r)
  const cur = window.location.pathname + window.location.search + window.location.hash
  if (cur === next) return
  if (routeDepth(r) > routeDepth(parseRoute())) history.pushState(null, '', next)
  else history.replaceState(null, '', next)
}
