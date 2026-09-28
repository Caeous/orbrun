/**
 * The rc files of the players on this device: what `get_rc` reads and
 * `set_rc` writes (ws_handler.py), and what crawl is started with.
 *
 * A server keeps one file per account and rc directory, and its lobby says
 * which games share one (game_links.html `(edit rc)`). Here a profile has
 * one file for every version it plays: a new release is a new slot on this
 * device (channels `slotOf`), and the options a player wrote carry over to
 * it rather than starting again from nothing.
 */
export interface RcBook {
  /** The profile's rc file; empty when it has none, as a server reads a file that is not there. */
  read(profile: string): string
  write(profile: string, contents: string): void
}

const KEY = 'orbrun.offline.rc:'

/** Profiles match in any case, as accounts do. */
function keyOf(profile: string): string {
  return KEY + profile.toLowerCase()
}

/** Where crawl finds it: outside the save directory, so it is never written into a save's database. */
export const RC_PATH = '/rc/init.txt'

/** The RcBook of a browser: each file in `storage`. */
export function browserRcBook(storage: Storage = localStorage): RcBook {
  return {
    read(profile) {
      try {
        return storage.getItem(keyOf(profile)) ?? ''
      } catch {
        return ''
      }
    },
    write(profile, contents) {
      // a failed write throws: the client checks a save by reading it back, and must hear that it did not take
      if (contents) storage.setItem(keyOf(profile), contents)
      else storage.removeItem(keyOf(profile))
    },
  }
}

/** Forget a profile's rc file (deleteProfileSaves). */
export function forgetRc(profile: string, storage: Storage | undefined = globalThis.localStorage) {
  try {
    storage?.removeItem(keyOf(profile))
  } catch {}
}
