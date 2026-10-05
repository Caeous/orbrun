/**
 * The touch spell bar: the player's memorised spells, a button each, in a
 * row under the message log (hud.ts `renderSpellBar`). Orbrun's own; WebTiles
 * has no such thing, and never sends the spell list unasked: it comes only
 * in the `menu` crawl opens to list it (tag `spell`, spl-cast.cc
 * `list_spells`).
 *
 * So the list is looked up quietly (`SpellBook`): `I` (CMD_DISPLAY_SPELLS,
 * view only, no turn) opens it, its rows are kept, and Escape closes it,
 * none of it reaching the state or the screen. It is looked up again when
 * the letters change under it ("Spell assigned to 'b'." on every spell
 * gained, "Your memory of X unravels." on one lost, the `=` "(adjust)" menu),
 * and read off any list of spells the player opens themselves.
 *
 * A spell is tapped twice: the first tap arms it, the second spends it
 * (`SpellBar.tap`). One that aims (data/spell-targets.json) opens its aim on the
 * first, and the second fires at crawl's pick; one that does not only lights
 * on the first, so a stray tap never spends a Haste.
 */
import { MouseMode, formattedStringToText, type ClientMessage, type MenuItem, type ServerMessage } from '@orbrun/webtiles'
import TARGETS from '../data/spell-targets.json'

export interface Spell {
  /** the spell's letter, as `z` asks for it */
  letter: string
  name: string
  /** its art, a layer or two of the GUI texture, as the menu row carries it */
  tile: { t: number; tex: number; ymax?: number }[]
  /** the failure column as crawl prints it ("3%") */
  fail?: string
}

/**
 * One row of crawl's spell list: " a - Magic Dart   Conjuration   3%   1".
 * The last spell cast is marked `+` rather than `-` (spl-cast.cc
 * SpellMenuEntry `_get_text_preface`). The columns are cut by position after
 * the preface, as `_spell_base_description` pads them (the name to 30, the
 * schools to 58), not on runs of spaces: a long enough school list leaves a
 * single space before the failure column. Null for a row that is no spell
 * (a heading, a row with no letter or art).
 */
export function parseSpellRow(item: MenuItem | undefined): Spell | null {
  if (!item?.hotkeys?.length || !item.tiles?.length) return null
  const plain = formattedStringToText(item.text ?? '').replace(/^\s*\S\s*[-+]\s/, '')
  const name = plain.slice(0, 32).trim()
  if (!name) return null
  const tail = plain.slice(58).trim().split(/\s+/).filter(Boolean)
  return { letter: String.fromCharCode(item.hotkeys[0]), name, tile: item.tiles, ...(tail.length > 1 ? { fail: tail.slice(0, -1).join(' ') } : {}) }
}

const AIMS = TARGETS as Record<string, boolean>

/**
 * Whether casting `name` opens an aim (its flags hold crawl's
 * `targeting_mask`), or undefined for a spell the table has never heard of.
 * A name cut short by its column is looked up by what is left of it.
 */
export function spellAims(name: string): boolean | undefined {
  if (name in AIMS) return AIMS[name]
  const long = Object.keys(AIMS).find((k) => k.startsWith(name))
  return long === undefined ? undefined : AIMS[long]
}

/** what crawl titles its list of spells with, whichever way it was opened: `I` describes, `z` casts */
const LISTS = /Your spells \((describe|cast)\)/
/** the `=` menu that reassigns the letters, and prints nothing when it has */
const ADJUST = /Your spells \(adjust\)/
/** crawl's line for `I` with nothing memorised (MSG_NO_SPELLS) */
const NONE = /^You don't know any spells\b/
/** the letters changed: add_spell_to_memory's line on every spell gained, and the one for a spell lost */
const CHANGED = /Spell assigned to\b|Your memory of .+ unravels\b/

/** How long the look may hold the player's keys back before they go anyway. */
export const LOOK_HOLD_MS = 1500
/** How long a late answer to the look is still taken quietly, after the keys have gone on. */
export const LOOK_LATE_MS = 8000

export interface SpellBookHooks {
  send(m: ClientMessage): void
  /** the list changed */
  changed(): void
  now(): number
}

