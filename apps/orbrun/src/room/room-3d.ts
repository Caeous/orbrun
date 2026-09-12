import { Render3d } from '@orbrun/render-3d'
import type { Camera, Scene } from '@orbrun/scene'
import { getSettings, type Settings } from '../servers'
import { antechamberScene } from './scene'
import { loadRoomTiles } from './tiles'

/**
 * The room's renderer: three.js and the level renderer, in the chunk the
 * game already loads them in. `RoomView` (view.ts) imports this lazily, so
 * the front end's first paint never waits on it.
 */
/** the room's own eye, for a build with no settings to read (tools/build/poster.mjs): the game's defaults */
export const ROOM_FOV = 80
export const ROOM_EYE_HEIGHT = 0.65

export class Room3d {
  private r: Render3d
  readonly scene: Scene
  readonly camera: Camera

  private constructor(canvas: HTMLCanvasElement, scene: Scene, camera: Camera, tiles: Awaited<ReturnType<typeof loadRoomTiles>>) {
    this.scene = scene
    this.camera = camera
    this.r = new Render3d(roomOptions(getSettings()))
    this.r.mount(canvas)
    this.r.setTiles(tiles)
    this.r.setScene(scene)
  }

  /** The room on `canvas`: its tiles fetched, its vault compiled, the renderer mounted. */
  static async create(canvas: HTMLCanvasElement): Promise<Room3d> {
    const tiles = await loadRoomTiles()
    const { scene, camera } = antechamberScene(tiles)
    return new Room3d(canvas, scene, camera, tiles)
  }

  resize(width: number, height: number, dpr: number) {
    this.r.resize(width, height, dpr)
  }

  /** The Camera settings, as the game would draw them: the settings screen shows its changes on the room behind it. */
  applySettings(st: Settings) {
    this.r.setOptions(roomOptions(st))
  }

  render(cam: Camera) {
    this.r.setCamera(cam)
    this.r.render()
  }

  destroy() {
    this.r.destroy()
  }
}

/** The renderer's options under `st`: first person always (there is no @ to stand behind), the eye and the lens as the player set them. */
function roomOptions(st: Settings) {
  return { view: 'first' as const, fov: st.fov ?? ROOM_FOV, eyeHeight: st.eyeHeight ?? ROOM_EYE_HEIGHT, viewmodel: false, motion: false }
}
