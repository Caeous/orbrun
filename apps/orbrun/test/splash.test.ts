import { describe, it, expect } from 'vitest'
import { XOM_SPLASHES, pickSplash, splashWeight } from '../src/splash'

describe('the title splash', () => {
  it('draws by weight: the Orb gift line is the likeliest and the ends of [0, 1) land inside the pool', () => {
    expect(pickSplash(0)).toBe('Ponder my incredible Orb!')
    expect(pickSplash(2.5 / splashWeight())).toBe('Ponder my incredible Orb!')
    expect(pickSplash(3 / splashWeight())).toBe('Is this the Orb you wanted?')
    expect(pickSplash(1 - Number.EPSILON)).toBe(XOM_SPLASHES[XOM_SPLASHES.length - 1].text)
    expect(pickSplash(1)).toBe(XOM_SPLASHES[XOM_SPLASHES.length - 1].text)
  })

  it('every line names the Orb, is one short sentence, and has no template left in it', () => {
    for (const { text } of XOM_SPLASHES) {
      expect(text).toMatch(/\bOrb\b/)
      expect(text).not.toMatch(/[@[\]]/)
      expect(text.length).toBeLessThan(70)
    }
    expect(new Set(XOM_SPLASHES.map((s) => s.text)).size).toBe(XOM_SPLASHES.length)
  })
})
