/**
 * Edge pips ("what is around you"): a marker on the edge of the
 * 3D view for every monster and item the server shows in line of sight that
 * the camera does not frame. The monster list names what is around you; the
 * pips say where, on the edge nearest to it, so a jackal behind the left
 * shoulder is a pip on the left edge and one straight behind sits at the
 * bottom. Everything here is pure geometry so it can be pinned by tests; the
 * HUD (hud.ts `renderPips`) draws what this places.
 */
import { cellKey, type Billboard, type CellKey, type Scene } from '@orbrun/scene'
import { visibleMonsters } from '@orbrun/scene-webtiles'
import { isStationaryItemName } from '@orbrun/webtiles'

/** What gets a pip: nothing, the monster list's monsters, or those and items on cells in sight. */
export type EdgePipMode = 'off' | 'monsters' | 'all'

/** A point in camera space, three.js convention: x right, y up, z toward the viewer (in front of the lens is z < 0). */
export interface CamPoint {
  x: number
  y: number
  z: number
}

/** What the 3D renderer lends the HUD after a frame: its lens and a way into its camera space. */
export interface Projector {
  /** tan of half the vertical field of view */
  tanHalfY: number
  /** width over height */
  aspect: number
  /** the view's height in CSS pixels, which is what the vertical field of view spans */
  height: number
  /** The centre of cell (x, y) at height h (0 floor, 1 lid) in camera space. */
  toCamera(x: number, y: number, h: number): CamPoint
}

/** Where a pip goes on the view's edge: u, v in 0..1 across and down the view. */
export interface EdgePlace {
  u: number
  v: number
}

/**
 * Which billboards get a pip: the monsters the WebTiles monster list shows
 * (`visibleMonsters`, in its order, so the pips and the rows agree), never
 * scenery; then the player's own minions the list leaves out: the sidebar
 * mirrors WebTiles and drops what gives no experience (`no_exp`), which is
 * a foxfire or a battlesphere as much as a plant, but a friendly one is a
 * thing you cast and want to keep track of, so it gets a pip anyway, after
 * the list's monsters; under `all`, the items on cells in sight as well, never the cell
 * the player stands on (items underfoot are the pick-up prompt), never
 * a cell that already has a monster's pip (the stack mark rides the sprite),
 * and never a corpse or skeleton (`isStationaryItemName`: `g` refuses them,
 * so there is nothing there to go and take; and as a corpse links below the
 * movable items on its cell, a corpse tile on top means the pile holds
 * nothing else).
 */
export function pipTargets(scene: Scene, mode: EdgePipMode): Billboard[] {
  if (mode === 'off') return []
  const out: Billboard[] = []
  const taken = new Set<CellKey>()
  for (const b of visibleMonsters(scene)) {
    if (b.scenery) continue
    taken.add(cellKey(b.x, b.y))
    out.push(b)
  }
  for (const b of scene.billboards) {
    if (b.kind !== 'monster' || b.scenery || b.attitude !== 'friendly') continue
    const k = cellKey(b.x, b.y)
    if (taken.has(k) || scene.cells.get(k)?.visibility !== 'visible') continue
    taken.add(k)
    out.push(b)
  }
  if (mode === 'all') {
    for (const b of scene.billboards) {
      if (b.kind !== 'item' || b.scenery || (b.name && isStationaryItemName(b.name))) continue
      if (b.x === scene.player.x && b.y === scene.player.y) continue
      const k = cellKey(b.x, b.y)
      if (taken.has(k) || scene.cells.get(k)?.visibility !== 'visible') continue
      taken.add(k)
      out.push(b)
    }
  }
  return out
}

/**
 * Where a camera-space point lands on the view's edge, or null when the
 * lens frames it (then the sprite itself is on screen and needs no pip). A
 * point in front projects normally and is clamped to the edge along the
 * ray from the view's centre. A point behind the lens is placed by its
 * horizontal bearing alone (its height says nothing about where to turn):
 * from the middle of the side edge when it is exactly beside, down that
 * edge and along the bottom to the bottom centre when it is straight
 * behind, so the bottom edge reads as "behind you" and the walk along the
 * perimeter is continuous with the clamp in front.
 *
 * The clamp in front holds its height as a thing swings out to the side —
 * the ray from the centre depends on the point's direction, not its depth —
 * so the two halves would meet at a step: a jackal beside you sat a sixth
 * of the view below the middle of the edge and snapped to the middle the
 * moment it passed abeam, which on a cell-aligned monster is the moment
 * your yaw crosses the middle of a heading. So the height fades out over
 * the swing from the edge of the lens (where the pip is born, and the
 * clamp is the truth) to abeam (where the walk behind takes over): the pip
 * slides to the middle of the side edge instead of jumping to it.
 */
