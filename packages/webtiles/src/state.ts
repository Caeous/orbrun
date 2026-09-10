import type { ServerMessage } from './protocol.js'
import { MouseMode } from './protocol.js'

// ---------------------------------------------------------------------------
// Map

/** Packed tile word from the server: a number, or [lo, hi] for > 32 bits. */
export type TileWord = number | [number, number]

export interface CellTiles {
  fg?: TileWord
  bg?: TileWord
  cloud?: TileWord
  base?: number
  overlay1?: number
  overlay2?: number
  doll?: [number, number][] | null
  mcache?: [number, number, number][] | null
  trans?: boolean
  flv?: { f?: number; s?: number }
  ov?: number[]
  icons?: number[]
  bloody?: boolean
  old_blood?: boolean
  blood_rotation?: number
  moldy?: boolean
  glowing_mold?: boolean
  silenced?: boolean
  halo?: number
  sanctuary?: boolean
  blasphemy?: boolean
  liquefied?: boolean
  orb_glow?: number
  quad_glow?: boolean
  disjunct?: number
  mangrove_water?: boolean
  awakened_forest?: boolean
  travel_trail?: number
  highlighted_summoner?: boolean
  has_bfb_corpse?: boolean
  [key: string]: unknown
}

export interface Monster {
  id?: number
  name: string
  plural?: string
  type?: number
  typedata?: { avghp?: number; no_exp?: boolean }
  att: number
  btype?: number
  threat?: number
  clientid?: number
  refs?: number
  [key: string]: unknown
}

export interface MapCell {
  x: number
  y: number
  /** dungeon feature id (version specific, informational) */
  f?: number
  /** map-feature category for the minimap */
  mf?: number
  g?: string
  col?: number
  t?: CellTiles
  mon?: Monster | null
  flc?: number
  fla?: number
  [key: string]: unknown
}

export function mapKey(x: number, y: number): number {
  return ((y + 512) << 10) | (x + 512)
}

export interface MapStore {
  cells: Map<number, MapCell>
  monsters: Map<number, Monster>
  bounds: { left: number; top: number; right: number; bottom: number } | null
  /** view centre (vgrdc) */
  viewCenter: { x: number; y: number } | null
  playerOnLevel: boolean
  invisibleMonsterDesc: string
}

// ---------------------------------------------------------------------------
// Player

export interface InvItem {
  slot: number
  name?: string
  base_type?: number
  sub_type?: number
  quantity?: number
  col?: number
  action_panel_order?: number
  /** tileweb.cc `_send_item`: plain ids in the main texture, base item first; older layers name their own texture */
  tile?: number | (number | { t: number; tex: number; ymax?: number })[]
  [key: string]: unknown
}

export interface StatusEntry {
  light?: string
  text?: string
  col?: number
  desc?: string
}

export interface PlayerState {
  name: string
  title: string
  species: string
  species_display_name: string
  god: string
  piety_rank: number
  penance: boolean
  ostracism_pips: number
  hp: number
  hp_max: number
  real_hp_max: number
  poison_survival: number
  mp: number
  mp_max: number
  dd_real_mp_max: number
  ac: number
  ev: number
  sh: number
  ac_mod: number
  ev_mod: number
  sh_mod: number
  str: number
  int: number
  dex: number
  str_max: number
  int_max: number
  dex_max: number
  xl: number
  progress: number
  gold: number
  place: string
  depth: number
  time: number
  time_delta: number
  turn: number
  time_last_input?: number
  status: StatusEntry[]
  inv: Record<number, InvItem>
  weapon_index: number
  weapon_colour: number
  offhand_index: number
  offhand_weapon: boolean
  offhand_weapon_colour: number
  unarmed_attack: string
  quiver_item: number
  quiver_desc: string
  pos: { x: number; y: number }
  contam: number
  doom: number
  doom_desc: string
  noise: number
  adjusted_noise: number
  wizard: boolean
  explore: boolean
  form: number
  /** `turn` when `pos` or `place`/`depth` last changed: the turn the player arrived where they stand. */
  arrivedTurn: number
  /**
   * Whether that arrival's `player` update also gained inventory or gold:
   * autopickup took something, which ends a second turn (main.cc `_input`:
   * `world_reacts` after the move, `autopickup`, then `world_reacts` again
   * when it picked up), so `item_check`'s line about what it left was
   * printed one turn before `arrivedTurn` (cdi-0.34-autopickup.ndjson).
   */
  arrivedPickup: boolean
  /**
   * The server's latest floor-items announcement, `item_check` (items.cc) on
   * MSGCH_FLOOR_ITEMS, by the turn it was printed, with its text as sent:
   * the line itself, and for "Things that are here:" the plain-channel line
   * of names that follows it. `picked` counts the items taken from it since
   * (inventory or gold gained in a `player` update while standing there).
   * See `itemsUnderfoot`, `floorItemsLabel`.
   */
  floorItems: { turn: number; lines: string[]; picked: number } | null
  /**
   * Whether a `player` message has arrived for this game. Until it has, the
   * sheet is this record's zeros, not the character's: a new game sends
   * none while the chooser is up (newgame.cc `choose_game` puts the UI in
   * `UI_CRT`; tileweb.cc `redraw` sends the first `player` in the same
   * batch as the `ui_state` back to normal), and a continued game sends
   * none until the save has loaded.
   */
  received: boolean
  changed: Set<string>
  /** Previous values for keys in `changed`. */
  previous: Record<string, unknown>
  [key: string]: unknown
}

function initialPlayer(): PlayerState {
  return {
    name: '',
    title: '',
    species: '',
    species_display_name: '',
    god: '',
    piety_rank: 0,
    penance: false,
    ostracism_pips: 0,
    hp: 0,
    hp_max: 0,
    real_hp_max: 0,
    poison_survival: 0,
    mp: 0,
    mp_max: 0,
    dd_real_mp_max: 0,
    ac: 0,
    ev: 0,
    sh: 0,
    ac_mod: 0,
    ev_mod: 0,
    sh_mod: 0,
    str: 0,
    int: 0,
    dex: 0,
    str_max: 0,
    int_max: 0,
    dex_max: 0,
    xl: 0,
    progress: 0,
    gold: 0,
    place: '',
    depth: 0,
    time: 0,
    time_delta: 0,
    turn: 0,
    status: [],
    inv: {},
    weapon_index: -1,
    weapon_colour: -1,
    offhand_index: -1,
    offhand_weapon: false,
    offhand_weapon_colour: -1,
    unarmed_attack: '',
    quiver_item: -1,
    quiver_desc: '',
    pos: { x: 0, y: 0 },
    contam: 0,
    doom: 0,
    doom_desc: '',
    noise: 0,
    adjusted_noise: 0,
    wizard: false,
    explore: false,
    form: 0,
    received: false,
    arrivedTurn: 0,
    arrivedPickup: false,
    floorItems: null,
    changed: new Set(),
    previous: {},
  }
}

