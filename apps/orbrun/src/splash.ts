/**
 * The line under the title: what a god says about the Orb, picked once per
 * visit the way Minecraft picks a splash. Every line is verbatim from crawl's
 * dat/database/godspeak.txt (GPL2, like the rest of what Orbrun shows of the
 * game), and only lines that name the Orb qualify. Across that file and the
 * gods' C++ (religion.cc, xom.cc and kin, checked 2026-09-09) that is Xom's
 * "orb gift" speech and nothing else; the weights are crawl's own.
 */
export interface Splash {
  text: string
  /** How many draws of the hat this line gets (crawl's `w:`). */
  w?: number
}

export const XOM_SPLASHES: readonly Splash[] = [
  // Xom orb gift
  { text: 'Ponder my incredible Orb!', w: 3 },
  { text: 'Is this the Orb you wanted?' },
  { text: 'Many adventurers have sought this Orb.' },
]

/** Sum of the pool's weights. */
export function splashWeight(pool: readonly Splash[] = XOM_SPLASHES): number {
  return pool.reduce((n, s) => n + (s.w ?? 1), 0)
}

/** One line from the pool by weight, `random` being a draw in [0, 1). */
export function pickSplash(random: number = Math.random(), pool: readonly Splash[] = XOM_SPLASHES): string {
  let at = Math.min(Math.max(random, 0), 1 - Number.EPSILON) * splashWeight(pool)
  for (const s of pool) {
    at -= s.w ?? 1
    if (at < 0) return s.text
  }
  return pool[pool.length - 1].text
}
