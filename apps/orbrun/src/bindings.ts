import { Keys } from '@orbrun/webtiles'
import type { Dir8 } from '@orbrun/scene'
import type { Button, PadEvent } from './gamepad'
import { isFocusMode, type Context, type MenuContext, type ParsedPrompt, type ShopContext } from './context'
import type { FocusOp } from './focus'
import { menuHasSections } from './menu-nav'

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
 * offers one `held` step; the runner paces them (runner.ts `HELD_STEP_MS`),
 * sending the next only once the previous one has echoed back.
 */

export type Action =
  | { kind: 'step'; dir: RelDir; run?: boolean; attack?: boolean; turns?: boolean; held?: boolean } // turns: left / right rotate the camera (the d-pad and the left stick alike) instead of strafing; held: a repeat tick of a held direction
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
  /** `contextual`: the binding exists only because of the situation (a shop with marked rows), so the bar shows it unasked */
  | { kind: 'keys'; seq: KeyOrText[]; label: string; contextual?: boolean }
  /**
   * `altSelect` sends the hovered row's hotkey shifted (the shop's "put on shopping list");
   * `examine` describes the hovered row where it stands (menu.cc CMD_MENU_EXAMINE)
   */
  | { kind: 'menu'; op: 'next' | 'prev' | 'pageNext' | 'pagePrev' | 'sectionNext' | 'sectionPrev' | 'first' | 'last' | 'select' | 'altSelect' | 'examine' | 'toggle' | 'cancel' | 'left' | 'right' }
  | { kind: 'cursor'; dir: Dir8 }
  | { kind: 'prompt'; hotkey: string }
  /** the focus layer's cursor over the top overlay (popup, prompt, CRT screen, dialog) */
  | { kind: 'focus'; op: FocusOp }
  | { kind: 'ui'; op: 'commands' | 'travel' | 'palette' | 'system' | 'keyboard' | 'faceHostile' | 'toggleRenderer' | 'toggleView' | 'levelmap' | 'bindings' | 'scrollLog' | 'popupAction'; arg?: number; category?: CommandCategory; section?: string }
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
/** space, as the `--more--` loop takes it (message.cc `readkey_more`); also what a click on the ringed message pane sends (hud.ts) */
export const CONTINUE: Action = kc(Keys.SPACE, 'Continue')
const SPACE = CONTINUE
const palette = (category: CommandCategory, section?: string): Action => ({ kind: 'ui', op: 'palette', category, section })
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
  X: k('o', 'Autoexplore'),
  Y: k('i', 'Inventory'),
  LB: hold(k('.', 'Wait one turn'), k('5', 'Rest')),
  RB: { kind: 'ui', op: 'commands' },
  LT: { kind: 'fire' },
  RT: { kind: 'fight' },
  // either stick click examines: R3 for a right thumb already on the look stick, L3 for a left thumb resting on the move stick
  L3: { kind: 'examine' },
  R3: { kind: 'examine' },
  SELECT: { kind: 'ui', op: 'travel' },
  // the way out of a game from the pad: the Orbrun menu, with Save and exit on it
  START: SYSTEM,
}

const MENU: Partial<Record<Button, Action>> = {
  A: { kind: 'menu', op: 'select' },
  B: { kind: 'menu', op: 'cancel' },
  // the hovered row, described where it stands (the spell, ability and item menus' "[?] toggle ... description"
  // without the toggle, see Overlays.menuAction); `!` cycles the mode from the palette, or Left/Right on a row
  X: { kind: 'menu', op: 'examine' },
  Y: k('?', 'Help'),
  // the previous / next section (menu.cc cycle_headers, both ways); a menu without headers pages
  LB: { kind: 'menu', op: 'sectionPrev' },
  RB: { kind: 'menu', op: 'sectionNext' },
  LT: { kind: 'menu', op: 'toggle' },
  // Select stays the filter (documented); the palette's menu section holds the rest
  L3: palette('menu'),
  R3: k(',', 'Select all'),
  SELECT: ctrl('F', 'Filter'),
  START: situational(ENTER),
}

