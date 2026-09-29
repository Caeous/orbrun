import { EngineStore } from '@orbrun/offline'
import { ENGINE_BASE, offlineOffered, offlineRuns } from './servers'

let busy: () => boolean = () => false

/** The offline engine builds kept on this device, and their updates (@orbrun/offline EngineStore). */
export const engines = new EngineStore({
  // no page to be relative to under node (the session tests), where nothing is kept anyway
  base: new URL(ENGINE_BASE + '/', typeof location === 'undefined' ? 'http://localhost/' : location.href).href,
  caches: typeof caches === 'undefined' ? undefined : caches,
  busy: () => busy(),
})

/**
 * Keep Orbrun and the offline engine on this device: the service worker that
 * keeps the app, so it opens with no connection, and answers the engine's
 * requests from what is kept (public/sw.js), and what counts as a game under
 * way, which downloads wait for. Only where the engine runs: elsewhere the
 * app is no use offline.
 */
export function keepEngines(gameUnderWay: () => boolean) {
  busy = gameUnderWay
  if (!offlineOffered() || !offlineRuns() || !('serviceWorker' in navigator)) return
  navigator.serviceWorker.register(`/sw.js?base=${encodeURIComponent(ENGINE_BASE + '/')}`).catch(() => {})
}

/**
 * Ask the browser to keep this device's games when it runs short of space:
 * the saves and the engine are otherwise the first things it clears. Chrome
 * answers without asking the player.
 */
export function keepSaves() {
  if (typeof navigator === 'undefined') return
  navigator.storage?.persist?.().catch(() => {})
}
