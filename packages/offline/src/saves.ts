import { saveFiles } from './channels.js'

/**
 * The save info a server's lobby shows beside a game (game_links.html
 * `save_info`), for the saves on this device.
 *
 * A server asks crawl (`-save-json`), which reads the character out of the
 * save itself. Here the save is only a file in IndexedDB, so the words come
 * from what crawl said while it played instead: a `*milestone` line (every
 * save, level change, experience level and god) carries the character's
 * xlog fields (hiscores.cc `update_whereis`), and the last one is kept for
 * the save directory the game ran in. Whether a character is waiting is the
 * save file's to say, not the note's: crawl deletes it when the character
 * dies, wins or quits.
 */
export interface SaveBook {
  /** Crawl sent a milestone from a game in `dir`. */
  note(dir: string, fields: Record<string, unknown>): void
  /** The save waiting in `dir`, as a server's lobby words it; null when there is none. */
  info(dir: string): Promise<string | null>
}

/**
 * A character the way a server's lobby names a save (player.cc
 * `player_save_info::short_desc`): "Kai, a level 3 Minotaur Berserker of
 * Trog". Null for a milestone that names no character yet (chargen's).
 */
export function saveDesc(f: Record<string, unknown>): string | null {
  const str = (k: string) => (typeof f[k] === 'string' ? (f[k] as string) : '')
  if (!str('name') || !str('xl') || !str('race')) return null
  return `${str('name')}, a level ${str('xl')} ${[str('race'), str('cls')].filter(Boolean).join(' ')}` + (str('god') ? ` of ${str('god')}` : '')
}

const KEY = 'orbrun.offline.save:'

/** The SaveBook of a browser: notes in `storage`, saves in `idb`. */
export function browserSaveBook(storage: Storage = localStorage, idb: IDBFactory = indexedDB): SaveBook {
  return {
    note(dir, fields) {
      const desc = saveDesc(fields)
      if (!desc) return
      try {
        storage.setItem(KEY + dir, desc)
      } catch {
        // a full or blocked storage loses the words, not the save
      }
    },
    async info(dir) {
      // only a database that is there: opening one that is not would make it
      if (!(await idb.databases()).some((d) => d.name === dir)) return null
      const files = await saveFiles(idb, dir)
      if (!files?.length) return null
      let desc: string | null = null
      try {
        desc = storage.getItem(KEY + dir)
      } catch {}
      // a save from before the words were kept: its name, from its file
      return desc ?? files[0].slice(files[0].lastIndexOf('/') + 1, -'.cs'.length)
    },
  }
}

/** Forget the notes of the save directories `mine` picks (deleteProfileSaves). */
export function forgetSaveNotes(mine: (dir: string) => boolean, storage: Storage | undefined = globalThis.localStorage) {
  if (!storage) return
  try {
    for (let i = storage.length - 1; i >= 0; i--) {
      const k = storage.key(i)
      if (k?.startsWith(KEY) && mine(k.slice(KEY.length))) storage.removeItem(k)
    }
  } catch {}
}
