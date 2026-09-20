import {
  StepCadence,
  MAX_WALK_LAG,
  planStep,
  sampleStep,
  type StepCurve,
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
 * Camera controller: yaw easing toward the facing goal,
 * free look with the right stick or a mouse or touch drag (yaw
 * unbounded, pitch free short of the poles, nothing snaps back), and the eye's
 * glide after a step along the path the feet took (`walkTo`); a jump snaps.
 */
/** The yaw in radians; enough to put the camera back facing where it faced (the pitch is not kept). */
export interface CameraView {
  yaw: number
}

export class CameraController {
  camera: Camera = makeCamera()
  /** yaw the camera is easing toward */
  private goalYaw = 0
  /**
   * The heading the minimap's ground shows at the top, in radians, where the
   * ground stands on compass quarters (MAP_TURNS_DIAGONAL off): eases toward
   * the map heading (`mapFacingOf`) the same way the view's yaw eases toward
   * its facing, so the map turns in step with the scene rather than
   * snapping. Where the ground turns with the view itself it is not used:
   * `mapYaw` is the view's own yaw then, so the map and the scene cannot
   * come apart, under a keyed turn or a look.
   */
  private _mapYaw = 0
  /**
   * The heading what is painted on that ground is turned back to, in radians:
   * the grid heading (`gridFacing`), eased at the same rate. Where the ground
   * turns on diagonals too the two run 45 degrees apart there, so the
   * features, the highlights and the cursor lie with the ground instead of
   * standing upright over it (the monsters, items and the player stay
   * upright); easing both means the lean grows and falls away smoothly
   * instead of flipping as a turn crosses the diagonal.
   */
  private _uprightYaw = 0
  private freeLook = false
  private dragging = false
  private lookVel = 0
  private pitchVel = 0
  private _steeringRevision = 0
  /** Explicit turn/look input, not animation or auto-facing. An old move may not undo a newer look. */
  get steeringRevision(): number {
    return this._steeringRevision
  }
  reducedMotion = false
  /**
   * Where the camera points at rest: the Camera angle setting, in radians,
   * negative below the horizon. It is the pitch a fresh camera starts on;
   * free look is measured from wherever the camera happens to point, so
   * nothing ever springs back to it.
   */
  restPitch = REST_PITCH
  private lastMoveTs = 0
  /** cell centres the eye has still to pass, in order, ending at the camera's cell (`walkTo`); empty once it stands there */
  private path: { x: number; y: number }[] = []
  /** Distance and speed are in grid steps, so a diagonal has the same timing as a cardinal step. */
  private walk: (StepCurve & { travelled: number; elapsed: number }) | null = null
  private cadence = new StepCadence()
  private walkSpeed = 0
  /** Last sampled movement time; yaw/input still use the frame delta. */
  private walkAt = 0
  /** Steering revision at autofight input; null means it was pressed during manual look. */
  private autofightRevision: number | null | undefined

  get facing(): Dir8 {
    return this.camera.facing
  }

  setFacing(d: Dir8, immediate = false) {
    this.camera.facing = d
    this.goalYaw = dirToYaw(d)
    if (immediate || this.reducedMotion) {
      this.camera.yaw = this.goalYaw
      this._mapYaw = this.mapGoal
      this._uprightYaw = this.uprightGoal
    }
  }

  /**
   * The heading up the minimap's ground right now, in radians; `mapFacingOf`
   * once the turn settles. Where the ground turns with the view
   * (MAP_TURNS_DIAGONAL) it is the view's yaw itself, every frame: a keyed
   * turn eases both as one, and a stick or drag look, which turns the view
   * to any heading between the detents, turns the map with it, so what is
   * ahead in the scene is up the map at all times.
   */
  get mapYaw(): number {
    return MAP_TURNS_DIAGONAL ? this.camera.yaw : this._mapYaw
  }

  /** The heading the minimap lays its features, highlights and cursor against right now, in radians; `gridFacing` once the turn settles. */
  get mapUprightYaw(): number {
    return this._uprightYaw
  }

  private get mapGoal(): number {
    return dirToYaw(mapFacingOf(this.camera.facing))
  }

  private get uprightGoal(): number {
    return dirToYaw(this.gridFacing)
  }

  turn(by: number) {
    this._steeringRevision++
    this.setFacing(rotateDir(this.camera.facing, by))
  }

  /**
   * The camera is at `x`, `y`, now: a level change, a blink, a teleport, or
   * a travel the rc asked to skip the steps of (`travel_delay -1` arrives as
   * one update several cells on). No glide: nothing was drawn between.
   */
  snapTo(x: number, y: number) {
    this.stopClosing()
    this.cadence.reset()
    this.landAt(x, y)
  }

  /** Landing keeps the arrival cadence; an explicit snap forgets it. */
  private landAt(x: number, y: number) {
    this.camera.x = x
    this.camera.y = y
    this.camera.eyeX = x
    this.camera.eyeY = y
    this.path = []
    this.walk = null
    this.walkSpeed = 0
  }

  /**
   * The feet walked to `x`, `y` by `hops`, one cell each, from the camera's
   * cell (the last goal). The eye glides after them along that path
   * (`update`) rather than jumping the cell, and along the real path rather
   * than the straight line, so two hops through a doorway do not cut the
   * corner into the wall. Hops that do not add up to the destination (a
   * missed message) are replaced by the straight line where it is a single
   * cell, else the walk is a jump and the eye snaps. Arrival time (`now`,
   * seconds) adjusts repeated steps within 100–140 ms; it never adds a hop.
   */
  walkTo(x: number, y: number, hops: readonly { dx: number; dy: number }[], now = performance.now() / 1000) {
    const c = this.camera
    if (this.reducedMotion) {
      this.snapTo(x, y)
      return
    }
    let px = c.x
    let py = c.y
    const pts: { x: number; y: number }[] = []
    let valid = true
    for (const h of hops) {
      if (!Number.isInteger(h.dx) || !Number.isInteger(h.dy) || Math.abs(h.dx) > 1 || Math.abs(h.dy) > 1) {
        valid = false
        break
      }
      if (h.dx === 0 && h.dy === 0) continue
      px += h.dx
      py += h.dy
      pts.push({ x: px, y: py })
    }
    if (!valid || px !== x || py !== y) {
      if (Math.abs(x - c.x) > 1 || Math.abs(y - c.y) > 1) {
        this.snapTo(x, y)
        return
      }
      pts.length = 0
      if (x !== c.x || y !== c.y) pts.push({ x, y })
    }
    if (pts.length === 0) return
    // Sample the previous confirmed walk at the arrival time before retargeting,
    // exactly as the monsters do. Never charge the new step for an older frame.
    this.advanceWalk(0, now)
    c.x = x
    c.y = y
    this.walkAt = now
    const moving = this.walk !== null
    this.path.push(...pts)
    const { duration, continuous } = this.cadence.confirm(now)
    this.planWalk(this.pathLength(), duration, moving ? this.walkSpeed : undefined, continuous)
  }

  /** The view to keep between sessions: the way the camera faces right now. */
  get view(): CameraView {
    return { yaw: this.camera.yaw }
  }

  /**
   * Face the camera the way a previous session left it, at once and without
   * easing; the pitch stays at its rest angle. Facing follows the yaw so
   * turns and auto-facing start from here.
   */
  restore(view: CameraView) {
    this.stopClosing()
    const c = this.camera
    c.yaw = normalizeYaw(view.yaw)
    c.facing = yawToDir(c.yaw)
    this.goalYaw = c.yaw
    this._mapYaw = this.mapGoal
    this._uprightYaw = this.uprightGoal
  }

  /**
   * The player chose another rest angle: the view tilts with it, so the
   * change shows at once in the settings menu.
   */
  setRestPitch(p: number) {
    const d = p - this.restPitch
    this.restPitch = p
    this.camera.pitch = this.clampPitch(this.camera.pitch + d)
  }

  private clampPitch(p: number): number {
    return clamp(p, -PITCH_MAX, PITCH_MAX)
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
    this._steeringRevision++
    this.freeLook = true
    this.lookVel = dx * 3.2 * sensitivity
    this.pitchVel = (invert ? dy : -dy) * 0.8 * sensitivity
  }

  /**
   * Relative look from a mouse or touch drag: `dyaw`/`dpitch` in radians,
   * applied at once. Call `endDrag` when the drag ends.
   */
  lookBy(dyaw: number, dpitch: number) {
    if (dyaw !== 0 || dpitch !== 0) this._steeringRevision++
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
   * the left edge of the view, `l` up the right, and `u` straight ahead. A
   * look's forward and back are the one exception, running along the facing
   * itself instead (runner `absoluteAim`), so there `k` steps straight up
   * the screen and `j` straight down it.
   */
  get gridFacing(): Dir8 {
    return gridFacingOf(this.camera.facing)
  }

  /**
   * The aim's cursor moved. A cell on one of the eight rays from the player
   * (straight along a heading) turns the view to that heading at once, so
   * an aim opened on a diagonal facing turns to east as soon as the cursor
   * steps onto the line due east, and a cursor stepping diagonally from a
   * compass facing takes the view with it. Off every ray, the heading is
   * kept while the cell is in front of the player (ahead of the line across
   * their shoulders), so a walk of the cursor about the view never swings
   * it; a cell on or behind that line turns the view to the heading nearest
   * the cell, so the cursor stays in sight.
   */
  faceCursorBehind(scene: Scene, x: number, y: number) {
    const dx = x - scene.player.x
    const dy = y - scene.player.y
    if (dx === 0 && dy === 0) return
    const onRay = dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy)
    const f = this.camera.facing
    if (!onRay && dx * DIR8_DX[f] + dy * DIR8_DY[f] > 0) return
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
    if (this.autofightOverridden) return
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
    if (this.autofightOverridden) return true
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
    if (this.autofightOverridden) return true
    this.stopClosing()
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
    if (!m) {
      this.stopClosing()
      return false
    }
    this.autofightRevision = this.steering ? null : this._steeringRevision
    if (!this.steering) {
      this.faceCell(scene, m.x, m.y)
    }
    const inReach = kingMoves(scene, m) <= 1
    this.closing = !inReach
    return inReach
  }

  /** A move other than autofight's: the walk it was closing on is over. */
  stopClosing() {
    this.closing = false
    this.autofightRevision = undefined
  }

  private get autofightOverridden(): boolean {
    return this.autofightRevision !== undefined && this.autofightRevision !== this._steeringRevision
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

  /**
   * Advance easing. `now` is the shared presentation clock in seconds.
   * Movement uses that clock; yaw eases toward the chosen compass heading.
   */
  update(dt: number, now?: number): boolean {
    if (!Number.isFinite(dt) || dt <= 0) return false
    const c = this.camera
    let moved = this.advanceWalk(dt, now)
    if (this.freeLook) {
      c.yaw = normalizeYaw(c.yaw + this.lookVel * dt)
      c.pitch = this.clampPitch(c.pitch + this.pitchVel * dt)
      c.facing = yawToDir(c.yaw)
      moved = true
    } else {
      const yaw = this.ease(c.yaw, this.goalYaw, dt, TURN_RATE)
      if (yaw !== c.yaw) {
        c.yaw = yaw
        moved = true
      }
    }
    // The minimap's ground: where it turns with the view it *is* the view's
    // yaw (`mapYaw`), so there is nothing to ease — the same turn, the same
    // look, the map and the scene swing as one. On quarters it has a
    // different heading to reach, and eases there with a touch of extra
    // speed. What is painted on the ground follows the grid heading at the
    // view's rate, so the lean grows and falls away in step with the ground
    // it lies on.
    const rate = MAP_TURNS_DIAGONAL ? TURN_RATE : MAP_TURN_RATE
    if (!MAP_TURNS_DIAGONAL) {
      const map = this.ease(this._mapYaw, this.mapGoal, dt, rate)
      if (map !== this._mapYaw) {
        this._mapYaw = map
        moved = true
      }
    }
    const upright = this.ease(this._uprightYaw, this.uprightGoal, dt, rate)
    if (upright !== this._uprightYaw) {
      this._uprightYaw = upright
      moved = true
    }
    return moved
  }

  /** Remaining path length in grid steps, not Euclidean cells. */
  private pathLength(): number {
    let total = 0
    let { eyeX: x, eyeY: y } = this.camera
    for (const p of this.path) {
      total += Math.max(Math.abs(p.x - x), Math.abs(p.y - y))
      x = p.x
      y = p.y
    }
    return total
  }

  /** Replan the whole confirmed path, carrying speed rather than starting each reply from rest. */
  private planWalk(length: number, duration: number, speed: number | undefined, continuous: boolean) {
    this.walk = { ...planStep(length, duration, speed, continuous), elapsed: 0, travelled: 0 }
    this.walkSpeed = this.walk.startSpeed
  }

  /** Sample movement on the host's clock; delta-only callers (the room/tests) still work. */
  private advanceWalk(dt: number, now?: number): boolean {
    const elapsed = now === undefined ? dt : Math.max(0, now - this.walkAt)
    if (!this.walk || elapsed <= 0) return false
    this.walkAt = now ?? this.walkAt + elapsed
    return this.glide(elapsed)
  }

  private glide(dt: number): boolean {
    const c = this.camera
    const walk = this.walk
    if (!walk) return false
    if (this.reducedMotion) {
      this.snapTo(c.x, c.y)
      return true
    }
    walk.elapsed = Math.min(walk.duration, walk.elapsed + dt)
    // Finish exactly, including accumulated floating-point time at the deadline.
    if (walk.duration - walk.elapsed < 1e-9) {
      this.landAt(c.x, c.y)
      return true
    }
    const { distance: position, speed } = sampleStep(walk, walk.elapsed)
    this.walkSpeed = speed
    const planned = Math.max(0, position - walk.travelled)
    // Leave room for an ordinary next step without a position jump. Only a
    // fast travel or burst of replies forces catch-up; it still follows the
    // real path, and rebasing keeps the original landing deadline.
    let step = Math.max(planned, this.pathLength() - MAX_WALK_LAG)
    const caughtUp = step > planned
    while (step > 0 && this.path.length > 0) {
      const p = this.path[0]
      const d = Math.max(Math.abs(p.x - c.eyeX), Math.abs(p.y - c.eyeY))
      if (d <= step) {
        c.eyeX = p.x
        c.eyeY = p.y
        step -= d
        this.path.shift()
      } else {
        c.eyeX += ((p.x - c.eyeX) / d) * step
        c.eyeY += ((p.y - c.eyeY) / d) * step
        step = 0
      }
    }
    if (caughtUp) this.planWalk(this.pathLength(), walk.duration - walk.elapsed, this.walkSpeed, walk.continuous)
    else walk.travelled = position
    return true
  }

  /** One step of the turn easing from `from` toward `to` at `rate` per second; `to` itself once close enough. */
  private ease(from: number, to: number, dt: number, rate: number): number {
    const d = yawDelta(from, to)
    if (Math.abs(d) > 0.002) {
      const k = this.reducedMotion ? 1 : -Math.expm1(-dt * rate)
      return normalizeYaw(from + d * k)
    }
    return to
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

/** Exponential turn rates, calibrated to the old 60 Hz feel but independent of frame rate. */
const TURN_RATE = 16
const MAP_TURN_RATE = 21
/** how far ahead a heading must be open before it counts as not facing a wall */
const OPEN_DEPTH = 2
/** rotations from a preferred heading, nearest first, ending with a full about-turn */
const HEADING_OFFSETS = [1, -1, 2, -2, 3, -3, 4]

/** pitch limit: nearly straight up or down, stopping short of the pole so yaw stays meaningful */
const PITCH_MAX = (Math.PI / 180) * 85

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
 * Experiment: the minimap's ground turns to every heading, diagonals
 * included, instead of standing on the compass quarter. Only the ground —
 * the grid the keys are read against (`gridFacingOf`) keeps its quarters, so
 * an aim, an examine and a fire pick cells exactly as they always did. The
 * monsters, items and the player stay upright over the turned ground; the
 * features, the highlights and the cursor lie with it.
 */
export const MAP_TURNS_DIAGONAL = true

/**
 * The compass heading the grid is read against under a facing (`gridFacing`):
 * a compass facing itself, a diagonal the compass heading on its left, so
 * north-east reads as north. An aim's keys are read against it (runner
 * `absoluteAim`), and under quarter turns the minimap stands on it too.
 */
function gridFacingOf(f: Dir8): Dir8 {
  return f % 2 === 0 ? f : rotateDir(f, -1)
}

/**
 * The heading the minimap's ground stands on under a facing: the grid's
 * heading, or the facing itself where the map turns on diagonals too
 * (MAP_TURNS_DIAGONAL). The keys keep reading against `gridFacingOf` either
 * way, so on a diagonal the map leans under a cursor that does not.
 */
export function mapFacingOf(f: Dir8): Dir8 {
  return MAP_TURNS_DIAGONAL ? f : gridFacingOf(f)
}