export function edgePlace(p: CamPoint, proj: { tanHalfY: number; aspect: number }): EdgePlace | null {
  const tx = proj.tanHalfY * proj.aspect
  const ty = proj.tanHalfY
  let u: number, v: number
  if (p.z < 0) {
    let dx = p.x / (-p.z * tx)
    let dy = p.y / (-p.z * ty)
    if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) return null
    // the fade: 0 while the lens still has the point between its side walls (|dx| <= 1, so the height is untouched for
    // anything that left over the top or the bottom), 1 abeam, where dy is nothing and the clamp lands on the middle of
    // the side edge — exactly where the walk behind starts
    const beta = Math.atan2(Math.abs(p.x), -p.z)
    const half = Math.atan(tx)
    dy *= 1 - Math.max(0, Math.min(1, (beta - half) / (Math.PI / 2 - half)))
    const m = Math.max(Math.abs(dx), Math.abs(dy))
    dx /= m
    dy /= m
    u = (dx + 1) / 2
    v = (1 - dy) / 2
  } else {
    // t: 0 exactly beside, 1 straight behind; the first half runs down the side edge, the second along the bottom
    const beta = Math.atan2(Math.abs(p.x), p.z)
    const t = 1 - beta / (Math.PI / 2)
    const right = p.x >= 0
    if (t < 0.5) {
      u = right ? 1 : 0
      v = 0.5 + t
    } else {
      v = 1
      u = right ? 1.5 - t : t - 0.5
    }
  }
  return { u, v }
}

/** The smallest a pip is ever drawn, in px: below this a sprite is a smudge rather than a cue. */
export const PIP_MIN_PX = 12

/**
 * The share of the cap where the size curve starts to bend: below this a pip
 * is the honest perspective size, above it the knee takes over.
 */
const PIP_KNEE_FRAC = 0.5

/**
 * How big a pip is: the size the sprite itself would have been had the lens
 * framed it, so the pip stands in for the thing at the thing's own scale and
 * a jackal at your shoulder reads louder than one across the room.
 *
 * A billboard is drawn as a cell-square quad `height` world units tall
 * (render-3d addStanding), and the vertical field of view spans the view's
 * `height` pixels at any depth, so the quad measures
 * `height * viewH / (2 * tanHalfY * d)` pixels at distance `d`. Distance is
 * radial from the lens rather than depth along the view axis: it stays
 * finite and keeps falling as a thing swings past the shoulder and behind
 * you, where depth would flip sign.
 *
 * That size runs away in the close range — 1/d doubles every time you halve
 * the gap — so it is passed through a soft knee rather than clipped at
 * `maxPx`. Under `PIP_KNEE_FRAC` of the cap the perspective size is left
 * alone; above it the curve bends over and approaches the cap without ever
 * reaching it, so the near range keeps its ordering (the thing in the next
 * cell still reads louder than the one three cells on) instead of a row of
 * pips all pinned to the same wall of a marker. The knee is smooth: the two
 * halves meet with the same slope, so a monster walking toward you grows
 * evenly rather than hitting a corner.
 *
 * A floor under all of it: nothing smaller than `PIP_MIN_PX`, since a cue
 * you cannot see is not a cue.
 */
export function pipSizeInView(p: CamPoint, proj: { tanHalfY: number; height: number }, height: number, maxPx: number): number {
  // a hair off the lens, so a sprite the camera stands inside does not divide by nothing
  const d = Math.max(0.25, Math.hypot(p.x, p.y, p.z))
  const px = (height * proj.height) / (2 * proj.tanHalfY * d)
  const cap = Math.max(PIP_MIN_PX, maxPx)
  const knee = cap * PIP_KNEE_FRAC
  const over = px - knee
  const soft = over <= 0 ? px : knee + ((cap - knee) * over) / (over + (cap - knee))
  return Math.round(Math.min(Math.max(soft, PIP_MIN_PX), cap))
}

export interface PxRect {
  left: number
  top: number
  width: number
  height: number
}

/** A pip's centre in view pixels, the size it is drawn at, and which edge it rides. */
export interface PipPx {
  x: number
  y: number
  size: number
  edge: 'left' | 'right' | 'top' | 'bottom'
}