/**
 * The shop (`ShopMenu`): letters mark a row for purchase (or describe it in
 * examine mode), Enter buys what is marked (or the shopping list when
 * nothing is), `!` flips buy/examine, `$` moves the marks to the shopping
 * list and back, a shifted letter lists one row, `/` sorts. Every button's
 * label follows the state the server printed, so the bar reads "Unmark",
 * "Buy list" and so on rather than the key.
 */
function shopTable(shop: ShopContext): Partial<Record<Button, Action>> {
  const t: Partial<Record<Button, Action>> = {
    A: { kind: 'menu', op: 'select' },
    B: { kind: 'menu', op: 'cancel' },
    Y: { kind: 'menu', op: 'altSelect' },
    LB: { kind: 'menu', op: 'pagePrev' },
    RB: { kind: 'menu', op: 'pageNext' },
    L3: palette('menu'),
    R3: k('/', 'Sort'),
    START: ENTER,
  }
  // the server prints the mode as a live prompt (`[!] buy|examine items`, its lit half the current one), so the bar shows the
  // flip unasked. The label is the prompt's own text and does not change with the mode: the footer already lights the
  // current half, and a steady label lets the eye stay on the shop while the mode flips instead of re-reading the bar
  if (shop.canBuy) t.X = situational(k('!', 'Buy|examine'))
  if (shop.anyMarked) t.LT = situational(k('$', 'List marked'))
  else if (shop.canBuy && shop.anyListed) t.LT = situational(k('$', 'Mark listed'))
  // Enter with nothing marked and nothing listed does nothing in buy mode (purchase_selected returns)
  if (shop.canBuy && shop.anyMarked) t.START = situational(kc(Keys.ENTER, 'Buy marked'))
  else if (shop.canBuy && shop.anyListed) t.START = situational(kc(Keys.ENTER, 'Buy list'))
  else if (shop.mode === 'examine') t.START = kc(Keys.ENTER, 'Describe')
  return t
}

