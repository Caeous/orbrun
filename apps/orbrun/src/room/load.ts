import type { Camera, Scene } from '@orbrun/scene'
import { placeCamera } from '@orbrun/room/places'
import { readScene, type PlaceFile } from '@orbrun/room/place-data'
import { RoomTiles } from '@orbrun/room/tiles'

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

function loadImage(url: string): Promise<TexImageSource> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`could not load ${url}`))
    img.src = url
  })
}
