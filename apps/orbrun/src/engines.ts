import { EngineStore } from '@orbrun/offline'
import { ENGINE_BASE, offlineOffered } from './servers'

let busy: () => boolean = () => false

/** The offline engine builds kept on this device, and their updates (@orbrun/offline EngineStore). */
export const engines = new EngineStore({
  // no page to be relative to under node (the session tests), where nothing is kept anyway
  base: new URL(ENGINE_BASE + '/', typeof location === 'undefined' ? 'http://localhost/' : location.href).href,
  caches: typeof caches === 'undefined' ? undefined : caches,
  busy: () => busy(),
})

/**
 * Keep the offline engine on this device: the service worker that answers
 * the engine's requests from what is kept (public/sw.js), and what counts as
 * a game under way, which downloads wait for.
 */
export function keepEngines(gameUnderWay: () => boolean) {
  busy = gameUnderWay
  if (!offlineOffered() || !('serviceWorker' in navigator)) return
  navigator.serviceWorker.register(`/sw.js?base=${encodeURIComponent(ENGINE_BASE + '/')}`).catch(() => {})
}