/** An aim (a throw, a spell): shaped like EXAMINE, with the mode's own action on A and on the trigger that opened it. */
const TARGETING: Partial<Record<Button, Action>> = {
  A: { kind: 'fire' },
  B: ESC,
  LB: k('-', 'Previous'),
  RB: k('+', 'Next'),
  X: k('v', 'Describe'),
  // the quiver, cycled inside the aim (CMD_TARGET_CYCLE_QUIVER_FORWARD / _BACKWARD): the shot to take is chosen
  // where it is aimed, and the bar's Fire label follows the server's new quiver line
  Y: hold(k(')', 'Next quiver'), k('(', 'Previous quiver')),
  // the same button as opened the aim confirms it, so tapping LT again and again fires shot after shot as `f f f` does
  LT: { kind: 'fire' },
  SELECT: palette('targeting'),
  START: ENTER,
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
 * live in the palette.
 */
const EXAMINE: Partial<Record<Button, Action>> = {
  A: { kind: 'examine' },
  B: ESC,
  LB: k('-', 'Previous monster'),
  RB: k('+', 'Next monster'),
  X: situational(k('.', 'Travel here')),
  Y: situational(k('?', 'Help')),
  LT: k('/', 'Previous item'),
  RT: k('*', 'Next item'),
  SELECT: palette('targeting'),
  START: ENTER,
}

const LEVELMAP: Partial<Record<Button, Action>> = {
  A: k('.', 'Travel here'),
  B: ESC,
  LB: k('<', 'Up stairs'),
  RB: k('>', 'Down stairs'),
  X: k('v', 'Describe'),
  Y: k('@', 'Find you'),
  // zoom is { / }; '+' and '-' scroll the map
  LT: kc(123, 'Zoom out'),
  RT: k('}', 'Zoom in'),
  SELECT: palette('levelmap'),
  START: ENTER,
}

/**
 * The focus layer's set, shared by every overlay that is not a server menu:
 * the d-pad moves one cursor over what the screen offers, A takes it, B
 * cancels, the bumpers page. Modes add a shortcut or two on top.
 */
const FOCUS: Partial<Record<Button, Action>> = {
  A: focus('select'),
  B: focus('cancel'),
  LB: focus('pagePrev'),
  RB: focus('pageNext'),
  SELECT: palette('command'),
  // Enter is a fallback A already covers: the hints do not need a Confirm chip next to the answer they name
  START: ENTER,
}

/**
 * A popup's first action, on X: a describe screen's pane switch
 * (Description | Status | Quote on a monster, `!`), or the first verb of a
 * popup without panes (the overview's Travel). The label is the action's own,
 * so the chip reads "Status" and then "Quote" as the panes cycle.
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
  if (prompt.yesno) for (const o of prompt.options) out.set(o.hotkey, o.hotkey.toLowerCase() === 'n' ? 'B' : 'A')
  return out
}

/**
 * The focus set, less B on a prompt Escape means nothing to
 * (`ParsedPrompt.cancel` false: the stat-gain prompt), so the bar never
 * offers a Cancel the game would ignore.
 */
function promptTable(prompt: ParsedPrompt): Partial<Record<Button, Action>> {
  if (prompt.cancel) return FOCUS
  const { B: _b, ...rest } = FOCUS
  return rest
}

const NEWGAME_EXTRA: Partial<Record<Button, Action>> = {
  X: k('*', 'Random'),
  Y: k('+', 'Recommended'),
}

const MORE: Partial<Record<Button, Action>> = {
  // A wears the prompt on the bar (the more is the situation); the rest continue too, unlabelled
  A: situational(SPACE),
  B: SPACE,
  X: SPACE,
  Y: SPACE,
  LT: SPACE,
  RT: SPACE,
  START: ENTER,
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

const SPECTATING: Partial<Record<Button, Action>> = {
  B: SYSTEM,
  START: SYSTEM,
  R3: { kind: 'ui', op: 'faceHostile' },
}

/** Table for the current context: what each face button does now. */
export function bindingTable(ctx: Context): Partial<Record<Button, Action>> {
  if (isFocusMode(ctx)) {
    switch (ctx.mode) {
      case 'newgame':
        return { ...FOCUS, ...NEWGAME_EXTRA }
      case 'yesno':
        return ctx.prompt ? promptTable(ctx.prompt) : FOCUS
      case 'prompt':
        // a prompt the parser made nothing of: the official client's own hints stay reachable
        return ctx.prompt ? promptTable(ctx.prompt) : { ...FOCUS, X: k('*', 'List'), Y: k('?', 'Help') }
      case 'dialog':
        return { A: FOCUS.A, B: FOCUS.B, START: ENTER }
      case 'popup':
        return ctx.popupActions?.length ? { ...FOCUS, X: POPUP_ACTION } : FOCUS
      default:
        // the focused item's second action (a skill row's "Set target") sits on Y while the cursor rests on one
        return ctx.focus?.altLabel ? { ...FOCUS, Y: focus('altSelect') } : FOCUS
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
      return ctx.menu?.shop ? shopTable(ctx.menu.shop) : MENU
    case 'targeting':
      return ctx.examining ? EXAMINE : TARGETING
    case 'levelmap':
      return LEVELMAP
    case 'text':
      return TEXT
    case 'spectating':
      return SPECTATING
    case 'lobby':
      return {}
    default:
      return FOCUS
  }
}

/** What A does on a focus screen with nothing to focus: close a popup, confirm anything else. */
export function focusFallback(ctx: Context): { select: 'close' | 'confirm'; label: string; cancelLabel: string } {
  const closes = ctx.mode === 'popup' || ctx.mode === 'dialog'
  return { select: closes ? 'close' : 'confirm', label: closes ? 'Close' : 'Confirm', cancelLabel: closes ? 'Close' : 'Cancel' }
}

/** Every binding of the context as a label, in display order. */
export function barLabels(ctx: Context): BindingLabel[] {
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
      return !!ctx.prompt?.options.some((x) => x.hotkey.toLowerCase() === a.hotkey.toLowerCase())
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
interface SheetCell {
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
      return { commands: 'Actions', travel: 'Commands', palette: 'Commands', system: 'Orbrun menu', keyboard: 'Keyboard', faceHostile: 'Face threat', toggleRenderer: 'View', toggleView: 'Camera', levelmap: 'Map', bindings: 'Gamepad', scrollLog: 'Log', popupAction: 'Action' }[a.op]
    default:
      return actionLabel(a, EMPTY_CTX)
  }
}

/** A context with nothing in it, for labels that do not depend on one. */
const EMPTY_CTX = { mode: 'command', layer: 'micro', ahead: { kind: 'floor' }, under: { kind: 'floor' } } as unknown as Context

export function actionLabel(a: Action, ctx: Context, button?: Button): string {
  switch (a.kind) {
    case 'keys':
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
      if (shop && a.op === 'select') return shop.mode === 'buy' ? (shop.hoveredMarked ? 'Unmark' : 'Mark') : 'Examine'
      if (shop && a.op === 'altSelect') return shop.hoveredListed ? 'Drop from list' : 'Add to list'
      if (shop && a.op === 'cancel') return 'Leave'
      if (a.op === 'sectionNext' || a.op === 'sectionPrev') {
        // the bumpers read as the jump they make: sections where the menu has headers, pages otherwise
        const sections = !!ctx.menu && menuHasSections(ctx.menu.menu)
        return a.op === 'sectionNext' ? (sections ? 'Next section' : 'Page down') : sections ? 'Previous section' : 'Page up'
      }
      return { next: 'Next', prev: 'Previous', pageNext: 'Page down', pagePrev: 'Page up', first: 'First', last: 'Last', select: 'Select', altSelect: 'List', examine: 'Examine', toggle: 'Toggle', cancel: 'Back', left: 'Left', right: 'Right' }[a.op]
    }
    case 'prompt': {
      const o = ctx.prompt?.options.find((x) => x.hotkey.toLowerCase() === a.hotkey.toLowerCase())
      return o ? o.label : a.hotkey === 'Y' || a.hotkey === 'y' ? 'Yes' : a.hotkey === 'N' || a.hotkey === 'n' ? 'No' : a.hotkey
    }
    case 'focus': {
      const f = ctx.focus
      const fb = focusFallback(ctx)
      switch (a.op) {
        case 'select':
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
      return { commands: 'Actions', travel: 'Commands', palette: 'Commands', system: 'Menu', keyboard: 'Keyboard', faceHostile: 'Face threat', toggleRenderer: 'View', toggleView: 'Camera', levelmap: 'Map', bindings: 'Gamepad', scrollLog: 'Log' }[a.op]
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
 * changed mode: LB in a menu pages on press, the menu closes,
 * and the release lands in command mode where LB is wait/rest. Only a
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

/** Resolve a pad event into an action, or null. */
export function resolve(ev: PadEvent, ctx: Context): Action | null {
  const t = bindingTable(ctx)
  if (ev.type === 'press' || ev.type === 'repeat') {
    // Buttons never auto-repeat: in particular, holding RT cannot fight continuously.
    if (ev.type === 'repeat') return null
    const a = t[ev.button]
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
        // the left stick is a d-pad: left / right turn the camera, never strafe.
        // held: one more single step per tick, paced by the runner; never a run
        if (ev.type === 'dirRepeat') return { kind: 'step', dir: ev.dir as RelDir, turns: true, held: true }
        return { kind: 'step', dir: ev.dir as RelDir, turns: true }
      }
      case 'menu':
        if (ev.dir === 0) return { kind: 'menu', op: 'prev' }
        if (ev.dir === 4) return { kind: 'menu', op: 'next' }
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
