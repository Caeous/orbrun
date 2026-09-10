import { MouseMode, UiState, floorItemsLabel, formattedStringToText, isStationaryItemName, topMenu, topPopup, type GameState, type MenuState, type Monster } from '@orbrun/webtiles'
import { cellAhead, cellUnder, billboardsAt, getCell, isThreat, monstersInView, type Camera, type Feature, type Scene, type SceneCell } from '@orbrun/scene'
import type { FocusInfo } from './focus'

export type Mode =
  | 'command'
  /** inputMode MACRO: the server is capturing a macro, keys go through raw */
  | 'macro'
  | 'more'
  | 'menu'
  | 'popup'
  | 'newgame'
  | 'targeting'
  | 'levelmap'
  | 'text'
  | 'yesno'
  | 'prompt'
  | 'crt'
  | 'dialog'
  | 'lobby'
  | 'spectating'
  | 'ended'

export type Layer = 'micro' | 'macro' | 'info'

type Target =
  | { kind: 'none'; label: string }
  | { kind: 'monster'; monster: Monster; hostile: boolean; label: string }
  /** `items`: things also lie on this cell, named as the server did, colour tags and all (A's hold picks them up when the feature takes the tap) */
  | { kind: 'feature'; feature: Feature; label: string; items?: string }
  | { kind: 'item'; label: string }
  | { kind: 'wall'; label: string }
  | { kind: 'door-closed'; label: string }
  | { kind: 'unknown'; label: string }
  | { kind: 'cloud'; label: string }

export interface ParsedPrompt {
  text: string
  /** `held`: what the letter holds now, in the server's words (a letter picker over the inventory) */
  options: { hotkey: string; label: string; held?: string }[]
  yesno: boolean
  /**
   * A letter picker: the prompt wants one letter, and the options are every
   * inventory letter (adjust.cc `adjust_item`, `_adjust_spell`,
   * `_adjust_ability`: "Adjust to which letter?", read with `get_ch`, which
   * is `MOUSE_MODE_PROMPT` (macro.cc), or `prompt_invent_item` with
   * `manual_list`, which prints no menu). `item`: the inventory's letters,
   * so each option can say what it holds; `spell` and `ability`: the server
   * sends no list, the letters stand bare.
   */
  letters?: 'item' | 'spell' | 'ability'
  /** the letter being moved, named on the line before the prompt ("c - a +0 dagger (weapon)"): the cursor starts there */
  from?: string
  /**
   * Escape means something to this prompt: a yes/no takes it as its default
   * answer (prompt.cc `yesno`), a choice prompt cancels. False only for the
   * stat-gain prompt, whose loop ignores Escape and Enter outright
   * (player-stats.cc `attribute_increase`: `CASE_ESCAPE ... break`).
   */
  cancel: boolean
}

export interface MenuContext {
  menu: MenuState
  hoverable: number[]
  arrowsSelect: boolean
  multiselect: boolean
  wrap: boolean
  /** the shop menu (tag `shop`): what its letters, `$` and Enter do right now */
  shop?: ShopContext
}

/**
 * The shop (`ShopMenu`, shopping.cc) read from what the server prints. Its
 * `more` line carries the action mode (`[!] <white>buy<lightgrey>|examine items`, absent
 * when the shop will not sell), and each row starts with its letter and a
 * state sign: `+` marked for purchase, `$` on the shopping list, `-` neither.
 */
export interface ShopContext {
  /** the shop sells to us; a view-only shop (no gold, spectating) only examines */
  canBuy: boolean
  /** what a letter does: mark the row for purchase, or describe it */
  mode: 'buy' | 'examine'
  hoveredMarked: boolean
  hoveredListed: boolean
  anyMarked: boolean
  anyListed: boolean
}

