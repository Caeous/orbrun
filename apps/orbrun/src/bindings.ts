import { Keys, MenuFlag, colouredText, type InvItem } from '@orbrun/webtiles'
import type { Dir8 } from '@orbrun/scene'
import type { Button, PadEvent } from './gamepad'
import { DEFAULT_YESNO, LOG_DEFAULT_COLOUR, isFocusMode, type Context, type MenuContext, type ParsedPrompt, type ShopContext } from './context'
import type { FocusOp } from './focus'
import { menuHasSections } from './menu-nav'
import { SHOUT, SHOUT_KEY, SWAP_WEAPONS, SWAP_WEAPONS_KEY } from './action-tabs'
import type { TouchGlyph } from './touch-glyphs'

export type RelDir = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7

/**
 * One key of a sequence. `await: 'prompt'` holds the key back until the
 * server has left command mode (a prompt, menu or popup opened) so a `G>`
 * style macro cannot spill its second key into the map when the first is
 * refused.
 */
export type KeyOrText = ({ key: number } | { text: string }) & { await?: 'prompt' }

/** A press shorter than this is a tap; longer runs the hold action. */
export const HOLD_MS = 400

/**
 * A held direction is a typewriter of single steps, never a run: a run
 * (Shift+dir) keeps going until the server decides to stop, so a stick held a
 * moment too long would carry the player across the level. Every repeat tick
 * offers one `held` step at the gamepad's repeat cadence. The runner sends
 * it immediately, without waiting for an echo or a camera animation; only
 * confirmed position updates move the displayed eye.
 */

export type Action =
  | { kind: 'step'; dir: RelDir; run?: boolean; attack?: boolean; turns?: boolean; held?: boolean } // turns: left / right rotate the camera instead of strafing, as this input's setting says; held: a repeat tick of a held direction
  | { kind: 'turn'; dir: 'left' | 'right' }
  | { kind: 'look'; dx: number; dy: number }
  /** A: act underfoot, then ahead. Overlapping interactions open a chooser. */
  | { kind: 'contextual'; alt?: boolean }
  /** RT: one normal DCSS autofight step, including the server's safety checks. */
  | { kind: 'fight' }
  /** Open look mode ahead, or describe the cursor's cell when already looking. */
  | { kind: 'examine' }
  /** Fire the quivered action (`f`), or confirm the shot when already aiming: `f` inside the aim prompt selects the target too. */
  | { kind: 'fire' }
  | { kind: 'hold'; tap: Action; hold: Action }
  /**
   * `contextual`: the binding exists only because of the situation (a shop with marked rows), so the bar shows it unasked;
   * `keepsMap`: the keys leave the level map for another screen, and the map stays drawn until that screen is up (map-hold.ts);
   * `repeats`: held, the button sends the keys again and again (`repeatsHeld`)
   */
  | { kind: 'keys'; seq: KeyOrText[]; label: string; contextual?: boolean; keepsMap?: boolean; repeats?: boolean }
  /**
   * `altSelect` sends the hovered row's hotkey shifted (the shop's "put on shopping list");
   * `examine` describes the hovered row where it stands (menu.cc CMD_MENU_EXAMINE)
   */
  | { kind: 'menu'; op: 'next' | 'prev' | 'pageNext' | 'pagePrev' | 'sectionNext' | 'sectionPrev' | 'first' | 'last' | 'select' | 'altSelect' | 'examine' | 'toggle' | 'cancel' | 'left' | 'right' }
  | { kind: 'cursor'; dir: Dir8 }
  | { kind: 'prompt'; hotkey: string }
  /** the focus layer's cursor over the top overlay (popup, prompt, CRT screen, dialog) */
  | { kind: 'focus'; op: FocusOp }
  | { kind: 'ui'; op: 'commands' | 'actionTab' | 'equipment' | 'palette' | 'system' | 'keyboard' | 'faceHostile' | 'toggleRenderer' | 'levelmap' | 'bindings' | 'scrollLog' | 'popupAction'; arg?: number; category?: CommandCategory; section?: string }
  | { kind: 'osk'; op: 'move' | 'type' | 'backspace' | 'space' | 'submit' | 'cancel' | 'shift'; dir?: Dir8 }

/** Which section of the command palette applies: the cmd-keys.h key table for the mode. */
export type CommandCategory = 'command' | 'levelmap' | 'targeting' | 'menu'

export interface BindingLabel {
  /** A button or a directional stick hint (not a stick click). */
  button: Button | 'LSTICK_UP' | 'LSTICK' | 'RSTICK' | 'DPAD'
  /** An unlearned control, not a contextual action; inert to pointer clicks. */
  teaching?: boolean
  label: string
  action: Action
  /** what a long press does, when the binding has one and it does something here */
  hold?: string
  /**
   * The label came from the situation (a monster ahead, stairs underfoot, a
   * prompt's own options) rather than from the table.
   */
  contextual: boolean
}

const k = (text: string, label: string): Action => ({ kind: 'keys', seq: [{ text }], label })
const focus = (op: FocusOp): Action => ({ kind: 'focus', op })
const kc = (key: number, label: string): Action => ({ kind: 'keys', seq: [{ key }], label })
/** Ctrl+letter as the official client sends it: the control code. */
const ctrl = (letter: string, label: string): Action => kc(letter.toUpperCase().charCodeAt(0) - 64, label)
const ESC: Action = kc(Keys.ESC, 'Cancel')
const ENTER: Action = kc(Keys.ENTER, 'Confirm')
/**
 * space, as the `--more--` loop takes it (message.cc `readkey_more`); also
 * what a click on the ringed message pane sends (hud.ts). It wears the game's
 * own word rather than ours: the pane says `--more--` where the stop happened,
 * and the chip under A says the same, so the two read as one thing.
 */
export const CONTINUE: Action = kc(Keys.SPACE, '--more--')
const SPACE = CONTINUE
const SYSTEM: Action = { kind: 'ui', op: 'system' }
const hold = (tap: Action, hold: Action): Action => ({ kind: 'hold', tap, hold })
/** A keys binding the situation created (a shop with rows marked): the bar shows it unasked (`isContextual`). */
const situational = (a: Action): Action => (a.kind === 'keys' ? { ...a, contextual: true } : a)

/** Shared actions the game screen sends outside the binding tables, so the bar can label them. */
export const AUTOFIGHT: Action = kc(Keys.TAB, 'Autofight')
export const LEVEL_MAP: Action = k('X', 'Level map')

/** Direct controls: no trigger layers, and only wait/rest uses a hold. */
const COMMAND: Partial<Record<Button, Action>> = {
  A: { kind: 'contextual' },
  B: ESC,
  // the two face buttons over A open screens: X the actions, Y the pack, each a face button
  // whose pages the bumpers turn (action-tabs.ts, pack-tabs.ts)
  X: { kind: 'ui', op: 'commands' },
  Y: { kind: 'ui', op: 'equipment' },
  // The right hand attacks -- a shot on RB, autofight on RT, which repeats while held (`repeatsHeld`) -- and the left hand does everything
  // that is not attacking. Explore and autofight, the tightest loop there is, stay on opposite
  // hands, so the pair you alternate constantly never shares a finger. Wait and rest are the
  // same verb at two lengths, so they share LB, beside autoexplore: the left hand passes the time.
  LB: hold(k('.', 'Wait'), k('5', 'Rest')),
  RB: { kind: 'fire' },
  LT: k('o', 'Autoexplore'),
  RT: { kind: 'fight' },
  // either stick click examines: R3 for a right thumb already on the look stick, L3 for a left thumb resting on the move stick
  L3: { kind: 'examine' },
  R3: { kind: 'examine' },
  // the level map, where the ways across the dungeon are (levelmapTable)
  SELECT: { kind: 'ui', op: 'levelmap' },
  // the way out of a game from the pad: the Orbrun menu, with Save and exit on it
  START: SYSTEM,
}

/**
 * A server menu. Where a button stands for one of the switches the menu
 * prints in its keyhelp (menu.cc `Menu::get_keyhelp`: select, page down, page
 * up, exit, toggle selected, accept) it wears that switch's own word, lower
 * case as the footer prints it, so the glyph reads as the key the footer
 * names. The rest (help, the filter, select all) are keys the keyhelp does
 * not print, and keep our names and our capitals. A button is only there
 * when it does something on this menu: marking and selecting all where rows
 * are marked, the filter where the menu filters, describing where rows have
 * a description behind them, the bumpers where there is a section or a page
 * to go to, accepting once something is marked.
 */
