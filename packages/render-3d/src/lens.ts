/**
 * The lens's vertical angle for a view `aspect` wide per unit tall, from the
 * Field of view setting (`fov`, degrees): the setting is the vertical angle,
 * and the across one follows the view's shape. Orbrun's own, for a phone held
 * upright (`upright`): kept vertical on a view taller than wide, the across
 * angle would shrink to a slot (85° up and down is some 45° across on a
 * phone), so there the setting is the angle across, as on a square view, and
 * the lens opens up and down instead; the extra height falls mostly under the
 * HUD's panes along its top and foot.
 */
export function lensFov(fov: number, aspect: number, upright = false): number {
  if (!upright || !(aspect > 0) || aspect >= 1) return fov
  return (2 * Math.atan(Math.tan((fov * Math.PI) / 360) / aspect) * 180) / Math.PI
}
