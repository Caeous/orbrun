import { characterOf, type LastCharacter, type ServerInfo } from './servers'

/**
 * `<player>.where`: what the server itself says is waiting in a player's save.
 *
 * Crawl writes one of these per player into the morgue directory on every save and every exit
 * (chardump.cc `whereis_record`, from `update_whereis`: files.cc `save_game` writes "saved", end.cc writes the
 * exit reason — "dead", "won", "quit", "bailed out", "crash"), and dgamelaunch servers publish the morgue
 * directory. It is the only account-wide word on a save that a server keeps its `set_game_links` save info
 * from (CDI): the WebTiles socket cannot be asked, and this device's own memory is not evidence, since the
 * same account can be played out and killed from any other browser.
 *
 * One file per player, not per version — it is rewritten by whichever game ran last — so it answers for the
 * version named in `v` and says nothing about any other.
 */
export interface Whereis {
  /** the row this line answers for: "0.34" for a release, "trunk" for an alpha build (gameLinkRows' versions) */
  version: string | null
  /** the `status` field as crawl wrote it: "saved", "dead", "won", "quit", "bailed out", "crash", … */
  status: string
  character: LastCharacter
}

/**
 * One xlog line into its fields (hiscores.cc `xlog_fields::xlog_line`): `key=value` pairs separated by `:`,
 * with a literal colon in a value written `::` — which is how a place reaches us as `place=D::2`.
 */
export function parseXlog(line: string): Record<string, string> {
  const parts: string[] = []
  let cur = ''
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== ':') cur += line[i]
    else if (line[i + 1] === ':') (cur += ':', i++)
    else (parts.push(cur), cur = '')
  }
  parts.push(cur)
  const out: Record<string, string> = {}
  for (const p of parts) {
    const eq = p.indexOf('=')
    if (eq > 0) out[p.slice(0, eq)] = p.slice(eq + 1)
  }
  return out
}

/**
 * Which home-screen row a `v=` field belongs to: a trunk build carries an alpha marker ("0.35-a0-1015-g…"),
 * a release is its major and minor ("0.34.1-4-g…" is the "0.34" row), as `gameLinkRows` groups them.
 */
export function whereisVersion(v: string): string | null {
  if (/-a\d/.test(v)) return 'trunk'
  const m = /^(\d+\.\d+)/.exec(v)
  return m ? m[1] : null
}

/** Read a `.where` file. Null when it is not one (an error page, an empty file, a line without a character). */
export function parseWhereis(text: string): Whereis | null {
  const line = text.split('\n').find((l) => l.includes('status=') && l.includes('name='))
  if (!line) return null
  const f = parseXlog(line.trim())
  if (!f.name || !f.status) return null
  const species = [f.race, f.cls].filter(Boolean).join(' ')
  return {
    version: f.v ? whereisVersion(f.v) : null,
    status: f.status,
    character: characterOf({ username: f.name, char: species, xl: f.xl, place: f.place, title: f.title, god: f.god }),
  }
}

/**
 * Whether the line says a save is sitting there: crawl wrote it as it saved (files.cc "saved", end.cc's
 * `game_exit::save`). Every other status is not a yes — "dead", "won", "quit" and "bailed out" are a plain no,
 * and "crash", "abort" and "unknown" are nobody's word either way, which is the same thing as far as a row
 * that may only say what it knows is concerned.
 */
export function saveWaiting(w: Whereis): boolean {
  return w.status === 'saved' || w.status === 'save'
}

/**
 * Where a server keeps a player's morgue directory, as `game_ended`'s `dump` spells it: the path less the
 * file, e.g. "/crawl/morgue/caeo/". Null when the dump is not a path on the server.
 */
export function morgueDirOf(server: ServerInfo, dump: string): string | null {
  let u: URL
  try {
    u = new URL(dump, server.http)
  } catch {
    return null
  }
  if (u.host !== new URL(server.http).host) return null
  const cut = u.pathname.lastIndexOf('/')
  return cut > 0 ? u.pathname.slice(0, cut + 1) : null
}

/**
 * The directories to try for a player's morgue before a `game_ended` has named the real one: the layouts
 * dgamelaunch-config ships with (CDI keeps them under /crawl/, most servers at the root, CAO under /rawdata/).
 * The first that answers is remembered for the server (servers.ts `setMorgueDir`).
 */
export function morgueDirGuesses(username: string): string[] {
  const u = encodeURIComponent(username)
  return [`/crawl/morgue/${u}/`, `/morgue/${u}/`, `/rawdata/${u}/`]
}

/** The same-origin address of the `.where` file in a morgue directory, for the proxy (gamedata-proxy.ts). */
export function whereisUrl(server: ServerInfo, dir: string): string | null {
  const segs = dir.split('/').filter(Boolean)
  const who = segs[segs.length - 1]
  if (!who) return null
  let u: URL
  try {
    u = new URL(dir + who + '.where', server.http)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  return `/morgue-proxy/${u.host}${u.pathname}`
}
