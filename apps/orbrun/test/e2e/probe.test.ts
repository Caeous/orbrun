// @vitest-environment happy-dom
// Where each scenario lands, printed: for writing a new one. `E2E_PROBE=1 ONLY=id,id npm run e2e -- probe`
import { it } from 'vitest'
import { startLive } from './client'
import { screen } from './screen'
import { FIGHTER, SCENARIOS } from './scenarios'

it.skipIf(!process.env.E2E_PROBE)('probe', { timeout: 300000 }, async () => {
  const only = process.env.ONLY?.split(',')
  for (const sc of SCENARIOS.filter((s) => !only || only.includes(s.id))) {
    const g = await startLive({ args: sc.args ?? FIGHTER })
    try {
      if (!sc.newGame) for (let i = 0; i < 5 && g.ctx().mode !== 'command'; i++) await g.raw('a')
      await sc.setup(g)
      const s = screen(g)
      const ok = typeof sc.surface === 'string' ? s.surface === sc.surface : sc.surface.test(s.surface)
      console.log(`${ok ? 'OK ' : 'BAD'} ${sc.id}: ${s.surface} | ${s.title.slice(0, 70)} | lit ${s.lit} | bar ${JSON.stringify(s.bar)}\n   log ${JSON.stringify(s.log)}`)
    } catch (err) {
      console.log(`BAD ${sc.id}: FAILED ${String(err)}`)
    } finally {
      g.close()
    }
  }
})