function menuTable(m: MenuContext | undefined, ctx: Context): Partial<Record<Button, Action>> {
  const t: Partial<Record<Button, Action>> = {
    A: { kind: 'menu', op: 'select' },
    B: { kind: 'menu', op: 'cancel' },
  }
  if (!m) return t
  // the menu's own help, on the key it names (the inventory's `_`); a menu that names none has none
  if (m.helpKey) t.Y = k(m.helpKey, 'Help')
  // X's actions as tabs (action-tabs.ts): the bumpers turn them, and Y and LT are the two actions that are no list
  if (m.actions) {
    if (EXAMINING_MENUS.has(m.menu.tag)) t.X = { kind: 'menu', op: 'examine' }
    return { ...t, LB: { kind: 'ui', op: 'actionTab', arg: -1 }, RB: { kind: 'ui', op: 'actionTab', arg: 1 }, Y: SWAP_WEAPONS, LT: SHOUT }
  }
  // the hovered row, described where it stands (the spell, ability and item menus' "[?] toggle ... description"
  // without the toggle, see Overlays.menuAction); Left/Right on a row cycles the mode, as `!` does
  if (EXAMINING_MENUS.has(m.menu.tag) && !m.togglesAtOnce) t.X = { kind: 'menu', op: 'examine' }
  // the previous / next section (menu.cc cycle_headers, both ways); a menu without headers pages, when it has pages.
  // In the pack the bumpers turn its pages, as Left and Right do (pack-tabs.ts), and the sections move to the triggers beside them
  const sectioned = m.sections || ctx.pageable
  // (a pack with one page to it keeps the sections on the bumpers)
  const turns = !!m.pack?.next
  if (turns) {
    t.LB = { kind: 'menu', op: 'left' }
    t.RB = { kind: 'menu', op: 'right' }
  } else if (sectioned) {
    t.LB = { kind: 'menu', op: 'sectionPrev' }
    t.RB = { kind: 'menu', op: 'sectionNext' }
  }
  if (m.multiselect && !m.togglesAtOnce) {
    t.LT = { kind: 'menu', op: 'toggle' }
    // `,` selects all (menu.cc CMD_MENU_SELECT_ALL); a paged inventory (drop) selects a category at a time instead
    if (!(m.menu.flags & MenuFlag.PAGED_INVENTORY)) t.R3 = k(',', 'Select all')
    // Start is Enter here (screenKey): it takes what is marked, so it is there once something is
    if (m.anyMarked) t.START = situational(kc(Keys.ENTER, 'accept'))
  }
  // Select is the filter
  if (m.filter) t.SELECT = ctrl('F', 'Filter')
  if (turns && sectioned) {
    t.LT = { kind: 'menu', op: 'sectionPrev' }
    t.RT = { kind: 'menu', op: 'sectionNext' }
  }
  return t
}

/**
 * The shop (`ShopMenu`): letters mark a row for purchase (or describe it in
 * examine mode), Enter buys what is marked (or the shopping list when
 * nothing is), `!` flips buy/examine, `$` moves the marks to the shopping
 * list and back, a shifted letter lists one row, `/` sorts.
 *
 * Every button that stands for one of the switches the shop prints in its
 * more line (shopping.cc `ShopMenu::update_help`) wears that switch's own
 * words, lower case and all: "buy marked items", "put item on shopping
 * list". The glyph stands where the footer prints the key, so the two read as
 * one sentence and nothing has to be translated between them -- and the
 * borrowed words stay lower case, which is what marks them as the game's
 * rather than ours. `$` is the exception: the shop binds it but never prints
 * it, so its label is ours and wears our capital.
 */
function shopTable(shop: ShopContext, pageable: boolean): Partial<Record<Button, Action>> {
  const t: Partial<Record<Button, Action>> = {
    A: { kind: 'menu', op: 'select' },
    B: { kind: 'menu', op: 'cancel' },
    Y: { kind: 'menu', op: 'altSelect' },
    R3: k('/', shop.sortOrder ? `sort (${shop.sortOrder})` : 'Sort'),
  }
  if (pageable) {
    t.LB = { kind: 'menu', op: 'pagePrev' }
    t.RB = { kind: 'menu', op: 'pageNext' }
  }
  // the server prints the mode as a live prompt (`[!] buy|examine items`, its lit half the current one), so the bar shows the
  // flip unasked. The label is the prompt's own text and does not change with the mode: the footer already lights the
  // current half, and a steady label lets the eye stay on the shop while the mode flips instead of re-reading the bar
  if (shop.canBuy) t.X = situational(k('!', 'buy|examine items'))
  if (shop.anyMarked) t.LT = situational(k('$', 'List marked'))
  else if (shop.canBuy && shop.anyListed) t.LT = situational(k('$', 'Mark listed'))
  // Enter with nothing marked and nothing listed does nothing in buy mode (purchase_selected returns)
  if (shop.canBuy && shop.anyMarked) t.START = situational(kc(Keys.ENTER, 'buy marked items'))
  else if (shop.canBuy && shop.anyListed) t.START = situational(kc(Keys.ENTER, 'buy shopping list'))
  else if (shop.mode === 'examine') t.START = kc(Keys.ENTER, 'describe')
  return t
}

/** An aim (a throw, a spell): shaped like EXAMINE, with the mode's own action on A and on the trigger that opened it. */
function targetingTable(ctx: Context): Partial<Record<Button, Action>> {
  const t: Partial<Record<Button, Action>> = {
    A: { kind: 'fire' },
    B: ESC,
    // the same button as opened the aim confirms it, so tapping RB again and again fires shot after shot as `f f f` does
    RB: { kind: 'fire' },
    X: k('v', 'Describe'),
  }
  // one button walks the targets, so the other bumper can stay the shot: the cycle wraps, so `-` (previous)
  // is not missed; with one target there is nowhere to walk
  if (ctx.hostilesInView > 1) t.LB = k('+', 'Next target')
  // the quiver, cycled inside the aim (CMD_TARGET_CYCLE_QUIVER_FORWARD / _BACKWARD): the shot to take is chosen
  // where it is aimed, and the bar's Fire label follows the server's new quiver line. A spell's aim cycles nothing
  if (ctx.aimQuiver) t.Y = hold(k(')', 'Next quiver'), k('(', 'Previous quiver'))
  return t
}

/**
 * Look mode, what `x` opens (directn.cc `_look_around_target`: `just_looking`,
 * the cursor starting on the player). Its keys differ from an aim's: `v`
 * describes the cell (CMD_TARGET_DESCRIBE, `describe_target`), while Enter,
 * `.` and `5` select it, which `do_look_around` turns into travel
 * (`start_travel`); Space cancels (`targeting_behaviour::get_command`). So A
 * describes, named for what the cursor rests on ("Examine goblin"), travel
 * moves to X and help sits on Y. The server prints those three itself
 * ("Press: ? - help, v - describe, . - travel"), so they are the situation's
 * own and the corner shows them (`situational`). The bumpers cycle monsters
 * (`-`/`+`), the triggers the items in view (`/`/`*`, cmd-keys.h
 * OBJ_CYCLE_BACK/FORWARD), B cancels; the finds (`<`, `>`, `_`, `^`, Tab, `r`)
 * have no button.
 */
function examineTable(ctx: Context): Partial<Record<Button, Action>> {
  const t: Partial<Record<Button, Action>> = {
    A: { kind: 'examine' },
    B: ESC,
    X: situational(k('.', 'Travel here')),
    Y: situational(k('?', 'Help')),
    LT: k('/', 'Previous item'),
    RT: k('*', 'Next item'),
  }
  // the monsters in view, one way and the other; with none there is nothing to cycle
  if (ctx.monstersInView > 0) {
    t.LB = k('-', 'Previous monster')
    t.RB = k('+', 'Next monster')
  }
  return t
}

/**
 * Leave the level map, then send a main-map command: crawl reads the keys in
 * order, and nothing flushes between. The map stays on screen meanwhile (map-hold.ts).
 */
const offMap = (label: string, key: KeyOrText): Action => ({ kind: 'keys', seq: [{ key: Keys.ESC }, key], label, contextual: true, keepsMap: true })

/**
 * The level map (X), and Select's: the pad's way across the dungeon. Unlike
 * an aim, the server prints no key help here, so the corner names all of
 * it. The bumpers put the cursor on the next stairs up or down (`<`/`>`,
 * CMD_MAP_FIND_UPSTAIR/DOWNSTAIR), A travels there; X describes the cell
 * (`v`), and the triggers zoom (`{`/`}`, cmd-keys.h CMD_MAP_ZOOM_OUT/IN, which
 * nudge `tile_map_scale` and send it back as a `set_option`). `{` goes as a
 * keycode: as text it would open a JSON message (keys.ts). `+` and `-`
 * scroll the map, so they are not zoom.
 *
 * Travel to a branch (`G`), the overview (Ctrl-O) and the stash search
 * (Ctrl-F) are main-map commands: inside the map `G` views another level
 * (CMD_MAP_GOTO_LEVEL) and Ctrl-F forgets it (CMD_MAP_FORGET), so those
 * buttons close the map first. Select closes it again.
 */
function levelmapTable(ctx: Context): Partial<Record<Button, Action>> {
  const t: Partial<Record<Button, Action>> = {
    B: ESC,
    LB: situational(k('<', 'Up stairs')),
    RB: situational(k('>', 'Down stairs')),
    X: situational(k('v', 'Describe')),
    // held, the triggers keep zooming, a step (tileweb.cc ZOOM_INC) every repeat
    LT: { kind: 'keys', seq: [{ key: 123 }], label: 'Zoom out', contextual: true, repeats: true },
    RT: { kind: 'keys', seq: [{ text: '}' }], label: 'Zoom in', contextual: true, repeats: true },
    L3: offMap('Find…', { key: 6 }),
    R3: offMap('Overview', { key: 15 }),
    SELECT: kc(Keys.ESC, 'Close'),
  }
  // the cursor away from the player: somewhere to travel to, and a way back to them; on them, Y travels further
  if (!ctx.mapCursorHome) {
    t.A = k('.', 'Travel here')
    t.Y = situational(k('@', 'Find you'))
  } else t.Y = offMap('Travel to…', { text: 'G' })
  return t
}

