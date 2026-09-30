import { dataPoint, parseCount } from '../src/count-events'

/** Workers Analytics Engine's dataset binding; absent where it is not bound, and then nothing is kept. */
export interface EventsDataset {
  writeDataPoint(point: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void
}

/**
 * One of the app's event counts (count.ts sends it with `sendBeacon`, a
 * POST). Only what `parseCount` lets through is kept, and nothing of who
 * sent it: no address, no browser, no place. The one header read is
 * `Sec-GPC`, Global Privacy Control, and only to keep nothing: the app sends
 * no count under it, and one that comes anyway is dropped. Whatever came, the
 * answer is the same empty 204, so the endpoint tells a sender nothing either.
 */
export function countEvent(request: Request, url: URL, env: { EVENTS?: EventsDataset }): Response {
  const optedOut = request.headers.get('Sec-GPC') === '1'
  const row = request.method === 'POST' && !optedOut ? parseCount(url.searchParams) : null
  if (row && env.EVENTS) {
    try {
      env.EVENTS.writeDataPoint(dataPoint(row))
    } catch {
      // a count lost is only a count
    }
  }
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
}
