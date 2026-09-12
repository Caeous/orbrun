import {
  DIR8_DX,
  DIR8_DY,
  dirToYaw,
  getCell,
  isWalkable,
  makeCamera,
  monstersInView,
  nearestBlocker,
  isThreat,
  nearestHostile,
  normalizeYaw,
  REST_PITCH,
  rotateDir,
  yawDelta,
  yawToDir,
  type Billboard,
  type Camera,
  type Dir8,
  type Scene,
} from '@orbrun/scene'

/**
 * Camera controller: yaw easing toward the facing goal, magnetic detents,
 * free look with the right stick or a mouse or touch drag (yaw
 * unbounded, pitch free short of the poles, nothing snaps back), snaps to the player's cell.
 */
/** Yaw and pitch in radians; enough to put the camera back where it pointed. */
export interface CameraView {
  yaw: number
  pitch: number
}

export class CameraController {
  camera: Camera = makeCamera()
  /** yaw the camera is easing toward */
  private goalYaw = 0
  private freeLook = false
  private dragging = false
  private lookVel = 0
  private pitchVel = 0
  reducedMotion = false
  /**
   * Third person (rendering-3d.md II.11): the camera stands under the lid
   * behind the player, so the glance range is a fraction of first person's;
   * clamping here rather than in the renderer keeps the stick from winding
   * up pitch it cannot show.
   */
  thirdPerson = false
  /**
   * Where the camera points at rest: the Camera angle setting, in radians,
   * negative below the horizon. It is the pitch a fresh camera starts on and
   * the centre of third person's glance window; free look is measured from
   * wherever the camera happens to point, so nothing ever springs back to it.
   */
  restPitch = REST_PITCH
  private lastMoveTs = 0

  get facing(): Dir8 {
    return this.camera.facing
  }

  setFacing(d: Dir8, immediate = false) {
    this.camera.facing = d
    this.goalYaw = dirToYaw(d)
    if (immediate || this.reducedMotion) this.camera.yaw = this.goalYaw
  }

  turn(by: number) {
    this.setFacing(rotateDir(this.camera.facing, by))
  }

  snapTo(x: number, y: number) {
    this.camera.x = x
    this.camera.y = y
  }

  /** The view to keep between sessions: where the camera points right now. */
  get view(): CameraView {
    return { yaw: this.camera.yaw, pitch: this.camera.pitch }
  }

  /**
   * Point the camera where a previous session left it, at once and without
   * easing. Facing follows the yaw so turns and auto-facing start from here.
   */
  restore(view: CameraView) {
    const c = this.camera
    c.yaw = normalizeYaw(view.yaw)
    c.pitch = this.clampPitch(view.pitch)
    c.facing = yawToDir(c.yaw)
    this.goalYaw = c.yaw
  }

  /**
   * The player chose another rest angle: the view tilts with it, so the
   * change shows at once in the settings menu, and third person's window
   * moves under it. Set this before restoring a saved view (the saved pitch
   * is already where the player left it, angle and all).
   */
  setRestPitch(p: number) {
    const d = p - this.restPitch
    this.restPitch = p
    this.camera.pitch = this.clampPitch(this.camera.pitch + d)
  }

  private clampPitch(p: number): number {
    return this.thirdPerson ? clamp(p, this.restPitch - THIRD_GLANCE, this.restPitch + THIRD_GLANCE) : clamp(p, -PITCH_MAX, PITCH_MAX)
  }

  /**
   * Right stick input; dx, dy in [-1,1]. Zero releases the stick. Look is
   * free: yaw is unbounded, pitch is clamped to PITCH_MAX, and releasing the
   * stick leaves the camera exactly where it points (no detent, no spring).
   */
  look(dx: number, dy: number, sensitivity = 1, invert = false) {
    if (dx === 0 && dy === 0) {
      if (this.freeLook) this.endFreeLook()
      this.lookVel = 0
      this.pitchVel = 0
      return
    }
    this.freeLook = true
    this.lookVel = dx * 3.2 * sensitivity
    this.pitchVel = (invert ? dy : -dy) * 0.8 * sensitivity
  }

