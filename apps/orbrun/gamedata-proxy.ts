import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { ATLASES } from '@orbrun/gamedata'

/**
 * The one gamedata proxy, in two shells.
 *
 * WebTiles servers serve their version-specific gamedata (enums.js,
 * tileinfo-*.js, atlases) without CORS headers, so the browser cannot fetch
 * it directly: every shell needs something same-origin in front of it. The
 * route and the rules live here so dev, preview and production cannot drift;
 * `worker/index.ts` (Cloudflare) and `gamedataProxy()` (Vite) are only
 * adapters over `serveGamedata`.
 *
 * URL shape: /gamedata-proxy/<host>/gamedata/<version>/<file>
 * Upstream:  https://<host>/gamedata/<version>/<file>
 */
export const GAMEDATA_PROXY_PREFIX = '/gamedata-proxy/'

/**
 * The morgue proxy, the same shape for the same reason: a game's morgue
 * file or character dump (`game_ended` `dump`) is a plain-text file the
 * server publishes without CORS headers, and the exit screen shows it in
 * place rather than in a new tab.
 *
 * URL shape: /morgue-proxy/<host>/<path>.txt
 * Upstream:  https://<host>/<path>.txt
 */
export const MORGUE_PROXY_PREFIX = '/morgue-proxy/'

/**
 * What may be proxied. Not an allow-list of hosts: a player can add any
 * server (platforms.md "Server picker"), so the host stays open and the
 * *shape* is what is pinned. Only a hex version segment and only the file
 * names the loader asks for (@orbrun/gamedata `loadGamedata`) get through,
 * which leaves nothing here worth pointing at a host that is not a WebTiles
 * server.
 */
const GAMEDATA_FILES = new Set<string>([
  'enums.js',
  'status-icon-sizes.js',
  ...ATLASES.map((a) => `tileinfo-${a}.js`),
  ...ATLASES.map((a) => `${a}.png`),
])

const ROUTE = /^\/gamedata-proxy\/([^/@]+)\/gamedata\/([0-9a-f]+)\/([A-Za-z0-9_.-]+)$/

/** A hostname, optionally with a port: no userinfo, no path, no wildcards. */
const HOST = /^[A-Za-z0-9.-]+(:[0-9]{1,5})?$/

/**
 * A morgue path: plain segments, a `.txt` at the end and nothing else. Only
 * the extension is pinned, not the directory: servers keep their morgues
 * under different names (`/morgue/`, `/crawl/morgue/`, `/rawdata/`), and the
 * path comes from the server's own `game_ended` message.
 */
const MORGUE_ROUTE = /^\/morgue-proxy\/([^/@]+)\/((?:[A-Za-z0-9_.~-]+\/)*[A-Za-z0-9_.~-]+\.txt)$/

function validHost(host: string): boolean {
  return HOST.test(host) && !host.startsWith('.') && !host.endsWith('.')
}

/** The upstream URL a morgue proxy path names, or null if it is not one of ours. */
export function morgueUpstream(pathname: string): string | null {
  const m = MORGUE_ROUTE.exec(pathname)
  if (!m) return null
  const [, host, path] = m
  if (!validHost(host)) return null
  if (path.split('/').some((seg) => seg === '.' || seg === '..')) return null
  return `https://${host}/${path}`
}

/** The upstream URL a proxy path names, or null if it is not one of ours. */
export function gamedataUpstream(pathname: string): string | null {
  const m = ROUTE.exec(pathname)
  if (!m) return null
  const [, host, version, file] = m
  if (!validHost(host)) return null
  if (!GAMEDATA_FILES.has(file)) return null
  return `https://${host}/gamedata/${version}/${file}`
}

function contentType(file: string): string {
  return file.endsWith('.png') ? 'image/png' : 'text/javascript; charset=utf-8'
}

function corsHeaders(file: string): Record<string, string> {
  return {
    'Content-Type': contentType(file),
    // WebGL needs the atlases to be cross-origin clean; the app may also be
    // served from a different origin than the proxy in other shells.
    'Access-Control-Allow-Origin': '*',
    // versioned paths: a version's gamedata never changes
    'Cache-Control': 'public, max-age=31536000, immutable',
  }
}

/**
 * Serve one gamedata file, or null when the path is not a proxy path (the
 * caller then falls through to whatever else it serves).
 *
 * An upstream failure is passed through as a status, never as a body that
 * could be mistaken for JavaScript: a 200 with an HTML body is what makes
 * the loader throw `Unexpected token '<'`.
 */
export async function serveGamedata(pathname: string, fetchImpl: typeof fetch = fetch): Promise<Response | null> {
  const upstream = gamedataUpstream(pathname)
  if (!upstream) return null
  const file = pathname.slice(pathname.lastIndexOf('/') + 1)
  let r: Response
  try {
    r = await fetchImpl(upstream)
  } catch (e) {
    return new Response(`gamedata upstream unreachable: ${String(e)}`, {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
  if (!r.ok) {
    return new Response(`gamedata upstream ${r.status}`, {
      status: r.status === 404 ? 404 : 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
  const body = await r.arrayBuffer()
  return new Response(body, { status: 200, headers: corsHeaders(file) })
}

/**
 * Serve one morgue file as text, or null when the path is not a morgue
 * proxy path. A character dump is rewritten on every save, so nothing here
 * is immutable: a short cache is all it gets.
 */
export async function serveMorgue(pathname: string, fetchImpl: typeof fetch = fetch): Promise<Response | null> {
  const upstream = morgueUpstream(pathname)
  if (!upstream) return null
  let r: Response
  try {
    r = await fetchImpl(upstream)
  } catch (e) {
    return new Response(`morgue upstream unreachable: ${String(e)}`, {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
  if (!r.ok) {
    return new Response(`morgue upstream ${r.status}`, {
      status: r.status === 404 ? 404 : 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
  const body = await r.text()
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=300',
    },
  })
}

/**
 * Dev/preview middleware: the same proxies, in front of Vite's own serving.
 * Fetched gamedata is kept in memory so a reload is instant; a morgue is
 * fetched each time, as a dump changes with every save.
 */
export function gamedataProxy(): Plugin {
  const cache = new Map<string, { type: string; body: Buffer }>()
  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const pathname = (req.url || '').split('?')[0]
    if (pathname.startsWith(MORGUE_PROXY_PREFIX)) {
      const r = await serveMorgue(pathname)
      if (!r) return next()
      res.statusCode = r.status
      r.headers.forEach((v, k) => res.setHeader(k, v))
      res.end(Buffer.from(await r.arrayBuffer()))
      return
    }
    if (!pathname.startsWith(GAMEDATA_PROXY_PREFIX)) return next()
    if (!gamedataUpstream(pathname)) return next()
    const hit = cache.get(pathname)
    if (hit) {
      res.setHeader('Content-Type', hit.type)
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      res.end(hit.body)
      return
    }
    const r = await serveGamedata(pathname)
    if (!r) return next()
    const body = Buffer.from(await r.arrayBuffer())
    res.statusCode = r.status
    r.headers.forEach((v, k) => res.setHeader(k, v))
    if (r.ok) cache.set(pathname, { type: r.headers.get('Content-Type') || 'text/javascript', body })
    res.end(body)
  }
  return {
    name: 'orbrun-gamedata-proxy',
    configureServer(server) {
      server.middlewares.use(handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler)
    },
  }
}
