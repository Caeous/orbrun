import { cm, Keys, MouseMode, MSGCH, type ClientMessage } from '@orbrun/webtiles'
import { DIR8_DX, DIR8_DY, dirFromDelta, rotateDir, type Dir8 } from '@orbrun/scene'
import type { Session } from './session'
import type { CameraController } from './camera'
import { AUTOFIGHT, hasInteractionChoice, type Action, type CommandCategory, type KeyOrText, type RelDir } from './bindings'
import type { Context, Mode } from './context'
import type { FocusOp } from './focus'

/** DCSS movement keys by absolute compass direction. */
const MOVE_KEYS = ['k', 'u', 'l', 'n', 'j', 'b', 'h', 'y'] as const

/** How long a first press of a dangerous action stays armed for its confirming second press. */
const CONFIRM_WINDOW_MS = 2000

/** How long after a step the runner sent a position change may still be that step's. */
export const OWN_STEP_WINDOW_MS = 1500

/** How long after an `x` went out the targeting mode that follows may still be its look mode. */
export const LOOK_WINDOW_MS = 1500

/** The last step the runner initiated, so auto-facing knows a move was ours. */
export interface LastStep {
  /** the absolute direction sent */
  dir: Dir8
  /** the camera was aimed along it: a forward step or an attack, never a strafe */
  turned: boolean
  t: number
}

/**
 * Whether a move `dx, dy` echoed by the server is the runner's own step:
 * `last` was sent within OWN_STEP_WINDOW_MS *and* in the direction the feet
 * actually went. A step that went another way was not ours: an explore or
 * travel that stopped after one cell (a monster came into view) right after
 * a keyed step must be treated as path-driven, or the camera faces the road
 * and never the threat.
 *
 * The scene is rebuilt once per frame, so a stick held sideways can have two
 * or three echoed steps land in one update as a multi-cell displacement.
 * With `hops` (the one-cell moves the server sent since the last scene,
 * game.ts `trackHop`) that is still ours when every hop went the step's way;
 * otherwise a strafe would read as a walk and turn the camera to face it.
 */
export function stepIsOurs(last: LastStep | null, dx: number, dy: number, now: number, hops: { dx: number; dy: number }[] = []): boolean {
  if (!last || now - last.t >= OWN_STEP_WINDOW_MS) return false
  if (hops.length > 0) return hops.every((h) => dirFromDelta(h.dx, h.dy) === last.dir)
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return false
  return dirFromDelta(dx, dy) === last.dir
}

export interface RunnerHooks {
  context(): Context
  ui(op: string, arg?: number, category?: CommandCategory, section?: string): void
  osk(op: string, dir?: Dir8): void
  menu(op: string): void
  focus(op: FocusOp): void
  status(text: string): void
  /** the "confirm dangerous actions" setting: stairs need a second press while hostiles are in view */
  confirmDangerous(): boolean
  now(): number
  /** A melee attack went out: the weapon lifts a touch (rendering-3d.md II.7). */
  swing(): void
}

/**
 * Executes actions and owns the only path to `Connection.send` for game
 * input. Relative movement, sequencing with verification, and prompts.
 */
export class Runner {
  private session: Session
  private cam: CameraController
  private hooks: RunnerHooks
  private sequence: { steps: (() => Promise<boolean>)[]; abort: () => void } | null = null
  /** last step the runner initiated, so auto-facing knows it was ours */
  lastStep: LastStep | null = null
  /** a dangerous action awaiting its confirming second press */
  private armed: { what: string; t: number } | null = null
  /** look mode: `x` went out (`pending`), the server opened its targeting (`active`) */
  private look: { state: 'idle' | 'pending' | 'active'; t: number } = { state: 'idle', t: 0 }
  /**
   * fire holds the view: `f` went out (`pending`), the server opened its aim
   * (`active`). While it holds, the cursor's arrival on a default target
   * turns nothing; the first cursor step releases it (`step`).
   */
  private hold: { state: 'idle' | 'pending' | 'active'; t: number } = { state: 'idle', t: 0 }
  /** the facing when the last command went out: where an aim it opens starts */
  private aimFacing: Dir8 = 0
  /** the aim up now already had its cursor started ahead (or arrived elsewhere) */
  private aimed = false