/**
 * The focus layer's set, shared by every overlay that is not a server menu:
 * the d-pad moves one cursor over what the screen offers, A takes it, B
 * cancels, the bumpers page. Modes add a shortcut or two on top.
 */
const FOCUS: Partial<Record<Button, Action>> = {
  A: focus('select'),
  B: focus('cancel'),
}

/** The focus set, with the bumpers where there is a page to turn (`Context.pageable`). */
function focusTable(ctx: Context): Partial<Record<Button, Action>> {
  return ctx.pageable ? { ...FOCUS, LB: focus('pagePrev'), RB: focus('pageNext') } : { ...FOCUS }
}

/**
 * A popup's first action, on X: a describe screen's pane switch
 * (Description | Status | Quote on a monster, `!`), or the first verb of a
 * popup without panes (the overview's Travel). The label is the row's own
 * words, so the chip reads the whole pane list and does not rename itself as
 * the panes cycle (overlays.ts `paneAction`).
 */
const POPUP_ACTION: Action = { kind: 'ui', op: 'popupAction', arg: 0 }

/**
 * The button a prompt's answer sits on, which is also the glyph its chip
 * wears: a yes/no puts Yes on A and No on B. A choice prompt's answers are
 * not on the face buttons at all: the card is a focus set like every other,
 * the d-pad walks its chips and A sends the focused one, so a three-way
 * prompt ("Increase (S)trength, (I)ntelligence, or (D)exterity?") reads and
 * plays like a menu, and no button means one thing here and another on the
 * next card. Its chips wear no glyph after the pad; the action bar names the
 * focused answer on A.
 */
export function promptButtons(prompt: ParsedPrompt): Map<string, Button> {
  const out = new Map<string, Button>()
  if (prompt.yesno) for (const o of prompt.options) out.set(o.hotkey, YESNO_BUTTONS[o.hotkey.toUpperCase()] ?? 'A')
  return out
}

/** A yes/no's answers on the face buttons: Yes on A, No on B, and a prompt's Always (prompt.cc `ask_always`) on X. */
const YESNO_BUTTONS: Record<string, Button> = { Y: 'A', N: 'B', A: 'X' }

/**
 * The focus set, less B on a prompt Escape means nothing to
 * (`ParsedPrompt.cancel` false: the stat-gain prompt), so the bar never
 * offers a Cancel the game would ignore.
 */
function promptTable(prompt: ParsedPrompt, ctx: Context): Partial<Record<Button, Action>> {
  // a yes/no: its answers are its buttons (there is no cursor), whatever crawl's default
  if (prompt.yesno) {
    const t: Partial<Record<Button, Action>> = {}
    for (const [hotkey, button] of promptButtons(prompt)) t[button] = { kind: 'prompt', hotkey }
    return t
  }
  const t = focusTable(ctx)
  if (prompt.cancel) return t
  // the stat gain: no way back, and no answer until the cursor lights one (updatePrompt)
  delete t.B
  if (!ctx.focus?.label) delete t.A
  return t
}

const NEWGAME_EXTRA: Partial<Record<Button, Action>> = {
  X: k('*', 'Random'),
  Y: k('+', 'Recommended'),
}

/**
 * Character creation: B is a step back, where crawl's Escape would abandon
 * the choices made so far. The step is the screen's own (`Context.newgameBack`);
 * on the first screen there is nothing to lose, so B is crawl's Escape there,
 * out of character creation altogether.
 */
function newgameTable(ctx: Context): Partial<Record<Button, Action>> {
  return { ...focusTable(ctx), ...NEWGAME_EXTRA, B: kc(ctx.newgameBack ?? 27, 'Back') }
}

/**
 * Only the keys `readkey_more` (message.cc) takes: space, Enter and Escape;
 * every other key it reads and drops. The pad keeps to that set, so the
 * buttons that autoexplore, autofight, wait and open the pack in command
 * mode do nothing here, as `o`, Tab, `.` and `i` do nothing there. A wears
 * the prompt on the bar (the more is the situation); B is crawl's Escape,
 * which also skips the rest of the turn's mores (`set_more_autoclear`).
 */
const MORE: Partial<Record<Button, Action>> = {
  A: situational(SPACE),
  B: kc(Keys.ESC, 'Skip'),
}

// B leaves, as it does everywhere else; X erases, RB puts a space
const TEXT: Partial<Record<Button, Action>> = {
  A: { kind: 'osk', op: 'type' },
  B: { kind: 'osk', op: 'cancel' },
  X: { kind: 'osk', op: 'backspace' },
  Y: { kind: 'osk', op: 'submit' },
  LB: { kind: 'osk', op: 'shift' },
  RB: { kind: 'osk', op: 'space' },
  START: { kind: 'osk', op: 'submit' },
  SELECT: { kind: 'osk', op: 'cancel' },
}

// a number pad (osk.ts) has no case to shift and no space to put
const NUMBER_TEXT: Partial<Record<Button, Action>> = (({ LB: _lb, RB: _rb, ...rest }) => rest)(TEXT)

/**
 * The skill target prompt (skill_menu.cc read_skill_target) opens off Y on a
 * skill row (overlays.ts crtBody: Set target), so Y does not also submit it:
 * a second press, or one held a beat, would send an empty target straight
 * back. Start alone confirms there.
 */
const SKILL_TARGET_TEXT: Partial<Record<Button, Action>> = (({ Y: _y, ...rest }) => rest)(NUMBER_TEXT)

/** The prompts whose keyboard Y does not submit (see SKILL_TARGET_TEXT). */
export function submitOnStartOnly(textTag: string | undefined): boolean {
  return textTag === 'skill_target'
}

/**
 * The prompts that take a number, where the on-screen keyboard is a number
 * pad (osk.ts `OskTarget.numpad`): a skill target, which may have a point
 * (skill-menu.cc _keyfun_target_input), and a depth to travel to.
 */
export function numberPrompt(textTag: string | undefined): 'whole' | 'decimal' | undefined {
  return textTag === 'skill_target' ? 'decimal' : textTag === 'travel_depth' ? 'whole' : undefined
}

const SPECTATING: Partial<Record<Button, Action>> = {
  B: SYSTEM,
  START: SYSTEM,
  R3: { kind: 'ui', op: 'faceHostile' },
}

/**
 * On a screen, the keyboard is a pad: the keys that stand for its buttons
 * become those buttons, and go down the same path (`resolve`, the runner),
 * so a key and the button it stands for can never do two different things.
 *
 * - Enter is A, the confirm, and Escape is B, the way back.
 * - Space is A too, except over text to read, where it pages as crawl's own
 *   scrollers do (menu-nav.ts `scrollKeyIntent`).
 * - The arrows are the d-pad on a screen with a cursor. On the map, in an aim
 *   and on the level map they stay the direction keys they are (keys.ts).
 * - PageUp and PageDown are the bumpers on a cursor's list.
 *
 * Two screens pair them otherwise, on purpose:
 * - a menu where rows are marked (drop, pickup, the shop): Enter takes what is
 *   marked, as crawl's Enter does, so Enter is Start there; A and Space mark.
 * - a yes/no: Enter stays crawl's, its default answer (the safe one), as the
 *   card says; A is Yes and B is No whatever the default.
 *
 * Null leaves the key to what it is on its own: typed text, a hotkey, raw.
 */
export function screenKey(key: string, ctx: Context, scrollsText = false): { button: Button } | { dir: Dir8 } | null {
  const mode = ctx.mode
  const cursor = isFocusMode(ctx) || mode === 'menu'
  const screen = cursor || mode === 'more' || mode === 'targeting' || mode === 'levelmap'
  // a yes/no's Enter and Space are its default answer (prompt.cc `yesno`, `f_keyfilter`): mashing
  // either through the --more-- before it lands on the safe answer, as in crawl
  if (!screen || (mode === 'yesno' && (key === 'Enter' || key === ' '))) return null
  switch (key) {
    case 'Enter':
      return { button: mode === 'menu' && ctx.menu?.multiselect ? 'START' : 'A' }
    case 'Escape':
      return { button: 'B' }
    case ' ':
      if (!cursor || scrollsText) return null
      return { button: 'A' }
    case 'ArrowUp':
      return cursor ? { dir: 0 } : null
    case 'ArrowRight':
      return cursor ? { dir: 2 } : null
    case 'ArrowDown':
      return cursor ? { dir: 4 } : null
    case 'ArrowLeft':
      return cursor ? { dir: 6 } : null
    // the bumpers page a cursor's list; a menu pages itself and text to read scrolls (menu-nav.ts)
    case 'PageUp':
      return isFocusMode(ctx) && !scrollsText ? { button: 'LB' } : null
    case 'PageDown':
      return isFocusMode(ctx) && !scrollsText ? { button: 'RB' } : null
  }
  return null
}

