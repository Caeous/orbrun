import { describe, it, expect, vi } from 'vitest'
import { RendererPark, type Parked } from '../src/park'

/** A park entry with a renderer that only knows how to be destroyed. */
function entry(): Parked & { destroyed: () => number } {
  const destroy = vi.fn()
  return { canvas: {} as HTMLCanvasElement, renderer: { destroy } as unknown as Parked['renderer'], tiles: null, optionsKey: '', destroyed: () => destroy.mock.calls.length }
}

describe('the renderer park', () => {
  it('holds one renderer and hands it back once', () => {
    const park = new RendererPark()
    expect(park.take()).toBeNull()
    const a = entry()
    park.keep(a)
    expect(park.held).toBe(true)
    expect(park.take()).toBe(a)
    expect(park.held).toBe(false)
    expect(park.take()).toBeNull()
    expect(a.destroyed()).toBe(0)
  })

  it('is bounded: keeping a second destroys the first', () => {
    const park = new RendererPark()
    const a = entry(), b = entry()
    park.keep(a)
    park.keep(b)
    expect(a.destroyed()).toBe(1)
    expect(b.destroyed()).toBe(0)
    expect(park.take()).toBe(b)
  })

  it('clears by destroying what it holds, and is safe to clear when empty', () => {
    const park = new RendererPark()
    park.clear()
    const a = entry()
    park.keep(a)
    park.clear()
    expect(a.destroyed()).toBe(1)
    expect(park.held).toBe(false)
    park.clear()
    expect(a.destroyed()).toBe(1)
  })
})
