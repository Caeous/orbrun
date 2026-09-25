/**
 * orbrun-engine: engine/dist over HTTP, at /engine/<path> (how orbrun.app
 * forwards it) or at /<path> (the Worker's own address), the nightly start of
 * its own build, and an email when that build fails or publishes.
 *
 * The files under a commit never change meaning, so they are cached for good;
 * a channel's engine.json is what moves, so it is always asked again.
 */
interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
  /** The Workers Builds deploy hook that runs engine/ci.sh: a secret (`wrangler secret put DEPLOY_HOOK`), since whoever has it can start builds. */
  DEPLOY_HOOK?: string
  /** Sends from orbrun.app (Email Routing), to verified addresses only. */
  EMAIL: { send(message: { from: string; to: string; subject: string; text: string }): Promise<unknown> }
  /** Where build emails go: a secret (`wrangler secret put NOTIFY_EMAIL`), since the repo is public. */
  NOTIFY_EMAIL?: string
  /** When the running version was deployed: newer than a build's start means that build published. */
  VERSION: { id: string; timestamp: string }
}

/** A Workers Builds event, as the event subscription puts it on the queue. */
interface BuildEvent {
  type: string
  metadata: { accountId: string }
  payload: { buildUuid: string; runningAt?: string | null; createdAt: string; stoppedAt?: string | null }
}

const CHANNELS = ['stable', 'trunk']

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
  // Workers Builds events (the orbrun-engine-builds queue): one email per build
  // that failed, was canceled or published; a run with nothing new sends none
  async queue(batch: { messages: { body: BuildEvent }[] }, env: Env): Promise<void> {
    if (!env.NOTIFY_EMAIL) return
    for (const { body } of batch.messages) {
      const outcome = body.type.split('.').pop()
      const build = body.payload
      const started = build.runningAt ?? build.createdAt
      let subject: string
      if (outcome === 'failed' || outcome === 'canceled') {
        subject = `orbrun engine build ${outcome}`
      } else if (outcome === 'succeeded' && Date.parse(env.VERSION.timestamp) > Date.parse(started)) {
        const live = await Promise.all(CHANNELS.map(async (c) => {
          const res = await env.ASSETS.fetch(new Request(`https://engine/${c}/engine.json`))
          return res.ok ? `${c} ${((await res.json()) as { version: string }).version}` : `${c} none`
        }))
        subject = `orbrun engine published: ${live.join(', ')}`
      } else {
        continue
      }
      const minutes = build.stoppedAt ? Math.round((Date.parse(build.stoppedAt) - Date.parse(started)) / 60000) : undefined
      await env.EMAIL.send({
        from: 'engine@orbrun.app',
        to: env.NOTIFY_EMAIL,
        subject,
        text: [
          `${subject}.`,
          `Started ${started}${minutes === undefined ? '' : `, ${minutes} min`}.`,
          `Log: https://dash.cloudflare.com/${body.metadata.accountId}/workers/services/view/orbrun-engine/production/builds/${build.buildUuid}`,
        ].join('\n\n'),
      })
    }
  },
}