/** What a button does now, as a single press: the tap of a tap-or-hold. Null when it does nothing here. */
export function buttonAction(button: Button, ctx: Context): Action | null {
  const a = bindingTable(ctx)[button]
  if (!a) return null
  return a.kind === 'hold' ? a.tap : a
}

/** Table for the current context: what each face button does now. */
export function bindingTable(ctx: Context): Partial<Record<Button, Action>> {
  if (isFocusMode(ctx)) {
    switch (ctx.mode) {
      case 'newgame':
        return newgameTable(ctx)
      case 'yesno':
        return promptTable(ctx.prompt ?? DEFAULT_YESNO, ctx)
      case 'prompt':
        // a prompt the parser made nothing of: the official client's own hints stay reachable
        return ctx.prompt ? promptTable(ctx.prompt, ctx) : { ...focusTable(ctx), X: k('*', 'List'), Y: k('?', 'Help') }
      case 'dialog':
        return { A: FOCUS.A, B: FOCUS.B }
      case 'popup':
        return ctx.popupActions?.length ? { ...focusTable(ctx), X: POPUP_ACTION } : focusTable(ctx)
      default: {
        // the focused item's second action (a skill row's "Set target") sits on Y while the cursor rests on one
        const t = focusTable(ctx)
        if (ctx.focus?.altLabel) t.Y = focus('altSelect')
        return t
      }
    }
  }
  switch (ctx.mode) {
    case 'command':
      return COMMAND
    case 'macro':
      // macro capture: the server reads raw keys; only the system menu is ours
      return { B: ESC, START: ENTER }
    case 'more':
      return MORE
    case 'menu':
      return ctx.menu?.shop ? shopTable(ctx.menu.shop, !!ctx.pageable) : menuTable(ctx.menu, ctx)
    case 'targeting':
      return ctx.examining ? examineTable(ctx) : targetingTable(ctx)
    case 'levelmap':
      return levelmapTable(ctx)
    case 'text':
      return submitOnStartOnly(ctx.textTag) ? SKILL_TARGET_TEXT : numberPrompt(ctx.textTag) ? NUMBER_TEXT : TEXT
    case 'spectating':
      return SPECTATING
    case 'lobby':
      return {}
    default:
      return FOCUS
  }
}

/** The prompt up now, a yes/no's two answers when nothing was parsed (the bindings answer it all the same). */
function promptOf(ctx: Context): ParsedPrompt | undefined {
  return ctx.prompt ?? (ctx.mode === 'yesno' ? DEFAULT_YESNO : undefined)
}

/** What A does on a focus screen with nothing to focus: close a popup, confirm anything else. */
export function focusFallback(ctx: Context): { select: 'close' | 'confirm'; label: string; cancelLabel: string } {
  const closes = ctx.mode === 'popup' || ctx.mode === 'dialog'
  return { select: closes ? 'close' : 'confirm', label: closes ? 'Close' : 'Confirm', cancelLabel: closes ? 'Close' : 'Cancel' }
}

/** Every binding of the context as a label, in display order. Built once per context object: a frame asks several times. */
export function barLabels(ctx: Context): BindingLabel[] {
  const memo = barLabelsMemo.get(ctx)
  if (memo) return memo
  const out = buildBarLabels(ctx)
  barLabelsMemo.set(ctx, out)
  return out
}
const barLabelsMemo = new WeakMap<Context, BindingLabel[]>()

function buildBarLabels(ctx: Context): BindingLabel[] {
  const t = bindingTable(ctx)
  const out: BindingLabel[] = []
  for (const b of BAR_ORDER) {
    const a = t[b]
    if (!a) continue
    if (a.kind === 'hold') {
      const hold = actionLabel(a.hold, ctx, b)
      out.push({ button: b, label: actionLabel(a.tap, ctx, b), action: a.tap, hold: hold === NO_ACTION ? undefined : hold, contextual: isContextual(a, ctx) })
    } else out.push({ button: b, label: actionLabel(a, ctx, b), action: a, contextual: isContextual(a, ctx) })
  }
  return out
}

/**
 * The touch bar's fifteen cells, row by row from the top (hud.ts
 * `renderTouchBar`), named for what the map puts in them. A button stands
 * where its meaning puts it, not where the pad button it presses is: glass
 * has no feel, so a button's place and its word are all a finger has. Seven
 * cells hold the same thing on every screen (`TOUCH_ANCHORS`); the rest are
 * the screen's own (`touchLayout`, or `GENERIC_HOME` and `GENERIC_FREE`).
 * Start and Select have no cell on the map (a tap on the stats pane opens
 * what Start does, a tap on the minimap the level map), nor R3 (a hold on
 * the view, game.ts).
 */
export const TOUCH_CELLS = [
  ['corner', 'wait', 'examine', 'quiver', 'select'],
  ['spare', 'explore', 'up', 'fight', 'actions'],
  ['esc', 'left', 'down', 'right', 'gear'],
] as const

export type TouchCell = (typeof TOUCH_CELLS)[number][number]

export function isTouchCell(s: string): s is TouchCell {
  return TOUCH_CELLS.some((row) => (row as readonly string[]).includes(s))
}

/**
 * A touch button's picture: crawl's art by tile name (`icon`, overlays.ts
 * `commandTileId`), or a glyph of ours (`glyph`, touch-glyphs.ts) where
 * crawl draws none.
 */
export type TouchIcon = { icon?: string; glyph?: TouchGlyph }

/**
 * The cells that are for the same thing on every screen: Esc in the
 * bottom-left corner, the arrows an upturned T, Examine in the middle of the
 * top row and the screen's verb at its end. Where the screen gives one
 * nothing to do it stands dim under this word and picture (hud.ts), so every
 * screen is one keypad's shape and only what lights up changes.
 */
export const TOUCH_ANCHORS: Partial<Record<TouchCell, TouchIcon & { label: string }>> = {
  esc: { label: 'Esc', icon: 'PROMPT_NO' },
  up: { label: '↑' },
  left: { label: '←' },
  down: { label: '↓' },
  right: { label: '→' },
  examine: { label: 'Examine', icon: 'CMD_LOOKUP_HELP' },
  select: { label: 'Select', icon: 'PROMPT_YES' },
}

/**
 * A touch bar button: the binding it presses (`button`), standing in `cell`
 * and the `span` - 1 cells right of it, with its picture (`TouchIcon`) or an
 * item's own tile (`item`) over the word, and how many of it (`count`).
 * `auto`: it goes on by itself, turn after turn (`runsOn`).
 */
export type TouchLabel = BindingLabel & TouchIcon & { cell: TouchCell; span?: number; item?: InvItem['tile']; count?: number; auto?: boolean }

type TouchLayout = readonly (readonly (Button | null)[])[]

/**
 * The map, cell by cell as the user drew it: the passing of time left of the
 * arrows (Wait over Explore), the attacks right of them (the shot over
 * Fight), and at the edge the verb over the two screens X and Y open.
 */
const MAP_LAYOUT: TouchLayout = [
  [null, 'LB', 'L3', 'RB', 'A'],
  [null, 'LT', 'DU', 'RT', 'X'],
  ['B', 'DL', 'DD', 'DR', 'Y'],
]

/**
 * An aim keeps the map's shape. The shot's cell fires, so the shot tapped
 * twice is `f f`; A fires too, and the two cells side by side are one
 * button across both. The next target and the next shot stand either side
 * of the up arrow, the shot's under the shot.
 */
const AIM_LAYOUT: TouchLayout = [
  [null, null, 'X', 'RB', 'RB'],
  [null, 'LB', 'DU', 'Y', null],
  ['B', 'DL', 'DD', 'DR', null],
]

/**
 * Look mode: Examine, tapped again, describes what the cursor rests on, and
 * the screen's verb is travel there. The next item and the next monster
 * stand either side of the up arrow (the cycles wrap: one way is enough).
 */
const LOOK_LAYOUT: TouchLayout = [
  [null, null, 'A', null, 'X'],
  [null, 'RT', 'DU', 'RB', null],
  ['B', 'DL', 'DD', 'DR', null],
]

/** The level map, as the user drew it: zoom down the left, the stairs down the right, travel and the search at the edge. */
const LEVELMAP_LAYOUT: TouchLayout = [
  [null, 'RT', 'X', 'LB', 'A'],
  [null, 'LT', 'DU', 'RB', 'Y'],
  ['B', 'DL', 'DD', 'DR', 'L3'],
]

/** The screen's own layout, or null for one that places its buttons by the generic rule. A panel of ours over the map is no map. */
function touchLayout(ctx: Context, panel: boolean): TouchLayout | null {
  if (panel) return null
  if (ctx.mode === 'command') return MAP_LAYOUT
  if (ctx.mode === 'targeting') return ctx.examining ? LOOK_LAYOUT : AIM_LAYOUT
  if (ctx.mode === 'levelmap') return LEVELMAP_LAYOUT
  return null
}

