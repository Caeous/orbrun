import type { OfflineChannel } from './server.js'
import { forgetSaveNotes } from './saves.js'

/** A channel's engine.json (engine/build.sh, engine/pointer.mjs): the build it points at. */
export interface EngineInfo {
  channel: string
  commit: string
  /** crawl's own version string, `git describe`: `0.34.1-4-g0e95e087e2`, `0.35-a0-1079-ga0251cc2b5`. */
  version: string
  stamp: string
  gamedata: string
  /** Every file a device keeps to play the build, relative to the engine base, with its size in bytes. */
  files: [path: string, size: number][]
}

/** The release a build belongs to, `0.34`; null for trunk, or a version that names none. */
export function releaseOf(info: Pick<EngineInfo, 'channel' | 'version'>): string | null {
  return info.channel === 'trunk' ? null : (/^(\d+\.\d+)/.exec(info.version)?.[1] ?? null)
}

/**
 * What a build is played as on this device: `trunk`, or its release. Trunk
 * updates in place; a new release is a slot of its own beside the last one,
 * since crawl carries a save forward into a new release and never back.
 */
export function slotOf(info: Pick<EngineInfo, 'channel' | 'version'>): string {
  return releaseOf(info) ?? info.channel
}

/** Where a slot's saves are (engine/wasm/pre.js mounts it): the default profile's, and the stem of every other's. */
function slotSaveDir(slot: string): string {
  return `/crawl-${slot}`
}

/**
 * The lobby entry for a build. The label carries the version the client
 * sorts game rows by (webtiles `gameLinkRows`): `trunk` for trunk, the
 * release's major.minor for anything else.
 */
export function channelOf(info: EngineInfo): OfflineChannel {
  const slot = slotOf(info)
  const release = releaseOf(info)
  return {
    id: `offline-${slot}`,
    label: release ? `DCSS ${release}` : 'DCSS trunk',
    commit: info.commit,
    gamedata: info.gamedata,
    saveDir: slotSaveDir(slot),
  }
}

/** The profile a device starts with, which keeps its saves in the slot's own directory. */
export const DEFAULT_PROFILE = 'Player'

/**
 * Where a profile keeps its saves for a slot: a directory of its own, so
 * one profile's saved characters, high scores and morgues never show in
 * another's. IDBFS names its IndexedDB database after the directory, so
 * each is a database of its own too (deleteProfileSaves). Names match in any
 * case, as accounts do.
 */
export function profileSaveDir(slotDir: string, profile: string): string {
  const p = profile.toLowerCase()
  return p === DEFAULT_PROFILE.toLowerCase() ? slotDir : `${slotDir}~${p}`
}

/** The save databases on this device: one per slot and profile (profileSaveDir). */
async function saveDatabases(idb: IDBFactory): Promise<string[]> {
  return (await idb.databases()).map((d) => d.name ?? '').filter((n) => n.startsWith(slotSaveDir('')))
}

/**
 * Delete a profile's saves in every slot: the IndexedDB database each slot's
 * directory is (profileSaveDir), and what was noted of them (saves.ts).
 * Settles once every delete has, whether it went through or not; a database
 * still open elsewhere (a game in another tab) goes when that closes.
 */
export async function deleteProfileSaves(profile: string, idb: IDBFactory = indexedDB): Promise<void> {
  const p = profile.toLowerCase()
  const mine = (name: string) => {
    const at = name.indexOf('~')
    return p === DEFAULT_PROFILE.toLowerCase() ? at < 0 : at >= 0 && name.slice(at + 1) === p
  }
  forgetSaveNotes(mine)
  await Promise.all(
    (await saveDatabases(idb)).filter(mine).map(
      (name) =>
        new Promise<void>((resolve) => {
          const req = idb.deleteDatabase(name)
          req.onsuccess = req.onerror = req.onblocked = () => resolve()
        }),
    ),
  )
}

/**
 * Whether any profile has a character saved in a slot: a `.cs` file under
 * `saves/` in one of its databases (IDBFS keeps each file under its full
 * path, in `FILE_DATA`). A database that cannot be read counts as holding
 * one, so a slot is never dropped on a guess.
 */
export async function hasSaves(slot: string, idb: IDBFactory = indexedDB): Promise<boolean> {
  const stem = slotSaveDir(slot)
  const names = (await saveDatabases(idb)).filter((n) => n === stem || n.startsWith(stem + '~'))
  const found = await Promise.all(names.map((name) => holdsSave(idb, name)))
  return found.some(Boolean)
}

async function holdsSave(idb: IDBFactory, name: string): Promise<boolean> {
  const files = await saveFiles(idb, name)
  return files === null || files.length > 0
}

/**
 * The saved characters in one save directory's database: the `.cs` files
 * under `saves/`, by their full path. Null when the database cannot be read.
 */
export function saveFiles(idb: IDBFactory, name: string): Promise<string[] | null> {
  return new Promise((resolve) => {
    const req = idb.open(name)
    req.onerror = () => resolve(null)
    req.onsuccess = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('FILE_DATA')) {
        db.close()
        return resolve([])
      }
      const keys = db.transaction('FILE_DATA').objectStore('FILE_DATA').getAllKeys()
      keys.onsuccess = () => {
        db.close()
        resolve(keys.result.filter((k): k is string => typeof k === 'string' && /\/saves\/[^/]+\.cs$/.test(k)))
      }
      keys.onerror = () => {
        db.close()
        resolve(null)
      }
    }
  })
}

/** The channels engine/build.sh publishes, each an engine.json under the engine base. */
export const CHANNEL_NAMES = ['stable', 'trunk'] as const