/**
 * Whether the server has said items lie under the player where they stand
 * now. The player's own cell never says so: `tileidx_player` (tilepick-p.cc)
 * sets no `S_UNDER` flag on the player's fg tile, unlike an item under a
 * stationary monster (tileview.cc `_tile_place_monster`), and the official
 * client draws nothing for it. What the server does send is `item_check`'s
 * line on MSGCH_FLOOR_ITEMS each time the player arrives on a pile (items.cc
 * `autopickup` runs it, after autopickup or instead of it) or a pile is
 * pushed under them (player.cc). The line is matched to the standing by
 * turn, not by position: a recorded spectator stream delivered one such
 * line ten turns after the pile it described was left, and the `player`
 * update with the new `pos` precedes the `msgs` in the same batch
 * (cdi-0.34-watch.ndjson), so the announcement's turn is never below the
 * arrival's when it is about this cell, except by the one turn autopickup
 * takes when it picks something up on the way (`arrivedPickup`;
 * cdi-0.34-autopickup.ndjson has the line at 29815 under the arrival at
 * 29816, beside "c - a scroll labelled POT ISCHUEGUUB"). Nothing is sent when a manual
 * pick-up empties the pile (items.cc `pickup` does not call `item_check`),
 * so the pile is counted down instead: each item taken shows up in the same
 * `player` update as an inventory slot whose quantity grew (`_send_item`,
 * tileweb.cc; "T - a scroll of torment" is the line beside it in
 * orbrun-rec.ndjson) or as more gold (items.cc `get_gold`), and the answer
 * turns false once as many have been taken as `item_check` listed. A pile
 * whose size the line does not give ("There are many items here.") stays
 * until the next step or a "There are no items here." (items.cc `pickup`).
 * A pile of nothing but corpses counts as no items: `pickup` has nothing
 * to offer there (`floorItemsCount`, `isStationaryItemName`).
 */
export function itemsUnderfoot(state: GameState): boolean {
  const f = state.player.floorItems
  const p = state.player
  if (!f || f.turn < p.arrivedTurn - (p.arrivedPickup ? 1 : 0)) return false
  const n = floorItemsCount(f.lines)
  return n === null || f.picked < n
}

/** Colour tags off, whitespace trimmed: the text as `floorItemsLabel` reads it. */
function plainLines(lines: string[]): string[] {
  return lines.map((l) => l.replace(/<[^>]*>/g, '').trim())
}

/**
 * A corpse or skeleton, by the name the server prints (item-name.cc
 * `item_def::name`, OBJ_CORPSES: "<monster> corpse" / "<monster> skeleton",
 * a named one "... corpse of <name>"). Corpses are the one stationary item
 * kind (item-prop.cc `item_is_stationary`, since 0.25 with placed nets):
 * `g` on one says "You can't pick that up." (items.cc `pickup_single_item`),
 * `pickup` counts only the movable items of a pile (`count_movable_items`)
 * and autopickup skips them (`item_needs_autopickup`). They are useless
 * items too (item-name.cc `is_useless_item`), so the default rc prints
 * them darkgrey (dat/defaults/menu_colours.txt `menu += darkgrey:.*useless_item.*`);
 * the colour is not the test, since a useless scroll is grey and still
 * picked up.
 */
export function isStationaryItemName(name: string): boolean {
  return /\b(corpse|skeleton)( of .+)?$/.test(name.replace(/<[^>]*>/g, '').trim())
}

/**
 * The console glyphs a corpse and a skeleton print in "Items here: ..."
 * (viewchar.cc `dchar_table`, CSET_DEFAULT: item_corpse †, item_skeleton ÷;
 * a black mamba corpse is `(<blue>†</blue>)` in cdi-0.34-watch.ndjson).
 * An rc that rebinds `item_glyph` for them is not recognised here.
 */
const STATIONARY_GLYPHS = /[†÷]/g

/**
 * How many items `item_check` (items.cc) said the pile holds that `pickup`
 * would take: one for "You see here X." (its `items.size() == 1` case),
 * one per name in the "; " list under "Things that are here:"
 * (`item_message`), one per glyph in "Items here: ...", each less the
 * corpses (`isStationaryItemName`, `STATIONARY_GLYPHS`). Null when it did
 * not say ("There are many items here.").
 */
export function floorItemsCount(lines: string[]): number | null {
  const [head = '', names] = plainLines(lines)
  const single = /^You see here (.+)\.$/.exec(head)
  if (single) return isStationaryItemName(single[1]) ? 0 : 1
  if (head === FLOOR_LIST_HEAD) return names ? names.split('; ').filter((n) => !isStationaryItemName(n)).length : null
  const m = /^Items here: (.*)\.$/.exec(head)
  if (m) return Array.from(m[1].replace(/\s+/g, '').replace(STATIONARY_GLYPHS, '')).length
  return null
}

/**
 * What lies underfoot, in the words the server used (items.cc `item_check`,
 * `item_message`), colour tags and all, so a prompt for it reads as its line
 * in the message log does ("a staff of alchemy", green where the log is green):
 *
 * - "You see here X." gives X, as the server named it;
 * - "Things that are here:" is followed by the names joined with "; " on
 *   the plain channel (up to `msgwin_lines() - 1` items), kept as is;
 * - "Items here: ...", printed from `item_stack_summary_minimum` items up
 *   (an rc option), lists one glyph per item, and gives those glyphs
 *   ("[[ ((", each in its item's colour), the log's own shorthand;
 * - "There are many items here." gives "many items".
 *
 * Once some of a listed pile has been taken (`floorItems.picked`) the server
 * has not said which, so what is left is counted, not named: "2 items".
 * Corpses are left out of the name and the count (`isStationaryItemName`:
 * "a +0 mace; a bat corpse" reads "a +0 mace"), as `pickup` leaves them
 * out of what it offers. Null when nothing is underfoot (`itemsUnderfoot`),
 * which a pile of corpses alone is not.
 *
 * The tags that wrap a whole line are not part of what it names, so they are
 * left behind with the words: what comes back is the item's own colouring.
 */
export function floorItemsLabel(state: GameState): string | null {
  if (!itemsUnderfoot(state)) return null
  const f = state.player.floorItems!
  const lines = plainLines(f.lines)
  const head = lines[0] || ''
  const n = floorItemsCount(f.lines)
  if (n !== null && f.picked > 0) return n - f.picked === 1 ? '1 item' : `${n - f.picked} items`
  let m = SEE_HERE_RE.exec(f.lines[0] || '')
  if (m) return named(m[1], m[2])
  if (head === FLOOR_LIST_HEAD) return f.lines[1] ? f.lines[1].trim().split('; ').filter((n) => !isStationaryItemName(n)).join('; ') : 'items'
  m = ITEMS_HERE_RE.exec(f.lines[0] || '')
  if (m) return named(m[1], m[2])
  if (head === 'There are many items here.') return 'many items'
  return 'items'
}

/** "You see here X." and "Items here: X.", the tags the line opens with kept apart from the name. */
const SEE_HERE_RE = /^\s*((?:<[^>]*>)*)You see here ([\s\S]+)\.(?:<[^>]*>)*\s*$/
const ITEMS_HERE_RE = /^\s*((?:<[^>]*>)*)Items here: ([\s\S]*)\.(?:<[^>]*>)*\s*$/

/**
 * The name out of one of those lines, coloured as the log shows it: the
 * colour the line opened in (`<lightgrey>You see here a +0 halberd.`) is the
 * name's too unless the name opens its own (`<green>a staff of alchemy`), and
 * the tags left dangling at the end belong to the full stop, not to the item
 * — crawl closes a colour by opening the one before it (`<green>a
 * staff<lightgrey>.`).
 */
function named(lead: string, name: string): string {
  const n = name.replace(/(?:<\/?[a-z:]*>)+$/i, '')
  return n.startsWith('<') ? n : lead + n
}

// ---------------------------------------------------------------------------
// Messages, menus, popups

/**
 * Message channels the client reads, numbered as `mpr.h` `msg_channel_type`
 * declares them (`message.cc` writes the number on each `msgs` line; the
 * official `messages.js` ignores it). Only the ones Orbrun acts on are named.
 */
export const MSGCH = {
  PLAIN: 0,
  /** "various prompts": "Cast which spell? (? or * to list)" (spl-cast.cc `cast_a_spell`), "Where to?" (travel.cc) */
  PROMPT: 2,
  /** "much less serious threats": `i_feel_safe`'s "X is nearby!" (nearby-danger.cc) */
  WARN: 6,
  /** `item_check` (items.cc): "You see here X.", "Items here: ...", "Things that are here:", "There are many items here." */
  FLOOR_ITEMS: 21,
  /** "Foo comes into view", "You encounter Foo." (player-notices.cc, delay.cc) */
  MONSTER_WARNING: 31,
} as const

