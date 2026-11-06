/** the player's arrow for each eighth of a turn from north, clockwise (as the monster list's bearings) */
const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖']

/** The arrow pointing the way `yaw` faces (north 0, clockwise), to the nearest eighth of a turn. */
export function facingArrow(yaw: number): string {
  const k = Math.round(yaw / (Math.PI / 4))
  return ARROWS[((k % 8) + 8) % 8]
}

/**
 * Where the level map's top-left cell is to show all the level that is known (`bounds`) in `w` x `h` cells, kept
 * clear of the stats pane over its top-left (`corner`): under the pane where it fits there, else beside it, else over
 * the whole of it, the pane over its corner as the browser's; centred in the room it has. Null where it does not fit
 * at all, and the map follows its cursor.
 */
export function mapFrame(bounds: { left: number; top: number; right: number; bottom: number }, w: number, h: number, corner: { w: number; h: number }): { left: number; top: number } | null {
  const bw = bounds.right - bounds.left + 1, bh = bounds.bottom - bounds.top + 1
  if (bw <= 0 || bh <= 0 || bw > w || bh > h) return null
  const mid = (room: number, size: number) => Math.floor((room - size) / 2)
  if (bh <= h - corner.h) return { left: bounds.left - mid(w, bw), top: bounds.top - corner.h - mid(h - corner.h, bh) }
  if (bw <= w - corner.w) return { left: bounds.left - corner.w - mid(w - corner.w, bw), top: bounds.top - mid(h, bh) }
  return { left: bounds.left - mid(w, bw), top: bounds.top - mid(h, bh) }
}

/**
 * Where the level map's top-left cell is, `w` x `h` cells, its cursor at `cur`, where it was last (`was`, null as it
 * opens): all the known level where it fits (`mapFrame`); else along each way it fits, the level centred, and along a
 * way it does not, the map on the cursor as it opens and moved only when the cursor comes within `edge` cells of a
 * side, as a scrolled map, but never past the level's sides, so none of the map is spent beyond them.
 */
export function mapView(bounds: { left: number; top: number; right: number; bottom: number }, cur: { x: number; y: number }, was: { left: number; top: number } | null, w: number, h: number, corner: { w: number; h: number }, edge: number): { left: number; top: number } {
  const whole = mapFrame(bounds, w, h, corner)
  if (whole) return whole
  const axis = (lo: number, hi: number, size: number, c: number, at: number | undefined) => {
    const span = hi - lo + 1
    if (span <= 0) return c - Math.floor(size / 2)
    if (span <= size) return lo - Math.floor((size - span) / 2)
    const e = Math.min(edge, Math.floor(size / 4))
    let start = at ?? c - Math.floor(size / 2)
    if (c - start < e || c - start >= size - e) start = c - Math.floor(size / 2)
    return Math.max(lo, Math.min(hi - size + 1, start))
  }
  return { left: axis(bounds.left, bounds.right, w, cur.x, was?.left), top: axis(bounds.top, bounds.bottom, h, cur.y, was?.top) }
}
