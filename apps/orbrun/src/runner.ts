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

/**
 * How long a cursor walk the server has not echoed yet is still walked from
 * (`orbitStep`). Past it the walk is taken to have been refused — crawl
 * keeps the cursor inside the level, so a ring that runs off the map stops
 * dead — and the server's own cursor is read again.
 */
export const ORBIT_WINDOW_MS = 1000

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
  /**
   * The cells a walk round the player (`orbitStep`) has sent the cursor to
   * and the server has not echoed back yet, oldest first, with the time the
   * oldest went out. The next step is walked from the last of them rather
   * than from the cursor the server reports, which trails the keys by a
   * round trip.
   */
  private orbit: { path: { x: number; y: number }[]; t: number } | null = null

  constructor(session: Session, cam: CameraController, hooks: RunnerHooks) {
    this.session = session
    this.cam = cam
    this.hooks = hooks
  }

  send(msg: ClientMessage) {
    if (this.session.watching) return
    // anything but the walk's own key may move the cursor itself (a click, a
    // grid direction, the key that ends the aim): the walk's unechoed path is
    // no longer what the cursor is doing. `step` re-records it after its send.
    this.orbit = null
    if (this.hooks.context().mode === 'command') {
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
      // an aim's cursor is the server's: nothing is sent to place it, so it
      // opens on the cell crawl chose. What is ours is the view. Look mode
      // (`x`, typed or from LB) does not turn it: the direction keys and the
      // d-pad read against the grid the player sees (camera `gridFacing`),
      // and the heading is kept while the cursor walks in front (game.ts
      // `faceCursor`). The targeting that follows `x` is remembered as look
      // mode, which the server does not distinguish from an aim
      // (`examining`). Fire holds the heading until the cursor is first
      // stepped (`step`, `holdingView`); any other command drops a hold a
      // refused `f` left behind.
      if (isLookAround(msg)) this.look = { state: 'pending', t: this.hooks.now() }
      this.hold = isFire(msg) ? { state: 'pending', t: this.hooks.now() } : { state: 'idle', t: 0 }
      this.session.send(msg)
      return
    }
    this.session.send(msg)
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
   *
   * In a look (`x`), forward and back are the exception: they run along the
   * facing itself, not the grid. On a diagonal the grid's north is the axis
   * beside the view, so forward used to walk the cursor up the left edge and
   * back down the right; now, facing north-east, forward keeps it stepping
   * north-east and back south-west, straight up and down the screen. The
   * cursor stays on the ray it set out along, so the view holds its heading
   * instead of swinging off it. The sides and the diagonals are untouched:
   * they keep reading against the grid, `l` still up the right-hand edge.
   */
  absoluteAim(rel: RelDir, opts: { look?: boolean } = {}): Dir8 {
    if (opts.look && (rel === 0 || rel === 4)) return rotateDir(this.cam.facing, rel)
    return rotateDir(this.cam.gridFacing, rel)
  }

  /**
   * The compass step that walks an aim's cursor one cell round the player,
   * to the right (1) or the left (-1): left and right keep the cursor the
   * distance from the player it is already at (the ring of cells that far
   * out, as crawl counts distance) and walk it round, so a cursor two cells
   * out stays two cells out however far it goes. It holds its heading along
   * a side of that ring and changes it at the corners, the cells on a
   * diagonal from the player, where the ring turns: from the cell
   * north-east of the player, right heads south down the ring's east side
   * and left heads west along its north side. The two are mirror images at
   * every cell, which reading both against one compass heading never was.
   *
   * The walk is stepped from where the runner's own unechoed steps have
   * already sent the cursor (`orbit`), not from the cursor the server
   * reports, which trails a held key by a round trip: read against a stale
   * cell every repeat in a lag spike computes the same heading, and the
   * cursor walks off its ring in a straight line instead of round it. The
   * server's cursor reconciles that path as it catches up — it is the truth
   * wherever it lands on one of those cells — and a walk it never echoes is
   * dropped after ORBIT_WINDOW_MS, crawl having refused it.
   *
   * Null where there is no cursor to walk — a compass prompt, a cursor the
   * server has not placed, or one standing on the player — and the key
   * falls back to the grid in view (`absoluteAim`). A fire or an attack
   * that way (Shift, Ctrl) is a direction, not a walk, and never orbits.
   */
  private orbitStep(side: 1 | -1): { dir: Dir8; x: number; y: number } | null {
    const scene = this.session.scene
    if (!scene.playerOnLevel) return null
    const c = this.orbitFrom()
    if (!c) return null
    const dx = c.x - scene.player.x
    const dy = c.y - scene.player.y
    // the ring the cursor stands on, and where on it: a side of the ring
    // (one of sx, sy zero) or a corner (neither)
    const r = Math.max(Math.abs(dx), Math.abs(dy))
    if (r === 0) return null
    const at = dirFromDelta(Math.abs(dx) === r ? dx : 0, Math.abs(dy) === r ? dy : 0)
    if (at === null) return null
    // a corner turns the walk a further eighth: it is stepping off one side of the ring onto the next
    const dir = rotateDir(at, (at % 2 === 1 ? 3 : 2) * side)
    return { dir, x: c.x + DIR8_DX[dir], y: c.y + DIR8_DY[dir] }
  }

  /**
   * The cell the next walk steps from: the end of the runner's own unechoed
   * path where it has one, else the server's cursor. The server's cursor
   * confirms that path as it arrives — everything up to and including the
   * cell it reports is echoed, and the rest is still in flight — and a path
   * it has not reached within ORBIT_WINDOW_MS is abandoned, so a walk crawl
   * refused at the level's edge cannot drift on forever under a held key.
   */
  private orbitFrom(): { x: number; y: number } | null {
    const server = this.session.state.cursors[0] ?? null
    const p = this.orbit
    if (!p) return server
    if (server) {
      const echoed = p.path.findIndex((cell) => cell.x === server.x && cell.y === server.y)
      if (echoed >= 0) {
        p.path.splice(0, echoed + 1)
        p.t = this.hooks.now()
      }
    }
    if (p.path.length === 0 || this.hooks.now() - p.t > ORBIT_WINDOW_MS) {
      this.orbit = null
      return server
    }
    return p.path[p.path.length - 1]
  }

  /** Record a walk's cell as sent but not echoed (`orbitFrom`). */
  private orbitSent(cell: { x: number; y: number }) {
    const p = this.orbit
    if (p) p.path.push(cell)
    else this.orbit = { path: [cell], t: this.hooks.now() }
  }

  /**
   * Movement in command mode: forward turns the camera; the diagonals and
   * back strafe. Left and right turn the camera or strafe as `opts.turns`
   * says, which the caller reads off the setting for the input the player
   * used (servers.ts `leftRightTurns`). Every step is remembered (`lastStep`), and
   * only one that aimed the camera (forward, or an attack) snaps the view onto
   * the vector the feet took once the server echoes the new position (game.ts
   * onScene); j, y, u, b and n strafe and keep the heading.
   * In targeting the same key moves the cursor (plain), fires that way
   * (Shift: the uppercase letter is CMD_TARGET_DIR_*) or sends the Ctrl
   * variant, read against the grid the player sees (`absoluteAim`), whose
   * forward and back run along the facing itself in a look; a plain left or
   * right walks the cursor round the player instead, keeping its distance
   * (`orbitStep`). The
   * level map is north-up: absolute.
   */
  step(rel: RelDir, opts: { run?: boolean; attack?: boolean; turns?: boolean } = {}) {
    const ctx = this.hooks.context()
    if (ctx.mode !== 'command' && ctx.mode !== 'targeting' && ctx.mode !== 'levelmap' && ctx.mode !== 'prompt') return
    if (ctx.mode === 'targeting' || ctx.mode === 'prompt') {
      // read against the grid in view, never turn it. The first step of a
      // fire's cursor releases the held view: from here the cursor's walk
      // turns the view as any aim's does (game.ts `faceCursor`)
      if (ctx.mode === 'targeting') this.hold = { state: 'idle', t: 0 }
      // left and right walk the cursor round the player instead (`orbitStep`)
      const orbit = (rel === 2 || rel === 6) && !opts.run && !opts.attack ? this.orbitStep(rel === 2 ? 1 : -1) : null
      this.send(dirMessage(orbit?.dir ?? this.absoluteAim(rel, { look: ctx.examining }), opts))
      // after the send, which drops the path any other cursor move invalidates
      if (orbit) this.orbitSent(orbit)
      return
    }
    if (ctx.mode === 'levelmap') {
      // north-up surface: absolute
      this.send(dirMessage(rel, opts))
      return
    }
    // left / right on an input set to turn is a pure turn: nothing is sent and
    // no time passes. Set to strafe, it falls through and steps sideways.
    // A run or an attack is always a step, whatever the setting says.
    if ((rel === 2 || rel === 6) && opts.turns && !opts.attack && !opts.run) {
      this.cam.turn(rel === 2 ? 1 : -1)
      return
    }
    // spectating: a turn above still turns the view, but nothing else is a step
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
   * LT: fire. `f` in command mode, and `f` again inside the aim it opens,
   * where it is CMD_TARGET_SELECT as `.` and Enter are (cmd-keys.h): one
   * key either side of the server's round trip, which is what lets LT be
   * tapped as fast as `f` is spammed on a keyboard, however late the aim
   * arrives. The view holds as the key goes out (`send`) so the aim's own
   * target does not swing it, and the d-pad walks the cursor along the grid
   * in view. Look mode is not an aim: nothing is sent there.
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

  /**
   * R3: examine. `x` in command mode, and inside the look it opens the same
   * button describes the cell under the cursor (`v`, CMD_TARGET_DESCRIBE)
   * rather than travelling there, which is what Enter would do.
   */
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
