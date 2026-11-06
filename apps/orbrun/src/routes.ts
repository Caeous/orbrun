import { findServer, getChosenAccount, listAccounts, OFFLINE_SERVER, sameAccount, type Account } from '@orbrun/client/servers'
import { ownWindow } from './quit'
import { ACCOUNT_PATH, HOME, MENU_PATH, MORGUES_PATH, pageAt, RC_PATH, titleAt, VERSIONS_PATH } from './site'

// --------------------------------------------------------------------- route

/**
 * What the URL says we should be doing. The path names it, the verb first,
 * then the server, then the game: `/play/cdi/dcss-0.34`, `/watch/cdi` (the
 * Watch screen: the server's lobby roster, the official client's `#lobby`),
 * `/login/cdi`, so a link opens the same thing on another device. Who is
 * after the `#`: `/play/cdi/dcss-0.34#orbrun`, `/watch/cdi#bob`,
 * `/login/cdi#orbrun`. The fragment never leaves the browser, so the page
 * view the site counts (analytics.ts) names nobody, and a copied link still
 * does. Watching needs no account, so its address names none: it is the
 * chosen account's when that is on the same server. Games on this device are
 * named as CDI names its own (`/play/offline/dcss-0.34#Ada`, `dcss-git` for
 * trunk), so a game reads the same played here or there. The front end's own
 * screens have addresses too (`/settings/view`, `/accounts/add`); the bare
 * root is the home screen. The About pages are the site's, not the app's
 * (site.ts): `openPage` goes to them.
 * (`watch`'s `username` is the player being watched, not the account's own.)
 */
export type Route =
  | { kind: 'home' }
  | MenuRoute
  | { kind: 'lobby'; serverId: string; account: Account | null }
  | { kind: 'play'; account: Account; gameId: string }
  | { kind: 'watch'; serverId: string; account: Account | null; username: string }

/**
 * A front-end screen: `path` is one of MENU_PATH's, or `login`/`register`
 * on `serverId` (as `username`, when the address names one), or
 * `accounts/versions`, an account's Other versions (`username` always named),
 * or `accounts/rc`, an account's rc file: the one `gameId` reads on a server,
 * the one every game reads on this device (no `gameId`); `accounts` on
 * `serverId`, an account's own screen; `accounts/morgues`, its Morgues, or the
 * one `morgue` names by when it ended (`20260915-155745`).
 */
export interface MenuRoute {
  kind: 'menu'
  path: string
  serverId?: string
  username?: string
  gameId?: string
  morgue?: string
}

/** what every game id on this device starts with (@orbrun/offline channelOf), which its address says as CDI would */
const DEVICE_GAME = 'offline-'

/** a game on this device in an address: `offline-0.34` is `dcss-0.34`, `offline-trunk` CDI's `dcss-git` */
function deviceGameAddress(gameId: string): string {
  const slot = gameId.startsWith(DEVICE_GAME) ? gameId.slice(DEVICE_GAME.length) : gameId
  return 'dcss-' + (slot === 'trunk' ? 'git' : slot)
}

/** the game on this device an address names; the bare slot (`0.34`, `trunk`) is how older addresses said it */
function deviceGameAt(game: string): string {
  const slot = game.toLowerCase().replace(/^dcss-/, '')
  return DEVICE_GAME + (slot === 'git' ? 'trunk' : slot)
}

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

/** the chosen account, when it is on `serverId`: who a watch address, which names nobody, watches as */
function chosenOn(serverId: string): Account | null {
  const chosen = getChosenAccount()
  return chosen?.serverId === serverId ? chosen : null
}

/** the only account on `serverId`, when there is just the one: who a play address that names nobody is for */
function onlyAccountOn(serverId: string): Account | null {
  const on = listAccounts().filter((a) => a.serverId === serverId)
  return on.length === 1 ? on[0] : null
}