export interface GameMessage {
  text: string
  turn?: number
  channel?: number
  /** Marker set by the client when a new command/turn starts after this line. */
  marker?: 'turn' | 'command'
}

export interface MessageLog {
  lines: GameMessage[]
  more: boolean
  moreText: string
  paneHeight: number
  textCursor: boolean
  /**
   * How many of `lines` the player had on screen the last time the server
   * read a key from them: crawl's `message_window::input_line`
   * (message.cc `got_input`, called from `msgwin_reply`, `clear_messages`
   * and every key read). A full `--more--` fires when the lines after it
   * fill the window (`make_space` scrolls off only the ones before it), so
   * `lines.slice(readTo)` is what the more is about; the client sets it
   * whenever the server leaves a mode that was reading a key (any mode but
   * NORMAL, protocol.ts MouseMode).
   */
  readTo: number
}

export interface MenuItem {
  text: string
  level?: number
  colour?: number
  hotkeys?: number[]
  tiles?: { t: number; tex: number; ymax?: number }[]
  q?: number
  preselected?: boolean
  [key: string]: unknown
}

export interface MenuState {
  tag: string
  type?: string
  flags: number
  title: { text: string }
  more: string
  alt_more: string
  total_items: number
  items: (MenuItem | undefined)[]
  last_hovered: number
  chunk_start?: number
  'ui-centred'?: boolean
  jump_to?: number
  /** client-side: first visible index reported by the server for spectators */
  server_first_visible?: number
  /** `title_prompt`: the title is a text field (the menu filter); `raw` while the macro editor reads a key */
  titlePrompt?: { prompt: string; raw: boolean } | null
  /** client-side: this menu's place in the server's one ui stack (`stackOrder`), and whether a `ui_cutoff` hid it */
  stackOrder?: number
  hidden?: boolean
  [key: string]: unknown
}

export interface Popup {
  type: string
  generation_id?: number
  'ui-centred'?: boolean
  /** every other field as sent (title, body, actions, text, ...) */
  data: ServerMessage
  /** ui-state updates merged in */
  state: Record<string, unknown>
  /** client-side: this popup's place in the server's one ui stack (`stackOrder`), and whether a `ui_cutoff` hid it */
  stackOrder?: number
  hidden?: boolean
  /**
   * Last `ui-state-sync` for this popup (spectators follow the player's
   * focus and widget state): `widget_id`, `has_focus`, and the widget's own
   * fields, as sent.
   */
  sync?: UiStateSync
  /**
   * The last scroll line the server sent for this popup: `ui-scroller-scroll`
   * for most popups, the `scroll` field of a `ui-state` for a formatted
   * scroller (ui-layouts.js recv_ui_scroll / formatted_scroller_update). The
   * client applies it unless it came from its own scrolling (`from_webtiles`)
   * and it is not spectating; `scrollSeq` counts arrivals so a repeat of the
   * same line is applied again.
   */
  scroll?: number
  scrollFromWebtiles?: boolean
  scrollSeq?: number
}

/** A `ui-state-sync` message: the player's focus or widget state, for spectators to follow. */
export interface UiStateSync {
  generation_id?: number
  /** `data-sync-id` of the widget, or null/'' for the popup itself */
  widget_id?: string | null
  has_focus?: boolean
  /** true when relayed by the server from the player's own client */
  from_webtiles?: boolean
  /** every field as sent (widget state such as `checked`, `text`, `scroll`) */
  data: ServerMessage
  /** bumps on every sync so consumers can react to a repeat of the same state */
  seq: number
}

export interface TextInputState {
  type: 'messages' | 'generic' | 'seed-selection'
  tag?: string
  prompt?: string
  maxlen?: number
  size?: number
  prefill?: string
  historyId?: string
  select_prefill?: boolean
  /** current text (client-side) */
  text: string
  [key: string]: unknown
}

export interface CrtScreen {
  lines: Map<number, string>
  /** other text areas keyed by id */
  areas: Map<string, Map<number, string>>
}

export interface LobbyEntry {
  id: number
  username: string
  game_id: string
  spectator_count?: number
  idle_time?: number
  xl?: string
  char?: string
  place?: string
  turn?: string
  dur?: string
  god?: string
  title?: string
  milestone?: string
  [key: string]: unknown
}

export interface GameLink {
  id: string
  label: string
  /**
   * The save waiting in this game, in the lobby's own words (game_links.html
   * `save_info`, ws_handler.py `update_save_info`): the bracket text after
   * the game's name. "orbruntest, a level 3 Minotaur Berserker of Trog" is a
   * save to continue (player.cc `player_save_info::short_desc`); "playing" is
   * a save another session has open; "slot full" is a save of another game
   * type in the same slot, which the lobby greys out and does not link.
   * Absent when the lobby shows a plain link: no save, or a server that does
   * not publish save info (`show_save_info` off), which look the same.
   */
  save?: string
  /** true when the lobby offers no link for this game: its save slot holds another game type ("slot full") */
  disabled?: boolean
}

export interface LobbyState {
  entries: Map<number, LobbyEntry>
  complete: boolean
  gameLinksHtml: string
  games: GameLink[]
  bannerHtml: string
  username: string | null
  admin: boolean
  loginFailed: string | null
  loginCookie: { cookie: string; expires: number } | null
  registerFailed: string | null
  /** `rcfile_contents`: the rc file the lobby asked for with `get_rc`, until the editor is closed. */
  rcfile: { gameId: string | null; contents: string } | null
  /** `stale_processes`: the server is about to stop old game processes unless a key is pressed. */
  staleProcesses: { game: string; timeout: number } | null
  /** `force_terminate?`: a stale process would not stop; the server asks whether to kill it. */
  forceTerminate: boolean
  /** `set_account_hold` / `clear_account_hold`: the account awaits administrator approval. */
  accountHold: boolean
  /** `reload_url`: the server wants the client reloaded (a new client version). */
  reloadUrl: boolean
  /** `admin_log` lines, newest last, for the admin panel. */
  adminLog: string[]
}

export type ServerOptions = Record<string, unknown>

export interface ChatLine {
  sender: string
  html: string
  meta?: boolean
  automated?: boolean
}

export interface Diagnostic {
  text: string
  msg?: string
  detail?: unknown
}

export type Phase = 'lobby' | 'loading' | 'playing' | 'watching' | 'ended'

export interface GameState {
  phase: Phase
  lobby: LobbyState
  version: { gameId: string | null; gamedataVersion: string | null; text: string | null; content: string | null }
  map: MapStore
  player: PlayerState
  options: ServerOptions
  messages: MessageLog
  inputMode: number
  uiState: number
  cursors: (({ x: number; y: number } | null) | undefined)[]
  ui: Popup[]
  /** the last `ui_cutoff` the server sent; what it hid is on each menu's and popup's `hidden` (`applyCutoff`) */
  uiCutoff: number
  /** next `stackOrder`: menus and popups share the server's one stack, and the cutoff counts them together */
  uiStackOrder: number
  /** Most recent `ui-state-sync`, also attached to its popup as `sync`. */
  uiSync: UiStateSync | null
  /** Most recent `ui-scroller-scroll` (a line number for the top popup's scroller), also attached to the popup as `scroll`. */
  uiScroll: { scroll: number; from_webtiles: boolean; seq: number } | null
  menus: MenuState[]
  crt: CrtScreen
  dialog: string | null
  textInput: TextInputState | null
  watching: { username: string } | null
  /** `game_ended`: why the last game ended, its parting words and its morgue/dump URL (less the `.txt`); `watched` names the player when it was a watched game. */
  exit: { reason: string; message?: string; dump?: string; watched?: string } | null
  spectators: { count: number; names: string } | null
  /**
   * Chat, as chat.js keeps it: `html` is the server's rendered line (a
   * `chat_sender` span and a `chat_msg` span), `meta` lines are notices that
   * do not count as unread, `automated` lines are the client's own (a dump
   * url, an announcement).
   */
  chat: ChatLine[]
  /** `toggle_chat` / `super_hide_chat`: whether the chat panel is shown at all; `super_hide_chat` removes even the restore button. */
  chatVisible: boolean
  chatSuperHidden: boolean
  diagnostics: Diagnostic[]
  /** Monotonic counters: bump on every change of the respective part. */
  rev: { map: number; player: number; messages: number; ui: number; lobby: number; chat: number; any: number }
  /** Set of map keys touched since the last `clearDirty`. */
  dirtyCells: Set<number>
  mapCleared: boolean
  flushPending: boolean
}

