/**
 * Leaving the app, for the players who have no tab to close.
 *
 * Orbrun ships as a web page, so most of the time the browser already has a
 * way out and a Quit row would be noise. Two places it does not: a kiosk
 * browser launched from Steam (STEAM.md), which on a Deck in Gaming Mode has
 * no chrome at all, and an installed web app in its own window.
 */

/** the display modes that mean a window of our own, rather than a tab among others */
const OWN_WINDOW = ['fullscreen', 'standalone', 'minimal-ui', 'window-controls-overlay']

/**
 * `?fullscreen` in the address: treat the page as a window of its own however
 * the browser describes itself, so the Quit row can be seen in an ordinary
 * tab. It is read fresh each time rather than kept, and the routes carry the
 * query along (servers.ts formatRoute), so it lasts as long as the address
 * does and `?fullscreen=0`, or dropping it, is the way back. The row is all
 * it changes: a page cannot put itself full screen without being asked to.
 */
function forced(): boolean {
  try {
    const q = new URLSearchParams(window.location.search)
    return q.has('fullscreen') && q.get('fullscreen') !== '0'
  } catch {
    return false
  }
}

/**
 * Whether to offer a way out: the page is standing on its own, in a kiosk
 * browser (`--kiosk` reports `display-mode: fullscreen`) or an installed web
 * app (`standalone`, and iOS's own `navigator.standalone`). A page in an
 * ordinary tab says no: the tab's own X is right there, and it is the
 * browser's window, not ours, to close.
 */
export function canQuit(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  if (forced()) return true
  if ((navigator as { standalone?: boolean }).standalone === true) return true
  return OWN_WINDOW.some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches)
}

/** how long to wait for the window to go before deciding the browser refused */
const CLOSE_MS = 300

/**
 * Close the window. A browser only lets a script close what a script opened,
 * or the single window of a kiosk session, and it refuses without a word —
 * so a window still there a moment later is a refusal, and `onRefused` says
 * so rather than leaving a dead row behind. Nothing to save on the way: the
 * game lives on the server, which keeps it across a dropped socket as it does
 * for any other disconnect.
 */
export function quit(onRefused?: () => void): void {
  window.close()
  if (!onRefused) return
  setTimeout(() => {
    if (!window.closed) onRefused()
  }, CLOSE_MS)
}
