/**
 * A frame for a terminal: written whole or not at all (`synced`); and, for
 * a terminal that shows kitty graphics (walk.ts), a picture as an image
 * (`kittyImage`, `kittyFile`).
 */

import { deflateSync } from 'node:zlib'

/**
 * A frame's escapes as one synchronized update (mode 2026): the terminal
 * holds what it shows until the whole frame is in, so it never paints one
 * half drawn. Terminals that do not know the mode ignore it.
 */
export function synced(out) {
  return out && `\x1b[?2026h${out}\x1b[?2026l`
}

/**
 * A kitty graphics image (`w` x `h` pixels, RGBA, or RGB with `channels` 3)
 * sent and shown at the cursor over `cols` x `rows` cells at z-index `z`
 * (under the text where negative), replacing the image `id` had: the
 * protocol's transmit-and-display, zlib-compressed, in chunks of 4096 base64
 * characters, the cursor left where it was and no reply asked for.
 */
export function kittyImage(id, px, w, h, cols, rows, z = 0, channels = 4) {
  return kittyData(id, deflateSync(Buffer.from(px.buffer, px.byteOffset, w * h * channels), { level: 1 }), w, h, cols, rows, z, channels)
}

/** `kittyImage` of pixels zlib-compressed already (`deflated`), as one compressed off the main thread. */
function kittyData(id, deflated, w, h, cols, rows, z = 0, channels = 4) {
  const b64 = deflated.toString('base64')
  const out = []
  for (let i = 0; i < b64.length; i += 4096) {
    const more = i + 4096 < b64.length ? 1 : 0
    const head = i === 0 ? `a=T,f=${channels * 8},o=z,s=${w},v=${h},i=${id},p=1,c=${cols},r=${rows},z=${z},C=1,q=2,m=${more}` : `m=${more}`
    out.push(`\x1b_G${head};${b64.slice(i, i + 4096)}\x1b\\`)
  }
  return out.join('')
}

/**
 * `kittyImage` of RGB pixels written to `path` (a temporary file, under /tmp
 * and named with `tty-graphics-protocol`, as kitty, Ghostty and Rex ask),
 * which the terminal reads and deletes: only the path goes through the
 * terminal, not the pixels.
 */
export function kittyFile(id, path, w, h, cols, rows, z = 0) {
  return `\x1b_Ga=T,t=t,f=24,s=${w},v=${h},i=${id},p=1,c=${cols},r=${rows},z=${z},C=1,q=2;${Buffer.from(path).toString('base64')}\x1b\\`
}

/** Where the picture for a temporary file goes (`kittyFile`): this process's, numbered. */
export function kittyTempPath(n) {
  return `/tmp/orbrun-tty-graphics-protocol-${process.pid}-${n}.rgb`
}

/** Every image the terminal shows taken down. */
export const DELETE_IMAGES = '\x1b_Ga=d,d=A,q=2\x1b\\'