export function parseRoute(href: string = window.location.href): Route {
  const { pathname, hash } = new URL(href)
  // split before decoding, so a `/` in a name (`%2F`) stays in it; an empty segment (`//`, a trailing `/`) says nothing
  const parts = pathname.split('/').filter(Boolean).map(decode)
  if (!parts.length) return { kind: 'home' }
  const menu = parts.join('/').toLowerCase()
  if (MENU_PATH.test(menu)) return { kind: 'menu', path: menu }
  // an account's Other versions (`/accounts/versions/cdi#orbrun`): who, as a play address says it; there are no
  // versions to pick on this device
  if (parts.length === 3 && parts.slice(0, 2).join('/').toLowerCase() === VERSIONS_PATH) {
    const server = findServer(parts[2].toLowerCase())
    if (!server || server.offline) return { kind: 'home' }
    const named = hash.length > 1 ? decode(hash.slice(1)) : null
    const account = named ? knownAccount(server.id, named) : (chosenOn(server.id) ?? onlyAccountOn(server.id))
    if (!account) return { kind: 'menu', path: 'login', serverId: server.id, ...(named ? { username: named } : {}) }
    return { kind: 'menu', path: VERSIONS_PATH, serverId: server.id, username: account.username }
  }
  // an account's rc file (`/accounts/rc/cdi/dcss-0.34#orbrun`): the game names the file on a server; a player on
  // this device has one for every game (`/accounts/rc/offline#Ada`)
  if ((parts.length === 3 || parts.length === 4) && parts.slice(0, 2).join('/').toLowerCase() === RC_PATH) {
    const server = findServer(parts[2].toLowerCase())
    if (!server || (parts.length === 4) === !!server.offline) return { kind: 'home' }
    const named = hash.length > 1 ? decode(hash.slice(1)) : null
    const account = named ? knownAccount(server.id, named) : (chosenOn(server.id) ?? onlyAccountOn(server.id))
    if (!account) return { kind: 'menu', path: 'login', serverId: server.id, ...(named ? { username: named } : {}) }
    return { kind: 'menu', path: RC_PATH, serverId: server.id, username: account.username, ...(server.offline ? {} : { gameId: parts[3] }) }
  }
  // an account's Morgues (`/accounts/morgues/cdi#orbrun`), and one of them, by when it ended
  // (`/accounts/morgues/cdi/20260915-155745#orbrun`)
  if ((parts.length === 3 || parts.length === 4) && parts.slice(0, 2).join('/').toLowerCase() === MORGUES_PATH) {
    const server = findServer(parts[2].toLowerCase())
    if (!server || (parts.length === 4 && !/^\d{8}-\d{6}$/.test(parts[3]))) return { kind: 'home' }
    const named = hash.length > 1 ? decode(hash.slice(1)) : null
    const account = named ? knownAccount(server.id, named) : (chosenOn(server.id) ?? onlyAccountOn(server.id))
    if (!account) return { kind: 'menu', path: 'login', serverId: server.id, ...(named ? { username: named } : {}) }
    return { kind: 'menu', path: MORGUES_PATH, serverId: server.id, username: account.username, ...(parts[3] ? { morgue: parts[3] } : {}) }
  }
  // an account's own screen (`/accounts/cdi#orbrun`, `/accounts/offline#Ada`)
  if (parts.length === 2 && parts[0].toLowerCase() === ACCOUNT_PATH) {
    const server = findServer(parts[1].toLowerCase())
    if (!server) return { kind: 'home' }
    const named = hash.length > 1 ? decode(hash.slice(1)) : null
    const account = named ? knownAccount(server.id, named) : (chosenOn(server.id) ?? onlyAccountOn(server.id))
    if (!account) return { kind: 'menu', path: 'login', serverId: server.id, ...(named ? { username: named } : {}) }
    return { kind: 'menu', path: ACCOUNT_PATH, serverId: server.id, username: account.username }
  }
  const [verb, where, ...rest] = parts
  const server = where === undefined ? null : findServer(where.toLowerCase())
  if (!server) return { kind: 'home' }
  const serverId = server.id
  const what = verb.toLowerCase()
  // who: after the `#`; addresses from before that said it in the path (`/play/cdi/orbrun/dcss-0.34`, `/watch/cdi/bob`)
  const tagged = hash.length > 1 ? decode(hash.slice(1)) : null
  if ((what === 'login' || what === 'register') && rest.length <= 1) {
    const named = rest[0] ?? tagged
    return { kind: 'menu', path: what, serverId, ...(named ? { username: knownAccount(serverId, named)?.username ?? named } : {}) }
  }
  if (what === 'play' && (rest.length === 1 || rest.length === 2)) {
    const game = rest[rest.length - 1]
    const named = rest.length === 2 ? rest[0] : tagged
    const account = named ? knownAccount(serverId, named) : (chosenOn(serverId) ?? onlyAccountOn(serverId))
    // an account this device does not have, or no telling which: its login, to add it or pick
    if (!account) return { kind: 'menu', path: 'login', serverId, ...(named ? { username: named } : {}) }
    return { kind: 'play', account, gameId: server.offline ? deviceGameAt(game) : game }
  }
  // nobody else plays on this device
  if (what !== 'watch' || server.offline || rest.length > 1) return { kind: 'home' }
  const watched = rest[0] ?? tagged
  if (!watched) return { kind: 'lobby', serverId, account: chosenOn(serverId) }
  return { kind: 'watch', serverId, account: chosenOn(serverId), username: watched }
}