  constructor(session: Session, cam: CameraController, hooks: RunnerHooks) {
    this.session = session
    this.cam = cam
    this.hooks = hooks
  }

  send(msg: ClientMessage) {
    if (this.session.watching) return
    if (this.hooks.context().mode === 'command') {
      // any command may open an aim; its cursor starts where the player faced
      // as the key went out, before a look snaps the view (`startAimAhead`)
      this.aimFacing = this.cam.facing
      // autofight swings at the nearest hostile: face it, whichever path sent
      // the key. Only swing when the press actually attacks: with the target
      // out of reach autofight walks toward it, and the camera closes on that
      // monster with it (camera.ts `autofight`); with none in view it refuses.
      if (msg.msg === 'key' && (msg.keycode === Keys.TAB || msg.keycode === Keys.CK_SHIFT_TAB)) {
        if (this.cam.autofight(this.session.scene)) this.hooks.swing()
      }
      // explore with an unsafe monster in view (hostile or neutral, not a
      // plant: nearby-danger.cc `mons_is_safe`): the server refuses with
      // "X is nearby!" and nothing moves, so the refusal is the event to face,
      // and the nearest blocker is faced at once; the reply's name, if it
      // gives one, corrects that (warnings.ts). With none in view, the steps
      // that follow drive the camera: they are the explore's, not ours,
      // however recently we last stepped.
      if (isExplore(msg)) {
        this.lastStep = null
        this.cam.faceBlocker(this.session.scene)
      }
      // look mode (`x`, typed or from LB): the view is not turned; the
      // direction keys and the d-pad read against the grid the player sees
      // (camera `gridFacing`), and the heading is kept while the cursor
      // walks in front (game.ts `faceCursor`). The targeting that follows
      // `x` is remembered as look mode, which the server does not
      // distinguish from an aim (`examining`). Fire (`f`, typed or from LT)
      // locks onto crawl's default target wherever it stands, and the view
      // is not to swing for that: it holds its heading until the cursor is
      // first stepped (`step`, `holdingView`). Any other command drops a
      // hold a refused `f` left behind.
      if (isLookAround(msg)) this.look = { state: 'pending', t: this.hooks.now() }
      this.hold = isFire(msg) ? { state: 'pending', t: this.hooks.now() } : { state: 'idle', t: 0 }
      this.session.send(msg)
      // a look, or a fire with no hostile for crawl to pick, opens on the
      // player: the cell ahead goes out with the key, before the server
      // has even opened the aim (`aimAt`; safe wherever it lands)
      const ctx = this.hooks.context()
      if (isLookAround(msg) || (isFire(msg) && ctx.hostilesInView === 0 && ctx.readiedAction)) this.aimAt(this.aimAhead())
      return
    }
    this.session.send(msg)
  }

  /** The cell one step from the player along the facing an aim started from. */
  private aimAhead(): { x: number; y: number } | null {
    const scene = this.session.scene
    if (!scene.playerOnLevel) return null
    return { x: scene.player.x + DIR8_DX[this.aimFacing], y: scene.player.y + DIR8_DY[this.aimFacing] }
  }

  /**
   * Put an open aim's cursor on a cell with the WebTiles `target_cursor`
   * message, the one the mouse sends as it hovers while aiming. It is safe
   * to send before the aim is up, or when it never comes: tileweb.cc
   * `_handle_cell_target` moves the target only inside a direction chooser
   * (MOUSE_MODE_TARGET / _PATH, `targeting_mouse_move`) and yields
   * CK_REDRAW otherwise, which the command loop, a --more-- and the spell
   * prompt all treat as a redraw; a direction key in their place would step,
   * dismiss, or pick a spell. Messages reach crawl in order, one per read,
   * so one sent right after `x` lands inside the look it opens.
   */
  private aimAt(cell: { x: number; y: number } | null) {
    if (!cell || this.session.watching) return
    this.session.send(cm.targetCursor(cell.x, cell.y))
  }

