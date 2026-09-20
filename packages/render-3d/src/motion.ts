import type { Billboard } from '@orbrun/scene'

/**
 * Monsters glide between cells the way the player does.
 *
 * The camera keeps the cell the feet are on apart from the place the eye is
 * drawn, and eases the one after the other (app `CameraController.walkTo`).
 * A monster has no such pair: the server tells us where it stands now, and
 * the renderer stands it there. This holds the missing half — where a monster
 * was a moment ago — so the sprite can be drawn between the two while it
 * catches up with its cell.
 *
 * WebTiles sends no "this monster moved" message: a step arrives as the cell
 * it left losing its monster and the cell it entered gaining one. The two are
 * the same monster when they carry the same client id (crawl's
 * `monster_info::client_id`, on the billboard's `ref`), which is what a move
 * is read from here.
 *
 * Only a single step glides. Anything further — a blink, a teleport, a fast
 * monster given two moves in one update, or a rest or travel that resolves
 * many turns before the client draws again — snaps, exactly as the camera
 * snaps rather than gliding a jump.
 */

/**
 * Seconds a step takes, the camera's `WALK_SECONDS`: a monster stepping
 * beside the player lands as the player does.
 */
export const STEP_SECONDS = 0.18

/**
 * How long a monster the scene stopped carrying keeps its last place, in
 * seconds. A step can arrive split over two updates — the old cell cleared in
 * one, the new cell filled in the next — and the monster is on no cell in
 * between; a short memory glides that as one step rather than dropping it.
 * Long enough for a split update, far short of a monster that left the
 * player's sight and came back. It is the only place a clock decides
 * anything: a monster the scene keeps carrying glides its next step however
 * long it stood still first, since a monster nothing is happening to gets no
 * updates at all.
 */
const MEMORY_SECONDS = 0.5

/** Where a monster stood, when the scene last carried it there, and whether it has since dropped off the scene. */
interface Seen {
  x: number
  y: number
  at: number
  gone: boolean
}

/** A step under way: the place it left, the cell it is bound for, and when it started. */
interface Mover {
  fromX: number
  fromY: number
  toX: number
  toY: number
  start: number
}

/** How far a sprite stands from the cell it is on, in cells; zero once it has landed. */
export interface Offset {
  x: number
  y: number
}

export class Movers {
  private seen = new Map<number, Seen>()
  private moving = new Map<number, Mover>()

  /**
   * Read the scene's monsters against the last one's: every id that changed
   * cell by a single step starts a glide from where it was, and every other
   * change of place snaps. A step begun while one is still under way carries
   * the place the sprite is drawn at into the new one, so a monster walking
   * cell after cell flows instead of restarting at each.
   */
  track(billboards: readonly Billboard[], now: number): void {
    const here = new Set<number>()
    for (const b of billboards) {
      if (b.kind !== 'monster') continue
      const id = monsterId(b)
      if (id === undefined || here.has(id)) continue
      here.add(id)
      const was = this.seen.get(id)
      this.seen.set(id, { x: b.x, y: b.y, at: now, gone: false })
      if (!was || (was.x === b.x && was.y === b.y)) continue
      const step = Math.max(Math.abs(b.x - was.x), Math.abs(b.y - was.y))
      // a step it was away for is only a step while the gap is short enough to be one update split in two
      if (step !== 1 || (was.gone && now - was.at > MEMORY_SECONDS)) {
        this.moving.delete(id)
        continue
      }
      const o = this.offset(id, now)
      this.moving.set(id, { fromX: was.x + (o?.x ?? 0), fromY: was.y + (o?.y ?? 0), toX: b.x, toY: b.y, start: now })
    }
    for (const [id, s] of this.seen) {
      if (here.has(id)) continue
      // gone from the scene: nothing to draw, but its place is kept a moment in case the step was split across updates
      this.moving.delete(id)
      s.gone = true
      if (now - s.at > MEMORY_SECONDS) this.seen.delete(id)
    }
  }

  /** Whether `id` is mid-step: its sprite is drawn between cells and so cannot be baked into the crowd. */
  flying(id: number | undefined): boolean {
    return id !== undefined && this.moving.has(id)
  }

  /** Where `id`'s sprite stands relative to its cell right now, or null when it stands on it. */
  offset(id: number | undefined, now: number): Offset | null {
    if (id === undefined) return null
    const m = this.moving.get(id)
    if (!m) return null
    const t = Math.min(1, Math.max(0, (now - m.start) / STEP_SECONDS))
    // the camera's landing curve with no speed carried in (`glide`): away from the old cell, to a stop on the new one
    const k = 1 - t * t * (3 - 2 * t)
    if (k === 0) return { x: 0, y: 0 }
    return { x: (m.fromX - m.toX) * k, y: (m.fromY - m.toY) * k }
  }

  /**
   * The ids whose step is over, taken out of the list as they are reported:
   * their sprites stand on their cells again and belong back in the baked
   * crowd.
   */
  landed(now: number): number[] {
    const out: number[] = []
    for (const [id, m] of this.moving) {
      if (now - m.start < STEP_SECONDS) continue
      this.moving.delete(id)
      out.push(id)
    }
    return out
  }

  /** Whether anything is mid-step, so the host keeps drawing frames. */
  get active(): boolean {
    return this.moving.size > 0
  }

  /** Forget every monster: a new level, or a renderer whose crowd was dropped. */
  clear(): void {
    this.seen.clear()
    this.moving.clear()
  }
}

/** Crawl's client id for the monster a billboard was built from, where it has one. */
export function monsterId(b: Billboard): number | undefined {
  const id = (b.ref as { id?: number } | undefined)?.id
  return typeof id === 'number' ? id : undefined
}