/**
 * The spells, as the last list crawl sent said, and the quiet look that
 * asks for it (module doc). `intercept` sees every message from the server
 * before the state does and says which are the look's own, to be dropped;
 * `hold` says whether a key the player sends must wait for the look to end
 * (it goes out with `release`).
 */
export class SpellBook {
  /** a new array on every change, so a reader can tell by identity */
  spells: Spell[] = []
  /** the list has been read since the game began, and nothing has changed it since */
  known = false
  /**
   * `asked`: `I` sent, the list not yet here; `closing`: the list taken and
   * Escape sent, its closing messages still to come; `late`: asked so long
   * ago that the keys went on, but a list titled as the look's is still
   * taken quietly if it comes
   */
  private phase: 'idle' | 'asked' | 'closing' | 'late' = 'idle'
  private since = 0
  private held: ClientMessage[] = []

  constructor(private hooks: SpellBookHooks) {}

  /** Look the list up, if it is not known. The caller has made sure crawl is at its command prompt with nothing up. */
  look(): boolean {
    if (this.known || this.phase !== 'idle') return false
    this.phase = 'asked'
    this.since = this.hooks.now()
    this.hooks.send({ msg: 'input', text: 'I' })
    return true
  }

  /** a look is under way: what crawl sends is the look's, and what the player sends waits */
  get busy(): boolean {
    return this.phase === 'asked' || this.phase === 'closing'
  }

  /** Hold a message the player sent while the look is under way; true if held. */
  hold(m: ClientMessage): boolean {
    if (!this.busy || (m.msg !== 'input' && m.msg !== 'key')) return false
    this.held.push(m)
    return true
  }

  /** Time passing: a look that has held the keys too long lets them go, and one past its late window is given up. */
  tick() {
    const age = this.hooks.now() - this.since
    if (this.phase === 'asked' && age > LOOK_HOLD_MS) {
      this.phase = 'late'
      this.release()
    } else if (this.phase === 'late' && age > LOOK_HOLD_MS + LOOK_LATE_MS) {
      this.phase = 'idle'
    }
  }

  /** A new game, or the same one joined again: nothing is known. */
  reset() {
    this.phase = 'idle'
    this.held = []
    this.known = false
    if (this.spells.length) {
      this.spells = []
      this.hooks.changed()
    }
  }

  /** A message from the server, before the state sees it: true when it is the look's own and must go no further. */
  intercept(m: ServerMessage): boolean {
    if (m.msg === 'go_lobby' || m.msg === 'game_client') {
      this.reset()
      return false
    }
    if (m.msg === 'menu') return this.onMenu(m)
    if (m.msg === 'msgs') return this.onMsgs(m)
    if (this.phase === 'asked') return m.msg === 'input_mode'
    if (this.phase === 'closing') {
      if (m.msg === 'close_menu' || m.msg === 'close_all_menus') return true
      if (m.msg === 'input_mode') {
        // the last of the closing: crawl is back at its prompt
        if (m.mode === MouseMode.COMMAND) this.end()
        return true
      }
    }
    return false
  }

  private onMenu(m: ServerMessage): boolean {
    const title = formattedStringToText((m.title as { text?: string } | undefined)?.text ?? '')
    const items = (m.items as (MenuItem | undefined)[] | undefined) ?? []
    const spell = m.tag === 'spell'
    if (spell && ADJUST.test(title)) this.known = false
    const ours = spell && (this.phase === 'asked' || (this.phase === 'late' && /Your spells \(describe\)/.test(title)))
    // a list opened by the player is read too, if it came whole (a long one comes in chunks)
    if (ours || (spell && LISTS.test(title) && items.length >= ((m.total_items as number) ?? 0))) this.take(items)
    if (!ours) {
      // something else answered the look: it is crawl's, and shows
      if (this.phase === 'asked') this.end()
      return false
    }
    this.phase = 'closing'
    this.hooks.send({ msg: 'key', keycode: 27 })
    return true
  }

  private onMsgs(m: ServerMessage): boolean {
    const lines = (m.messages as { text?: string }[] | undefined) ?? []
    if (lines.some((l) => CHANGED.test(l.text ?? ''))) this.known = false
    if (this.phase !== 'asked' && this.phase !== 'late') return false
    const plain = lines.map((l) => formattedStringToText(l.text ?? '').trim())
    if (!plain.length || !plain.every((t) => NONE.test(t))) return false
    // a character with no spells: the look's answer is this line, and nothing opens
    this.take([])
    this.end()
    return true
  }