/**
 * Where a screen without a layout of its own puts a button: Esc, the arrows
 * and A in their anchors, the triggers either side of the up arrow and the
 * bumpers either side of Examine, as on the map.
 */
const GENERIC_HOME: Partial<Record<Button, TouchCell>> = { B: 'esc', A: 'select', DU: 'up', DL: 'left', DD: 'down', DR: 'right', LT: 'explore', RT: 'fight', LB: 'wait', RB: 'quiver' }
/** the buttons with no home there, in the order they take `GENERIC_FREE` */
const GENERIC_REST: readonly Button[] = ['START', 'Y', 'X', 'R3', 'L3', 'SELECT']
/** what is left, down the right edge under A first, so a screen of a few buttons keeps them beside the one it is for */
const GENERIC_FREE: readonly TouchCell[] = ['actions', 'gear', 'explore', 'fight', 'wait', 'quiver', 'spare', 'corner']

/**
 * The touch bar's buttons (hud.ts `renderTouchBar`): the bindings as the bar
 * lists them (`barLabels`, or a panel of ours' own), each in its cell, less
 * what a finger has no use for: a button that does nothing here, and one the
 * screen has no cell for. The map, an aim, look mode and the level map have
 * a layout each (`touchLayout`); every other screen places its buttons by
 * one rule (`GENERIC_HOME`), and there the bumpers stand only on a keyboard,
 * whose Shift has no key of its own (the tabs and pages they turn elsewhere
 * are a finger's to tap and scroll), and a button that does what another
 * already does not at all. `panel`: the
 * labels are a panel of ours' (Overlays.padPrompts), up over the map: the
 * map's rules are not theirs. The d-pad's arrows are added wherever the
 * d-pad moves something (it is no binding of the tables, see `resolve`).
 */
export function touchLabels(labels: readonly BindingLabel[], ctx: Context, panel = false): TouchLabel[] {
  const has = new Map<Button, BindingLabel>()
  for (const l of labels) if (!l.teaching && l.label !== NO_ACTION && !has.has(l.button as Button)) has.set(l.button as Button, l)
  if (panel || dpadMoves(ctx)) for (const [b, label] of TOUCH_ARROWS) has.set(b, { button: b, label, action: { kind: 'keys', label, seq: [] }, contextual: false })
  const out: TouchLabel[] = []
  const put = (l: BindingLabel, cell: TouchCell, span = 1) => out.push({ ...touchFace(l, ctx, panel), cell, ...(span > 1 ? { span } : {}) })
  const layout = touchLayout(ctx, panel)
  if (layout) {
    layout.forEach((row, r) =>
      row.forEach((b, c) => {
        const l = b && has.get(b)
        // a button in two cells side by side is one button across both
        if (!l || (c > 0 && row[c - 1] === b)) return
        let span = 1
        while (row[c + span] === b) span++
        put(l, TOUCH_CELLS[r][c], span)
      }),
    )
    return out
  }
  const taken = new Set<TouchCell>()
  const placed: string[] = []
  const fits = (l: BindingLabel) => {
    const a = l.action
    if (placed.includes(JSON.stringify(a))) return false
    return (l.button !== 'LB' && l.button !== 'RB') || a.kind === 'osk'
  }
  const place = (l: BindingLabel, cell: TouchCell) => {
    taken.add(cell)
    placed.push(JSON.stringify(l.action))
    put(l, cell)
  }
  // a menu's describe of the lit row is Examine
  const home = (b: Button, l: BindingLabel) => (b === 'X' && l.action.kind === 'menu' && l.action.op === 'examine' ? 'examine' : GENERIC_HOME[b])
  for (const [b, l] of has) {
    const cell = home(b, l)
    if (cell && fits(l)) place(l, cell)
  }
  for (const b of GENERIC_REST) {
    const l = has.get(b)
    if (!l || home(b, l) || !fits(l)) continue
    const cell = GENERIC_FREE.find((c) => !taken.has(c))
    if (cell) place(l, cell)
  }
  return out
}

/**
 * A button's face on the touch bar (touchLabels): its word, short where
 * crawl's is long (`TOUCH_WORDS`), its picture (`touchIcon`), and the
 * quivered shot drawn on the button that shoots it, on the map and in the
 * aim it opens (`touchShot`), where the aim's own word ("Fire at goblin")
 * stays under the picture. B is Esc on every screen, whatever it is called
 * there (Cancel, Back, Close, Skip, No): one key, one name.
 */
function touchFace(l: BindingLabel, ctx: Context, panel: boolean): Omit<TouchLabel, 'cell'> {
  const auto = !panel && runsOn(l.action, ctx)
  const face = { ...l, ...(auto ? { auto } : {}) }
  // the d-pad's cells are their arrows, which the bar draws itself
  if (TOUCH_ARROWS.some(([b]) => b === l.button)) return face
  if (l.button === 'B') return { ...face, label: TOUCH_ANCHORS.esc!.label, ...ESC_ICON }
  const word = TOUCH_WORDS[l.label] ?? (l.action.kind === 'keys' ? TOUCH_WORDS[l.action.label] : undefined) ?? l.label
  const out = { ...face, label: word, ...touchIcon(l.action, ctx, panel) }
  if (!panel && l.action.kind === 'fire' && ctx.readiedAction && (ctx.mode === 'command' || (ctx.mode === 'targeting' && ctx.aimQuiver))) {
    const shot = touchShot(ctx.readiedAction, ctx.readiedTile)
    return { ...out, ...shot, label: ctx.mode === 'command' ? shot.label : l.label }
  }
  return out
}

/**
 * Whether a button goes on by itself, turn after turn, until something
 * happens: explore, fight, and travel from the level map or look mode
 * (styles.css `.tb.auto`).
 */
function runsOn(a: Action, ctx: Context): boolean {
  if (a.kind === 'fight') return true
  const key = lastKey(a)
  if (ctx.mode === 'command') return key === 'o'
  if (ctx.mode === 'levelmap') return key === '.' || key === 'G'
  return ctx.mode === 'targeting' && !!ctx.examining && key === '.'
}

/** the last key a keys action sends, as text or a keycode */
function lastKey(a: Action): string | number | undefined {
  const last = a.kind === 'keys' ? a.seq[a.seq.length - 1] : undefined
  return last === undefined ? undefined : 'text' in last ? last.text : last.key
}

/**
 * The quivered shot on the touch bar (touchLabels): the server's whole line
 * ("Drink: 3 potions of curing") is cut off on a button a fifth of a phone
 * wide. An item is drawn instead, under its verb, with the count from the
 * line ("Throw", 23 darts); a spell or an ability has no tile of its own and
 * goes by its name under crawl's icon for casting or using one.
 */
export function touchShot(readied: string, tile: InvItem['tile'] | undefined): { label: string; icon?: string; item?: InvItem['tile']; count?: number } {
  const m = /^([^:]+):\s*(.*)$/.exec(readied)
  if (!m) return { label: readied }
  const [, verb, what] = m
  if (tile !== undefined) {
    const n = /^(\d+)\s/.exec(what)
    return { label: verb, item: tile, ...(n ? { count: Number(n[1]) } : {}) }
  }
  return { label: what || verb, icon: verb === 'Cast' ? 'CMD_CAST_SPELL' : 'CMD_USE_ABILITY' }
}

/** the touch bar's own words for crawl's (touchLabels) */
const TOUCH_WORDS: Record<string, string> = { Autoexplore: 'Explore', Autofight: 'Fight', '--more--': 'Continue' }

const ours = (glyph: TouchGlyph): TouchIcon => ({ glyph })
const YES: TouchIcon = { icon: 'PROMPT_YES' }
const ESC_ICON: TouchIcon = { icon: 'PROMPT_NO' }
const LOOK: TouchIcon = { icon: 'CMD_LOOKUP_HELP' }
const LIST: TouchIcon = { icon: 'CMD_REPLAY_MESSAGES' }
const KEYBOARD: TouchIcon = { icon: 'CMD_KEYBOARD' }
const TRAVEL: TouchIcon = { icon: 'CMD_MAP_GOTO_TARGET' }
/** the Quiver tab's own picture (action-tabs.ts) */
const QUIVER: TouchIcon = { icon: 'MI_BOOMERANG' }
/** crawl's own help, the `?` it lists its commands under */
const HELP: TouchIcon = { icon: 'CMD_DISPLAY_COMMANDS' }
const NEXT = ours('next')
const PREV = ours('prev')

/**
 * A keys binding's picture, by the last key it sends: crawl's command art
 * for the key's command where its touch command bar has one (tilereg-cmd.cc,
 * the GUI atlas's `CMD_*`), a glyph of ours where it has none.
 */