export interface Context {
  mode: Mode
  layer: Layer
  /** The server's description of the action fired by LT. */
  readiedAction?: string
  ahead: Target
  under: Target
  prompt?: ParsedPrompt
  menu?: MenuContext
  popupType?: string
  /** Actions the top popup offers (describe-item verbs, pane switches), in pad order. Filled by the app from the overlays. */
  popupActions?: { key: string; label: string }[]
  /**
   * The focus layer's cursor over the top overlay (popup, prompt, CRT screen,
   * dialog): what A and B would do. Filled by the app from the overlays; absent
   * when the screen offers nothing to focus, so the bindings fall back to raw keys.
   */
  focus?: FocusInfo
  hostilesInView: number
  /** HP or MP below its maximum: resting would do something, so the bar offers wait/rest when nothing is in view. */
  injured?: boolean
  /**
   * Targeting: what the server's cursor rests on (`cursors[0]`, the cell it
   * named in its last `cursor` message), so the bar can say what A will
   * describe. On the player's own cell with nothing there, "here".
   */
  cursor?: Target
  /**
   * The targeting is the look mode `x` opened (runner `examining`): the
   * server reports targeting alone, and the runner pairs it with the `x` it
   * sent. Filled by the app. A then describes the cell rather than selecting it.
   */
  examining?: boolean
  /** the crt screen's tag (`skills`) when a CRT text screen is up, in menu or crt mode */
  crtTag?: string
}

/** Modes whose top overlay is driven by the focus layer rather than by mode-specific keys. */
export function isFocusMode(ctx: Context): boolean {
  switch (ctx.mode) {
    case 'popup':
    case 'newgame':
    case 'crt':
    case 'yesno':
    case 'prompt':
    case 'dialog':
    case 'ended':
      return true
    case 'menu':
      // a crt menu (the skills screen) has no server hover: the focus layer's cursor is the only one
      return ctx.menu?.menu.type === 'crt'
    default:
      return false
  }
}

export function deriveMode(state: GameState): Mode {
  if (state.phase === 'lobby') return 'lobby'
  if (state.phase === 'ended') return 'ended'
  if (state.phase === 'watching') return 'spectating'
  if (state.messages.more) return 'more'
  if (state.textInput) return 'text'
  if (state.dialog) return 'dialog'
  if (state.inputMode === MouseMode.MORE) return 'more'
  // prompt.cc `yesno`: inside a layout or with `prompt_menu`, the question is
  // the server's own arrows-select menu (tag `prompt`, Yes/No rows, hover on
  // the default). That is a menu like any other: the cursor walks it and A
  // picks. Only a yes/no asked in the message pane is `yesno`.
  if (state.inputMode === MouseMode.YESNO) return topMenu(state)?.tag === 'prompt' ? 'menu' : 'yesno'
  const popup = topPopup(state)
  if (popup) return popup.type === 'newgame-choice' ? 'newgame' : 'popup'
  if (state.menus.length) return 'menu'
  if (state.uiState === UiState.CRT) return 'crt'
  if (state.uiState === UiState.VIEW_MAP) return 'levelmap'
  if (state.inputMode === MouseMode.PROMPT) return 'prompt'
  if (state.inputMode === MouseMode.TARGET || state.inputMode === MouseMode.TARGET_DIR || state.inputMode === MouseMode.TARGET_PATH) return 'targeting'
  if (state.inputMode === MouseMode.MACRO) return 'macro'
  // COMMAND while the server waits for a command, NORMAL while it processes one (both appear every turn in play)
  return 'command'
}

/**
 * What a cell is, for the contextual action. Items on a cell ahead are its
 * item billboard, labelled by what its tile shows ("dagger", "scroll of
 * identify": scene-webtiles `itemTileName`; the map sends no name), or
 * "items" when the tile has no name; under the player
 * there is none (the server draws the player over them and flags nothing,
 * `itemsUnderfoot`), so `itemsHere` is the server's word that a pile lies
 * underfoot, in its words and colours (`floorItemsLabel`: "a +0 halberd",
 * "[[ ((", the message log's own line for the square, colour tags kept).
 * A corpse ahead is no item to take: `g` refuses it (items.cc
 * `pickup_single_item`, `isStationaryItemName`), and as corpses sink under
 * whatever else lies on the cell (items.cc `move_item_to_grid`,
 * `link_items`: a stationary item links below the movable ones) a corpse
 * tile on top means the pile holds nothing else. The billboard is still
 * drawn; only the prompt goes.
 */
