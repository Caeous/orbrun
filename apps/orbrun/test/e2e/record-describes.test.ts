// @vitest-environment happy-dom
// Crawl's own text for the popups console-text.ts lays out, from the offline engine (both versions), one case for
// each way crawl's source sets text out to its eighty columns: describe.cc _format_prop_desc, its tables, a
// monster's statuses, a mutation's category against the right edge, a talisman's table, the quotes and the
// changelog someone wrapped by hand. Saved to test/fixtures/describes.json for console-text.test.ts; record again
// after an engine update: `E2E_RECORD=1 npm run e2e -- record-describes`
import { writeFileSync } from 'node:fs'
import { it } from 'vitest'
import { startLive, type E2e } from './client'
import { CONJURER, FIGHTER, give, letterOf, mores, toFloor, wiz, wizard } from './scenarios'

interface Case {
  id: string
  args?: string[]
  /** from the map to the popup */
  setup(g: E2e): Promise<void>
}

/** an item, by its name or a vault ITEM spec, made, picked up and described from the pack; `then`, keys on from there */
const item = (id: string, name: string, part: string, args?: string[], then = ''): Case => ({
  id,
  args,
  async setup(g) {
    await wiz(g)
    await give(g, name)
    await g.key('i')
    await g.key(letterOf(g, part))
    for (const k of then) await g.key(k)
  },
})

/** a monster, by its name or a vault MONS spec, made beside the player and described from look mode */
const monster = (id: string, spec: string): Case => ({
  id,
  async setup(g) {
    await wiz(g)
    await wizard(g, 'm', spec + '\r')
    await mores(g)
    await g.key('x')
    await g.key('+')
    await g.key('v')
  },
})

const CASES: Case[] = [
  item('ego-mesmerism', 'orb ego:mesmerism', 'orb'),
  item('brand-flaming', 'long sword ego:flaming', 'sword'),
  item('brand-antimagic', 'long sword ego:antimagic', 'sword'),
  item('randart-armour', 'leather armour randart', 'armour'),
  item('randart-ring', 'ring of protection from fire randart', 'ring'),
  item('unrand-dbrand', 'Singing Sword', 'Sword'),
  item('talisman-maw', 'maw talisman', 'talisman'),
  item('talisman-blade', 'blade talisman', 'talisman'),
  item('spell-fail-change', 'plate armour', 'plate', CONJURER),
  // the spells it would change, a line each (describe.cc _spell_fail_change_description), behind `!`
  item('spell-fail-table', 'plate armour', 'plate', ['-seed', '1', '-species', 'human', '-background', 'wizard', '-wizard'], '!'),
  monster('monster-goblin', 'goblin'),
  monster('monster-berserk', 'orc warrior ench:berserk'),
  monster('monster-corroded', 'ogre ench:corrosion'),
  monster('monster-caster', 'orc wizard'),
  {
    id: 'god-okawaru',
    async setup(g) {
      await wiz(g)
      await toFloor(g)
      await wizard(g, '(', 'altar_okawaru\r')
      await g.key('>')
      await mores(g)
    },
  },
  {
    id: 'version',
    async setup(g) {
      await g.key('?')
      await g.key('v')
    },
  },
  {
    id: 'mutation-horns',
    async setup(g) {
      await g.key('A')
      await g.key('a')
    },
  },
  {
    id: 'spell-magic-dart',
    args: CONJURER,
    async setup(g) {
      await g.key('I')
      await g.key('a')
    },
  },
  { id: 'overview', setup: (g) => g.key('%') },
]

it.skipIf(!process.env.E2E_RECORD)('records the describes', { timeout: 600000 }, async () => {
  const out: { channel: string; id: string; type: string; fields: Record<string, string> }[] = []
  const only = process.env.ONLY?.split(',')
  for (const channel of ['stable', 'trunk'])
    for (const c of CASES.filter((c) => !only || only.includes(c.id))) {
      const g = await startLive({ channel, args: c.args ?? FIGHTER })
      try {
        for (let i = 0; i < 5 && g.ctx().mode !== 'command'; i++) await g.raw('a')
        await c.setup(g)
        const top = g.state().ui.at(-1)
        if (!top) throw new Error('no popup')
        // every field of more than a line; the changelog's first lines are as many kinds of line as the rest has
        const fields = Object.fromEntries(
          Object.entries(top.data)
            .filter(([k, v]) => typeof v === 'string' && k !== 'msg' && v.includes('\n'))
            .map(([k, v]) => [k, (v as string).split('\n').slice(0, 120).join('\n')]),
        ) as Record<string, string>
        out.push({ channel, id: c.id, type: top.type, fields })
        console.log(`OK  ${channel} ${c.id}: ${top.type} ${Object.keys(fields).join(',')}`)
      } catch (err) {
        const said = g.state().messages.lines.slice(-3).map((m) => m.text)
        console.log(`BAD ${channel} ${c.id}: ${String(err)}; crawl said ${JSON.stringify(said)}`)
      } finally {
        g.close()
      }
    }
  writeFileSync(process.env.E2E_RECORD_OUT ?? 'apps/orbrun/test/fixtures/describes.json', JSON.stringify(out, null, 1) + '\n')
})
