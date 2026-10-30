/** the player's arrow for each eighth of a turn from north, clockwise (as the monster list's bearings) */
const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖']

/** The arrow pointing the way `yaw` faces (north 0, clockwise), to the nearest eighth of a turn. */
export function facingArrow(yaw: number): string {
  const k = Math.round(yaw / (Math.PI / 4))
  return ARROWS[((k % 8) + 8) % 8]
}
