import type { SceneCursor } from '@orbrun/scene'

/**
 * The marks on a cell's floor, as every renderer draws them. The cursor is
 * WebTiles' own icon for it (`SceneCursor.tile`) laid on its cell where the
 * tiles have it, else a ring round the cell's middle: a diamond band
 * RING_INNER..RING_OUTER out from it (|x| + |z|, in cells), CURSOR_COLOUR
 * for a look or an aim and CURSOR_MAP_COLOUR on the level map, as sRGB, at
 * CURSOR_ALPHA. The cell's other marks (travel arrows, exclusion on unseen
 * cells, badges) are its floor's (cells.ts `floorLayers` `marks`).
 */
export const RING_INNER = 0.34
export const RING_OUTER = 0.46
export const CURSOR_COLOUR = 0xff8800
export const CURSOR_MAP_COLOUR = 0xffffff
export const CURSOR_ALPHA = 0.95

/** The ring's colour for the cursor's mode, as sRGB. */
export function cursorColour(cur: Pick<SceneCursor, 'mode'>): number {
  return cur.mode === 'map' ? CURSOR_MAP_COLOUR : CURSOR_COLOUR
}

/**
 * How much of a pixel the ring covers, 0..1, at (fx, fz) of the cell (0..1
 * east and south), the pixel `w` cells wide on the floor: the band's share
 * of the pixel, thickened where the pixel is wider than the band so a far
 * ring does not print as dashes. The shader (CURSOR_FRAG) works it the same.
 */
export function ringCover(fx: number, fz: number, w: number): number {
  const d = Math.abs(fx - 0.5) + Math.abs(fz - 0.5)
  w = Math.max(w, 1e-5)
  const c = Math.max(0, Math.min(1, (Math.min(d + 0.5 * w, RING_OUTER) - Math.max(d - 0.5 * w, RING_INNER)) / w))
  return 1 - Math.pow(1 - c, Math.max(1, w / (RING_OUTER - RING_INNER)))
}