function initialLobby(): LobbyState {
  return {
    entries: new Map(),
    complete: false,
    gameLinksHtml: '',
    games: [],
    bannerHtml: '',
    username: null,
    admin: false,
    loginFailed: null,
    loginCookie: null,
    registerFailed: null,
    rcfile: null,
    staleProcesses: null,
    forceTerminate: false,
    accountHold: false,
    reloadUrl: false,
    adminLog: [],
  }
}

function emptyMap(): MapStore {
  return {
    cells: new Map(),
    monsters: new Map(),
    bounds: null,
    viewCenter: null,
    playerOnLevel: false,
    invisibleMonsterDesc: '',
  }
}

export function initialState(): GameState {
  return {
    phase: 'lobby',
    lobby: initialLobby(),
    version: { gameId: null, gamedataVersion: null, text: null, content: null },
    map: emptyMap(),
    player: initialPlayer(),
    options: {},
    messages: { lines: [], more: false, moreText: '', paneHeight: 7, textCursor: false, readTo: 0 },
    inputMode: MouseMode.NORMAL,
    uiState: 0,
    cursors: [],
    ui: [],
    uiCutoff: -1,
    uiStackOrder: 0,
    uiSync: null,
    uiScroll: null,
    menus: [],
    crt: { lines: new Map(), areas: new Map() },
    dialog: null,
    textInput: null,
    watching: null,
    exit: null,
    spectators: null,
    chat: [],
    chatVisible: true,
    chatSuperHidden: false,
    diagnostics: [],
    rev: { map: 0, player: 0, messages: 0, ui: 0, lobby: 0, chat: 0, any: 0 },
    dirtyCells: new Set(),
    mapCleared: false,
    flushPending: false,
  }
}

// ---------------------------------------------------------------------------
// Reducer

function diag(state: GameState, text: string, msg?: ServerMessage, detail?: unknown) {
  state.diagnostics.push({ text, msg: msg?.msg, detail })
  if (state.diagnostics.length > 200) state.diagnostics.shift()
}

/** chat.js receive_message: append, keep the history bounded. */
function pushChat(state: GameState, line: ChatLine) {
  state.chat.push(line)
  if (state.chat.length > 500) state.chat.shift()
  state.rev.chat++
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function resetGame(state: GameState) {
  state.map = emptyMap()
  state.player = initialPlayer()
  state.options = {}
  state.messages = { lines: [], more: false, moreText: '', paneHeight: 7, textCursor: false, readTo: 0 }
  state.inputMode = MouseMode.NORMAL
  state.uiState = 0
  state.cursors = []
  state.ui = []
  state.uiCutoff = -1
  state.uiStackOrder = 0
  state.uiSync = null
  state.uiScroll = null
  state.menus = []
  state.crt = { lines: new Map(), areas: new Map() }
  state.dialog = null
  state.textInput = null
  state.spectators = null
  // client.js game_cleanup: chat.clear()
  state.chat = []
  state.rev.chat++
  state.dirtyCells = new Set()
  state.mapCleared = true
  state.rev.map++
  state.rev.player++
  state.rev.messages++
  state.rev.ui++
}

function mergeObjects<T extends object>(current: T | undefined, diff: Partial<T>): T {
  if (!current) return diff as T
  for (const k of Object.keys(diff)) (current as Record<string, unknown>)[k] = (diff as Record<string, unknown>)[k]
  return current
}

function mergeMonster(map: MapStore, oldMon: Monster | null | undefined, mon: Monster | null | undefined): Monster | null {
  if (oldMon && oldMon.refs) oldMon.refs--
  if (!mon) return null
  const id = mon.id
  let last = id !== undefined ? map.monsters.get(id) : undefined
  if (!last) {
    if (oldMon) last = mergeObjects(mergeObjects({} as Monster, oldMon), mon)
    else {
      last = mon
      last.att = last.att || 0
    }
  } else mergeObjects(last, mon)
  if (id !== undefined) {
    last.refs = (last.refs || 0) + 1
    map.monsters.set(id, last)
  }
  return last
}

function mergeCells(state: GameState, cells: MapCell[]) {
  const map = state.map
  let lastX = 0
  let lastY = 0
  for (const val of cells) {
    if (!val || typeof val !== 'object') {
      diag(state, 'map cell is not an object; skipped', undefined, val)
      continue
    }
    const x = val.x === undefined ? lastX + 1 : val.x
    const y = val.y === undefined ? lastY : val.y
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
      diag(state, 'map cell has a bad position; skipped', undefined, val)
      continue
    }
    lastX = x
    lastY = y
    const key = mapKey(x, y)
    let entry = map.cells.get(key)
    if (!entry) {
      entry = { x, y }
      map.cells.set(key, entry)
    }
    for (const prop of Object.keys(val)) {
      if (prop === 'x' || prop === 'y') continue
      if (prop === 'mon') {
        const mon = val.mon
        if (mon !== null && mon !== undefined && typeof mon !== 'object') {
          diag(state, 'map cell mon is not an object; skipped', undefined, val)
          continue
        }
        entry.mon = mergeMonster(map, entry.mon, mon)
      } else if (prop === 't') {
        const t = val.t
        if (!t || typeof t !== 'object') {
          // the official client would throw here; keep what we know and say so
          diag(state, 'map cell t is not an object; skipped', undefined, val)
          continue
        }
        entry.t = mergeObjects(entry.t, t)
        if (t.doll && t.trans === undefined) entry.t.trans = false
      } else (entry as Record<string, unknown>)[prop] = (val as Record<string, unknown>)[prop]
    }
    state.dirtyCells.add(key)
    if (map.bounds) {
      const b = map.bounds
      if (b.left > x) b.left = x
      if (b.right < x) b.right = x
      if (b.top > y) b.top = y
      if (b.bottom < y) b.bottom = y
    } else map.bounds = { left: x, top: y, right: x, bottom: y }
  }
  for (const [id, m] of map.monsters) if (!m.refs) map.monsters.delete(id)
}

/**
 * The lobby's "Play now" line (`set_game_links`, game_links.html): one
 * top-level `<span>` per game, holding a separator, the game's name, and,
 * when the server has checked the save slot, a nested `<span>` with the save
 * in brackets. The `#play-<id>` link is on the name when there is no save and
 * on the bracket text when there is one; a game whose slot another game type
 * holds ("[slot full]") has no link at all, and its id is only known from the
 * `(edit rc)` link's `data-game_id`, which the first game of an rc directory
 * carries.
 */
