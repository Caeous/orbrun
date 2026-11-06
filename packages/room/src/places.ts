import type { Camera } from '@orbrun/scene'
import { makeCamera, REST_PITCH, yawToDir } from '@orbrun/scene'
import list from './places.json'
import type { PlaceFile } from './place-data'

/**
 * The places the front end stands in (place-data.ts): moments of real
 * games, frozen by the film tooling (tools/build/places.mjs, on the
 * film-record branch) and listed in
 * places.json. The front screen stands in the next of the `cycle` each time
 * the front end opens, so every visit is somewhere else. The screens off it
 * (What's new, the account's, Settings, Watch) stand in stills of their own
 * over it (menu.ts Backdrop).
 */
export type Tint = 'depths' | 'abyss' | 'lair' | 'dungeon' | 'shoals' | 'zot' | 'spider'

export interface PlaceEntry {
  id: string
  /** where the game stood, for the room's label */
  place: string
  /** the veil laid over the place so the menus read on it (styles.css `.room-veil`) */
  tint: Tint
  /** the front screen stands in it, in its turn */
  cycle?: boolean
  /**
   * An open level (the Shoals: sky and no walls round it) known only in part:
   * no spot on it sees no void, so the eye stands where it sees least and
   * opens facing away from it
   */
  openLevel?: boolean
}

export const PLACES: readonly PlaceEntry[] = list as PlaceEntry[]
const CYCLE = PLACES.filter((p) => p.cycle)

export function placeById(id: string): PlaceEntry | undefined {
  return PLACES.find((p) => p.id === id)
}


const TURN_KEY = 'orbrun.roomPlace'

/**
 * The place this visit of the front screen stands in: the one after last
 * visit's, round the cycle. Remembered on the device only as a convenience;
 * with no storage every visit starts at a place of its own anyway.
 */
export function nextHomePlace(): PlaceEntry {
  let last = -1
  try {
    const i = CYCLE.findIndex((p) => p.id === localStorage.getItem(TURN_KEY))
    last = i >= 0 ? i : Math.floor(Math.random() * CYCLE.length) - 1
  } catch {
    last = Math.floor(Math.random() * CYCLE.length) - 1
  }
  const next = CYCLE[(last + 1) % CYCLE.length]
  try {
    localStorage.setItem(TURN_KEY, next.id)
  } catch {
    /* no storage: the next visit picks again */
  }
  return next
}

/** where the place's eye stands and looks, at the resting pitch */
export function placeCamera(file: Pick<PlaceFile, 'eye'>): Camera {
  const c = makeCamera(file.eye.x, file.eye.y)
  c.yaw = file.eye.yaw
  c.facing = yawToDir(c.yaw)
  c.pitch = REST_PITCH
  return c
}
