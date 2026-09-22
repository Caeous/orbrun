import { cellKey, type CellKey } from '@orbrun/scene'

/**
 * Visit every cell the ground-plane segment from (ax, az) to (bx, bz)
 * touches, in order from the start, until `visit` returns true.
 */
export function gridWalk(ax: number, az: number, bx: number, bz: number, visit: (x: number, z: number, k: CellKey) => boolean | void) {
  let x = Math.floor(ax), z = Math.floor(az)
  const dx = bx - ax, dz = bz - az
  const sx = Math.sign(dx), sz = Math.sign(dz)
  const tdx = dx === 0 ? Infinity : Math.abs(1 / dx)
  const tdz = dz === 0 ? Infinity : Math.abs(1 / dz)
  let tx = dx === 0 ? Infinity : (sx > 0 ? x + 1 - ax : ax - x) / Math.abs(dx)
  let tz = dz === 0 ? Infinity : (sz > 0 ? z + 1 - az : az - z) / Math.abs(dz)
  for (let i = 0; i < 128; i++) {
    if (visit(x, z, cellKey(x, z))) return
    // no boundary left before the end: the segment ends in this cell
    if (tx > 1 && tz > 1) return
    if (tx < tz) { x += sx; tx += tdx } else { z += sz; tz += tdz }
  }
}
