/**
 * The marks on a cell's floor, as every renderer draws them. The cursor is a
 * ring round the cell's middle: a diamond band RING_INNER..RING_OUTER out
 * from it (|x| + |z|, in cells), CURSOR_COLOUR for a look or an aim and
 * CURSOR_MAP_COLOUR on the level map, as sRGB.
 */
export const RING_INNER = 0.34
export const RING_OUTER = 0.46
export const CURSOR_COLOUR = 0xff8800
export const CURSOR_MAP_COLOUR = 0xffffff
