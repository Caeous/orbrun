import type { Mode } from './context'

/** How long the map waits on the screen a key leaves it for, as the runner's `awaitPrompt` waits on a prompt. */
const PATIENCE_MS = 1500

/**
 * The level map, kept on screen across a key that leaves it for a screen of
 * the main view's (bindings.ts `offMap`: the stash search, travel, the
 * overview). Crawl closes the map first, then opens the next screen; between
 * the two the view would cut to the dungeon and back. Held, the map stays
 * drawn under the search prompt and its results until crawl brings its own
 * map back (a search result, picked, opens it at the find) or the player is
 * back in the dungeon: the next screen put away, or none came.
 */
export class MapHold {
  private hold: { until: number; opened: boolean } | null = null

  begin(now: number) {
    this.hold = { until: now + PATIENCE_MS, opened: false }
  }

  /** Whether the map shows now: crawl's own, or the one held. `mode` is the context's, from the state just in. */
  shown(mapOpen: boolean, mode: Mode, now: number): boolean {
    const h = this.hold
    if (!h) return mapOpen
    // still the map: the Escape has not landed yet, or crawl's map is back
    if (mode === 'levelmap') {
      if (h.opened) this.hold = null
      return true
    }
    if (mode !== 'command') h.opened = true
    else if (h.opened || now > h.until) {
      this.hold = null
      return mapOpen
    }
    return true
  }
}
