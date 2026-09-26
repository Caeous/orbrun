// @vitest-environment happy-dom
/**
 * The harness's footing: the same scenario played twice on crawl sends the
 * client the same messages, message for message. A recording is replayed
 * and judged against later runs, so a game that drifted (system entropy, the
 * wall clock, a settle that returned early) would make every rule a coin toss.
 */
import { describe, expect, it } from 'vitest'
import { builtChannels } from './engine'
import { atSurface } from './matrix'
import { SCENARIOS } from './scenarios'

const CHECKED = ['describe-monster', 'shop', 'stat-gain', 'altar', 'pickup']

describe.skipIf(!builtChannels.length)('the same seed plays the same game', () => {
  it.each(CHECKED)('%s', async (id) => {
    const sc = SCENARIOS.find((s) => s.id === id)!
    const runs: string[][] = []
    for (let n = 0; n < 2; n++) {
      const g = await atSurface(sc)
      runs.push(g.recording().steps.flatMap((s) => s.msgs.map((m) => JSON.stringify(m))))
      g.close()
    }
    expect(runs[1]).toEqual(runs[0])
  })
})
