/**
 * Where the hands stand (rendering-3d.md II.7). The hands sit in their own
 * perspective overlay, framed so the view is two units tall at the hands'
 * depth; a full 32-texel icon is VM_SIZE units high. A pose is a view
 * position, then a roll in the icon's plane, a pitch of the tip away from the
 * player and a yaw toward the middle of the view; the hands are held flat,
 * facing the player. A weapon tile is the profile seen from the wielder's
 * outer side, so the wielded weapon is turned half a circle and its blade
 * heads up-left from a grip low right. A shield is held as drawn.
 */
export const VM_SIZE = 0.8
/** A rest pose: view position, then roll (in-plane), pitch (tip away), yaw (inward), in radians. */
export type HandPose = { x: number; y: number; roll: number; pitch: number; yaw: number }
// held flat, facing the player; the wielded weapon is turned half a circle so its blade heads up-left
export const VM_WEAPON_REST: HandPose = { x: 0.52, y: -1.12, roll: 0, pitch: 0, yaw: Math.PI }
export const VM_OFFWEAPON_REST: HandPose = { x: -0.52, y: -1.12, roll: 0, pitch: 0, yaw: 0 }
export const VM_SHIELD_REST: HandPose = { x: -0.5, y: -1.2, roll: 0, pitch: 0, yaw: 0 }

/**
 * Orbrun's own, for a phone held upright: on a view narrower than it is
 * tall the hands shrink with its width, hanging from the same points of the
 * bottom edge, so a weapon two-fifths of the height high does not fill the
 * whole width. A view at least as wide as it is tall keeps them whole.
 */
export function handsScale(aspect: number): number {
  return Math.min(1, aspect)
}

/**
 * A pose at `k` of its size: scaled about the view's bottom edge, x as a
 * share of the width as before. Orbrun's own, for a phone: with `foot` of
 * the view's height under the HUD's touch bar, the pose hangs from the
 * bar's top edge instead, where the bar does not hide it.
 */
export function scaledPose(p: HandPose, k: number, foot = 0): HandPose {
  return k === 1 && !foot ? p : { ...p, y: -1 + 2 * foot + (p.y + 1) * k }
}

/** What the hands hold, as far as their footprint cares. */
export interface HandsHeld {
  weapon: boolean
  offhand: 'none' | 'weapon' | 'shield'
}

/** A rectangle of the canvas as fractions of its width and height, y down. */
export interface HandRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * The canvas each hand at rest covers, as fractions of the canvas, for the
 * HUD to keep clear of (hud.ts `keepClear`). Each icon is a VM_SIZE square
 * hanging from its pose's point, its bottom centre; the pose's x is scaled
 * by the aspect, as the renderer scales it, so the hands keep their place
 * against the edge on every screen; `foot` lifts them as `scaledPose` does.
 * The attack thrust (a few percent of the height) is ignored: the prompts
 * need not dodge a swing.
 */
export function handsFootprint(held: HandsHeld, aspect: number, foot = 0): HandRect[] {
  const out: HandRect[] = []
  const k = handsScale(aspect)
  const rect = (rest: HandPose) => {
    const p = scaledPose(rest, k, foot)
    const cx = p.x * aspect
    const size = VM_SIZE * k
    const fx = (x: number) => Math.min(1, Math.max(0, (x / aspect + 1) / 2))
    const fy = (y: number) => Math.min(1, Math.max(0, (1 - y) / 2))
    out.push({ x0: fx(cx - size / 2), x1: fx(cx + size / 2), y0: fy(p.y + size), y1: fy(p.y) })
  }
  if (held.weapon) rect(VM_WEAPON_REST)
  if (held.offhand === 'shield') rect(VM_SHIELD_REST)
  else if (held.offhand === 'weapon') rect(VM_OFFWEAPON_REST)
  return out
}
