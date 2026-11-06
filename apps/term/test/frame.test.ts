import { describe, it, expect } from 'vitest'
// @ts-expect-error: plain JS
import { synced } from '../frame.mjs'

describe('synced', () => {
  it('holds the terminal for the whole of a frame, and writes nothing for nothing', () => {
    expect(synced('x')).toBe('\x1b[?2026hx\x1b[?2026l')
    expect(synced('')).toBe('')
  })
})
