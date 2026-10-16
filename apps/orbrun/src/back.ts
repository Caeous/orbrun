/**
 * Android's back button, or its back gesture.
 *
 * Left to the browser, back is history: in the installed app there is none
 * (servers.ts setRoute only rewrites the address there), so back closed the
 * app, game and all, and in a tab it dropped a game for the home screen.
 * Here it is the pad's B instead, the way out of whatever is up, and over the
 * map, where B has nowhere to go, Save and exit (GameScreen.back). Only the
 * bare home screen lets it through, to leave the app as back leaves any other.
 *
 * Back reaches a page as a close request (HTML, "Close requests and close
 * watchers"), which goes to the newest CloseWatcher before it would go back
 * through history. A watcher answers one back and is gone, so another takes
 * its place; one at a time is always allowed, so a second back with no tap
 * between is answered too.
 *
 * Off Android nothing is installed: there Esc is the close request, and the
 * keyboard already has its own Escape.
 */

interface CloseWatcherLike {
  onclose: ((ev: Event) => void) | null
  destroy(): void
}

type CloseWatcherCtor = new () => CloseWatcherLike

/** a close request this soon after an Escape keydown is that key's own: Android falls back to back for an Esc nothing took */
const ESC_MS = 200

function isAndroid(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  return nav.userAgentData?.platform === 'Android' || /\bAndroid\b/.test(nav.userAgent)
}

/**
 * Answer back with `back` while `armed` says it has somewhere to go. Returns
 * the check to run whenever that may have changed (main.ts runs it every
 * tick); it runs itself after each back.
 */
export function installBack(
  armed: () => boolean,
  back: () => void,
  env: { CloseWatcher?: CloseWatcherCtor; android?: boolean } = {},
): () => void {
  const Watcher = env.CloseWatcher ?? (globalThis as { CloseWatcher?: CloseWatcherCtor }).CloseWatcher
  if (!Watcher || !(env.android ?? isAndroid())) return () => {}
  let watcher: CloseWatcherLike | null = null
  let escAt = -Infinity
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') escAt = performance.now()
  }, true)
  const sync = () => {
    const want = armed()
    if (want && !watcher) {
      try {
        const w = new Watcher()
        w.onclose = () => {
          if (watcher !== w) return
          watcher = null
          if (performance.now() - escAt > ESC_MS) back()
          sync()
        }
        watcher = w
      } catch {
        // a document on its way out refuses one; the next tick asks again
      }
    } else if (!want && watcher) {
      const w = watcher
      watcher = null
      w.destroy()
    }
  }
  return sync
}