/**
 * Pixel positions for a set of edge places on a view `rect`. `size` is the
 * pip's side in px — one for all of them, or one per place (pipSizeAt, so a
 * near thing draws bigger than a far one). Each sits inset by half its own
 * size so it is whole on screen. Then two corrections, both along the edge
 * the pip rides, so a pip never leaves its edge: it steps off any `avoid`
 * rectangle (a pane on the edge) by its nearer side, the other side when
 * that would leave the view (so a pane in the corner is passed toward the
 * middle of the edge, and one in the middle of it — the action panel in its
 * strip — is passed on the side the pip came from), on past the next pane
 * when it lands on one (the minimap, then the monster list), and pips
 * that would overlap are spread to where their two halves just touch,
 * pushed back from the far end when the run would leave the view.
 */
export function placePips(places: EdgePlace[], rect: PxRect, size: number | number[], avoid: PxRect[] = []): PipPx[] {
  const sizeOf = (i: number) => (typeof size === 'number' ? size : (size[i] ?? 0))
  const out: PipPx[] = places.map((p, i) => {
    const s = sizeOf(i)
    const half = s / 2
    const w = Math.max(s, rect.width)
    const hgt = Math.max(s, rect.height)
    // corners count as the vertical edge: they read as "beside", and the top and bottom carry the behind/ahead cues
    const edge: PipPx['edge'] = p.u <= 0 ? 'left' : p.u >= 1 ? 'right' : p.v <= 0 ? 'top' : 'bottom'
    return { x: rect.left + half + p.u * (w - s), y: rect.top + half + p.v * (hgt - s), size: s, edge }
  })
  for (const pip of out) {
    const half = pip.size / 2
    const axis = pip.edge === 'top' || pip.edge === 'bottom' ? 'x' : 'y'
    const lo = (axis === 'x' ? rect.left : rect.top) + half
    const hi = (axis === 'x' ? rect.left + rect.width : rect.top + rect.height) - half
    // which way this pip steps off a pane, settled on the first one it meets and kept after: the nearer side of it, or
    // the other when that side would put the pip off the view. A pane in a corner is therefore passed toward the middle
    // of the edge, one in the middle of it (the action panel in its strip) on the side the pip came from, and a pip that
    // has started round a pane keeps going the same way rather than turning back into it.
    let dir = 0
    // stepping off one pane can land on the next (the minimap, then the monster list under it): go round until clear
    for (let pass = 0; pass <= avoid.length; pass++) {
      let moved = false
      for (const a of avoid) {
        const overlaps = pip.x + half > a.left && pip.x - half < a.left + a.width && pip.y + half > a.top && pip.y - half < a.top + a.height
        if (!overlaps) continue
        const before = axis === 'x' ? a.left - half : a.top - half
        const after = axis === 'x' ? a.left + a.width + half : a.top + a.height + half
        if (dir === 0) {
          const nearer = Math.abs(pip[axis] - before) <= Math.abs(pip[axis] - after) ? -1 : 1
          const fits = (d: number) => (d < 0 ? before >= lo : after <= hi)
          dir = fits(nearer) ? nearer : -nearer
        }
        pip[axis] = dir < 0 ? before : after
        moved = true
      }
      if (!moved) break
    }
  }
  for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
    const run = out.filter((p) => p.edge === edge)
    if (run.length < 2) continue
    const axis = edge === 'left' || edge === 'right' ? 'y' : 'x'
    const near = (axis === 'y' ? rect.top : rect.left)
    const far = axis === 'y' ? rect.top + rect.height : rect.left + rect.width
    // the gap two neighbours need: half of each, so pips of different sizes still just touch
    const gap = (i: number) => (run[i - 1].size + run[i].size) / 2
    run.sort((a, b) => a[axis] - b[axis])
    for (let i = 1; i < run.length; i++) run[i][axis] = Math.max(run[i][axis], run[i - 1][axis] + gap(i))
    // the run overshot the far end: pull it back, then forward again from the near end
    const last = run[run.length - 1]
    const over = last[axis] - (far - last.size / 2)
    if (over > 0) for (const p of run) p[axis] -= over
    run[0][axis] = Math.max(run[0][axis], near + run[0].size / 2)
    for (let i = 1; i < run.length; i++) run[i][axis] = Math.max(run[i][axis], run[i - 1][axis] + gap(i))
  }
  return out
}