  /**
   * Relative look from a mouse or touch drag: `dyaw`/`dpitch` in radians,
   * applied at once. Call `endDrag` when the drag ends.
   */
  lookBy(dyaw: number, dpitch: number) {
    const c = this.camera
    c.yaw = normalizeYaw(c.yaw + dyaw)
    c.pitch = this.clampPitch(c.pitch + dpitch)
    c.facing = yawToDir(c.yaw)
    this.goalYaw = c.yaw
    this.dragging = true
  }

  endDrag() {
    this.dragging = false
  }

  /** Stick released: keep the current view; facing is the nearest heading. */
  private endFreeLook() {
    this.freeLook = false
    this.camera.facing = yawToDir(this.camera.yaw)
    this.goalYaw = this.camera.yaw
  }

  /**
   * The compass heading an aim's direction keys are read against. A compass
   * facing is itself. A diagonal one is not turned (the view stays where
   * the player left it): the grid runs off at 45 degrees either side, and
   * the keys take the left-hand axis as north, so `k` walks the cursor up
   * the left edge of the view, `l` up the right, and `u` straight ahead.
   */
  get gridFacing(): Dir8 {
    return gridFacingOf(this.camera.facing)
  }

  /**
   * The aim's cursor moved: the heading is kept while the cell is in front
   * of the player (ahead of the line across their shoulders), so a walk of
   * the cursor about the view never swings it; a cell on or behind that
   * line turns the view to the heading nearest the cell, so the cursor
   * stays in sight.
   */
  faceCursorBehind(scene: Scene, x: number, y: number) {
    const dx = x - scene.player.x
    const dy = y - scene.player.y
    if (dx === 0 && dy === 0) return
    const f = this.camera.facing
    if (dx * DIR8_DX[f] + dy * DIR8_DY[f] > 0) return
    this.faceCell(scene, x, y)
  }

  /** Face a cell, choosing the nearest heading. */
  faceCell(scene: Scene, x: number, y: number) {
    const dx = x - scene.player.x
    const dy = y - scene.player.y
    if (dx === 0 && dy === 0) return
    const ang = Math.atan2(dx, -dy)
    this.setFacing(yawToDir(ang))
  }

  /**
   * A keyboard step went `delta`: the camera turns to that exact vector, the
   * old cell to the new one. No hostile or wall overrides it; the player
   * chose the direction and the view follows their feet.
   */
  faceStep(dx: number, dy: number) {
    if (dx === 0 && dy === 0) return
    this.setFacing(yawToDir(Math.atan2(dx, -dy)))
  }

  /**
   * Path-driven movement (travel, explore, a spectated player). A hostile in
   * view matters more than the road: face the nearest one. Otherwise face
   * along `delta`, the way the step went, unless that heading looks at a
   * known wall: then the nearest heading with room ahead, a small turn before
   * a large one. Unexplored cells ahead are not walls; exploring means walking
   * into them.
   */
  faceAfterMove(scene: Scene, dx: number, dy: number) {
    if (this.faceHostile(scene)) return
    this.setFacing(this.openHeading(scene, yawToDir(Math.atan2(dx, -dy))))
  }

  /**
   * Arrived several cells on in one update (`travel_delay -1` sends no frames
   * between steps; a blink; a teleport). The straight line from where we were
   * says little about a winding walk, so the travel trail is read first: the
   * last step it records is the way the feet went, and the camera faces it as
   * after any step. With no trail (`show_travel_trail` off, or a real jump)
   * the displacement stands in.
   */
  faceAfterJump(scene: Scene, dx: number, dy: number) {
    const s = trailStep(scene) ?? { dx, dy }
    this.faceAfterMove(scene, s.dx, s.dy)
  }

  /**
   * Face the threat: the nearest visible hostile autofight would attack
   * (`isThreat`: never a plant). Once chosen, the camera
   * stays on that monster until it leaves view or another hostile gets
   * strictly closer, so equidistant monsters don't make the view flicker.
   * While an autofight walk is closing on it (`autofight`), the hold is
   * firmer: see `threat`.
   */
  faceHostile(scene: Scene): boolean {
    const m = this.threat(scene)
    if (!m) return false
    this.faceCell(scene, m.x, m.y)
    return true
  }

