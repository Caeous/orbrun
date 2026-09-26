import { GAMEDATA_PROXY_PREFIX, MORGUE_PROXY_PREFIX, serveGamedata, serveMorgue } from '../gamedata-proxy'
import { MOVED, addressKind, pageAt } from '../src/site'

/**
 * orbrun.app: the static build, plus the gamedata proxy the browser cannot do
 * without and the morgue proxy the exit screen reads through (see
 * ../gamedata-proxy.ts for why and for the routes), and the offline engine's
 * files, handed to the orbrun-engine Worker as they are.
 *
 * Everything that is not a proxy path is handed to the static assets, so
 * `public/_headers` and `public/_redirects` (the `/deck` installer) keep
 * working. `run_worker_first` in wrangler.jsonc is what stops the asset
 * layer from answering /gamedata-proxy/* with index.html: that fallback is
 * exactly what used to reach the loader as `Unexpected token '<'`.
 *
 * Every other address comes here too (all but the hashed bundles and the
 * room's and Steam's pictures, wrangler.jsonc), so a search engine is told
 * the truth about it (`answerPage`).
 */
interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
  /** orbrun-engine (engine/wrangler.jsonc): the offline engine's files, at /engine/* */
  ENGINE: { fetch(request: Request): Promise<Response> }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/engine/')) return env.ENGINE.fetch(request)
    const morgue = url.pathname.startsWith(MORGUE_PROXY_PREFIX)
    if (!morgue && !url.pathname.startsWith(GAMEDATA_PROXY_PREFIX)) return answerPage(request, url, env)

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Max-Age': '86400',
        },
      })
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('method not allowed', { status: 405, headers: { Allow: 'GET, HEAD, OPTIONS' } })
    }

    // a morgue is read as it is: a character dump is rewritten on every save
    if (morgue) return (await serveMorgue(url.pathname)) ?? new Response('not found', { status: 404 })

    // versioned paths are immutable, so the edge cache is the whole story:
    // one fetch per file per colo, however many players are on that version
    // `caches.default` is the Workers runtime's own cache; the DOM's
    // CacheStorage type has no such member, hence the cast
    const cache = (caches as unknown as { default: Cache }).default
    const key = new Request(url.toString(), { method: 'GET' })
    const cached = await cache.match(key)
    if (cached) return cached

    const res = await serveGamedata(url.pathname)
    if (!res) return new Response('not found', { status: 404 })
    if (res.ok) await cache.put(key, res.clone())
    return res
  },
}

/**
 * The static assets' answer, with what a crawler should make of it. The
 * single-page fallback answers any address with the app, 200; that stays
 * what a person sees, but an address that is none of the app's (site.ts
 * addressKind) now says 404, so a mistyped or stale link is not indexed as
 * a copy of the home page. The app's own screens (a login, a game, a
 * spectate, settings) are the player's state, not pages: `noindex`. A file
 * (robots.txt, the favicon, the sitemap) is answered as it is.
 */
async function answerPage(request: Request, url: URL, env: Env): Promise<Response> {
  // a page has one address: `/About/New` or `/about/new/` is sent there for good, so it is never a second copy;
  // a page that moved (`/about/orbrun`, now part of `/about`) sends its old address on
  const moved = MOVED['/' + url.pathname.split('/').filter(Boolean).join('/').toLowerCase()]
  if (moved) return Response.redirect(new URL(moved + url.search, url).toString(), 301)
  const page = pageAt(url.pathname)
  if (page && url.pathname !== page.path) return Response.redirect(new URL(page.path + url.search, url).toString(), 301)
  const res = await env.ASSETS.fetch(request)
  const kind = addressKind(url.pathname)
  if (kind === 'page') return res
  const html = res.ok && (res.headers.get('Content-Type') ?? '').startsWith('text/html')
  if (!html) return res
  if (kind === 'app') {
    const out = new Response(res.body, res)
    out.headers.set('X-Robots-Tag', 'noindex')
    return out
  }
  const out = new Response(res.body, { status: 404, statusText: 'Not Found', headers: res.headers })
  out.headers.set('X-Robots-Tag', 'noindex')
  return out
}