function parseGameLinks(html: string): GameLink[] {
  const out: GameLink[] = []
  for (const block of topLevelSpans(html)) {
    const ids = [...block.matchAll(/href=["']#play-([^"']+)["']/gi)].map((m) => decodeURIComponent(m[1]))
    const rc = /data-game_id=["']([^"']+)["']/i.exec(block)
    const id = ids[0] ?? (rc ? decodeURIComponent(rc[1]) : null)
    if (!id) continue
    // the nested span: "[save]", linked or not
    const inner = /<span[^>]*>\s*(?:<a[^>]*>)?\s*\[([^\]]*)\]\s*(?:<\/a>)?\s*<\/span>/i.exec(block)
    // the name: the link's text when the name is the link; otherwise what stands between the separator and the
    // save. The separator is the server's own markup (CDI: "<br>&nbsp;... latest version: &nbsp;"), so the name
    // is what follows its last colon or bar
    const head = inner ? block.slice(0, inner.index) : block
    const nameLink = /<a[^>]*href=["']#play-[^"']+["'][^>]*>([\s\S]*?)<\/a>/i.exec(head)
    const raw = nameLink ? nameLink[1] : head.replace(/<a[^>]*class=["']edit_rc_link["'][\s\S]*?<\/a>/gi, '')
    let text = htmlText(raw)
    if (!nameLink) text = text.slice(Math.max(text.lastIndexOf(':'), text.lastIndexOf('|')) + 1).trim()
    if (!text) continue
    const link: GameLink = { id, label: text }
    if (inner) {
      link.save = htmlText(inner[1])
      if (!ids.length) link.disabled = true
    }
    out.push(link)
  }
  return out
}

/** The text of a piece of the lobby's html: tags gone, entities decoded, whitespace (and `&nbsp;`) collapsed. */
function htmlText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(nbsp|amp|lt|gt|quot|#39|apos|#x[0-9a-f]+|#\d+);/gi, (_m, e: string) => {
      const k = e.toLowerCase()
      if (k === 'nbsp') return ' '
      if (k === 'amp') return '&'
      if (k === 'lt') return '<'
      if (k === 'gt') return '>'
      if (k === 'quot') return '"'
      if (k === '#39' || k === 'apos') return "'"
      return String.fromCodePoint(k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10))
    })
    .replace(/[\s\u00a0]+/g, ' ')
    .trim()
}

/** The bodies of the outermost `<span>` elements of `html`, in order. */
function topLevelSpans(html: string): string[] {
  const out: string[] = []
  const re = /<span\b[^>]*>|<\/span>/gi
  let depth = 0
  let start = -1
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    if (m[0][1] !== '/') {
      if (depth === 0) start = m.index + m[0].length
      depth++
    } else if (depth > 0) {
      depth--
      if (depth === 0 && start >= 0) out.push(html.slice(start, m.index))
    }
  }
  // a lobby without the spans (an older template): one link per anchor
  if (!out.length) {
    const re2 = /<a[^>]*href=["']#play-([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
    while ((m = re2.exec(html))) out.push(m[0])
  }
  return out
}

/**
 * Version a lobby game link belongs to, from its label or id: 'trunk' for
 * git/trunk builds, a numeric "0.34"-style string for stable releases, or
 * null when nothing recognisable is present.
 */
function gameLinkVersion(g: GameLink): string | null {
  const text = `${g.label} ${g.id}`
  if (/\b(trunk|git)\b/i.test(text)) return 'trunk'
  const m = /\b(\d+\.\d+)\b/.exec(text)
  return m ? m[1] : null
}

/**
 * True for the game variants the lobby does not offer: custom seed, Dungeon
 * Sprint and the tutorial. Matched on the label or the id ("seeded-web-trunk",
 * "sprint-0.34", "tut-web-trunk").
 */
function isHiddenGameLink(g: GameLink): boolean {
  return /\b(seed|seeded|sprint|tut|tutorial)\b/i.test(`${g.label} ${g.id}`) || /^(seeded|sprint|tut)-/i.test(g.id)
}

/**
 * Keep only the links for trunk and for the newest stable release. Links with
 * no recognisable version are kept, so unusual servers still show something.
 */
export function latestGameLinks(games: GameLink[]): GameLink[] {
  let latest: string | null = null
  const cmp = (a: string, b: string) => {
    const [a0, a1] = a.split('.').map(Number)
    const [b0, b1] = b.split('.').map(Number)
    return a0 - b0 || a1 - b1
  }
  for (const g of games) {
    const v = gameLinkVersion(g)
    if (v && v !== 'trunk' && (!latest || cmp(v, latest) > 0)) latest = v
  }
  return games.filter((g) => {
    const v = gameLinkVersion(g)
    return v === null || v === 'trunk' || v === latest
  })
}

/** The lobby's "Play now" rows: the newest stable release, trunk, and anything unversioned. */
export interface GameLinkRows {
  /** the newest stable version, e.g. "0.34", or null if the server has none */
  latestVersion: string | null
  latest: GameLink[]
  trunk: GameLink[]
  other: GameLink[]
}

/**
 * Split the links `latestGameLinks` keeps into the rows the official lobby
 * shows: "latest version:" and "trunk:". Older releases are dropped; nobody
 * plays them and they only push the player table down the screen. The custom
 * seed, Sprint and tutorial variants are dropped too (`isHiddenGameLink`).
 */
export function gameLinkRows(games: GameLink[]): GameLinkRows {
  const rows: GameLinkRows = { latestVersion: null, latest: [], trunk: [], other: [] }
  for (const g of latestGameLinks(games)) {
    if (isHiddenGameLink(g)) continue
    const v = gameLinkVersion(g)
    if (v === 'trunk') rows.trunk.push(g)
    else if (v === null) rows.other.push(g)
    else {
      rows.latestVersion = v
      rows.latest.push(g)
    }
  }
  return rows
}

const PLAYER_KEYS_IGNORED = new Set(['msg', 'inv'])

function applyPlayer(state: GameState, data: ServerMessage) {
  const p = state.player
  p.received = true
  p.changed = new Set()
  p.previous = {}
  // items taken from the floor: slots whose quantity grew (`_send_item`, tileweb.cc, sends it when it changes) and gold gained
  let gained = 0
  const inv = data.inv as Record<string, Partial<InvItem>> | undefined
  if (inv && typeof inv === 'object') {
    for (const i of Object.keys(inv)) {
      const slot = Number(i)
      const v = inv[i]
      if (!Number.isFinite(slot) || !v || typeof v !== 'object') {
        diag(state, 'player inv entry is malformed; skipped', data, { slot: i, value: v })
        continue
      }
      const item = (p.inv[slot] = p.inv[slot] || { slot })
      if (typeof v.quantity === 'number' && v.quantity > (item.quantity || 0)) gained++
      Object.assign(item, v)
      item.slot = slot
    }
    p.changed.add('inv')
  } else if (inv !== undefined) diag(state, 'player inv is not an object; skipped', data)
  if (typeof data.gold === 'number' && data.gold > (p.gold || 0)) gained++
  let arrived = false
  for (const k of Object.keys(data)) {
    if (PLAYER_KEYS_IGNORED.has(k)) continue
    const old = (p as Record<string, unknown>)[k]
    const nv = data[k]
    if (k === 'pos') {
      const np = nv as { x: number; y: number } | null
      if (!np || typeof np !== 'object' || typeof np.x !== 'number' || typeof np.y !== 'number') {
        diag(state, 'player pos is malformed; kept the previous position', data, nv)
        continue
      }
      if (!old || (old as { x: number }).x !== np.x || (old as { y: number }).y !== np.y) {
        p.changed.add('pos')
        p.previous.pos = old
        arrived = true
      }
      p.pos = { x: np.x, y: np.y }
      continue
    }
    // a new level under the same coordinates is a new cell too
    if ((k === 'place' || k === 'depth') && old !== nv) arrived = true
    if (k === 'status') {
      p.changed.add('status')
      p.previous.status = old
      p.status = Array.isArray(nv) ? (nv as StatusEntry[]).filter((e) => e && typeof e === 'object') : []
      if (nv && !Array.isArray(nv)) diag(state, 'player status is not a list; cleared', data, nv)
      continue
    }
    if (old !== nv) {
      p.changed.add(k)
      p.previous[k] = old
    }
    ;(p as Record<string, unknown>)[k] = nv
  }
  // after the loop, so `turn` in the same update counts whatever order the keys came in
  if (arrived) {
    p.arrivedTurn = typeof p.turn === 'number' ? p.turn : 0
    p.arrivedPickup = gained > 0
  }
  // taken from the pile underfoot (a manual pick-up, which prints no new floor-items line); on arrival the
  // gain is autopickup's, and `item_check`'s line about what it left follows in the same batch
  else if (gained && p.floorItems && itemsUnderfoot(state)) p.floorItems.picked += gained
  if ('time_last_input' in data) {
    if (state.watching) p.time_delta = p.time - (p.time_last_input ?? p.time)
    p.lastTime = p.time
  } else if ('time' in data) {
    if (typeof p.lastTime === 'number') p.time_delta = p.time - p.lastTime
    p.lastTime = p.time
    markMessages(state, 'turn')
  }
  state.rev.player++
}

