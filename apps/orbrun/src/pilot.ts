import { MouseMode, UiState, type GameMessage, type GameState } from '@orbrun/webtiles'
import { isThreat, type Billboard, type Scene, type SceneCursor } from '@orbrun/scene'
import type { CameraController } from './camera'
import { deriveContext, type Context } from './context'
import type { LastStep, Runner } from './runner'
import type { Session } from './session'
import { ExploreDone, linesSince, namedInWarnings, namedMonster } from './warnings'

/** What a pilot tells the screen it flies for. */
export interface PilotHooks {
  /** the feet moved on, or onto a new level: `own` is the step of the runner's that moved them, if one did */
  moved?(own: LastStep | null, sameLevel: boolean, hops: readonly { dx: number; dy: number }[]): void
  /** a new level: whatever moved on the last is forgotten (render-3d `resetMotion`) */
  newLevel?(): void
}

/**
 * The eye that follows the player, with no page: what the game screen does
 * with the server's word before anything is drawn. It keeps the path the
 * feet took between scene rebuilds (`trackHop`), glides or snaps the camera
 * after them and faces the way they went, or a newcomer, or what a warning
 * names (`onScene`), owing a turn a --more-- held up (`payOwedTurn`); and
 * derives the frame's context once per change of what it reads (`context`).
 * The browser's GameScreen and the terminal both fly by it.
 */
export class Pilot {
  private lastPos = { x: NaN, y: NaN }
  /**
   * The player's position as of the last server message, and every hop it
   * made since the scene was last rebuilt. The scene is rebuilt once per
   * frame, so a fast explore or travel (a busy frame, or `travel_delay -1`)
   * arrives as several cells at once: the hops keep the path the feet took,
   * and the camera can face the way the last step went instead of mistaking
   * the batch for a teleport. `jumped` marks a hop that was not one cell.
   */
  private hopPos = { x: NaN, y: NaN }
  private hops: { dx: number; dy: number }[] = []
  private jumped = false
  /** place and depth the player was last seen on, so a level change is known even when the coordinates barely move */
  private lastLevel = ''
  /** arrived somewhere new before its cells came through: face again once they do */
  private arrivalPending = false
  private lastMonsters = new Set<number>()
  /** the newest message line the warning rule has read (warnings.ts), so each line is judged once */
  private lastWarningLine: GameMessage | undefined
  /** a turn a warning or newcomer earned while the server was not taking commands (a --more--), paid when it does */
  private owedTurn: { names: string[]; newcomer: boolean } | null = null
  /** the context as last derived, and the key of what it was derived from */
  private ctxBase: Context | null = null
  private ctxKey = ''
  /** whether crawl last said explore has nowhere to go, and the level has given it nowhere since (warnings.ts) */
  private exploreDone = new ExploreDone()

  constructor(
    private session: Session,
    readonly cam: CameraController,
    readonly runner: Runner,
    private hooks: PilotHooks = {},
  ) {}