/** a path of names, each encoded whole: a space, `/`, `?`, `#` or `%` in one stays in it */
function pathOf(...parts: string[]): string {
  return '/' + parts.map(encodeURIComponent).join('/')
}

/** who, after the `#`, encoded whole as a path's names are */
function tagOf(name: string | undefined): string {
  return name ? '#' + encodeURIComponent(name) : ''
}

/**
 * The address for a route. The query is carried through unchanged: the flags
 * that live there (`?perf`, `?fullscreen`) are set once when the page is
 * opened — by a Steam shortcut's launch options, say — and a device with no
 * address bar could not put one back, so a Play must not drop them.
 */
export function formatRoute(r: Route): string {
  const q = window.location.search
  if (r.kind === 'home') return '/' + q
  if (r.kind === 'menu') return (r.serverId ? pathOf(...r.path.split('/'), r.serverId, ...(r.gameId ? [r.gameId] : []), ...(r.morgue ? [r.morgue] : [])) : '/' + r.path) + q + tagOf(r.serverId ? r.username : undefined)
  if (r.kind === 'lobby') return pathOf('watch', r.serverId) + q
  if (r.kind === 'watch') return pathOf('watch', r.serverId) + q + tagOf(r.username)
  const { serverId, username } = r.account
  return pathOf('play', serverId, serverId === OFFLINE_SERVER.id ? deviceGameAddress(r.gameId) : r.gameId) + q + tagOf(username)
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
 * Leave the app for one of the site's own pages (`/about`), carrying the
 * query as a Play does (formatRoute), so the flags set at launch come back
 * with the player. In a window of our own the page takes this one's place in
 * history rather than adding to it, as setRoute does, so Quit can still close
 * the window afterwards.
 */
export function openPage(path: string) {
  const next = path + window.location.search
  if (ownWindow()) window.location.replace(next)
  else window.location.assign(next)
}

/**
 * Put the route in the address bar. Neither push nor replace fires
 * `popstate`, so this never comes back through `applyRoute`; only the
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
  if (!ownWindow() && routeDepth(r) > routeDepth(parseRoute())) history.pushState(null, '', next)
  else history.replaceState(null, '', next)
  // a game names the tab after its character (main.ts updateTitle); every other screen after its page
  if (r.kind !== 'play' && r.kind !== 'watch') document.title = screenTitle(window.location.pathname)
}

/**
 * The title of a screen that is not a game. In a window of its own (an
 * installed app, a kiosk) the title bar names the app and nothing more; in a
 * tab it is the page's search headline (site.ts).
 */
export function screenTitle(pathname: string): string {
  return ownWindow() && !pageAt(pathname) ? HOME.name : titleAt(pathname)
}