function targetFor(scene: Scene, cell: SceneCell | undefined, isUnder: boolean, itemsHere: string | null = null): Target {
  if (!cell || cell.kind === 'unknown') return { kind: 'unknown', label: 'unexplored' }
  const bbs = billboardsAt(scene, cell.x, cell.y)
  const mon = bbs.find((b) => b.kind === 'monster' && b.ref)
  if (mon && !isUnder) {
    const m = mon.ref as Monster
    // hostile means worth swinging at: a plant ahead is not an attack prompt, X autofights past it
    return { kind: 'monster', monster: m, hostile: isThreat(mon), label: m.name }
  }
  if (cell.kind === 'door') return { kind: 'door-closed', label: cell.label || 'closed door' }
  if (cell.kind === 'wall') return { kind: 'wall', label: cell.label || 'wall' }
  const pile = bbs.find((b) => b.kind === 'item' && !(b.name && isStationaryItemName(b.name)))
  const item = (isUnder && itemsHere) || (pile ? pile.name || 'items' : null)
  if (cell.feature && cell.feature.type !== 'other') {
    const t: Target = { kind: 'feature', feature: cell.feature, label: cell.label || cell.feature.type }
    if (item) t.items = item
    return t
  }
  if (item) return { kind: 'item', label: item }
  if (bbs.find((b) => b.kind === 'cloud')) return { kind: 'cloud', label: 'cloud' }
  if (cell.feature) return { kind: 'feature', feature: cell.feature, label: cell.label || 'feature' }
  return { kind: 'none', label: cell.label || 'floor' }
}

const HOTKEY_RE = /\(([A-Za-z0-9?*!.,])\)/g

const YESNO_RE = /\[Y\/N\]|\(y\/n\)|\(Y\/n\)|\(y\/N\)|\[y\/n\]/i

/** adjust.cc: the second prompt of `=`, for every kind; only the item one adds prompt_invent_item's "(? for menu, Esc to quit)" */
const LETTER_RE = /^Adjust to which letter\?/
/** adjust.cc `_adjust_spell`, `_adjust_ability`: the first prompt names the kind; the item one is a menu title and never a message */
const LETTER_KIND_RE = /^Adjust which (spell|ability)\?/
/** the line before the letter prompt: the thing being moved, as `mprf_nocap("%c - %s")` or `DESC_INVENTORY_EQUIP` print it */
const LETTER_FROM_RE = /^([A-Za-z]) - /

/** mpr.h `msg_channel_type`: the channel a prompt is printed on (MSGCH_PROMPT), one after MSGCH_FRIEND_ACTION */
const CH_PROMPT = 2
/**
 * A choice spelled `k - what it does`, on the prompt line's own parenthesis
 * (travel.cc `add_waypoint` "(0-9, D - delete waypoint)", dgn-overview.cc
 * `_prompt_annotate_branch` "(. - D:3, ? - help, ! - show branch list)") or
 * on the lines printed after it (shout.cc `_issue_orders_prompt`: " t -
 * Shout!", "r - Retreat!             s - Stop attacking."). The key is one
 * character; a label runs to the next comma or parenthesis, or to a gap of
 * two spaces where two share a line.
 */