  /**
   * Face what stopped the walk. Explore and travel halt for the monsters
   * `nearby-danger.cc` calls unsafe, hostile or neutral, never a plant
   * (`blocksExplore`), so that is the set to choose from, not hostiles alone:
   * the monster the server named in its warning when the caller has one,
   * else the nearest blocker, a hostile before a neutral at the same
   * distance. The camera then tracks that monster as its threat.
   */
  faceBlocker(scene: Scene, named: Billboard | null = null): boolean {
    const m = named ?? nearestBlocker(scene)
    if (!m) return false
    this.closing = false
    this.threatId = monsterId(m)
    this.faceCell(scene, m.x, m.y)
    return true
  }

  /** A hostile stands next to the player: face the threat (a fight in place). */
  faceAdjacentHostile(scene: Scene): boolean {
    const m = this.threat(scene)
    if (!m || kingMoves(scene, m) > 1) return false
    this.faceCell(scene, m.x, m.y)
    return true
  }

  /**
   * Autofight was sent (Tab): face the threat. Returns true when the press
   * swings, the threat being within reach. Otherwise autofight walks one step
   * toward it (`autofight.lua attack`: `move_towards`), and the camera starts
   * closing on that monster too: it is held through the walk, so a hostile
   * that turns up or edges closer meanwhile does not swing the view off the
   * one we are heading for. The hold ends when the threat is reached or
   * leaves view, when another hostile is already in reach, or when any other
   * move is made (`stopClosing`).
   */
  autofight(scene: Scene): boolean {
    const m = this.threat(scene)
    if (!m) return false
    this.faceCell(scene, m.x, m.y)
    const inReach = kingMoves(scene, m) <= 1
    this.closing = !inReach
    return inReach
  }

  /** A move other than autofight's: the walk it was closing on is over. */
  stopClosing() {
    this.closing = false
  }

  private threatId: number | undefined
  /** an autofight walk is under way toward `threatId` */
  private closing = false

  /**
   * The threat: the held monster while it is no farther than the nearest
   * hostile, else the nearest. Closing on it (an autofight walk), the held
   * monster stays the threat even with another hostile strictly closer, until
   * it is reached or gone. The one exception is a hostile already in reach:
   * `autofight.lua compare_monster_info` ranks `can_attack` above
   * `distance`, so the next Tab swings at that one, and the camera faces it.
   */
  private threat(scene: Scene): Billboard | null {
    const nearest = nearestHostile(scene)
    if (!nearest) {
      this.threatId = undefined
      this.closing = false
      return null
    }
    const held = this.threatId === undefined ? undefined : monstersInView(scene).find((b) => isThreat(b) && monsterId(b) === this.threatId)
    if (!held) this.closing = false
    const near = kingMoves(scene, nearest)
    const m = held && (kingMoves(scene, held) <= near || (this.closing && near > 1)) ? held : nearest
    if (kingMoves(scene, m) <= 1) this.closing = false
    this.threatId = monsterId(m)
    return m
  }

  /**
   * Arrived somewhere new (level change, teleport, an explore or travel that
   * came through as one jump): a hostile in view is faced; otherwise the
   * heading is kept unless it looks at a wall, and then the nearest heading
   * with room ahead. Returns false when nothing around the player is known
   * yet (the new level's cells have not arrived), so the caller can try again.
   */
  faceAfterArrival(scene: Scene): boolean {
    if (this.faceHostile(scene)) return true
    if (!this.surroundingsKnown(scene)) return false
    const d = this.openHeading(scene, this.camera.facing)
    // a heading with room ahead is kept as it is, exact yaw included
    if (d !== this.camera.facing) this.setFacing(d)
    return true
  }

  private surroundingsKnown(scene: Scene): boolean {
    for (let d = 0; d < 8; d++) {
      const c = getCell(scene, scene.player.x + DIR8_DX[d], scene.player.y + DIR8_DY[d])
      if (c && c.kind !== 'unknown') return true
    }
    return false
  }

  /**
   * `d` if it has room ahead; else the heading with room nearest to it, small
   * turns before large. "Room" is measured as open depth along the heading
   * (see `openDepth`): two cells of it means we are not looking at a wall,
   * one cell is better than none, and only when every heading is blocked do
   * we keep `d`.
   */
  private openHeading(scene: Scene, d: Dir8): Dir8 {
    const candidates = [d, ...HEADING_OFFSETS.map((off) => rotateDir(d, off))]
    for (const need of [OPEN_DEPTH, 1]) {
      for (const c of candidates) if (this.openDepth(scene, c) >= need) return c
    }
    return d
  }

