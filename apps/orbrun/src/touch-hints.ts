import type { Context } from './context'
import type { HintMode } from './gamepad-hints'

/**
 * The finger's lessons: what a tap on the stats pane (the menu) and on the
 * minimap (the level map) does, the two of the pad's buttons the touch bar
 * has no cell for (bindings.ts TOUCH_CELLS). A ring
 * stands on the thing itself with a word under it (hud.ts showTouchHints),
 * at quiet moments, each until its gesture has been seen to work.
 */
export type TouchLesson = 'menu' | 'map'
const LESSONS: readonly TouchLesson[] = ['menu', 'map']
const STORAGE_KEY = 'orbrun.touch-learning.v1'
const RESPONSE_WINDOW = 1500

export interface TouchHintEvidence {
  mode: Context['mode']
  clientOverlay: boolean
}

/** Device-wide, as the pad's: never attached to a character, server or run. */
export class TouchHints {
  private learned = new Set<TouchLesson>()
  private pending: { lesson: TouchLesson; before: TouchHintEvidence; at: number } | null = null

  constructor() {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
      if (Array.isArray(saved)) for (const id of LESSONS) if (saved.includes(id)) this.learned.add(id)
    } catch { /* unavailable or old/corrupt storage: teach normally */ }
  }

  knows(id: TouchLesson): boolean { return this.learned.has(id) }

  reset() {
    this.learned.clear()
    this.pending = null
    this.save()
  }

  private save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.learned])) } catch { /* session-only learning still works */ }
  }

  get waiting(): boolean { return this.pending !== null }

  /** The gesture was made; only what it opens (`observe`) teaches it. */
  attempt(lesson: TouchLesson, before: TouchHintEvidence, now: number) {
    if (this.knows(lesson)) return
    this.pending = { lesson, before, at: now }
  }

  observe(after: TouchHintEvidence, now: number) {
    const p = this.pending
    if (!p) return
    if (now - p.at > RESPONSE_WINDOW) { this.pending = null; return }
    const b = p.before
    const worked = p.lesson === 'menu' ? !b.clientOverlay && after.clientOverlay : b.mode !== 'levelmap' && after.mode === 'levelmap'
    if (!worked) return
    this.learned.add(p.lesson)
    this.save()
    this.pending = null
  }

  /**
   * The lessons to stand now: every one not yet learned, together, on the
   * map with nothing up and nothing hostile in sight, on Adaptive. Together
   * rather than in turns, so nothing changes on the screen by itself.
   */
  shown(ctx: Context, mode: HintMode, open: boolean): TouchLesson[] {
    if (mode !== 'adaptive' || ctx.mode !== 'command' || open || ctx.hostilesInView > 0) return []
    return LESSONS.filter((id) => !this.learned.has(id))
  }
}

let shared: TouchHints | undefined
export function touchHints(): TouchHints { return shared ??= new TouchHints() }
