/**
 * Peeling an atlas's ink off the frame (`Render3d.warmAtlases`).
 *
 * The peel reads every texel of an atlas and walks the ink in from its edges
 * (peel.ts), which on a 2048-square sheet is the best part of a second: done
 * in the frame that first draws a sprite of that atlas, it is the stall a
 * player feels on entering a level (docs/front-end-perf.md). Here it runs on
 * a copy of the image while the loading screen is up, and the renderer gets
 * back the cleaned pixels and the mask to install.
 *
 * Nothing of the renderer is imported: the worker carries peel.ts alone, not
 * three.
 */
import { peelInk, sameColours } from './peel.js'

export interface PeelRequest {
  id: number
  bitmap: ImageBitmap
  width: number
  height: number
  alphaMin: number
  sprites?: ReadonlyArray<{ sx: number; sy: number; w: number; h: number }>
}

/** The cleaned pixels (RGBA), the opacity mask and the same-colour bits (`sameColours`), or why there are none. */
export interface PeelReply {
  id: number
  data?: ArrayBufferLike
  mask?: ArrayBufferLike
  same?: ArrayBufferLike
  error?: string
}

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<PeelRequest>) => void) | null
  postMessage(message: PeelReply, transfer?: Transferable[]): void
}

scope.onmessage = (e) => {
  const { id, bitmap, width, height, alphaMin, sprites } = e.data
  try {
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('no 2d context')
    ctx.drawImage(bitmap, 0, 0)
    const image = ctx.getImageData(0, 0, width, height)
    const mask = peelInk(image.data, width, height, alphaMin, sprites)
    const same = sameColours(image.data, width, height)
    scope.postMessage({ id, data: image.data.buffer, mask: mask.buffer, same: same.buffer }, [image.data.buffer, mask.buffer, same.buffer])
  } catch (err) {
    scope.postMessage({ id, error: String(err) })
  } finally {
    bitmap.close()
  }
}
