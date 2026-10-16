import { EngineStore } from '@orbrun/offline'
import { ENGINE_BASE, offlineOffered, offlineRuns } from './servers'

let busy: () => boolean = () => false
let atRest: () => boolean = () => false
/** the service worker is registered here, so there is a version to look for */
let kept = false
/** a new version took over this page while the player was busy: switched to when they are not */
let arrived = false
let lastLook = 0
/** how often an open page asks after a new version, beyond the browser's own look at each page load */
const LOOK_MS = 5 * 60_000
/** the longest the engine's downloads wait on a new version of the app installing */
const SETTLE_MS = 30_000
/** the look for a new version of the app at load, and its install if there is one */
let settled: Promise<void> = Promise.resolve()

/** Chromium's Network Information (not in lib.dom): what the device is connected by, and whether the player asked to save data. */
interface NetworkInformation extends EventTarget {
  readonly type?: string
  readonly saveData?: boolean
}

/** The device's connection, where the browser says what it is (Chromium on Android and ChromeOS); elsewhere nothing counts as metered. */
export const connection: NetworkInformation | undefined =
  typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { connection?: NetworkInformation }).connection

/** The offline engine builds kept on this device, and their updates (@orbrun/offline EngineStore). */
export const engines = new EngineStore({
  // no page to be relative to under node (the session tests), where nothing is kept anyway
  base: new URL(ENGINE_BASE + '/', typeof location === 'undefined' ? 'http://localhost/' : location.href).href,
  caches: typeof caches === 'undefined' ? undefined : caches,
  busy: () => busy(),
  // a phone on mobile data, or a player saving data: updates wait for Wi-Fi
  metered: () => connection?.type === 'cellular' || !!connection?.saveData,
})

/**
 * Keep Orbrun and the offline engine on this device: the service worker that
 * keeps the app, so it opens with no connection, and answers the engine's
 * requests from what is kept (public/sw.js), and what counts as a game under
 * way, which downloads wait for. Only where the engine runs: elsewhere the
 * app is no use offline.
 *
 * A new deploy installs in the background and would otherwise wait for the
 * load after next; instead the page switches to it as soon as it takes over,
 * if the player is resting on the home screen (`resting`), else the next
 * time they are (`updateApp`).
 */
export function keepEngines(gameUnderWay: () => boolean, resting: () => boolean) {
  busy = gameUnderWay
  atRest = resting
  if (!offlineOffered() || !offlineRuns() || !('serviceWorker' in navigator)) return
  const sw = navigator.serviceWorker
  const look = sw
    .register(`/sw.js?base=${encodeURIComponent(ENGINE_BASE + '/')}`)
    .then(async (r) => {
      // the browser looks for itself as the page loads (Chrome a second or two in, however early it is asked);
      // asking too is how the page hears that it has looked, and what it found
      if (sw.controller) await r.update()
      await installed(r.installing ?? r.waiting)
    })
    .catch(() => {})
  settled = Promise.race([look, new Promise<void>((done) => setTimeout(done, SETTLE_MS))])
  kept = true
  lastLook = Date.now()
  // a first install takes over a page that already runs its version: nothing new to switch to
  let controlled = !!sw.controller
  sw.addEventListener('controllerchange', () => {
    if (!controlled) {
      controlled = true
      return
    }
    arrived = true
    updateApp()
  })
}

/** Resolves once `w` is the version in use, or was passed over. */
function installed(w: ServiceWorker | null): Promise<void> {
  return new Promise((done) => {
    if (!w) return done()
    const look = () => (w.state === 'activated' || w.state === 'redundant') && done()
    w.addEventListener('statechange', look)
    look()
  })
}

/**
 * Resolves once the look for a new version of the app made at load is done,
 * and the version it found installed: the engine's downloads and the
 * gamedata warmed for Play wait on it, so a new version is not left sharing
 * the connection with them, and they are not fetched for a page about to
 * switch.
 */
export function appSettled(): Promise<void> {
  return settled
}

/**
 * On the home screen: switch to a version that arrived while the player was
 * busy, or ask whether there is one (no more than every few minutes), so a
 * page left open finds a deploy too.
 */
export function updateApp() {
  if (!kept) return
  if (arrived) {
    if (atRest() && !busy()) {
      arrived = false
      location.reload()
    }
    return
  }
  if (Date.now() - lastLook < LOOK_MS) return
  lastLook = Date.now()
  navigator.serviceWorker.getRegistration().then((r) => r?.update()).catch(() => {})
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