  private take(items: (MenuItem | undefined)[]) {
    this.spells = items.map(parseSpellRow).filter((s): s is Spell => s !== null)
    this.known = true
    this.hooks.changed()
  }

  private end() {
    this.phase = 'idle'
    this.release()
  }

  private release() {
    const held = this.held
    this.held = []
    for (const m of held) this.hooks.send(m)
  }
}

/** How long a cast is given to open its aim, and a cancelled aim to close, before the bar stops waiting. */
export const AIM_WAIT_MS = 1500

export interface SpellBarHooks {
  /** the play view's mode, and whether its aim is a look (`x`) rather than a shot */
  mode(): { mode: string; examining?: boolean }
  /** the player's turn count: time passing puts a lit spell out */
  turn(): number
  now(): number
  /** `z` and the letter, as the pad casts */
  cast(spell: Spell): void
  /** confirm the aim at its target */
  fire(): void
  /** Escape out of the aim up */
  cancel(): void
}

/**
 * The bar's two taps (module doc). `armed` is a spell lit by its first tap
 * and not yet spent (one that does not aim); `aiming` is the spell whose cast
 * went out and whose aim is up, or coming: a tap on it fires. A tap on
 * another spell during an aim leaves that aim and starts the new spell once
 * crawl is back at its prompt (`pending`). `frame` puts a spell out when
 * its moment passes: time moving, a screen opening, the aim closing.
 */
export class SpellBar {
  armed: string | null = null
  aiming: string | null = null
  private armedTurn = 0
  private castAt = 0
  private aimSeen = false
  private pending: { spell: Spell; t: number } | null = null

  constructor(private hooks: SpellBarHooks) {}

  /** the spell the bar lights: the armed one, or the one being aimed */
  lit(): string | null {
    const m = this.hooks.mode()
    if (this.armed) return this.armed
    return m.mode === 'targeting' && !m.examining ? this.aiming : null
  }

  tap(spell: Spell) {
    const m = this.hooks.mode()
    if (m.mode === 'targeting' && !m.examining && this.aiming === spell.letter) {
      this.hooks.fire()
      return
    }
    if (m.mode === 'targeting') {
      // another aim is up (the quiver's, a look, another spell's): out of it first
      this.armed = null
      this.aiming = null
      this.pending = { spell, t: this.hooks.now() }
      this.hooks.cancel()
      return
    }
    if (m.mode !== 'command') return
    this.start(spell)
  }

  /** a cast went out and its aim has not opened yet: crawl is asking which spell, or about to */
  casting(): boolean {
    return !!this.aiming && !this.aimSeen && this.hooks.now() - this.castAt <= AIM_WAIT_MS
  }

  /** Another input: the lit spell goes out (an aim stays as crawl has it). */
  disarm() {
    this.armed = null
    this.pending = null
  }

  frame() {
    const m = this.hooks.mode()
    const now = this.hooks.now()
    if (this.pending) {
      if (m.mode === 'command') {
        const { spell } = this.pending
        this.pending = null
        this.start(spell)
      } else if (now - this.pending.t > AIM_WAIT_MS) this.pending = null
    }
    if (this.armed && (m.mode !== 'command' || this.hooks.turn() !== this.armedTurn)) this.armed = null
    if (this.aiming) {
      if (m.mode === 'targeting' && !m.examining) this.aimSeen = true
      else if (this.aimSeen || now - this.castAt > AIM_WAIT_MS) this.aiming = null
    }
  }

  private start(spell: Spell) {
    if (spellAims(spell.name) !== true && this.armed !== spell.letter) {
      this.armed = spell.letter
      this.armedTurn = this.hooks.turn()
      return
    }
    // an aimed spell's first tap, or a lit one's second: it goes. One that does not aim may still open crawl's
    // static targeter (the rc's always_use_static_spell_targeters), where a tap on it fires as on any aim
    this.armed = null
    this.aiming = spell.letter
    this.castAt = this.hooks.now()
    this.aimSeen = false
    this.hooks.cast(spell)
  }
}