const KEY_ICONS: Record<string, TouchIcon> = {
  o: { icon: 'CMD_EXPLORE' },
  '.': { icon: 'CMD_WAIT' },
  5: { icon: 'CMD_WAIT' },
  v: LOOK,
  ',': ours('all'),
  [SWAP_WEAPONS_KEY]: ours('swap'),
  [SHOUT_KEY]: ours('shout'),
  ')': QUIVER,
  '(': QUIVER,
  '+': ours('cycle'),
  '-': ours('cycle'),
  // the next item in view, as the level map's search for one draws it
  '*': { icon: 'CMD_MAP_FIND_STASH' },
  '/': { icon: 'CMD_MAP_FIND_STASH' },
  '<': { icon: 'CMD_MAP_FIND_UPSTAIR' },
  '>': { icon: 'CMD_MAP_FIND_DOWNSTAIR' },
  '@': { icon: 'CMD_MAP_FIND_YOU' },
  G: { icon: 'CMD_INTERLEVEL_TRAVEL' },
  // Find… is crawl's stash search (Ctrl-F), Overview its dungeon overview (Ctrl-O)
  6: { icon: 'CMD_SEARCH_STASHES' },
  15: { icon: 'CMD_DISPLAY_OVERMAP' },
  123: ours('zoom-out'),
  '}': ours('zoom-in'),
  // the shop's buy|examine flip, and its shopping list
  '!': ours('swap'),
  $: LIST,
  [Keys.ENTER]: ours('enter'),
  [Keys.ESC]: ESC_ICON,
  [Keys.SPACE]: YES,
}

/** the keys that mean another thing on one screen */
const MODE_KEY_ICONS: Partial<Record<Context['mode'], Record<string, TouchIcon>>> = {
  levelmap: { '.': TRAVEL },
  targeting: { '.': TRAVEL },
  menu: { 6: ours('filter'), '/': ours('sort') },
  // the new-game screens' Random is crawl's question mark, Recommended its hint
  newgame: { '*': { icon: 'ERROR' }, '+': { icon: 'STARTUP_HINTS' } },
  prompt: { '*': LIST },
}

const MENU_ICONS: Record<Extract<Action, { kind: 'menu' }>['op'], TouchIcon> = {
  select: YES,
  altSelect: LIST,
  examine: LOOK,
  toggle: ours('toggle'),
  cancel: ESC_ICON,
  next: NEXT,
  pageNext: NEXT,
  sectionNext: NEXT,
  right: NEXT,
  last: NEXT,
  prev: PREV,
  pagePrev: PREV,
  sectionPrev: PREV,
  left: PREV,
  first: PREV,
}

const FOCUS_ICONS: Record<FocusOp, TouchIcon> = {
  select: YES,
  cancel: ESC_ICON,
  // a skill row's Set target
  altSelect: ours('target'),
  next: NEXT,
  pageNext: NEXT,
  right: NEXT,
  last: NEXT,
  prev: PREV,
  pagePrev: PREV,
  left: PREV,
  first: PREV,
}

const UI_ICONS: Partial<Record<Extract<Action, { kind: 'ui' }>['op'], TouchIcon>> = {
  // X and Y wear the icon of the tab they open on, as their words name it
  commands: { icon: 'CMD_CAST_SPELL' },
  equipment: { icon: 'CMD_DISPLAY_INVENTORY' },
  // the palette is the screen's keys, for a player with no keyboard
  palette: KEYBOARD,
  keyboard: KEYBOARD,
  system: { icon: 'CMD_GAME_MENU' },
  levelmap: { icon: 'CMD_DISPLAY_MAP' },
  scrollLog: LIST,
  faceHostile: ours('target'),
}

/** a popup's verb, by its key: a describe screen's panes, the overview's travel, a feature's stairs */
const POPUP_ICONS: Record<string, TouchIcon> = {
  '!': ours('panes'),
  G: { icon: 'CMD_INTERLEVEL_TRAVEL' },
  '<': { icon: 'CMD_MAP_PREV_LEVEL' },
  '>': { icon: 'CMD_MAP_NEXT_LEVEL' },
  d: { icon: 'CMD_DROP' },
  Y: YES,
  y: YES,
}

const OSK_ICONS: Partial<Record<Extract<Action, { kind: 'osk' }>['op'], TouchIcon>> = {
  type: KEYBOARD,
  backspace: ours('backspace'),
  space: ours('space'),
  submit: ours('enter'),
  cancel: ESC_ICON,
  shift: ours('shift'),
}

/**
 * A touch button's picture (`TouchIcon`), so every button has one: the
 * screen's verb crawl's tick and the way back its cross (the art its touch
 * prompts answer with), the rest by what they do (`KEY_ICONS` and the
 * tables beside it), and a step on (`action`) for a verb there is no
 * picture for. `panel`: the label is a panel of ours', which the map's
 * meanings of a key are not.
 */
function touchIcon(a: Action, ctx: Context, panel: boolean): TouchIcon {
  switch (a.kind) {
    case 'contextual':
      return YES
    case 'fight':
      return { icon: 'CMD_AUTOFIGHT' }
    case 'examine':
      // crawl's magnifier, from its help lookup: Examine is looking about, which is what the glass says
      return LOOK
    case 'fire':
      // an aim's Fire is the cursor's target; the quivered shot's own picture goes over either (touchFace)
      return ctx.mode === 'targeting' ? ours('target') : QUIVER
    case 'keys': {
      // a menu's own help, on whichever key it names (the pack's `_`, look mode's `?`)
      if (a.label === 'Help') return HELP
      const key = String(lastKey(a))
      // the shop's Enter, in examine mode, describes
      if (key === String(Keys.ENTER) && ctx.menu?.shop?.mode === 'examine') return LOOK
      return (!panel && MODE_KEY_ICONS[ctx.mode]?.[key]) || KEY_ICONS[key] || ours('action')
    }
    case 'menu':
      return a.op === 'select' && ctx.menu?.shop?.mode === 'examine' ? LOOK : MENU_ICONS[a.op]
    case 'prompt': {
      const key = a.hotkey.toUpperCase()
      return key === 'N' ? ESC_ICON : key === 'A' ? ours('always') : YES
    }
    case 'focus':
      return FOCUS_ICONS[a.op]
    case 'ui':
      if (a.op === 'popupAction') return POPUP_ICONS[ctx.popupActions?.[a.arg ?? 0]?.key ?? ''] ?? ours('action')
      if (a.op === 'actionTab') return (a.arg ?? 1) < 0 ? PREV : NEXT
      return UI_ICONS[a.op] ?? ours('action')
    case 'osk':
      return OSK_ICONS[a.op] ?? ours('action')
    default:
      return ours('action')
  }
}

/** the d-pad's buttons, by their arrows (touchLabels) */
const TOUCH_ARROWS: readonly (readonly [Button, string])[] = [
  ['DU', '↑'],
  ['DL', '←'],
  ['DD', '↓'],
  ['DR', '→'],
]

/** Whether the d-pad moves something here (`resolve`'s directions): the player, a cursor, a list. A yes/no has no cursor. */
function dpadMoves(ctx: Context): boolean {
  if (ctx.mode === 'yesno' || ctx.prompt?.yesno) return false
  if (isFocusMode(ctx)) return true
  return ctx.mode === 'command' || ctx.mode === 'menu' || ctx.mode === 'targeting' || ctx.mode === 'levelmap' || ctx.mode === 'text'
}

/** Contextual prompts plus menu confirmation, the readied action and bump attacks. B stays implicit. */
export function promptLabels(ctx: Context): BindingLabel[] {
  const labels = barLabels(ctx).filter((l) => l.contextual && l.button !== 'B')
  if (ctx.mode === 'command' && ctx.ahead.kind === 'monster' && ctx.ahead.hostile) {
    labels.push({ button: 'LSTICK_UP', label: 'Attack ' + ctx.ahead.label, action: { kind: 'step', dir: 0 }, contextual: true })
  }
  return labels
}

/** Whether the binding's meaning here comes from the situation rather than the table (see promptLabels). */
function isContextual(a: Action, ctx: Context): boolean {
  switch (a.kind) {
    case 'contextual':
      return contextualLabel(ctx, a.alt) !== NO_ACTION
    case 'fight':
      // Autofight means the same thing every turn, so it is a lesson, not a
      // standing prompt (gamepad-hints). What the situation names is the bump
      // attack on the thing ahead, which promptLabels adds itself.
      return false
    case 'examine':
      // In look mode the cursor rests on something the server named.
      return ctx.mode === 'targeting' && !!ctx.examining
    case 'fire':
      // the server named what is quivered; while aiming, the cursor rests on the target.
      // Standing safe, the quivered shot is not the situation's own: it shows when
      // there is something to shoot at, alongside autofight.
      return ctx.mode === 'targeting' ? !ctx.examining : !!ctx.readiedAction && threatened(ctx)
    case 'hold':
      return isContextual(a.tap, ctx) || isContextual(a.hold, ctx)
    case 'keys':
      // wait/rest is the situation's own while hurt with nothing in view: resting is what the turn is for
      if (isRest(a) && restWorthwhile(ctx)) return true
      // the quiver cycle names the shot it would swap to, so it stands in the corner while there is one to swap
      if (isQuiverCycle(a)) return ctx.mode === 'targeting' && !ctx.examining && !!ctx.readiedAction
      return a.contextual === true
    case 'prompt':
      return !!promptOf(ctx)?.options.some((x) => x.hotkey.toLowerCase() === a.hotkey.toLowerCase())
    case 'focus':
      // the cursor rests on something with a name of its own (a spell, Yes); the fallbacks are the table's
      return a.op === 'select' ? !!ctx.focus?.label : a.op === 'cancel' ? !!ctx.focus?.cancelLabel : a.op === 'altSelect' ? !!ctx.focus?.altLabel : false
    case 'menu': {
      const shop = ctx.menu?.shop
      // the shop's letters mark and unmark; the label follows what the server printed
      if (shop) return a.op === 'select' || a.op === 'altSelect'
      // the cursor rests on a row that has a description behind it
      return a.op === 'examine' && !!ctx.menu && menuRowExamines(ctx.menu)
    }
    case 'ui':
      return a.op === 'popupAction' && !!ctx.popupActions?.[a.arg ?? 0]
    default:
      return false
  }
}