const KEYED_RE = /(?:^|[\s(,])([A-Za-z0-9!?*.<>_^~&%/#:]|Tab\/Enter|Enter|Tab) - ([^,()]+?)(?=\s{2,}|[,)]|\s*$)/g
/** the named keys a prompt spells out, as the key to send: Tab and Enter are not text, so the card sends them as keys */
const NAMED_KEYS: Record<string, string> = { 'Tab/Enter': '\t', Tab: '\t', Enter: '\r' }
/** a digit range on the prompt line: "(0-9, ..." */
const DIGITS_RE = /\((\d)-(\d)[,)]/
/**
 * A list of choices as `(K) Name`: the branches printed after the annotate
 * prompt (dgn-overview.cc `_show_dungeon_overview`: "(D) Dungeon        (T)
 * Temple"), or a menu shown in the message pane before its prompt
 * (prompt.cc `PromptMenu::show_in_msgpane`, `_prompt_text`: the travel
 * menu `G` prints its branches this way on the prompt channel, then "Where
 * to? (Tab/Enter - D:3, ? - help) ", and reads one key).
 */
const LISTED_RE = /\(([A-Za-z0-9])\) (\S+)/g

/**
 * A prompt whose choices are not on its line as `(k)ey` words: they are
 * spelled `k - label` in its parenthesis or on the lines after it, or
 * listed as `(K) Name` there, or on the prompt-channel lines just before it
 * (a message-pane menu). The prompt is the last prompt-channel line near
 * the end of the log; Esc is the layer's own Cancel and is not a chip.
 */
function listedPrompt(lines: { text: string; channel?: number }[]): ParsedPrompt | undefined {
  let at = -1
  for (let i = lines.length - 1; i >= 0 && i >= lines.length - 8; i--) {
    if (lines[i].channel === CH_PROMPT) {
      at = i
      break
    }
  }
  if (at < 0) return undefined
  const text = formattedStringToText(lines[at].text)
  const options: ParsedPrompt['options'] = []
  const add = (hotkey: string, label: string) => {
    hotkey = NAMED_KEYS[hotkey] ?? hotkey
    if (options.some((o) => o.hotkey === hotkey)) return
    label = label.trim().replace(/\.$/, '')
    options.push({ hotkey, label: label ? label[0].toUpperCase() + label.slice(1) : hotkey })
  }
  const keyed = (t: string) => {
    let m: RegExpExecArray | null
    KEYED_RE.lastIndex = 0
    while ((m = KEYED_RE.exec(t))) add(m[1], m[2])
  }
  const listed = (t: string): boolean => {
    let m: RegExpExecArray | null
    let any = false
    LISTED_RE.lastIndex = 0
    while ((m = LISTED_RE.exec(t))) {
      add(m[1], m[2])
      any = true
    }
    return any
  }
  // a menu in the message pane: its rows are the prompt-channel lines just before the prompt, in their order
  let first = at
  while (first > 0 && lines[first - 1].channel === CH_PROMPT && LISTED_RE.test(formattedStringToText(lines[first - 1].text))) first--
  for (let i = first; i < at; i++) listed(formattedStringToText(lines[i].text))
  const d = DIGITS_RE.exec(text)
  if (d) for (let n = Number(d[1]); n <= Number(d[2]); n++) add(String(n), String(n))
  keyed(text)
  for (let i = at + 1; i < lines.length; i++) {
    const t = formattedStringToText(lines[i].text)
    keyed(t)
    listed(t)
  }
  if (!options.length) return undefined
  return { text, options, yesno: false, cancel: true }
}

/** Every inventory letter in slot order (invent.h `index_to_letter`): a-z, then A-Z. */
const INVENTORY_LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

/**
 * The letter picker for a prompt that wants one letter. Each option is a
 * letter; over the inventory it also says what the letter holds now
 * (`state.player.inv`, keyed by slot: a-z are 0-25, A-Z 26-51), so the card
 * can name it as the cursor passes. `lines` is the log, `i` the prompt's
 * line: the lines before it say what kind of letter this is and which one
 * is moving.
 */
function letterPrompt(state: GameState, lines: { text: string }[], i: number, text: string): ParsedPrompt {
  let kind: ParsedPrompt['letters'] = text.includes('for menu') ? 'item' : undefined
  let from: string | undefined
  for (let j = i - 1; j >= 0 && j >= i - 6; j--) {
    const t = formattedStringToText(lines[j].text)
    if (!from) {
      const f = LETTER_FROM_RE.exec(t)
      if (f) from = f[1]
    }
    const k = LETTER_KIND_RE.exec(t)
    if (k) {
      if (!kind) kind = k[1] as 'spell' | 'ability'
      break
    }
  }
  kind ??= 'item'
  const options: ParsedPrompt['options'] = []
  for (let slot = 0; slot < INVENTORY_LETTERS.length; slot++) {
    const ch = INVENTORY_LETTERS[slot]
    const o: ParsedPrompt['options'][number] = { hotkey: ch, label: ch }
    const held = kind === 'item' ? state.player.inv[slot]?.name : undefined
    if (held) o.held = held
    options.push(o)
  }
  return { text, options, yesno: false, cancel: true, letters: kind, from }
}

/** player-stats.cc `attribute_increase`: the prompt is uppercase unless `easy_confirm = all`. */
const STAT_GAIN_RE = /^Increase \([Ss]\)trength, \([Ii]\)ntelligence, or \([Dd]\)exterity\?/

/**
 * When a choice prompt is nothing but its options ("Increase (S)trength,
 * (I)ntelligence, or (D)exterity?"), the answer chips are the question, and
 * printing it over them says everything twice. This returns what is left of
 * the text once the option words, the punctuation and the "or"/"and" between
 * them go: at most one word, the verb the chips complete ("Increase"), or ""
 * when nothing is. Null when more remains, so the text still asks something
 * the chips alone do not and the card must print it.
 */
export function promptLead(text: string): string | null {
  const rest = text
    .replace(/\S*\([A-Za-z0-9?*!.,]\)\S*/g, ' ')
    .replace(/[,.?!:;]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !/^(or|and)$/i.test(w))
  return rest.length <= 1 ? rest.join('') : null
}

/**
 * Parse hotkeys from the latest prompt-channel message. Only when the server
 * says a prompt is up (inputMode YESNO or PROMPT): message text alone never
 * makes a prompt, so in command mode nothing here can turn A into `y`.
 * Only the prompt line itself: what the command printed before it (the
 * level-up over the stat-gain prompt) stays in the message log, where the
 * player already reads it. A prompt line with no `(k)ey` words may still
 * spell its choices another way (`listedPrompt`), or want a bare letter
 * (`letterPrompt`).
 */
function parsePrompt(state: GameState): ParsedPrompt | undefined {
  const yesnoMode = state.inputMode === MouseMode.YESNO
  const promptMode = state.inputMode === MouseMode.PROMPT
  if (!yesnoMode && !promptMode) return undefined
  const lines = state.messages.lines
  for (let i = lines.length - 1; i >= 0 && i >= lines.length - 3; i--) {
    const l = lines[i]
    // a `(D) Dungeon` list printed around a prompt is not the prompt (recorded lines carry the channel; hand-made ones may not)
    if (l.channel !== undefined && l.channel !== CH_PROMPT) continue
    const text = formattedStringToText(l.text)
    LISTED_RE.lastIndex = 0
    if (LISTED_RE.test(text)) continue
    const options: { hotkey: string; label: string }[] = []
    if (yesnoMode && YESNO_RE.test(text)) {
      options.push({ hotkey: 'y', label: 'Yes' }, { hotkey: 'n', label: 'No' })
      return { text, options, yesno: true, cancel: true }
    }
    if (!promptMode) continue
    if (LETTER_RE.test(text)) return letterPrompt(state, lines, i, text)
    let m: RegExpExecArray | null
    HOTKEY_RE.lastIndex = 0
    while ((m = HOTKEY_RE.exec(text))) {
      // label: the word containing the hotkey
      const start = text.lastIndexOf(' ', m.index) + 1
      let end = text.indexOf(' ', m.index)
      if (end < 0) end = text.length
      const label = text.slice(start, end).replace(/[(),?]/g, '')
      options.push({ hotkey: m[1], label: label || m[1] })
    }
    if (options.length) return { text, options, yesno: false, cancel: !STAT_GAIN_RE.test(text) }
  }
  return promptMode ? listedPrompt(lines) : undefined
}

function menuContext(state: GameState): MenuContext | undefined {
  const menu = topMenu(state)
  if (!menu) return undefined
  const arrowsSelect = !!(menu.flags & 0x40000)
  const hoverable: number[] = []
  for (let i = 0; i < menu.items.length; i++) {
    const it = menu.items[i]
    if (!it) continue
    if ((it.level ?? 2) === 2 && (menu.tag === 'use_item' || (it.hotkeys && it.hotkeys.length) || arrowsSelect)) hoverable.push(i)
  }
  const ctx: MenuContext = { menu, hoverable, arrowsSelect, multiselect: !!(menu.flags & 0x0004), wrap: !!(menu.flags & 0x0080) }
  if (menu.tag === 'shop') ctx.shop = shopContext(menu)
  return ctx
}

/** A shop row's state sign, from the text `ShopEntry::get_text` prints: ` a + 30 gold   item`. */
const SHOP_ROW_RE = /^\s*[a-zA-Z]\s([+$-])\s/

export function shopContext(menu: MenuState): ShopContext {
  const more = (menu.more || '') + '\n' + (menu.alt_more || '')
  // a live shop (crawl.dcss.io, 2026-09) prints `<white>buy<lightgrey>|examine items`; `<w>` is the same colour tag
  const buy = /<(?:w|white)>buy(?:<\/w>|<lightgrey>)\|examine/.test(more)
  const examine = /buy\|<(?:w|white)>examine/.test(more)
  const canBuy = buy || examine
  let anyMarked = false
  let anyListed = false
  let hoveredMarked = false
  let hoveredListed = false
  for (let i = 0; i < menu.items.length; i++) {
    const it = menu.items[i]
    if (!it) continue
    const m = SHOP_ROW_RE.exec(formattedStringToText(it.text || ''))
    if (!m) continue
    const marked = m[1] === '+'
    const listed = m[1] === '$'
    anyMarked ||= marked
    anyListed ||= listed
    if (i === menu.last_hovered) {
      hoveredMarked = marked
      hoveredListed = listed
    }
  }
  return { canBuy, mode: buy ? 'buy' : 'examine', hoveredMarked, hoveredListed, anyMarked, anyListed }
}

export function deriveContext(state: GameState, scene: Scene, cam: Camera, layer: Layer): Context {
  const mode = deriveMode(state)
  const ahead = targetFor(scene, cellAhead(scene, cam.facing), false)
  const under = targetFor(scene, cellUnder(scene), true, floorItemsLabel(state))
  // what autofight would attack: a plant is hostile-attitude firewood and counts for nothing (scene `isThreat`)
  const hostiles = monstersInView(scene).filter(isThreat).length
  const p = state.player
  const ctx: Context = { mode, layer, ahead, under, hostilesInView: hostiles, readiedAction: p.quiver_desc || undefined }
  if (p.hp < p.hp_max || p.mp < p.mp_max) ctx.injured = true
  if (mode === 'yesno' || mode === 'prompt') ctx.prompt = parsePrompt(state)
  if (mode === 'menu') {
    ctx.menu = menuContext(state)
    if (ctx.menu?.menu.type === 'crt') ctx.crtTag = ctx.menu.menu.tag
  }
  if (mode === 'crt') ctx.crtTag = 'crt'
  if (mode === 'targeting') {
    const c = state.cursors[0]
    if (c) {
      const onPlayer = c.x === scene.player.x && c.y === scene.player.y
      const t = targetFor(scene, getCell(scene, c.x, c.y), onPlayer, onPlayer ? floorItemsLabel(state) : null)
      ctx.cursor = onPlayer && t.kind === 'none' ? { kind: 'none', label: 'here' } : t
    }
  }
  if (mode === 'popup' || mode === 'newgame') ctx.popupType = topPopup(state)?.type
  return ctx
}