/** items.cc `pickup`: the one line that says the cell under the player is bare. */
const NO_ITEMS_HERE = 'There are no items here.'
/** items.cc `item_check`: the head of a two-line listing; the names follow on the plain channel. */
const FLOOR_LIST_HEAD = 'Things that are here:'

/**
 * Keep `player.floorItems` (see `itemsUnderfoot`) in step with the message
 * log: a MSGCH_FLOOR_ITEMS line is the server saying items lie underfoot,
 * "There are no items here." that they do not. A line without a turn takes
 * the player's current one.
 */
function noteFloorItems(state: GameState, text: string, turn: unknown, channel: unknown) {
  const p = state.player
  if (channel === MSGCH.FLOOR_ITEMS) {
    p.floorItems = { turn: typeof turn === 'number' ? turn : typeof p.turn === 'number' ? p.turn : 0, lines: [text], picked: 0 }
    return
  }
  if (channel !== MSGCH.PLAIN || !p.floorItems) return
  const plain = text.replace(/<[^>]*>/g, '').trim()
  if (plain === NO_ITEMS_HERE) {
    p.floorItems = null
    return
  }
  // the names under "Things that are here:", the line right after it
  const lines = state.messages.lines
  const prev = lines[lines.length - 2]
  if (p.floorItems.lines.length === 1 && prev && prev.channel === MSGCH.FLOOR_ITEMS && prev.text.replace(/<[^>]*>/g, '').trim() === FLOOR_LIST_HEAD) p.floorItems.lines.push(text)
}

function markMessages(state: GameState, marker: 'turn' | 'command') {
  const lines = state.messages.lines
  if (lines.length) lines[lines.length - 1].marker = marker
  state.messages.more = false
  state.rev.messages++
}

function applyMenu(state: GameState, data: ServerMessage) {
  if (data.replace) state.menus.pop()
  const chunk = Array.isArray(data.items) ? (data.items as MenuItem[]) : []
  if (data.items !== undefined && !Array.isArray(data.items)) diag(state, 'menu items is not a list; ignored', data)
  const menu: MenuState = {
    tag: (data.tag as string) || '',
    type: data.type as string | undefined,
    flags: (data.flags as number) || 0,
    title: (data.title as { text: string }) || { text: '' },
    more: (data.more as string) || '',
    alt_more: (data.alt_more as string) || '',
    total_items: (data.total_items as number) ?? chunk.length,
    items: [],
    last_hovered: (data.last_hovered as number) ?? -1,
    chunk_start: (data.chunk_start as number) || 0,
    'ui-centred': data['ui-centred'] as boolean | undefined,
    jump_to: data.jump_to as number | undefined,
  }
  for (const k of Object.keys(data)) if (!(k in menu) && k !== 'msg' && k !== 'items') menu[k] = data[k]
  menu.items = new Array(Math.max(0, Number(menu.total_items) || 0))
  fillItems(state, menu, menu.chunk_start || 0, chunk)
  menu.stackOrder = state.uiStackOrder++
  state.menus.push(menu)
  state.rev.ui++
}

/**
 * `ui_cutoff`: the server hides everything on its ui stack at the moment it
 * says so. crawl pushes one (`ui::cutoff_point`, ui.cc `push_cutoff`) around
 * a screen that reads keys of its own, targeting above all (directn.cc
 * `direction_chooser::choose_direction`), and `cutoff` is the size of its
 * stack then (tileweb.cc `push_ui_cutoff`: `m_menu_stack.size()`, menus,
 * crt screens and popups counted together). The official client applies it
 * once, to the overlays present when the message arrives (game.js
 * `handle_set_ui_cutoff`: every `#ui-stack > .ui-popup` at index
 * `<= cutoff` gets `hidden`, and menu.js puts its menus on that stack too),
 * so a popup pushed afterwards, the description `v` opens in look mode, is
 * not hidden by it; the pop (`cutoff` back to -1, or the enclosing one)
 * unhides. Hence a flag on each overlay rather than an index applied at
 * every rebuild.
 */
function applyCutoff(state: GameState, cutoff: number) {
  state.uiCutoff = cutoff
  const all: (MenuState | Popup)[] = [...state.menus, ...state.ui]
  all.sort((a, b) => (a.stackOrder ?? 0) - (b.stackOrder ?? 0))
  all.forEach((o, i) => {
    o.hidden = i <= cutoff
  })
}

function fillItems(state: GameState, menu: MenuState, start: number, items: (MenuItem | string)[]) {
  if (!Array.isArray(items)) return
  if (!Number.isFinite(start) || start < 0) start = 0
  for (let i = 0; i < items.length; i++) {
    const idx = start + i
    if (idx >= menu.items.length) menu.items.length = idx + 1
    let it = items[i]
    if (typeof it === 'string') it = { text: it, level: 2 }
    if (!it || typeof it !== 'object') {
      // a null item leaves the slot as it was; the official client would throw
      diag(state, 'menu item is not an object; slot left as it was', undefined, { index: idx, item: it })
      continue
    }
    const existing = menu.items[idx]
    const merged = existing ? Object.assign(existing, it) : { ...it }
    if (it.colour === undefined) delete merged.colour
    if (it.tiles === undefined) delete merged.tiles
    if (it.hotkeys === undefined) delete merged.hotkeys
    if (merged.level === undefined) merged.level = 2
    menu.items[idx] = merged
  }
}

function applyText(state: GameState, data: ServerMessage) {
  const id = (data.id as string) || 'crt'
  let area = state.crt.areas.get(id)
  if (!area) {
    area = new Map()
    state.crt.areas.set(id, area)
  }
  if (id === 'crt') area = state.crt.lines
  const lines = (data.lines as Record<string, string>) || {}
  if (data.clear) {
    for (const k of Array.from(area.keys())) if (!(String(k) in lines)) area.delete(k)
  }
  for (const k of Object.keys(lines)) area.set(Number(k), lines[k])
  state.crt.areas.set(id, area)
  state.rev.ui++
}

/**
 * Apply one server message to the state, in place. Returns the same object.
 * Never throws on unknown input; problems go to `state.diagnostics`.
 */
export function reduce(state: GameState, m: ServerMessage): GameState {
  state.rev.any++
  if (!m || typeof m !== 'object' || typeof m.msg !== 'string') {
    diag(state, 'message is not an object with a msg field; ignored', undefined, m)
    return state
  }
  try {
    reduceUnchecked(state, m)
  } catch (e) {
    // a malformed field must never take the client down: note it, move on
    diag(state, 'reducer error: ' + (e instanceof Error ? e.message : String(e)), m, e)
  }
  return state
}