  /**
   * Whether the targeting up now is the look mode `x` opened. The server
   * reports targeting alone (MOUSE_MODE_TARGET, which aims share); this
   * pairs the `x` that went out with the targeting that follows it, and
   * forgets it when that targeting ends, or when none follows within
   * LOOK_WINDOW_MS (the key was refused, a --more-- came instead). A
   * --more-- or a popup over the look (the description `v` opened; crawl
   * ends the look itself after that, `describe_target` sets `force_cancel`)
   * keeps it, so a look resumed after a --more-- still describes on A rather
   * than travelling. Called once a frame with the mode the server reports.
   */
  examining(mode: Mode): boolean {
    const l = this.look
    if (mode === 'targeting') {
      if (l.state === 'pending') l.state = 'active'
    } else if (l.state === 'active') {
      if (mode !== 'more' && mode !== 'popup') l.state = 'idle'
    } else if (l.state === 'pending' && this.hooks.now() - l.t > LOOK_WINDOW_MS) l.state = 'idle'
    return l.state === 'active' && mode === 'targeting'
  }

  /**
   * Whether the aim up now is a fire whose view is held: no cursor the
   * server places turns it (game.ts `faceCursor`). Paired with the `f` that
   * went out the way `examining` pairs a look, and released by the first
   * cursor step (`step`) or the aim's end. Called once a frame with the mode
   * the server reports.
   */
  holdingView(mode: Mode): boolean {
    const h = this.hold
    if (mode === 'targeting') {
      if (h.state === 'pending') h.state = 'active'
    } else if (h.state === 'active') {
      if (mode !== 'more' && mode !== 'popup') h.state = 'idle'
    } else if (h.state === 'pending' && this.hooks.now() - h.t > LOOK_WINDOW_MS) h.state = 'idle'
    return h.state === 'active' && mode === 'targeting'
  }

  /**
   * An aim that opens on the player starts on the cell ahead instead. Crawl
   * puts the targeting cursor on a default target when it has one (the
   * nearest monster for `f` or a spell, directn.cc `find_default_target`),
   * and on the player otherwise, always for look mode (`x`, `just_looking`);
   * the player's own cell is never what a pad user meant to aim at, so when
   * the server's cursor (id 0) appears on the player it is sent to the cell
   * faced as the command went out (`aimAt`). A look or a fire had that cell
   * sent along with its key already; sending it again is the same target,
   * so this costs nothing where the first arrived. Once per aim: a cursor
   * walked back onto the player stays, and a --more-- or popup over the aim
   * (a description) does not start it again. The compass prompt
   * (MOUSE_MODE_TARGET_DIR, "Which direction?") has no cursor and is left
   * alone. Called once a frame with the mode the server reports.
   */
  startAimAhead(mode: Mode) {
    if (mode !== 'targeting') {
      if (mode !== 'more' && mode !== 'popup') this.aimed = false
      return
    }
    if (this.aimed) return
    const st = this.session.state
    if (st.inputMode === MouseMode.TARGET_DIR) return
    const c = st.cursors[0]
    if (!c) return // the cursor follows the mode change; wait for it
    this.aimed = true
    const scene = this.session.scene
    if (this.session.watching || !scene.playerOnLevel) return
    if (c.x !== scene.player.x || c.y !== scene.player.y) return
    this.aimAt(this.aimAhead())
  }

