// @vitest-environment happy-dom
import { it } from 'vitest'
import { startLive } from './client'
import { screen } from './screen'
import { FIGHTER } from './scenarios'
it('dump help', { timeout: 120000 }, async () => {
  const g = await startLive({ args: FIGHTER })
  for (let i = 0; i < 5 && g.ctx().mode !== 'command'; i++) await g.raw('a')
  await g.key('?')
  const dump = (n: string) => { const st: any = g.state(); const p = st.popups; const m = st.menus; console.log("=== " + n, JSON.stringify({p: p?.map((x:any)=>({type:x.type,data:x.data,state:x.state})), m: m?.map((x:any)=>({type:x.menu?.type, tag:x.menu?.tag, title:x.menu?.title}))}, null, 1).slice(0, 6000)); console.log(JSON.stringify(screen(g).bar)) }
  dump('menu')
  await g.key('a'); dump('after a')
  await g.key('Escape'); dump('after esc')
  g.close()
})
