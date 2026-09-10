import { describe, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { initialState, reduce, MapFeature, type ServerMessage } from '@orbrun/webtiles'
import { loadGamedata, type Gamedata } from '@orbrun/gamedata'
import { cellKey } from '@orbrun/scene'
import { buildScene } from '../src/index.js'
const here = '/Users/mangers/dev/com.github/Caeous/orbrun/packages/scene-webtiles/test'
const gdRoot = join(here, 'fixtures', 'gamedata')
const version = readdirSync(gdRoot)[0]
describe('mf monsters', () => { it('x', async () => {
  const gd: Gamedata = await loadGamedata({ base: 'f://x', version, skipImages: true, io: {
    async fetchText(url) { return readFileSync(join(gdRoot, version, url.split('/').pop()!), 'utf8') },
    async loadImage() { throw new Error('x') } } })
  const msgs = readFileSync(join(here, '..', '..', 'webtiles', 'test', 'fixtures', 'cdi-0.34-watch.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).m as ServerMessage)
  const st = initialState()
  const MONS = new Set<number>([MapFeature.MONS_FRIENDLY, MapFeature.MONS_PEACEFUL, MapFeature.MONS_NEUTRAL, MapFeature.MONS_HOSTILE, MapFeature.MONS_NO_EXP])
  let mfMonsTotal = 0, mfMonsNoBillboard = 0, mfMonsRemembered = 0, worstFrame = 0
  for (const m of msgs) {
    reduce(st, m)
    if (m.msg !== 'map') continue
    const sc = buildScene(st, gd)
    const bb = new Set<string>()
    for (const b of sc.billboards) if (b.kind === 'monster') bb.add(cellKey(b.x, b.y))
    let n = 0
    for (const mc of st.map.cells.values()) {
      if (mc.mf === undefined || !MONS.has(mc.mf)) continue
      mfMonsTotal++
      const k = cellKey(mc.x, mc.y)
      const c = sc.cells.get(k)
      if (!bb.has(k)) { mfMonsNoBillboard++; n++ }
      if (c && c.visibility !== 'visible') mfMonsRemembered++
    }
    worstFrame = Math.max(worstFrame, n)
  }
  const hist: Record<number, number> = {}
  for (const mc of st.map.cells.values()) if (mc.mf !== undefined) hist[mc.mf] = (hist[mc.mf] || 0) + 1
  console.log({ mfMonsTotal, mfMonsNoBillboard, mfMonsRemembered, worstFrame })
  console.log('mf histogram (final frame):', hist)
  const en = gd.enums as Record<string, unknown>
  console.log('server MF_MONS_HOSTILE', en.MF_MONS_HOSTILE, 'client', MapFeature.MONS_HOSTILE, 'MF_PLAYER', en.MF_PLAYER)
})})