  /**
   * Send a key sequence. A step marked `await: 'prompt'` is held until the
   * server leaves command mode for it (the travel prompt, a menu, a popup);
   * if a --more-- shows instead, or nothing changes, the rest is dropped so
   * a refused `G` never leaks its `>` into the dungeon.
   */
  sendKeys(seq: KeyOrText[]) {
    const one = (s: KeyOrText) => this.send('key' in s ? cm.key(s.key) : cm.input(s.text))
    // `opened`: the wait for step i is over, so it goes out even if the mouse mode never left command (a prompt-channel line)
    const from = (i: number, opened = false) => {
      for (; i < seq.length; i++, opened = false) {
        const s = seq[i]
        if (s.await && i > 0 && !opened && this.session.state.inputMode === MouseMode.COMMAND) {
          this.awaitPrompt(() => from(i, true))
          return
        }
        one(s)
      }
    }
    this.abortSequence()
    from(0)
  }

  /**
   * Run `then` once the server has opened something for input, or give up.
   * "Opened" is a mouse mode other than command, a menu, a popup, a text
   * field, or a new line on the prompt channel: `z` asks "Cast which spell?"
   * as an MSGCH_PROMPT message with the mouse mode unchanged (spl-cast.cc
   * `cast_a_spell`, `get_ch`), so the mode alone would never say it is up.
   */
  private awaitPrompt(then: () => void) {
    let done = false
    const rev0 = this.session.state.rev?.messages
    const finish = () => {
      done = true
      unsub()
      clearTimeout(timer)
      this.sequence = null
    }
    const timer = setTimeout(() => {
      if (done) return
      finish()
      this.hooks.status('Aborted: no prompt')
    }, 1500)
    const check = () => {
      if (done) return
      const st = this.session.state
      if (st.messages.more) {
        finish()
        this.hooks.status('Aborted: --more--')
        return
      }
      const lines = st.messages.lines ?? []
      const prompted = st.rev?.messages !== rev0 && lines.length > 0 && lines[lines.length - 1].channel === MSGCH.PROMPT
      if (st.inputMode !== MouseMode.COMMAND || st.menus.length || st.ui.length || st.textInput || prompted) {
        finish()
        then()
      }
    }
    const unsub = this.session.on((e) => {
      if (e.type === 'state') check()
    })
    this.sequence = { steps: [], abort: finish }
    check()
  }

  /** Absolute direction for a relative one under the current facing. */
  absolute(rel: RelDir): Dir8 {
    return rotateDir(this.cam.facing, rel)
  }

  /**
   * Absolute direction for a key in an aim: read against the grid the
   * player sees, one axis per key (camera `gridFacing`), so a diagonal
   * facing has `k` up its left-hand edge and `l` up its right.
   */
  absoluteAim(rel: RelDir): Dir8 {
    return rotateDir(this.cam.gridFacing, rel)
  }