/**
 * The menus whose rows answer CMD_MENU_EXAMINE with a description: InvMenu's
 * (invent.cc `examine_index`: inventory, pickup, drop, use_item), the spell
 * and memorise menus (spl-cast.cc, spl-book.cc), abilities (ability.cc
 * `on_examine`), the shop, its list and the stash search (shopping.cc,
 * stash.cc `examine_index`). Menu::examine_index itself is a no-op, so on any
 * other menu (travel, prompt, the game menu) the key does nothing.
 */
const EXAMINING_MENUS = new Set(['inventory', 'pickup', 'use_item', 'spell', 'ability', 'shop', 'stash'])

/** The hovered row is one a description stands behind: X examines it (see `EXAMINING_MENUS`). */
function menuRowExamines(m: MenuContext): boolean {
  const menu = m.menu
  if (!EXAMINING_MENUS.has(menu.tag)) return false
  const i = menu.last_hovered
  return i !== undefined && i >= 0 && m.hoverable.includes(i) && !!menu.items[i]?.hotkeys?.length
}

/** The wait (`.`) or rest (`5`) key on its own, as the LB tap-or-hold sends them. */
function isRest(a: Action): boolean {
  return a.kind === 'keys' && a.seq.length === 1 && 'text' in a.seq[0] && (a.seq[0].text === '.' || a.seq[0].text === '5')
}

/** The quiver cycle (`)` / `(`) as the aim's Y sends it, either way round. */
function isQuiverCycle(a: Action): boolean {
  return a.kind === 'keys' && a.seq.length === 1 && 'text' in a.seq[0] && (a.seq[0].text === ')' || a.seq[0].text === '(')
}

/** Something worth attacking: a hostile ahead, or one in view for autofight to pick. */
export function threatened(ctx: Context): boolean {
  return (ctx.ahead.kind === 'monster' && ctx.ahead.hostile) || ctx.hostilesInView > 0
}

/** Hurt, in command mode, with no hostile in view: the wait/rest prompt shows unasked (see `isContextual`). */
function restWorthwhile(ctx: Context): boolean {
  return ctx.mode === 'command' && !!ctx.injured && ctx.hostilesInView === 0
}

/** The bar's display order: face buttons, the d-pad (clockwise from up), then shoulders, sticks, and the system pair. */
const BAR_ORDER: Button[] = ['A', 'B', 'X', 'Y', 'DU', 'DR', 'DD', 'DL', 'LB', 'RB', 'LT', 'RT', 'L3', 'R3', 'SELECT', 'START']

/** Which cluster of the controller a button belongs to, so the bar can group its prompts. */
export function buttonGroup(b: BindingLabel['button']): 'face' | 'dpad' | 'shoulder' | 'stick' | 'system' {
  if (b === 'A' || b === 'B' || b === 'X' || b === 'Y') return 'face'
  if (b === 'DPAD' || b === 'DU' || b === 'DR' || b === 'DD' || b === 'DL') return 'dpad'
  if (b === 'LB' || b === 'RB' || b === 'LT' || b === 'RT') return 'shoulder'
  if (b === 'L3' || b === 'R3' || b === 'LSTICK_UP' || b === 'LSTICK' || b === 'RSTICK') return 'stick'
  return 'system'
}

/** One cell of the controls sheet: the tap and, when there is one, the hold. */
export interface SheetCell {
  tap: string
  hold?: string
}

/** One row of the controls sheet. */
export interface SheetRow {
  button: Button
  action: SheetCell
}

/**
 * The command-mode bindings as a sheet, generated from the tables so the
 * overlay can never drift from what the buttons do. Context-dependent
 * actions get their generic name.
 */
export function controlSheet(): SheetRow[] {
  const cell = (a: Action | undefined): SheetCell | null => {
    if (!a) return null
    if (a.kind === 'hold') return { tap: staticLabel(a.tap), hold: staticLabel(a.hold) }
    return { tap: staticLabel(a) }
  }
  return BAR_ORDER.flatMap((button) => {
    const action = cell(COMMAND[button])
    return action ? [{ button, action }] : []
  })
}

/** A label that needs no context: what the sheet and settings show for an action. */
function staticLabel(a: Action): string {
  switch (a.kind) {
    case 'contextual':
      return 'Interact'
    case 'fight':
      return 'Autofight'
    case 'examine':
      return 'Examine'
    case 'fire':
      return 'Fire'
    case 'hold':
      return staticLabel(a.tap)
    case 'keys':
      return a.label
    case 'ui':
      return { commands: 'Actions', actionTab: 'Actions tab', equipment: 'Equipment', palette: 'Commands', system: 'Orbrun menu', keyboard: 'Keyboard', faceHostile: 'Face threat', toggleRenderer: 'View', levelmap: 'Level map', bindings: 'Gamepad', scrollLog: 'Log', popupAction: 'Action' }[a.op]
    default:
      return actionLabel(a, EMPTY_CTX)
  }
}

/** A context with nothing in it, for labels that do not depend on one. */
const EMPTY_CTX = { mode: 'command', layer: 'micro', ahead: { kind: 'floor' }, under: { kind: 'floor' } } as unknown as Context

export function actionLabel(a: Action, ctx: Context, button?: Button): string {
  switch (a.kind) {
    case 'keys':
      // on a --more-- the chip under A reads as the pane's more row does: its text, in the pane's white
      if (ctx.mode === 'more' && ctx.moreText && a.label === '--more--') return colouredText(ctx.moreText, LOG_DEFAULT_COLOUR, true)
      return a.label
    case 'contextual':
      return a.alt === undefined && hasInteractionChoice(ctx) ? 'Interact' : contextualLabel(ctx, a.alt)
    case 'fight':
      return 'Autofight'
    case 'examine':
      return ctx.mode === 'targeting' && ctx.examining ? 'Examine ' + (ctx.cursor?.label ?? 'here') : 'Examine'
    case 'fire':
      if (ctx.mode === 'targeting' && !ctx.examining) return ctx.cursor && ctx.cursor.kind !== 'none' ? 'Fire at ' + ctx.cursor.label : 'Fire'
      return ctx.readiedAction ?? 'Fire'
    case 'hold':
      return actionLabel(a.tap, ctx, button)
    case 'menu': {
      const shop = ctx.menu?.shop
      // the letter switches, in the shop's own words; they read the same marked or not, as the footer does
      if (shop && a.op === 'select') return shop.mode === 'buy' ? 'mark item for purchase' : 'examine item'
      if (shop && a.op === 'altSelect') return 'put item on shopping list'
      // the bumpers in the pack name the page they turn to
      const pack = ctx.menu?.pack
      if (pack?.next && (a.op === 'left' || a.op === 'right')) return (a.op === 'left' ? pack.prev : pack.next)!
      if (a.op === 'sectionNext' || a.op === 'sectionPrev') {
        // the bumpers read as the jump they make: sections where the menu has headers, pages otherwise
        const sections = !!ctx.menu && menuHasSections(ctx.menu.menu)
        return a.op === 'sectionNext' ? (sections ? 'Next section' : 'Page down') : sections ? 'Previous section' : 'Page up'
      }
      // nothing under the cursor on a single-select arrows menu: A leaves the menu (Overlays.menuOp), and says so
      if (a.op === 'select' && ctx.menu && ctx.menu.arrowsSelect && !ctx.menu.multiselect && ctx.menu.menu.last_hovered < 0) return 'exit'
      // select, page down, page up, exit and toggle selected are the keyhelp's own words (menu.cc Menu::get_keyhelp)
      return { next: 'Next', prev: 'Previous', pageNext: 'page down', pagePrev: 'page up', first: 'First', last: 'Last', select: 'select', altSelect: 'List', examine: 'Examine', toggle: 'toggle selected', cancel: 'exit', left: 'Left', right: 'Right' }[a.op]
    }
    case 'prompt': {
      const o = promptOf(ctx)?.options.find((x) => x.hotkey.toLowerCase() === a.hotkey.toLowerCase())
      // an answer read off the log wears the log's colour for it (context.ts `ParsedPrompt.options.colour`)
      if (o) return o.colour !== undefined ? colouredText(o.label, o.colour) : o.label
      return a.hotkey === 'Y' || a.hotkey === 'y' ? 'Yes' : a.hotkey === 'N' || a.hotkey === 'n' ? 'No' : a.hotkey
    }
    case 'focus': {
      const f = ctx.focus
      const fb = focusFallback(ctx)
      switch (a.op) {
        case 'select':
          // a prompt's answer under the cursor keeps the colour the log gave it (overlays.ts updatePrompt)
          if (f?.label && f.colour !== undefined) return colouredText(f.label, f.colour)
          return f?.label ?? fb.label
        case 'cancel':
          return f?.cancelLabel ?? fb.cancelLabel
        case 'altSelect':
          return f?.altLabel ?? ''
        default:
          return { next: 'Next', prev: 'Previous', left: 'Left', right: 'Right', pageNext: 'Page down', pagePrev: 'Page up', first: 'First', last: 'Last' }[a.op]
      }
    }
    case 'ui':
      if (a.op === 'popupAction') return ctx.popupActions?.[a.arg ?? 0]?.label || 'Action'
      // the bumpers on X's actions name the tab they turn to
      if (a.op === 'actionTab') return ((a.arg ?? 1) < 0 ? ctx.menu?.actions?.prev : ctx.menu?.actions?.next) ?? 'Actions tab'
      // X and Y name the first tab of what they open (action-tabs.ts, pack-tabs.ts)
      return { commands: 'Spells', equipment: 'Gear', palette: 'Commands', system: 'Character', keyboard: 'Keyboard', faceHostile: 'Face threat', toggleRenderer: 'View', levelmap: 'Level map', bindings: 'Gamepad', scrollLog: 'Log' }[a.op]
    case 'osk':
      return { move: 'Move', type: 'Type', backspace: 'Backspace', space: 'Space', submit: 'Done', cancel: 'Cancel', shift: 'Shift' }[a.op]
    case 'step':
      return 'Step'
    case 'turn':
      return 'Turn'
    case 'look':
      return 'Look'
    case 'cursor':
      return 'Cursor'
  }
  void button
  return ''
}

