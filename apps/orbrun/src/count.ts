import { COUNT_PATH, SETTING_KEYS, countedHost, serverTag, settingParam, sideParam, versionTag, type CountedEvent } from './count-events'
import type { Settings } from './servers'

/**
 * The client half of the anonymous counts (count-events.ts has the rules both
 * halves keep): one beacon an event a page load, never in dev or on
 * workers.dev (count-events.ts `countedHost`), never under Global Privacy
 * Control, and never a failure the player could see.
 */
const sent = new Set<CountedEvent>()

/**
 * Where an event happened and how the game was set up: a server's id
 * (serverTag keeps it to the bundled ones), its game id (sent as stable or
 * trunk), the settings, whether a gamepad is connected (which the page
 * cannot tell on its own: a browser shows a pad only once a button is
 * pressed), and whether a finger is the pointer (a phone or a tablet, as the
 * app's touch layouts tell one: `pointer: coarse`).
 */
export interface CountWhere {
  server?: string
  game?: string | null
  settings?: Settings
  pad?: boolean
  touch?: boolean
}

/** The address one event is sent to, from a window `size` css px across and down. */
export function countUrl(event: CountedEvent, where: CountWhere = {}, size?: { width: number; height: number }): string {
  const q = new URLSearchParams({ e: event })
  if (where.server) q.set('s', serverTag(where.server))
  if (where.game) q.set('v', versionTag(where.game))
  if (where.pad) q.set('pad', '1')
  if (where.touch) q.set('touch', '1')
  const w = size && sideParam(size.width)
  const h = size && sideParam(size.height)
  if (w && h) {
    q.set('w', w)
    q.set('h', h)
  }
  if (where.settings) for (const key of SETTING_KEYS) {
    const v = settingParam(key, where.settings[key])
    if (v !== null) q.set(key, v)
  }
  return `${COUNT_PATH}?${q}`
}

/**
 * Whether the browser asks not to be measured: Global Privacy Control
 * (Brave's default, DuckDuckGo's, privacy extensions'). Then nothing is sent.
 */
export function optedOut(): boolean {
  try {
    return (navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl === true
  } catch {
    return false
  }
}

/** Count `event` once for this page load, on the first server and game it happened on; never when the browser has opted out. */
export function count(event: CountedEvent, where: CountWhere = {}): void {
  if (import.meta.env.DEV || sent.has(event) || optedOut() || !countedHost(location.hostname)) return
  sent.add(event)
  try {
    const touch = window.matchMedia?.('(pointer: coarse)').matches ?? false
    navigator.sendBeacon(countUrl(event, { ...where, touch }, { width: window.innerWidth, height: window.innerHeight }))
  } catch {
    // counting never gets in the way of the game
  }
}