  /**
   * Movement in command mode: forward turns the camera; the diagonals and
   * back strafe. A keyboard, d-pad or left-stick left / right (`opts.turns`)
   * is a turn. Every step is remembered (`lastStep`), and
   * only one that aimed the camera (forward, or an attack) snaps the view onto
   * the vector the feet took once the server echoes the new position (game.ts
   * onScene); j, y, u, b and n strafe and keep the heading.
   * In targeting the same key moves the cursor (plain), fires that way
   * (Shift: the uppercase letter is CMD_TARGET_DIR_*) or sends the Ctrl
   * variant, read against the grid the player sees (`absoluteAim`). The
   * level map is north-up: absolute.
   */
  step(rel: RelDir, opts: { run?: boolean; attack?: boolean; keyboard?: boolean; turns?: boolean } = {}) {
    const ctx = this.hooks.context()
    if (ctx.mode !== 'command' && ctx.mode !== 'targeting' && ctx.mode !== 'levelmap' && ctx.mode !== 'prompt') return
    if (ctx.mode === 'targeting' || ctx.mode === 'prompt') {
      // read against the grid in view, never turn it. The first step of a
      // fire's cursor releases the held view: from here the cursor's walk
      // turns the view as any aim's does (game.ts `faceCursor`)
      if (ctx.mode === 'targeting') this.hold = { state: 'idle', t: 0 }
      this.send(dirMessage(this.absoluteAim(rel), opts))
      return
    }
    if (ctx.mode === 'levelmap') {
      // north-up surface: absolute
      this.send(dirMessage(rel, opts))
      return
    }
    // keyboard, d-pad and left-stick left / right are pure turns (h / l,
    // input.md); a pad step without `turns` (none today) would strafe
    if ((rel === 2 || rel === 6) && (opts.keyboard || opts.turns) && !opts.attack && !opts.run) {
      this.cam.turn(rel === 2 ? 1 : -1)
      return
    }
    // spectating: h / l above still turn the view, but nothing else is a step
    // of ours. No feet are ours here, so the camera follows the player being
    // watched wherever they go (game.ts onScene, faceAfterMove).
    if (this.session.watching) return
    const abs = this.absolute(rel)
    // stepping into a monster is a swing: face it. Into a friendly it is a
    // swap (crawl movement.cc: allies trade places), so a strafe back into
    // a foxfire keeps its heading like any other strafe
    const forward = rel === 0
    // the weapon only lifts when something is there to hit; an attack into
    // empty air still aims the camera that way
    const target = this.targetIsMonster(abs)
    const turned = forward || target || !!opts.attack
    if (turned && !forward) this.cam.setFacing(abs)
    this.lastStep = { dir: abs, turned, t: this.hooks.now() }
    // a step of the player's own: whatever autofight was closing on, this walk is theirs
    this.cam.stopClosing()
    if (target) this.hooks.swing()
    this.send(dirMessage(abs, opts))
  }

  /**
   * A click on a cell, as the official client sends it (mouse_control.js
   * handle_cell_click: `click_cell` with the cell and `ev.which`, 1 left, 2
   * middle, 3 right). The server decides what the click means (tileweb.cc
   * `_handle_cell_click`: right describes; left in command mode is
   * `click_travel`, a step or attack on an adjacent cell, travel to a safe
   * far one, else one step toward it; left while targeting selects). A left
   * click on an adjacent monster in command mode is a swing, so the weapon
   * lifts as for a keyed attack, and the step is remembered as ours so the
   * camera stays where the mouse left it when the server echoes the move
   * (game.ts onScene): a mouse move never snaps the view to a heading.
   */
  clickCell(x: number, y: number, button: number) {
    const ctx = this.hooks.context()
    if (ctx.mode === 'command' && button === 1) {
      const scene = this.session.scene
      const dx = x - scene.player.x
      const dy = y - scene.player.y
      const dir = dirFromDelta(Math.sign(dx), Math.sign(dy))
      if (dir !== null) {
        const adjacent = Math.abs(dx) <= 1 && Math.abs(dy) <= 1
        this.lastStep = { dir, turned: false, t: this.hooks.now() }
        this.cam.stopClosing()
        if (adjacent && this.targetIsMonster(dir)) this.hooks.swing()
      }
    }
    this.send(cm.clickCell(x, y, button))
  }

  /** A monster a step into `abs` would hit: anything but a friendly, which is swapped with instead. */
  private targetIsMonster(abs: Dir8): boolean {
    const scene = this.session.scene
    const x = scene.player.x + DIR8_DX[abs]
    const y = scene.player.y + DIR8_DY[abs]
    return scene.billboards.some((b) => b.kind === 'monster' && b.attitude !== 'friendly' && b.x === x && b.y === y)
  }

