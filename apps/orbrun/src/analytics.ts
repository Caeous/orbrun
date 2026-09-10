/**
 * Cloudflare Web Analytics: the one beacon orbrun.app loads.
 *
 * It is here rather than in index.html so the tag only exists when there is a
 * token to put in it: an unset `%VITE_CF_BEACON_TOKEN%` placeholder would ship
 * to players as literal text in the HTML, and a beacon with no token is a
 * request that can only 400. The token itself is not a secret (Cloudflare's
 * own snippet puts it in the page source); it is a build-time variable so the
 * repo does not pin one deployment's site id.
 *
 * The script is loaded `defer`, after the app has its DOM, so measurement never
 * costs a frame of the game.
 */
const BEACON_SRC = 'https://static.cloudflareinsights.com/beacon.min.js'

function beaconToken(): string {
  const token = (import.meta.env.VITE_CF_BEACON_TOKEN as string | undefined) ?? ''
  return token.trim()
}

/**
 * Appends the beacon, once, when a token is configured and this is a real
 * build. Dev and preview servers stay out of the numbers.
 *
 * Returns the element it added, or null when it added nothing, so a test can
 * tell the difference.
 */
export function installAnalytics(doc: Document = document): HTMLScriptElement | null {
  if (import.meta.env.DEV) return null
  const token = beaconToken()
  if (!token) return null
  if (doc.querySelector(`script[src="${BEACON_SRC}"]`)) return null
  const script = doc.createElement('script')
  script.src = BEACON_SRC
  script.defer = true
  script.setAttribute('data-cf-beacon', JSON.stringify({ token }))
  doc.head.append(script)
  return script
}
