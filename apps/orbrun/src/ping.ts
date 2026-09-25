import type { ServerInfo } from './servers'

/** how long a reading stands before the server list asks again */
const FRESH_MS = 60_000
/** a server that has not answered all three by then gets no figure: the list is not the place to say it is down */
const TIMEOUT_MS = 4_000

const readings = new Map<string, { at: number; ms: Promise<number | null> }>()

/**
 * A server's round trip in milliseconds, or null when it did not answer in
 * time. WebTiles has no ping a client can ask for (the server sends its own
 * and wants a pong), so this times an opaque HEAD to the server's web root,
 * following a redirect (no-cors allows nothing else; CBR2's root sends on
 * to port 8443): one to open the connection, then the best of two over it, so
 * DNS and TLS are not counted. The figure includes the server's time to
 * answer, which is small next to the line. Kept a minute, so redraws of the
 * list reuse it.
 */
export function pingServer(sv: ServerInfo, now = Date.now()): Promise<number | null> {
  const had = readings.get(sv.id)
  if (had && now - had.at < FRESH_MS) return had.ms
  const ms = measure(sv.http)
  readings.set(sv.id, { at: now, ms })
  // a failed reading is asked again the next time the list opens, not held for a minute
  void ms.then((v) => v === null && readings.get(sv.id)?.ms === ms && readings.delete(sv.id))
  return ms
}

async function measure(base: string): Promise<number | null> {
  const url = base.replace(/\/$/, '') + '/'
  const signal = AbortSignal.timeout(TIMEOUT_MS)
  const once = async () => {
    const t = performance.now()
    await fetch(url, { method: 'HEAD', mode: 'no-cors', cache: 'no-store', credentials: 'omit', signal })
    return performance.now() - t
  }
  try {
    await once()
    return Math.round(Math.min(await once(), await once()))
  } catch {
    return null
  }
}

