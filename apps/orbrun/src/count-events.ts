import servers from '../data/servers.json' with { type: 'json' }

/**
 * Anonymous counts of how people come to play, posted by the app (count.ts)
 * to orbrun.app's own `/api/e` and kept by its Worker (worker/index.ts) in
 * Workers Analytics Engine. Page views are Cloudflare Web Analytics'
 * (analytics.ts). Nothing is counted once a game is under way: a count is a
 * page load, a game started (with the settings it started on) or a spectate.
 *
 * Nothing names anyone. A row is an event from `EVENTS`, the server (one of
 * the bundled ones, this device, or `other`), stable or trunk, the window's
 * size, whether a pad was connected, and each of `COUNTED_SETTINGS`:
 * `parseCount` is the whole of what the Worker keeps of a beacon, and it drops
 * anything else. It never reads the address or the browser a beacon came from.
 * A browser that asks not to be measured (Global Privacy Control) is not, and
 * nor is a workers.dev address (`countedHost`).
 *
 * Each event counts once a page load, so a row is about a person, not a
 * reload's worth of games.
 */
export const EVENTS = ['boot', 'play', 'play-offline', 'spectate'] as const
export type CountedEvent = (typeof EVENTS)[number]

/** Where a beacon goes: a first-party path with nothing a blocklist looks for in it. */
export const COUNT_PATH = '/api/e'

/**
 * Whether events at `hostname` are counted. A `workers.dev` address is a
 * deployment's own (its preview and version links), seen by whoever is
 * testing it, so nothing is counted there.
 */
export function countedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return host !== 'workers.dev' && !host.endsWith('.workers.dev')
}

/**
 * The settings a game start carries, each with the stops its row offers
 * (settings-rows.ts; a test keeps the two the same). A setting of words is a
 * text column, one of its stops or `other` (an old saved value). A number or
 * a yes-or-no is a number column (yes 1, no 0), any value in its stops'
 * range, so an old saved value between two stops is kept as it is. Append
 * only: the order here is the order of the columns. The 2D view is not
 * offered (`VIEW_OPTIONS`), so it is not counted.
 */
export const COUNTED_SETTINGS = {
  eyeHeight: [0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9],
  restPitch: [-30, -25, -20, -15, -10, -5, 0, 5, 10],
  fov: [60, 70, 75, 85, 95],
  viewmodel: [true, false],
  leftRightKeys: ['turn', 'strafe'],
  leftRightPad: ['turn', 'strafe'],
  lookSensitivity: [1, 1.3, 1.6, 0.7],
  invertLook: [false, true],
  hints: ['adaptive', 'contextual', 'off'],
  uiScale: [1, 1.15, 1.3, 1.5, 0.85],
  nearby: ['list', 'pips'],
  minimapTiles: [0, ...Array.from({ length: 24 }, (_, i) => 15 + 2 * i)],
  minimapCell: [0, 8, 10, 12, 14, 16, 20, 24, 28, 32],
  minimapTurns: [true, false],
  rightStick: ['look', 'turn'],
} as const satisfies Record<string, readonly (number | boolean | string)[]>
export type CountedSetting = keyof typeof COUNTED_SETTINGS
export const SETTING_KEYS = Object.keys(COUNTED_SETTINGS) as CountedSetting[]

const isWords = (k: CountedSetting) => typeof COUNTED_SETTINGS[k][0] === 'string'
/** The settings kept as text: words. */
export const WORD_SETTINGS = SETTING_KEYS.filter(isWords)
/** The settings kept as numbers: numbers, and yes-or-no as 1 or 0. */
export const NUMBER_SETTINGS = SETTING_KEYS.filter((k) => !isWords(k))

/** The range a number setting may be kept in: its stops', or 0 to 1 for a yes-or-no. */
function range(k: CountedSetting): [number, number] {
  const stops = COUNTED_SETTINGS[k].map(Number)
  return [Math.min(...stops), Math.max(...stops)]
}

/** How one setting's value is sent, or null when it is out of what a row keeps (then it is left out). */
export function settingParam(key: CountedSetting, value: unknown): string | null {
  if (isWords(key)) return (COUNTED_SETTINGS[key] as readonly unknown[]).includes(value) ? String(value) : 'other'
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const [min, max] = range(key)
  const v = Math.round(value * 100) / 100
  return v < min || v > max ? null : String(v)
}

