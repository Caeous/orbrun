#!/usr/bin/env node
/**
 * The art of crawl's spells and abilities, by name, for the touch bar's
 * Fire (apps/orbrun/src/bindings.ts `touchShot`): the server's quiver line
 * names a quivered spell or ability ("Cast: Magic Dart", "Abil: Combustion
 * Breath") but sends no tile for it, as it does an item's. Crawl draws them
 * with `get_spell_tile` (the spell's TILEG_ in spl-data.h) and
 * `tileidx_ability` (tilepick.cc, by ability.cc's enum), so both are read
 * here on every release branch since the quiver rework and on master:
 *
 *   node tools/build/action-tiles.mjs
 *
 * writes apps/orbrun/data/action-tiles.json: `{ spells: { "<name>": [tile] },
 * abilities: { ... } }`, each a GUI atlas tile name, newest branch's first
 * where branches differ (the app takes the first its gamedata has). An
 * ordinary build never runs this; it ships what this wrote.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const out = path.join(root, 'apps/orbrun/data/action-tiles.json')
// newest first
const REFS = ['master', ...Array.from({ length: 34 - 27 + 1 }, (_, i) => `stone_soup-0.${34 - i}`)]

async function source(ref, file) {
  const url = `https://raw.githubusercontent.com/crawl/crawl/${ref}/crawl-ref/source/${file}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  return res.text()
}

function add(table, name, tile) {
  const tiles = (table[name] ??= [])
  if (!tiles.includes(tile)) tiles.push(tile)
}

const spells = {}
const abilities = {}
for (const ref of REFS) {
  const [spl, abil, pick] = await Promise.all([source(ref, 'spl-data.h'), source(ref, 'ability.cc'), source(ref, 'tilepick.cc')])

  // { SPELL_X, "Name", ... TILEG_Y, }: the entry's last field is its tile
  let ns = 0
  for (const m of spl.matchAll(/\{\s*SPELL_\w+,\s*"([^"]+)",[^{}]*?\bTILEG_(\w+)/g)) {
    ns++
    add(spells, m[1], m[2])
  }

  // tileidx_ability: runs of `case ABIL_X:` ending in `return TILEG_Y;`
  const body = /tileidx_t tileidx_ability\([^)]*\)\s*\{([\s\S]*?)\n\}/.exec(pick)?.[1]
  if (!body) throw new Error(`${ref}: no tileidx_ability`)
  const tileOf = {}
  let cases = []
  for (const m of body.matchAll(/case (ABIL_\w+):|return TILEG_(\w+);|\bbreak;/g)) {
    if (m[1]) cases.push(m[1])
    else if (m[2]) {
      for (const c of cases) tileOf[c] ??= m[2]
      cases = []
    } else cases = []
  }
  // { ABIL_X, "Name", ...: the ability table, by the same enum
  let na = 0
  for (const m of abil.matchAll(/\{\s*(ABIL_\w+),\s*"([^"]+)"/g)) {
    const tile = tileOf[m[1]]
    if (!tile) continue
    na++
    add(abilities, m[2], tile)
  }
  if (!ns || !na) throw new Error(`${ref}: ${ns} spells, ${na} abilities read`)
  console.log(`${ref}: ${ns} spells, ${na} abilities`)
}
const sorted = (t) => Object.fromEntries(Object.keys(t).sort().map((k) => [k, t[k]]))
fs.writeFileSync(out, JSON.stringify({ spells: sorted(spells), abilities: sorted(abilities) }, null, 1) + '\n')
console.log(`${Object.keys(spells).length} spells, ${Object.keys(abilities).length} abilities → ${path.relative(root, out)}`)
