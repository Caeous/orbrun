/**
 * orbrun-engine: engine/dist over HTTP, at /engine/<path> (how orbrun.app
 * forwards it) or at /<path> (the Worker's own address), and the nightly
 * start of its own build.
 *
 * The files under a commit never change meaning, so they are cached for good;
 * a channel's engine.json is what moves, so it is always asked again.
 */
interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
  /** The Workers Builds deploy hook that runs engine/ci.sh: a secret (`wrangler secret put DEPLOY_HOOK`), since whoever has it can start builds. */
  DEPLOY_HOOK?: string
}

const IMMUTABLE = /^\/(builds|gamedata)\/[0-9a-f]{40}\//

/**
 * Types Cloudflare compresses on the way out. crawl.data and prewarm.bin are
 * opaque bytes the engine reads whole, and as application/octet-stream they
 * would go out raw: 24 MB instead of about 5. application/x-protobuf is the
 * one binary type on Cloudflare's list.
 */
const TYPES: Record<string, string> = {
  '.wasm': 'application/wasm',
  '.data': 'application/x-protobuf',
  '.bin': 'application/x-protobuf',
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } })
    }
    const url = new URL(request.url)
    url.pathname = url.pathname.replace(/^\/engine(?=\/)/, '')
    const res = await env.ASSETS.fetch(new Request(url, request))
    if (!res.ok) return res

    const out = new Response(res.body, res)
    out.headers.set('Cache-Control', IMMUTABLE.test(url.pathname) ? 'public, max-age=31536000, immutable' : 'no-cache')
    const type = TYPES[/\.[^./]*$/.exec(url.pathname)?.[0] ?? '']
    if (type) out.headers.set('Content-Type', type)
    return out
  },

  // the crons in wrangler.jsonc: a run with nothing new ends in seconds (engine/plan.mjs)
  async scheduled(_event: unknown, env: Env): Promise<void> {
    if (!env.DEPLOY_HOOK) return
    const res = await fetch(env.DEPLOY_HOOK, { method: 'POST' })
    if (!res.ok) throw new Error(`deploy hook: HTTP ${res.status}`)
  },
}