/**
 * The servers a row may name. A server added by hand is `other`: its address
 * is whatever the player typed, which may be their own.
 */
export const SERVER_IDS: readonly string[] = [...(servers as { id: string }[]).map((s) => s.id), 'offline', 'other']

/** The server a row names for `id`. */
export function serverTag(id: string): string {
  return SERVER_IDS.includes(id) ? id : 'other'
}

/** What a game is: a release (`dcss-0.34`, `spr-0.33`), trunk (`dcss-git`, `seeded-git`, `dcss-web-trunk`), or neither. */
export const VERSIONS = ['stable', 'trunk', 'other'] as const

/** The version a row names for a server's game id. Which release it is, is not counted. */
export function versionTag(gameId: string): string {
  if (/(^|[-_.])(git|trunk)($|[-_.])/.test(gameId)) return 'trunk'
  if (/\d+\.\d+/.test(gameId)) return 'stable'
  return 'other'
}

/** The largest window side a row keeps, in css px. */
export const MAX_SIDE = 10000

/** A window side as sent: css px to the nearest ten, so zoom and a resize's odd pixels gather on the sizes people use. */
export function sideParam(px: number): string | null {
  if (!Number.isFinite(px) || px <= 0) return null
  return String(Math.min(MAX_SIDE, Math.round(px / 10) * 10))
}

/**
 * The dataset's columns by name: Analytics Engine numbers them (blob1…,
 * double1…), in this order. Append only: a column moved is every old row
 * misread. tools/build/counts.mjs queries by these names. A setting is only
 * on a game start's row; on the others it is empty, or 0.
 */
export const BLOB_COLUMNS: readonly string[] = ['event', 'server', 'version', ...WORD_SETTINGS]
export const DOUBLE_COLUMNS: readonly string[] = ['pad', 'width', 'height', ...NUMBER_SETTINGS]

/** A row as the Worker writes it: every column by name, empty or 0 where the beacon did not say. */
export interface CountRow {
  event: CountedEvent
  text: Record<string, string>
  numbers: Record<string, number>
}

/** A row as Analytics Engine's `writeDataPoint` takes it, in the column order above. */
export function dataPoint(row: CountRow): { blobs: string[]; doubles: number[]; indexes: string[] } {
  return {
    blobs: BLOB_COLUMNS.map((c) => row.text[c] ?? ''),
    doubles: DOUBLE_COLUMNS.map((c) => row.numbers[c] ?? 0),
    indexes: [row.event],
  }
}

const KEYS: readonly string[] = ['e', 's', 'v', 'pad', 'w', 'h', ...SETTING_KEYS]
const NUMBER_RE = /^-?\d{1,5}(\.\d{1,2})?$/

/** What is kept of a beacon's query, or null when any of it is anything but what a row may hold. */
export function parseCount(search: URLSearchParams): CountRow | null {
  for (const key of search.keys()) if (!KEYS.includes(key)) return null
  const event = search.get('e') ?? ''
  const server = search.get('s')
  const version = search.get('v')
  const pad = search.get('pad')
  if (!(EVENTS as readonly string[]).includes(event)) return null
  if (server !== null && !SERVER_IDS.includes(server)) return null
  if (version !== null && !(VERSIONS as readonly string[]).includes(version)) return null
  if (pad !== null && pad !== '1') return null
  const text: Record<string, string> = { event, server: server ?? '', version: version ?? '' }
  const numbers: Record<string, number> = { pad: pad === '1' ? 1 : 0 }
  for (const [param, column] of [['w', 'width'], ['h', 'height']] as const) {
    const v = search.get(param)
    if (v === null) continue
    if (!/^\d{1,5}$/.test(v) || Number(v) > MAX_SIDE) return null
    numbers[column] = Number(v)
  }
  for (const key of WORD_SETTINGS) {
    const v = search.get(key)
    if (v === null) continue
    if (v !== 'other' && !COUNTED_SETTINGS[key].map(String).includes(v)) return null
    text[key] = v
  }
  for (const key of NUMBER_SETTINGS) {
    const v = search.get(key)
    if (v === null) continue
    const [min, max] = range(key)
    if (!NUMBER_RE.test(v) || Number(v) < min || Number(v) > max) return null
    numbers[key] = Number(v)
  }
  return { event: event as CountedEvent, text, numbers }
}
