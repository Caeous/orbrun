import { fileKeys, profileDatabases } from './channels.js'

/**
 * The morgue files a profile's games left on this device. Crawl writes one
 * as a game ends (end.cc, `morgue-<name>-<date>-<time>.txt`) into the
 * `morgue/` directory under its save directory (initfile.cc `reset_paths`),
 * and IDBFS keeps every file under its full path in the slot's database, so
 * they read without an engine.
 */
export interface DeviceMorgue {
  /** the save database it is in: a slot's save directory (profileSaveDir) */
  db: string
  /** where it is in that database: `/crawl-0.34~kai/morgue/morgue-Kai-20261025-153000.txt` */
  path: string
}

const MORGUE_FILE = /\/morgue\/morgue-[^/]+-\d{8}-\d{6}\.txt$/

/** Every morgue file of `profile`'s, in every slot it has played in. */
export async function profileMorgues(profile: string, idb: IDBFactory = indexedDB): Promise<DeviceMorgue[]> {
  const dbs = await profileDatabases(profile, idb)
  const found = await Promise.all(dbs.map(async (db) => ((await fileKeys(idb, db)) ?? []).filter((k) => k.startsWith(db + '/morgue/') && MORGUE_FILE.test(k)).map((path) => ({ db, path }))))
  return found.flat()
}

/**
 * A file in a save database, as text. Null when the database or the file is
 * not there, or cannot be read: a database is never opened before it is
 * known to exist, since opening one that is not would make it.
 */
export async function readSaveFile(db: string, path: string, idb: IDBFactory = indexedDB): Promise<string | null> {
  if (!(await idb.databases()).some((d) => d.name === db)) return null
  return new Promise((resolve) => {
    const req = idb.open(db)
    req.onerror = () => resolve(null)
    req.onsuccess = () => {
      const d = req.result
      if (!d.objectStoreNames.contains('FILE_DATA')) {
        d.close()
        return resolve(null)
      }
      const get = d.transaction('FILE_DATA').objectStore('FILE_DATA').get(path)
      get.onsuccess = () => {
        d.close()
        // IDBFS keeps a file as { timestamp, mode, contents }, its bytes a typed array (MEMFS's own: an Int8Array)
        const contents = (get.result as { contents?: unknown } | undefined)?.contents
        resolve(ArrayBuffer.isView(contents) ? new TextDecoder().decode(contents) : null)
      }
      get.onerror = () => {
        d.close()
        resolve(null)
      }
    }
  })
}
