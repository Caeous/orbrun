import { MSGCH, type GameMessage, type GameState } from '@orbrun/webtiles'
import { blocksExplore, cellKey, monstersInView, nearestOf, type Billboard, type CellKey, type Scene } from '@orbrun/scene'

/**
 * The server's own word on why a walk stopped or was refused, read from the
 * message log (rendering-3d.md III.2). Two kinds of line name a monster:
 *
 * - `MSGCH_MONSTER_WARNING` (31): `player-notices.cc _handle_encounter_messages`
 *   prints "You encounter X." for newly seen monsters, several as a list ("a
 *   hydra and 2 liches"), sometimes followed by another sentence about what
 *   it carries. `delay.cc monster_interrupt_message` prints "X comes into
 *   view." for a known monster that stops a delay, or "X is now too close for
 *   your liking." when it was already in view.
 * - `MSGCH_WARN` (6): `nearby-danger.cc i_feel_safe` refuses explore, travel
 *   and rest with "X is nearby!" when exactly one monster blocks. With several
 *   it says "There are monsters nearby!" and names nobody; an unseen invisible
 *   one is "X is probably nearby!" and has no cell to face.
 *
 * Crawl joins short consecutive messages onto one line, so every sentence of
 * a line is tried.
 */
export function namedInWarnings(lines: readonly GameMessage[]): string[] {
  const out: string[] = []
  for (const l of lines) {
    if (l.channel !== MSGCH.MONSTER_WARNING && l.channel !== MSGCH.WARN) continue
    for (const s of sentences(stripTags(l.text))) {
      if (l.channel === MSGCH.MONSTER_WARNING) {
        const enc = /^You encounter (.+)\.$/.exec(s)
        if (enc) {
          out.push(...splitList(enc[1]))
          continue
        }
        const seen = /^(.+?) (?:comes into view|is now too close for your liking)\.$/.exec(s)
        if (seen) out.push(seen[1])
      } else {
        const near = /^(.+?) is nearby!$/.exec(s)
        if (near && !/ is probably nearby!$/.test(s)) out.push(near[1])
      }
    }
  }
  return out
}

/**
 * The monster in view a warning names: matched on the server's own `name`
 * (`tileweb.cc _send_monster` sends `monster_info::full_name`) or `plural`,
 * with the article and count the message added taken off. Several matches
 * (two goblins, or a list) resolve to the nearest, a hostile before a neutral
 * at the same distance. Null when no name matches, so the caller can fall back
 * to the nearest blocker.
 */
export function namedMonster(scene: Scene, names: readonly string[]): Billboard | null {
  const wanted = new Set(names.map(bareName).filter(Boolean))
  if (!wanted.size) return null
  const hits = monstersInView(scene).filter((b) => {
    const ref = b.ref as { name?: string; plural?: string } | undefined
    if (!ref) return false
    return wanted.has((ref.name || '').toLowerCase()) || wanted.has((ref.plural || '').toLowerCase())
  })
  return nearestOf(scene, hits, (b) => (blocksExplore(b) ? 0 : 1) + (b.attitude === 'neutral' ? 1 : 0))
}

/**
 * The lines that arrived since `last` was the newest. When `last` is gone
 * (rolled back by the server, or nothing has been read yet) the lines of the
 * current `turn` stand in, so a warning is never lost and never older than
 * the turn it belongs to.
 */
export function linesSince(lines: readonly GameMessage[], last: GameMessage | undefined, turn: number): GameMessage[] {
  const i = last === undefined ? -1 : lines.lastIndexOf(last)
  if (i >= 0) return lines.slice(i + 1)
  return lines.filter((l) => l.turn === turn)
}

/**
 * Whether `o` would only say again that there is nowhere left to go. Crawl
 * says so when an explore finds no target (travel.cc
 * `_explore_find_target_square`): "Done exploring.", or "Partly explored, …"
 * for a door it will not open, a transporter, or a place or an item out of
 * reach, both on MSGCH_PLAIN. Explore heads for ground never seen and the
 * items it is greedy for, so the word holds until the level could offer
 * either: another level, ground the map did not have (a door opened onto it,
 * a magic map), or an item where none lay. A guess past that (an exclusion
 * lifted, flight over the water), so Explore is dimmed, not taken away: the
 * tap still goes to crawl, which has the last word.
 */
export class ExploreDone {
  private last: GameMessage | undefined
  private said: { place: string; revision: number; known: number; items: Set<CellKey> } | null = null

  /** Read once per change of the messages or the scene. */
  update(st: GameState, scene: Scene): boolean {
    const lines = st.messages.lines
    const fresh = linesSince(lines, this.last, st.player.turn)
    this.last = lines[lines.length - 1]
    // the level map is looking at another level, which says nothing of this one
    if (!scene.playerOnLevel) return this.said !== null
    const place = st.player.place + ':' + st.player.depth
    if (fresh.some((l) => l.channel === MSGCH.PLAIN && sentences(stripTags(l.text)).some((s) => s === 'Done exploring.' || s.startsWith('Partly explored, ')))) {
      this.said = { place, revision: scene.revision, ...explorable(scene) }
    } else if (this.said && scene.revision !== this.said.revision) {
      const said = this.said
      const now = explorable(scene)
      if (place !== said.place || now.known > said.known || [...now.items].some((k) => !said.items.has(k))) this.said = null
      else said.revision = scene.revision
    }
    return this.said !== null
  }
}

/** What an explore could head for: how many cells the map has, and where items lie. */
function explorable(scene: Scene): { known: number; items: Set<CellKey> } {
  let known = 0
  for (const c of scene.cells.values()) if (c.kind !== 'unknown') known++
  const items = new Set<CellKey>()
  for (const b of scene.billboards) if (b.kind === 'item' && !b.scenery) items.add(cellKey(b.x, b.y))
  return { known, items }
}

/** "a hydra and 2 liches" → ["a hydra", "2 liches"]; `comma_separated_fn` joins with ", " and " and ". */
function splitList(s: string): string[] {
  return s
    .split(/,\s+|\s+and\s+/)
    .map((x) => x.trim())
    .filter(Boolean)
}

/** The name as the server sends it on the cell: no article (DESC_A / DESC_THE), no count. */
function bareName(s: string): string {
  return s
    .trim()
    .replace(/^(?:a|an|the|some)\s+/i, '')
    .replace(/^\d+\s+/, '')
    .toLowerCase()
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, '')
}