  /** A server message moved the player: one more hop on the path since the last rebuild, or a jump. */
  trackHop() {
    const pos = this.session.state.player.pos
    if (!pos) return
    const { x, y } = this.hopPos
    if (pos.x === x && pos.y === y) return
    const dx = pos.x - x
    const dy = pos.y - y
    if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) this.hops.push({ dx, dy })
    else this.jumped = true
    this.hopPos = { x: pos.x, y: pos.y }
  }

  /** The scene was rebuilt: the eye after the feet, and turned to what earned a look. `now` in seconds. */
  onScene(now: number) {
    const cam = this.cam
    const scene = this.session.scene
    const st = this.session.state
    const p = scene.player
    const hops = this.hops
    const jumped = this.jumped
    this.hops = []
    this.jumped = false
    if (!scene.playerOnLevel) return
    const level = `${st.player.place}:${st.player.depth}`
    const newLevel = level !== this.lastLevel
    if (newLevel) this.hooks.newLevel?.()
    this.lastLevel = level
    const moved = p.x !== this.lastPos.x || p.y !== this.lastPos.y
    if (moved || newLevel) {
      // the feet moved on: whatever turn was owed is about the old spot
      this.owedTurn = null
      const dx = p.x - this.lastPos.x
      const dy = p.y - this.lastPos.y
      // Attribute all hops, including replies to older commands still in
      // flight after the player turned and sent a new direction.
      const ownStep = this.runner.stepForMove(dx, dy, performance.now(), jumped ? [] : hops)
      const wasOurs = ownStep !== null
      const sameLevel = !newLevel && !Number.isNaN(this.lastPos.x) && !(dx === 0 && dy === 0)
      const single = Math.abs(dx) <= 1 && Math.abs(dy) <= 1
      this.hooks.moved?.(ownStep, sameLevel, hops)
      // Several cells in one frame is still a walk when every hop the server
      // sent was one cell: travel, explore, a spectated player. The last hop
      // is the way the feet went. A single position update spanning several
      // cells (`travel_delay -1`, a blink, a teleport) has no hops: the
      // travel trail tells the last step, else the displacement stands in.
      const walk = sameLevel && hops.length > 0 && !jumped
      // the eye glides after a walk, by the hops the server drew (the rc's
      // `travel_delay`: a positive one sends every step, -1 sends the
      // arrival alone, which is a jump here as it is a jump there)
      if (walk || (sameLevel && single)) cam.walkTo(p.x, p.y, walk ? hops : [{ dx, dy }], now)
      else cam.snapTo(p.x, p.y)
      if (!sameLevel) {
        // level change: never nose-to-wall
        if (!cam.steering) this.arrivalPending = !cam.faceAfterArrival(scene)
      } else if (cam.steering) {
        // the player is looking around: leave the view alone
      } else if (wasOurs) {
        // Align our forward step only if no newer turn or look superseded
        // it. The reply confirms the feet, not a heading the player has
        // since changed (even if the drag/stick has already been released).
        if (ownStep === this.runner.lastStep && ownStep.turned && ownStep.steeringRevision === cam.steeringRevision) {
          const h = hops.at(-1) ?? { dx, dy }
          cam.faceStep(h.dx, h.dy)
        }
      } else if (walk || single) {
        // path-driven movement: face the way the last step went
        const h = walk ? hops[hops.length - 1] : { dx, dy }
        cam.faceAfterMove(scene, h.dx, h.dy)
      } else {
        cam.faceAfterJump(scene, dx, dy)
      }
      this.lastPos = { x: p.x, y: p.y }
    } else if (this.arrivalPending) {
      // the new level's cells have arrived: now the heading can be judged
      if (cam.steering) this.arrivalPending = false
      else this.arrivalPending = !cam.faceAfterArrival(scene)
    } else if (this.session.watching && !cam.steering) {
      // the spectated player stood their ground with a hostile beside them: a fight, face it
      cam.faceAdjacentHostile(scene)
    }
    // discovery: a monster newly in view turns the camera
    const ids = new Set<number>()
    let newest: Billboard | null = null
    for (const b of scene.billboards) {
      if (b.kind !== 'monster' || !b.ref) continue
      const id = (b.ref as { id?: number }).id
      if (id === undefined) continue
      ids.add(id)
      // a plant coming into view is no discovery: it is firewood, not a threat (scene `isThreat`)
      if (!this.lastMonsters.has(id) && isThreat(b)) newest = newest ?? b
    }
    // a step or a wait of the player's own: the turn they chose is not taken from them
    const keyedAt = Math.max(this.runner.lastStep?.t ?? -Infinity, this.runner.lastWaitAt)
    const keyedJustNow = performance.now() - keyedAt < 400
    this.lastMonsters = ids
    // the server's own word wins: a walk it refused ("X is nearby!") or
    // stopped ("You encounter X.", "X comes into view.") names the monster,
    // and that one is faced, or failing a match the nearest blocker, hostile
    // or neutral (warnings.ts). Read once the batch's cells are in, so the
    // named monster is on the scene to be found.
    const lines = st.messages.lines
    const fresh = linesSince(lines, this.lastWarningLine, st.player.turn)
    this.lastWarningLine = lines[lines.length - 1]
    const names = namedInWarnings(fresh)
    if ((newest || names.length) && !cam.steering && !keyedJustNow) {
      // A newcomer or a warning turns the camera, but only once the server
      // takes commands: a walk stopped under a --more-- ends its batch in
      // `input_mode 5` (fixtures/explore-more.json), and the line, read
      // once, would otherwise be spent before the prompt is dismissed. The
      // turn is owed instead and paid when input_mode returns to command.
      if (st.inputMode === MouseMode.COMMAND) this.faceEvent(scene, names, newest !== null)
      else this.owedTurn = { names: [...(this.owedTurn?.names ?? []), ...names], newcomer: (this.owedTurn?.newcomer ?? false) || newest !== null }
    }
  }

  /** The server takes commands again: pay the turn owed from under a --more--. True when the view turned. */
  payOwedTurn(): boolean {
    const owed = this.owedTurn
    if (!owed || this.session.state.inputMode !== MouseMode.COMMAND) return false
    this.owedTurn = null
    if (this.cam.steering) return false
    this.faceEvent(this.session.scene, owed.names, owed.newcomer)
    return true
  }

  private faceEvent(scene: Scene, names: readonly string[], newcomer: boolean) {
    if (names.length) this.cam.faceBlocker(scene, namedMonster(scene, names))
    else if (newcomer) this.cam.faceHostile(scene)
  }

  /**
   * The context of the frame (context.ts `deriveContext`): scans of the
   * scene's billboards and the message log, so it is derived once per change
   * of what it reads (every message bumps `rev.any`; a scene rebuild bumps
   * `scene.revision`; a turn changes the facing) and copied for the fields
   * the frame fills in afterwards (`examining`, `popupActions`, `focus`).
   */
  context(): Context {
    const st = this.session.state
    const key = `${st.rev.any}|${this.session.scene.revision}|${this.cam.camera.facing}`
    if (!this.ctxBase || key !== this.ctxKey) {
      this.ctxKey = key
      this.ctxBase = deriveContext(st, this.session.scene, this.cam.camera, 'micro')
      if (this.exploreDone.update(st, this.session.scene)) this.ctxBase.exploreDone = true
    }
    return { ...this.ctxBase }
  }

  /**
   * The server's cursor moved to a cell: the view turns to it, unless it is the level map's, the player is
   * steering or holding the view, or the cell is the one the player just aimed at (`aimed`).
   */
  faceCursor(c: SceneCursor, opts: { examining?: boolean; viewHeld?: boolean; aimed?: boolean } = {}) {
    if (c.mode === 'map' || this.cam.steering || opts.viewHeld || opts.aimed) return
    const scene = this.session.scene
    if (!scene.playerOnLevel) return
    if (opts.examining || !this.session.watching) this.cam.faceCursorBehind(scene, c.x, c.y)
    else this.cam.faceCell(scene, c.x, c.y)
  }
}

/**
 * The cursor the server has placed, as the views draw it (dungeon_renderer.js): the targeting or mouse one
 * first, then the level map's, then the tutorial's; its mode by what the server is doing, and WebTiles' icon
 * for it (`icon`: the gamedata's id of an icon by name). Null while there is none.
 */
export function serverCursor(st: GameState, icon?: (name: string) => number | undefined): SceneCursor | null {
  // cursor ids: 0 mouse/targeting, 1 tutorial, 2 level map
  const c = st.cursors[0] || st.cursors[2] || st.cursors[1]
  if (!c) return null
  const mode: SceneCursor['mode'] = st.uiState === UiState.VIEW_MAP ? 'map' : st.inputMode === MouseMode.COMMAND ? 'examine' : 'target'
  // WebTiles paints icons.CURSOR for the mouse and map cursors, TUTORIAL_CURSOR for the tutorial one
  const tutorial = !st.cursors[0] && !st.cursors[2] && !!st.cursors[1]
  return { x: c.x, y: c.y, mode, tile: icon?.(tutorial ? 'TUTORIAL_CURSOR' : 'CURSOR') }
}