  /**
   * Cells of open ground along `d` from the player, up to OPEN_DEPTH. A cell
   * is open unless known and unwalkable; unexplored counts as open. A
   * diagonal heading squeezing between two known walls counts as blocked at
   * once: in 3D that is two wall faces filling the view.
   */
  private openDepth(scene: Scene, d: Dir8): number {
    const blocked = (x: number, y: number) => {
      const c = getCell(scene, x, y)
      return c !== undefined && c.kind !== 'unknown' && !isWalkable(c)
    }
    const px = scene.player.x
    const py = scene.player.y
    if (d % 2 === 1) {
      const a = rotateDir(d, -1)
      const b = rotateDir(d, 1)
      if (blocked(px + DIR8_DX[a], py + DIR8_DY[a]) && blocked(px + DIR8_DX[b], py + DIR8_DY[b])) return 0
    }
    let n = 0
    while (n < OPEN_DEPTH && !blocked(px + DIR8_DX[d] * (n + 1), py + DIR8_DY[d] * (n + 1))) n++
    return n
  }

  /** Advance easing. Returns true if the camera moved (a frame is needed). */
  update(dt: number): boolean {
    const c = this.camera
    let moved = false
    if (this.freeLook) {
      c.yaw = normalizeYaw(c.yaw + this.lookVel * dt)
      c.pitch = this.clampPitch(c.pitch + this.pitchVel * dt)
      c.facing = yawToDir(c.yaw)
      moved = true
    } else {
      const d = yawDelta(c.yaw, this.goalYaw)
      if (Math.abs(d) > 0.002) {
        const k = this.reducedMotion ? 1 : Math.min(1, dt * 14)
        c.yaw = normalizeYaw(c.yaw + d * k)
        moved = true
      } else if (c.yaw !== this.goalYaw) {
        c.yaw = this.goalYaw
        moved = true
      }
    }
    return moved
  }

  get steering(): boolean {
    return this.freeLook || this.dragging
  }

  markMove(ts: number) {
    this.lastMoveTs = ts
  }
  get lastMove(): number {
    return this.lastMoveTs
  }
}

/**
 * The last step the travel trail records into the player's cell: the cell's
 * own "from" arrow, or failing that a neighbour whose "to" arrow points here.
 */
export function trailStep(scene: Scene): { dx: number; dy: number } | null {
  const px = scene.player.x
  const py = scene.player.y
  const here = getCell(scene, px, py)?.trail?.from
  if (here !== undefined) return { dx: DIR8_DX[here], dy: DIR8_DY[here] }
  for (let d = 0; d < 8; d++) {
    const c = getCell(scene, px + DIR8_DX[d], py + DIR8_DY[d])
    const to = c?.trail?.to
    // the arrow leaves the neighbour toward us: the opposite of the way to it
    if (to !== undefined && to === ((d + 4) % 8)) return { dx: DIR8_DX[to], dy: DIR8_DY[to] }
  }
  return null
}

/** how far ahead a heading must be open before it counts as not facing a wall */
const OPEN_DEPTH = 2
/** rotations from a preferred heading, nearest first, ending with a full about-turn */
const HEADING_OFFSETS = [1, -1, 2, -2, 3, -3, 4]

/** pitch limit: nearly straight up or down, stopping short of the pole so yaw stays meaningful */
const PITCH_MAX = (Math.PI / 180) * 85
/**
 * Third-person glance, as an offset either side of the rest pitch: the camera
 * is 0.75 up under a 1.0 lid, so past this there is only lid or floor to see.
 * The renderer clamps the final pitch to the same window.
 */
const THIRD_GLANCE = (Math.PI / 180) * 30

function kingMoves(scene: Scene, b: Billboard): number {
  return Math.max(Math.abs(b.x - scene.player.x), Math.abs(b.y - scene.player.y))
}

function monsterId(b: Billboard): number | undefined {
  return (b.ref as { id?: number } | undefined)?.id
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

/**
 * The compass heading the grid is read against under a facing (`gridFacing`):
 * a compass facing itself, a diagonal the compass heading on its left, so
 * north-east reads as north. The minimap turns to the same heading (hud.ts
 * renderMinimap), so the map and an aim's keys agree on which way is up.
 */
export function gridFacingOf(f: Dir8): Dir8 {
  return f % 2 === 0 ? f : rotateDir(f, -1)
}
