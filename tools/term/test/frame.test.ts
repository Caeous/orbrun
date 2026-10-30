import { inflateSync } from 'node:zlib'
import { describe, it, expect } from 'vitest'
// @ts-expect-error: plain JS
import { kittyFile, kittyImage, kittyTempPath, synced } from '../frame.mjs'

describe('synced', () => {
  it('holds the terminal for the whole of a frame, and writes nothing for nothing', () => {
    expect(synced('x')).toBe('\x1b[?2026hx\x1b[?2026l')
    expect(synced('')).toBe('')
  })
})

describe('kittyImage', () => {
  it('sends RGB as 24 bits a pixel, under the text where its z is negative, in chunks that join to the picture', () => {
    const px = Uint8Array.from({ length: 64 * 64 * 3 }, (_, i) => (i * 7919) % 251)
    const out = kittyImage(1, px, 64, 64, 8, 4, -1, 3)
    expect(out).toMatch(/^\x1b_Ga=T,f=24,.*s=64,v=64,i=1,.*c=8,r=4,z=-1,/)
    const b64 = [...out.matchAll(/\x1b_G[^;]*;([^\x1b]*)\x1b\\/g)].map((m) => m[1]).join('')
    expect(Buffer.compare(inflateSync(Buffer.from(b64, 'base64')), Buffer.from(px))).toBe(0)
  })

  it('hands over a picture as a temporary file the terminal may read: under /tmp, named as the protocol asks', () => {
    const path = kittyTempPath(7)
    expect(path).toMatch(/^\/tmp\/[^/]*tty-graphics-protocol[^/]*$/)
    const out = kittyFile(1, path, 64, 32, 8, 2, -1)
    expect(out).toMatch(/^\x1b_Ga=T,t=t,f=24,s=64,v=32,i=1,.*z=-1,/)
    expect(Buffer.from(out.slice(out.indexOf(';') + 1, -2), 'base64').toString()).toBe(path)
  })
})