/** Whether A must ask which of two underfoot interactions the player intends. */
export function hasInteractionChoice(ctx: Context): boolean {
  const u = ctx.under
  return u.kind === 'feature' && !!u.items && ['stairs', 'hatch', 'portal', 'shop', 'transporter', 'altar'].includes(u.feature.type)
}

/** A contextual A with nothing to act on: the tap does nothing. */
export const NO_ACTION = 'Nothing'

/** A label the map names in lower case ("weapon shop"), as a prompt starts it. */
function sentenceCase(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

/**
 * The A button: what is underfoot first, then the door ahead. Only actions
 * with a target: never a bare step (the stick) or an attack (RT). Items ahead
 * are not offered: crawl picks up from the cell you stand on, and the player
 * learns to step onto a pile (the prompt appears underfoot).
 *
 * `alt` names the pickup option when items share a feature's tile; the pad
 * asks which interaction to use.
 *
 * A pile underfoot is named, not verbed: the prompt is the server's own line
 * for it (`floorItemsLabel`: "a staff of alchemy", "[[ ((" ), colour tags
 * kept, so the prompt beside `g` reads as the message log's line for the same
 * square does. Every other label is the client's own word, plain text; the HUD
 * renders both as formatted strings (hud.ts `chip`).
 */
export function contextualLabel(ctx: Context, alt = false): string {
  const a = ctx.ahead
  const u = ctx.under
  // underfoot the server named the pile ("You see here a +0 halberd."), so the prompt is that name, in the log's own words and colours
  if (alt) return u.kind === 'feature' && u.items ? u.items : NO_ACTION
  if (u.kind === 'feature') {
    const f = u.feature
    // the D:1 start square is the way out: `<` there asks "Are you sure you want to leave the Dungeon?
    // This will make you lose the game!" (main.cc _prompt_stairs), so the prompt says what it is, not Ascend
    if (f.type === 'stairs' && f.exit) return 'Leave dungeon'
    if (f.type === 'stairs' || f.type === 'hatch') return f.dir === 'down' ? 'Descend' : 'Ascend'
    if (f.type === 'portal' || f.type === 'transporter') return 'Enter'
    // the shop as the tile names it ("weapon shop"): the server never sends the shopkeeper's own name for a square
    if (f.type === 'shop') return sentenceCase(u.label)
    if (f.type === 'altar') return 'Altar'
  }
  if (u.kind === 'item') return u.label
  if (u.kind === 'feature' && u.items) return u.items
  if (a.kind === 'door-closed') return 'Open door'
  if (a.kind === 'feature' && a.feature.type === 'door' && a.feature.state === 'open') return 'Close door'
  // items ahead get no prompt: crawl picks up from the cell you stand on, and the player learns to step onto them
  return NO_ACTION
}

/**
 * Whether a press of `button` now opens a tap-or-hold decision. The decision
 * is taken on release (or after HOLD_MS), by which time the server may have
 * changed mode: X in a menu examines on press, the menu closes,
 * and the release lands in command mode where X is wait/rest. Only a
 * press that began as a tap-or-hold may fire a tap or a hold, so a button that
 * already acted on press does nothing more (game.ts `pad`).
 */
export function armsTapOrHold(button: Button, ctx: Context): boolean {
  return bindingTable(ctx)[button]?.kind === 'hold'
}

/** The hold half of a tap-or-hold binding, for the frame loop to fire once HOLD_MS has passed. */
export function holdAction(button: Button, ctx: Context): Action | null {
  const a = bindingTable(ctx)[button]
  return a?.kind === 'hold' ? a.hold : null
}

/**
 * Whether a held button sends this action again and again, as a held key does
 * on a keyboard: autofight, the one action pressed in a run of dozens, where
 * holding Tab is how the keyboard plays it, and the level map's zoom, a step
 * at a time as a held `}` takes it. Every repeat is resolved
 * against the context of the moment, so whatever the last swing opened -- a
 * `--more--`, a prompt, an aim -- binds the button to something else and the
 * run stops there rather than answering it.
 */
function repeatsHeld(a: Action): boolean {
  return a.kind === 'fight' || (a.kind === 'keys' && !!a.repeats)
}

/**
 * Resolve a pad event into an action, or null. `turns` says whether left and
 * right turn the camera for the direction source the event came from; the
 * two pad sources are asked apart even though one setting answers for both
 * (servers.ts `leftRightTurns`). Left alone, both turn, as they always have.
 */
export function resolve(ev: PadEvent, ctx: Context, turns: (source: 'dpad' | 'lstick') => boolean = () => true): Action | null {
  const t = bindingTable(ctx)
  if (ev.type === 'press' || ev.type === 'repeat') {
    const a = t[ev.button]
    // all but a handful of buttons fire once a press (`repeatsHeld`)
    if (ev.type === 'repeat') return a && repeatsHeld(a) ? a : null
    // a tap-or-hold binding is decided on release
    if (!a || a.kind === 'hold') return null
    return a
  }
  if (ev.type === 'release') {
    // the hold half fires from the frame loop as soon as HOLD_MS passes (see holdAction);
    // a release before that is the tap
    const a = t[ev.button]
    if (a?.kind === 'hold' && ev.held < HOLD_MS) return a.tap
    return null
  }
  if (ev.type === 'dir' || ev.type === 'dirRepeat') {
    if (ev.dir === null) return null
    if (isFocusMode(ctx)) {
      const ops: Partial<Record<Dir8, FocusOp>> = { 0: 'prev', 4: 'next', 6: 'left', 2: 'right' }
      const op = ops[ev.dir]
      return op ? focus(op) : null
    }
    switch (ctx.mode) {
      case 'command': {
        // the left stick is a d-pad, and each says for itself whether left and
        // right turn the camera or strafe.
        // held: one more single step per tick, paced by the runner; never a run
        // the right stick's directions are only ever its turn (gamepad.ts `rightStickTurns`)
        const t = ev.source === 'rstick' || turns(ev.source)
        if (ev.type === 'dirRepeat') return { kind: 'step', dir: ev.dir as RelDir, turns: t, held: true }
        return { kind: 'step', dir: ev.dir as RelDir, turns: t }
      }
      case 'menu':
        if (ev.dir === 0) return { kind: 'menu', op: 'prev' }
        if (ev.dir === 4) return { kind: 'menu', op: 'next' }
        // X's actions: left and right turn the tabs, as they turn the pack's pages (crawl's own, there)
        if (ctx.menu?.actions && (ev.dir === 6 || ev.dir === 2)) return { kind: 'ui', op: 'actionTab', arg: ev.dir === 6 ? -1 : 1 }
        if (ev.dir === 6) return { kind: 'menu', op: 'left' }
        if (ev.dir === 2) return { kind: 'menu', op: 'right' }
        return null
      case 'targeting':
        return { kind: 'cursor', dir: ev.dir }
      case 'levelmap':
        return { kind: 'cursor', dir: ev.dir }
      case 'text':
        return { kind: 'osk', op: 'move', dir: ev.dir }
      case 'spectating':
        if (ev.type === 'dir') return { kind: 'ui', op: 'scrollLog', arg: ev.dir === 0 ? -1 : ev.dir === 4 ? 1 : 0 }
        return null
      default:
        return null
    }
  }
  if (ev.type === 'look') return { kind: 'look', dx: ev.dx, dy: ev.dy }
  return null
}