  execute(a: Action) {
    switch (a.kind) {
      case 'keys':
        this.sendKeys(a.seq)
        break
      case 'step':
        this.step(a.dir, { run: a.run, attack: a.attack, turns: a.turns })
        break
      case 'turn':
        this.cam.turn(a.dir === 'left' ? -1 : 1)
        break
      case 'look':
        break
      case 'contextual':
        this.contextual(a.alt)
        break
      case 'fight':
        this.fight()
        break
      case 'examine':
        this.examine()
        break
      case 'fire':
        this.fire()
        break
      case 'menu':
        this.hooks.menu(a.op)
        break
      case 'cursor':
        // targeting: facing-relative like the keyboard path; level map: absolute
        this.step(a.dir as RelDir)
        break
      case 'prompt':
        this.send(cm.input(a.hotkey))
        break
      case 'focus':
        this.hooks.focus(a.op)
        break
      case 'ui':
        this.hooks.ui(a.op, a.arg, a.category, a.section)
        break
      case 'osk':
        this.hooks.osk(a.op, a.dir)
        break
      case 'hold':
        // tables hand the tap or hold half to resolve(); executing the pair itself means the tap
        this.execute(a.tap)
        break
    }
  }

  /** RT always uses Crawl's autofight, including its HP cutoff and target selection. */
  fight() {
    if (this.hooks.context().mode !== 'command') return
    this.sendKeys(AUTOFIGHT.kind === 'keys' ? AUTOFIGHT.seq : [])
  }

  /**
   * LB: examine. In command mode it opens look mode (`x`); the cursor starts
   * on the player (directn.cc `_look_around_target`), and the cell faced goes
   * out with the key (`send`), `startAimAhead` covering a miss. In look
   * mode the same button describes the cell under the cursor (`v`,
   * CMD_TARGET_DESCRIBE); Enter would travel there instead.
   */
  /**
   * LT: fire. In command mode `f` fires what is quivered, opening the aim
   * prompt on the default target; the view holds as the key goes out
   * (`send`), and the d-pad walks the cursor along the grid in view. Inside
   * that prompt `f` is
   * CMD_TARGET_SELECT as `.` and Enter are (cmd-keys.h), so the same button
   * confirms the shot. The key is the same either side of the server's
   * round trip, which is what lets LT be tapped as fast as `f` is spammed
   * on a keyboard. Look mode is not an aim: nothing is sent there.
   */
  fire() {
    const ctx = this.hooks.context()
    if (ctx.mode === 'targeting') {
      if (!ctx.examining) this.send(cm.input('f'))
      return
    }
    if (ctx.mode !== 'command') return
    this.send(cm.input('f'))
  }

  examine() {
    const ctx = this.hooks.context()
    if (ctx.mode === 'targeting') {
      if (ctx.examining) this.send(cm.input('v'))
      return
    }
    if (ctx.mode !== 'command') return
    this.send(cm.input('x'))
  }

  /**
   * A acts underfoot, then on a door ahead. When a usable feature and items
   * share the tile, ask instead of choosing. An explicit alt selects the
   * feature (false) or the items (true) from that chooser.
   */
  contextual(alt?: boolean) {
    const ctx = this.hooks.context()
    if (ctx.mode !== 'command') return
    if (alt === undefined && hasInteractionChoice(ctx)) {
      this.hooks.ui('interact')
      return
    }
    // Explicit pickup from the interaction chooser.
    if (alt) {
      if (ctx.under.kind === 'feature' && ctx.under.items) this.send(cm.input(','))
      return
    }
    const a = ctx.ahead
    const u = ctx.under
    if (u.kind === 'feature') {
      const f = u.feature
      if (f.type === 'stairs' || f.type === 'hatch') {
        if (!this.confirmed('stairs', ctx)) return
        return this.send(cm.input(f.dir === 'down' ? '>' : '<'))
      }
      // altars: DCSS 0.29+ converts with '>' (there is no pray command)
      if (f.type === 'portal' || f.type === 'shop' || f.type === 'transporter' || f.type === 'altar') return this.send(cm.input('>'))
    }
    if (u.kind === 'item' || (u.kind === 'feature' && u.items)) return this.send(cm.input(','))
    if (a.kind === 'feature' && a.feature.type === 'door' && a.feature.state === 'open') return this.closeAhead()
    // moving into a closed door opens it without entering: the one "step" A keeps
    if (a.kind === 'door-closed') return this.step(0)
  }