function reduceUnchecked(state: GameState, m: ServerMessage): void {
  switch (m.msg) {
    // ---- lobby / session
    case 'ping':
      break
    case 'lobby_clear':
      state.lobby.entries.clear()
      state.lobby.complete = false
      state.rev.lobby++
      break
    case 'lobby_entry': {
      const e = m as unknown as LobbyEntry
      state.lobby.entries.set(e.id, e)
      state.rev.lobby++
      break
    }
    case 'lobby_remove':
      state.lobby.entries.delete(m.id as number)
      state.rev.lobby++
      break
    case 'lobby_complete':
      state.lobby.complete = true
      state.rev.lobby++
      break
    case 'set_game_links':
      state.lobby.gameLinksHtml = (m.content as string) || ''
      state.lobby.games = parseGameLinks(state.lobby.gameLinksHtml)
      state.rev.lobby++
      break
    case 'html':
      if (m.id === 'banner') state.lobby.bannerHtml = (m.content as string) || ''
      state.rev.lobby++
      break
    case 'login_success':
      state.lobby.username = m.username as string
      state.lobby.admin = !!m.admin
      state.lobby.loginFailed = null
      state.rev.lobby++
      break
    case 'login_fail':
      state.lobby.loginFailed = (m.reason as string) || 'Login failed.'
      state.rev.lobby++
      break
    case 'login_cookie':
      state.lobby.loginCookie = { cookie: m.cookie as string, expires: m.expires as number }
      state.rev.lobby++
      break
    case 'register_fail':
      state.lobby.registerFailed = (m.reason as string) || 'Registration failed.'
      state.rev.lobby++
      break
    case 'logout':
      state.lobby.username = null
      state.rev.lobby++
      break
    case 'go_lobby':
      state.phase = 'lobby'
      state.watching = null
      resetGame(state)
      state.rev.lobby++
      break
    case 'login_required':
      state.phase = 'lobby'
      state.lobby.loginFailed = 'Login required to play.'
      state.rev.lobby++
      break
    case 'game_client':
      // the game's client bundle, sent after `game_started` (ws_handler.py start_crawl, then the process's
      // client_path): a game already started stays 'playing', else the gamedata is loading for one about to
      state.phase = state.watching ? 'watching' : state.phase === 'playing' ? 'playing' : 'loading'
      state.version.gamedataVersion = m.version as string
      state.version.content = (m.content as string) || null
      resetGame(state)
      break
    case 'game_started':
      state.phase = 'playing'
      state.watching = null
      state.exit = null
      // the stale game is gone (or never was); the notice about it goes with it
      state.lobby.staleProcesses = null
      state.lobby.forceTerminate = false
      break
    case 'watching_started':
      state.watching = { username: m.username as string }
      state.phase = 'watching'
      state.exit = null
      break
    case 'game_ended':
      state.phase = 'ended'
      // client.js crawl_ended/go_lobby: the exit is shown back in the lobby, worded for a watched game when it was one
      state.exit = { reason: m.reason as string, message: m.message as string, dump: m.dump as string, watched: state.watching?.username }
      break
    case 'update_spectators':
      state.spectators = { count: m.count as number, names: m.names as string }
      state.rev.chat++
      break
    case 'chat':
      pushChat(state, { sender: (m.sender as string) || '', html: (m.content as string) || '', meta: !!m.meta })
      break
    case 'server_announcement':
      // client.js server_announcement: shown in chat with a magenta caption
      pushChat(state, { sender: 'server', html: '<span class="fg5">Serverwide announcement: </span><span>' + ((m.text as string) || '') + '</span>', meta: true, automated: true })
      break
    case 'dump':
      // chat.js handle_dump: the character dump url is posted into chat
      pushChat(state, { sender: '', html: '<span class="chat_msg chat_automated">' + escapeHtml(((m.url as string) || '') + '.txt') + '</span>', automated: true })
      break
    case 'toggle_chat':
      state.chatVisible = !state.chatVisible
      state.rev.chat++
      break
    case 'super_hide_chat':
      state.chatVisible = false
      state.chatSuperHidden = true
      state.rev.chat++
      break
    case 'layer':
      // the official client's crt/normal layer switch; Orbrun derives its screens from state
      break
    case 'reload_url':
      state.lobby.reloadUrl = true
      state.rev.lobby++
      break
    case 'stale_processes':
      state.lobby.staleProcesses = { game: (m.game as string) || '', timeout: (m.timeout as number) || 0 }
      state.rev.lobby++
      break
    case 'force_terminate?':
      state.lobby.forceTerminate = true
      state.rev.lobby++
      break
    case 'set_account_hold':
      state.lobby.accountHold = true
      state.rev.lobby++
      break
    case 'clear_account_hold':
      state.lobby.accountHold = false
      state.rev.lobby++
      break
    case 'go_admin':
      state.lobby.admin = true
      state.rev.lobby++
      break
    case 'admin_log':
      state.lobby.adminLog.push((m.text as string) || '')
      if (state.lobby.adminLog.length > 200) state.lobby.adminLog.shift()
      state.rev.lobby++
      break
    case 'rcfile_contents':
      state.lobby.rcfile = { gameId: (m.game_id as string) ?? null, contents: (m.contents as string) || '' }
      state.rev.lobby++
      break
    case 'auth_error':
      state.lobby.loginFailed = (m.reason as string) || 'Authentication error.'
      state.rev.lobby++
      break

    // ---- game
    case 'version':
      state.version.text = m.text as string
      break
    case 'options':
      state.options = (m.options as ServerOptions) || {}
      state.rev.player++
      break
    case 'set_option':
      state.options[m.name as string] = m.value
      state.rev.player++
      break
    case 'layout': {
      const pane = m.message_pane as { height?: number; small_more?: boolean } | undefined
      if (pane?.height) state.messages.paneHeight = pane.height + (pane.small_more ? 0 : -1)
      break
    }
    case 'ui_state':
      state.uiState = m.state as number
      state.rev.ui++
      break
    case 'ui_cutoff':
      applyCutoff(state, m.cutoff as number)
      state.rev.ui++
      break
    case 'input_mode': {
      const mode = m.mode as number
      if (mode !== state.inputMode) {
        // leaving a mode that read a key is the key being read: message.cc `got_input`
        if (state.inputMode !== MouseMode.NORMAL) state.messages.readTo = state.messages.lines.length
        state.inputMode = mode
        if (mode === MouseMode.COMMAND) markMessages(state, 'command')
      }
      state.rev.ui++
      break
    }
    case 'delay':
    case 'flush_messages':
      state.flushPending = true
      break
    case 'map': {
      if (m.clear) {
        state.map = emptyMap()
        state.dirtyCells = new Set()
        state.mapCleared = true
      }
      if (m.player_on_level != null) state.map.playerOnLevel = !!m.player_on_level
      if (m.vgrdc) state.map.viewCenter = m.vgrdc as { x: number; y: number }
      if (m.cells) mergeCells(state, m.cells as MapCell[])
      if ('invis_mon_desc' in m) state.map.invisibleMonsterDesc = (m.invis_mon_desc as string) || ''
      state.rev.map++
      break
    }
    case 'player':
      applyPlayer(state, m)
      break
    case 'msgs': {
      const log = state.messages
      // messages.js applies both when both are present, in this order
      const rollback = Math.max(0, Number(m.rollback) || 0)
      if (rollback) log.lines.splice(-rollback, rollback)
      const old = Math.max(0, Number(m.old_msgs) || 0)
      if (old) log.lines.splice(-old, old)
      if ('more' in m) {
        log.more = !!m.more
        log.moreText = m.more_text && (m.more_text as string).length > 0 ? (m.more_text as string) : '--more--'
      }
      const msgs = m.messages as GameMessage[] | undefined
      if (Array.isArray(msgs))
        for (const line of msgs) {
          if (!line || typeof line !== 'object') {
            diag(state, 'message line is not an object; skipped', m, line)
            continue
          }
          const text = typeof line.text === 'string' ? line.text : String(line.text ?? '')
          log.lines.push({ text, turn: line.turn, channel: line.channel })
          noteFloorItems(state, text, line.turn, line.channel)
        }
      else if (msgs !== undefined) diag(state, 'messages is not a list; ignored', m)
      if (log.lines.length > 500) {
        log.readTo -= log.lines.length - 500
        log.lines.splice(0, log.lines.length - 500)
      }
      log.readTo = Math.max(0, Math.min(log.readTo, log.lines.length))
      state.rev.messages++
      break
    }
    case 'text_cursor':
      state.messages.textCursor = !!m.enabled
      state.rev.messages++
      break
    case 'cursor': {
      const id = m.id as number
      state.cursors[id] = (m.loc as { x: number; y: number } | undefined) ?? null
      state.rev.ui++
      break
    }
    case 'menu':
      applyMenu(state, m)
      break
    case 'update_menu': {
      const menu = state.menus[state.menus.length - 1]
      if (!menu) break
      for (const k of Object.keys(m)) if (k !== 'msg' && k !== 'items') menu[k] = m[k]
      if (typeof m.total_items === 'number') menu.items.length = m.total_items
      state.rev.ui++
      break
    }
    case 'update_menu_items': {
      const menu = state.menus[state.menus.length - 1]
      if (!menu) break
      fillItems(state, menu, (m.chunk_start as number) || 0, Array.isArray(m.items) ? (m.items as MenuItem[]) : [])
      state.rev.ui++
      break
    }
    case 'menu_scroll': {
      const menu = state.menus[state.menus.length - 1]
      if (!menu) break
      menu.server_first_visible = m.first as number
      if (m.force || state.watching) menu.last_hovered = m.last_hovered as number
      state.rev.ui++
      break
    }
    case 'title_prompt': {
      const menu = state.menus[state.menus.length - 1]
      if (!menu) break
      menu.titlePrompt = m.close ? null : { prompt: (m.prompt as string) || 'Select what? (regex) ', raw: !!m.raw }
      state.rev.ui++
      break
    }
    case 'close_menu':
      state.menus.pop()
      state.rev.ui++
      break
    case 'close_all_menus':
      state.menus = []
      state.rev.ui++
      break
    case 'ui-push':
      state.ui.push({
        type: m.type as string,
        generation_id: m.generation_id as number,
        'ui-centred': m['ui-centred'] as boolean,
        data: m,
        state: {},
        stackOrder: state.uiStackOrder++,
      })
      state.rev.ui++
      break
    case 'ui-pop':
      state.ui.pop()
      state.rev.ui++
      break
    case 'ui-stack': {
      // only meaningful for spectators joining mid-popup
      const items = (m.items as ServerMessage[]) || []
      if (state.ui.length === 0) for (const it of items) reduce(state, it)
      break
    }
    case 'ui-state': {
      const top = state.ui[state.ui.length - 1]
      if (top) {
        // ui-layouts.js newgame_choice_update: the player's own client returns at once on the
        // echo of its `outer_menu_focus` (`from_client`), so the popup is not touched and a
        // click on the button under the mouse lands; only a spectator follows the echo
        const echo = top.type === 'newgame-choice' && m.from_client === true && !state.watching
        Object.assign(top.state, m)
        if (echo) break
        if (m.type === 'formatted-scroller' && typeof m.text === 'string') top.data = { ...top.data, text: m.text }
        // formatted_scroller_update: the scroller's own scroll line rides on its ui-state
        if (m.type === 'formatted-scroller' && typeof m.scroll === 'number') {
          top.scroll = m.scroll
          top.scrollFromWebtiles = !!m.from_webtiles
          top.scrollSeq = (top.scrollSeq ?? 0) + 1
        }
      }
      state.rev.ui++
      break
    }
    case 'ui-state-sync': {
      // ui.js: spectators follow the player's focus and widget state; the
      // player's own client ignores echoes of what it sent (from_webtiles)
      const sync: UiStateSync = {
        generation_id: typeof m.generation_id === 'number' ? m.generation_id : undefined,
        widget_id: typeof m.widget_id === 'string' ? m.widget_id : null,
        has_focus: m.has_focus === undefined ? undefined : !!m.has_focus,
        from_webtiles: !!m.from_webtiles,
        data: m,
        seq: (state.uiSync?.seq ?? 0) + 1,
      }
      state.uiSync = sync
      const top = state.ui[state.ui.length - 1]
      if (top && (sync.generation_id === undefined || top.generation_id === undefined || top.generation_id === sync.generation_id)) top.sync = sync
      state.rev.ui++
      break
    }
    case 'ui-scroller-scroll': {
      // ui-layouts.js recv_ui_scroll: a line number for the top popup's
      // scroller (formatted scrollers and menus sync their own way)
      if (typeof m.scroll !== 'number') {
        diag(state, 'ui-scroller-scroll without a numeric scroll; ignored', m)
        break
      }
      state.uiScroll = { scroll: m.scroll, from_webtiles: !!m.from_webtiles, seq: (state.uiScroll?.seq ?? 0) + 1 }
      const top = state.ui[state.ui.length - 1]
      if (top && top.type !== 'formatted-scroller' && top.type !== 'menu') {
        top.scroll = m.scroll
        top.scrollFromWebtiles = !!m.from_webtiles
        top.scrollSeq = (top.scrollSeq ?? 0) + 1
      }
      state.rev.ui++
      break
    }
    case 'txt':
      applyText(state, m)
      break
    case 'clear':
      state.crt.lines.clear()
      state.rev.ui++
      break
    case 'show_dialog':
      state.dialog = (m.html as string) || ''
      state.rev.ui++
      break
    case 'hide_dialog':
      state.dialog = null
      state.rev.ui++
      // process_handler.py _kill_stale_process sends this once the stale game is stopped: the lobby's notices about it close too
      if (state.lobby.staleProcesses || state.lobby.forceTerminate) {
        state.lobby.staleProcesses = null
        state.lobby.forceTerminate = false
        state.rev.lobby++
      }
      break
    case 'init_input':
      state.textInput = { ...(m as unknown as TextInputState), text: ((m.prefill as string) || '').trim() }
      state.rev.ui++
      break
    case 'close_input':
      state.textInput = null
      state.rev.ui++
      break
    case 'update_input':
      if (state.textInput) state.textInput.text = (m.input_text as string) || ''
      state.rev.ui++
      break
    case 'game_ended_placeholder':
      break
    default:
      diag(state, 'unknown message type', m)
  }
}

