import type { Camera, Scene } from '@orbrun/scene'
import { makeCamera, REST_PITCH, yawToDir } from '@orbrun/scene'
import list from './places.json'
import { readScene, type PlaceFile } from './place-data'
import { RoomTiles } from './tiles'

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

/** A place loaded: the renderer's tiles, the level, and the eye it opens with. */
export interface LoadedPlace {
  id: string
  tiles: RoomTiles
  scene: Scene
  camera: Camera
}

const loads = new Map<string, Promise<LoadedPlace>>()

/** The place's file and its atlas, fetched once and kept for the next time a screen stands there. */
export function loadPlace(id: string): Promise<LoadedPlace> {
  let p = loads.get(id)
  if (!p) {
    p = (async () => {
      const [file, image] = await Promise.all([
        fetch(`/room/places/${id}.json`).then((r) => {
          if (!r.ok) throw new Error(`place ${id}: HTTP ${r.status}`)
          return r.json() as Promise<PlaceFile>
        }),
        loadImage(`/room/places/${id}.png`),
      ])
      if (file.format !== 1) throw new Error(`place ${id}: format ${String(file.format)} is not one this build reads`)
      return { id, tiles: RoomTiles.fromPlace(file, image), scene: readScene(file.scene), camera: placeCamera(file) }
    })()
    loads.set(id, p)
    p.catch(() => loads.delete(id))
  }
  return p
}

/** where the place's eye stands and looks, at the resting pitch */
export function placeCamera(file: Pick<PlaceFile, 'eye'>): Camera {
  const c = makeCamera(file.eye.x, file.eye.y)
  c.yaw = file.eye.yaw
  c.facing = yawToDir(c.yaw)
  c.pitch = REST_PITCH
  return c
}

function loadImage(url: string): Promise<TexImageSource> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`could not load ${url}`))
    img.src = url
  })
}