  /**
   * Close the open door ahead: CMD_CLOSE_DOOR, then the direction only if the
   * server asks for one. With `easy_door` (on by default) and a single open
   * door adjacent, crawl closes it on `C` alone (movement.cc
   * close_door_action); a direction sent anyway would be a step. With more
   * doors, or `easy_door = false`, it prompts "Which direction?" in
   * MOUSE_MODE_TARGET_DIR (target-compass.cc prompt_compass_direction), and
   * that mode is the cue to answer, rotated with facing like any step. The
   * rc does not reach the client, so the mode is the only way to know.
   * Anything else (the door closed, "It's broken", a --more--) ends the wait;
   * the server's own message says what happened.
   */
  private closeAhead() {
    const dir = MOVE_KEYS[this.cam.facing]
    let done = false
    const finish = () => {
      done = true
      unsub()
      clearTimeout(timer)
      this.sequence = null
    }
    const timer = setTimeout(finish, 1500)
    const unsub = this.session.on((e) => {
      if (done) return
      if (e.type === 'state') {
        const st = this.session.state
        if (st.inputMode === MouseMode.TARGET_DIR) {
          finish()
          this.send(cm.input(dir))
        } else if (st.messages.more || st.inputMode !== MouseMode.COMMAND || st.menus.length || st.ui.length || st.textInput) finish()
        return
      }
      // the map moved on with no prompt: the door closed on `C` alone
      if (e.type === 'scene') finish()
    })
    this.abortSequence()
    this.sequence = { steps: [], abort: finish }
    this.send(cm.input('C'))
  }

  /**
   * "Confirm dangerous actions": with the setting on and hostiles in view, a
   * stairs action needs a second press within CONFIRM_WINDOW_MS. Returns
   * whether to go ahead.
   */
  private confirmed(what: string, ctx: Context): boolean {
    if (!this.hooks.confirmDangerous() || ctx.hostilesInView === 0) {
      this.armed = null
      return true
    }
    const now = this.hooks.now()
    if (this.armed && this.armed.what === what && now - this.armed.t <= CONFIRM_WINDOW_MS) {
      this.armed = null
      return true
    }
    this.armed = { what, t: now }
    this.hooks.status(`${ctx.hostilesInView} hostile${ctx.hostilesInView === 1 ? '' : 's'} in view: press again to confirm`)
    return false
  }

  abortSequence() {
    this.sequence?.abort()
    this.sequence = null
  }
}

/** The message the official client sends for a direction key with a modifier. */
function dirMessage(abs: Dir8, opts: { run?: boolean; attack?: boolean }): ClientMessage {
  const letter = MOVE_KEYS[abs]
  if (opts.attack) return cm.key(letter.toUpperCase().charCodeAt(0) - 64)
  if (opts.run) return cm.input(letter.toUpperCase())
  return cm.input(letter)
}

/** CMD_LOOK_AROUND, however it was typed: the `x` key as text or as a keycode. */
function isLookAround(msg: ClientMessage): boolean {
  if (msg.msg === 'input') return msg.text === 'x'
  return msg.msg === 'key' && msg.keycode === 'x'.charCodeAt(0)
}

/** CMD_FIRE, however it was typed: the `f` key as text or as a keycode. */
function isFire(msg: ClientMessage): boolean {
  if (msg.msg === 'input') return msg.text === 'f'
  return msg.msg === 'key' && msg.keycode === 'f'.charCodeAt(0)
}

/** CMD_EXPLORE, however it was typed: the `o` key as text or as a keycode. */
function isExplore(msg: ClientMessage): boolean {
  if (msg.msg === 'input') return msg.text === 'o'
  return msg.msg === 'key' && msg.keycode === 'o'.charCodeAt(0)
}
