import type { Render3d } from '@orbrun/render-3d'
import type { Gamedata } from '@orbrun/gamedata'

/**
 * The 3D view kept aside while the level map (X) has the screen.
 *
 * Opening the map swaps the 3D renderer for the 2D one and closing swaps
 * back. Made afresh each time, the 3D renderer paid for a new WebGL context,
 * its shaders, the atlas upload, the level's geometry and the whole crowd on
 * every close (`testbed/perf.ts` `transitions`). Parked instead, with its
 * canvas off the page, it comes back with all of that standing and only the
 * scene to sync.
 *
 * One slot, no more: the park holds at most one renderer, and whatever it
 * held before is destroyed when another is kept. The slot is cleared with
 * the screen, and by anything that makes the kept renderer wrong for the
 * screen it would return to (a change of renderer setting destroys the
 * outgoing view outright instead of parking it).
 */
export interface Parked {
  canvas: HTMLCanvasElement
  renderer: Render3d
  /** The tileset the renderer was given, so a return under new gamedata hands it the new one. */
  tiles: Gamedata | null
  /** The options it was built with, so a return under changed settings sets them again. */
  optionsKey: string
}

export class RendererPark {
  private slot: Parked | null = null

  /** Keep this renderer for the next return to 3D; one kept already is destroyed first. */
  keep(p: Parked): void {
    if (this.slot && this.slot !== p) this.slot.renderer.destroy()
    this.slot = p
  }

  /** The kept renderer, if any; the slot is empty afterwards. */
  take(): Parked | null {
    const p = this.slot
    this.slot = null
    return p
  }

  get held(): boolean {
    return this.slot !== null
  }

  /** Destroy whatever is kept. */
  clear(): void {
    this.slot?.renderer.destroy()
    this.slot = null
  }
}