// ---------------------------------------------------------------------------
// Derived helpers over GameState

export function topMenu(state: GameState): MenuState | undefined {
  return state.menus[state.menus.length - 1]
}

export function topPopup(state: GameState): Popup | undefined {
  return state.ui[state.ui.length - 1]
}

export function hasStatus(player: PlayerState, pattern: RegExp): boolean {
  return player.status.some((s) => s.text && pattern.test(s.text))
}

/**
 * The consumables action panel, as action_panel.js builds it: inventory items
 * with a quantity and `action_panel_order >= 0`, sorted by that order and
 * ties by `sub_type` as its own comparator does (by slot when an item came
 * without one). Each entry carries its inventory letter so a binding can act
 * on it.
 */
export function actionPanelItems(state: GameState): (InvItem & { letter: string })[] {
  const out: (InvItem & { letter: string })[] = []
  for (const item of Object.values(state.player.inv)) {
    if (!item || typeof item !== 'object') continue
    const order = item.action_panel_order
    if (typeof order !== 'number' || order < 0) continue
    if (!item.quantity) continue
    out.push({ ...item, letter: indexToLetter(item.slot) })
  }
  out.sort((a, b) => {
    const oa = a.action_panel_order as number
    const ob = b.action_panel_order as number
    if (oa !== ob) return oa - ob
    if (typeof a.sub_type === 'number' && typeof b.sub_type === 'number' && a.sub_type !== b.sub_type) return a.sub_type - b.sub_type
    return a.slot - b.slot
  })
  return out
}

export function indexToLetter(index: number): string {
  if (index === -1) return '-'
  if (index < 26) return String.fromCharCode(97 + index)
  return String.fromCharCode(65 + index - 26)
}
