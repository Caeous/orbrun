import { Render3d } from '@orbrun/render-3d'
import type { Camera } from '@orbrun/scene'
import { CHAMFER, getSettings, WALL_INSET, type Settings } from '../servers'
import { loadPlace, type LoadedPlace } from './places'

/**
 * The room's renderer: three.js and the level renderer, in the chunk the
 * game already loads them in. `RoomView` (view.ts) imports this lazily, so
 * the front end's first paint never waits on it. It draws one place at a
 * time (places.ts), with the walls the game builds, so a place looks as it
 * did in the game it was taken from.
 */
export class Room3d {
  private r: Render3d
  /** the place on show, once one is */
  place: LoadedPlace | null = null

  private constructor(canvas: HTMLCanvasElement) {
    this.r = new Render3d(roomOptions(getSettings()))
    this.r.mount(canvas)
  }

  /** The renderer on `canvas`, with nothing to draw until a place is shown. */
  static create(canvas: HTMLCanvasElement): Room3d {
    return new Room3d(canvas)
  }

  /** The place `id`, fetched (once) and handed to the renderer; the next render draws it. */
  async show(id: string): Promise<LoadedPlace> {
    const p = await loadPlace(id)
    if (this.place !== p) {
      this.place = p
      this.r.setTiles(p.tiles)
      this.r.setScene(p.scene, 0)
    }
    return p
  }

  resize(width: number, height: number, dpr: number) {
    this.r.resize(width, height, dpr)
  }

  /** The Camera settings, as the game would draw them: the settings screen shows its changes on the room behind it. */
  applySettings(st: Settings) {
    this.r.setOptions(roomOptions(st))
  }

  /** Draws a frame; whether the level still has building to do over the next ones (the renderer builds a big level a slice a frame). */
  render(cam: Camera): boolean {
    this.r.setCamera(cam)
    this.r.render(0)
    return this.r.animating
  }

  destroy() {
    this.r.destroy()
  }
}

/** The renderer's options under `st`: first person always (there is no @ to stand behind), the eye and the lens as the player set them, the walls as the game builds them. */
function roomOptions(st: Settings) {
  return { fov: st.fov, eyeHeight: st.eyeHeight, viewmodel: false, motion: false, wallInset: WALL_INSET, chamfer: CHAMFER }
}
