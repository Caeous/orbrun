#!/usr/bin/env node
/**
 * Which of crawl's spells aim, by name, for the touch spell bar
 * (apps/orbrun/src/spell-bar.ts): the bar's first tap opens an aim for a
 * spell that takes a target and only arms one that does not, so a stray
 * tap never spends a Haste. WebTiles never says which is which, and crawl
 * aims a spell when its flags hold `spflag::targeting_mask`
 * (spl-cast.h: dir_or_target | target; spl-cast.cc `your_spells`), so the
 * flags are read here from spl-data.h on every release branch since the
 * quiver rework and on master:
 *
 *   node tools/build/spell-targets.mjs
 *
 * writes apps/orbrun/data/spell-targets.json: `{ "<name>": true | false }`,
 * the newest branch's flag where branches differ. An ordinary build never
 * runs this; it ships what this wrote.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const out = path.join(root, 'apps/orbrun/data/spell-targets.json')
// newest first: the first branch that knows a spell decides it
const REFS = ['master', ...Array.from({ length: 34 - 27 + 1 }, (_, i) => `stone_soup-0.${34 - i}`)]

const spells = {}
for (const ref of REFS) {
  const url = `https://raw.githubusercontent.com/crawl/crawl/${ref}/crawl-ref/source/spl-data.h`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  const src = await res.text()
  // { SPELL_X, "Name", schools, flags, level, ...
  const entry = /\{\s*SPELL_\w+,\s*"([^"]+)",\s*[^,]+,\s*([^,]+?),\s*\d/g
  let n = 0
  for (const m of src.matchAll(entry)) {
    n++
    const [, name, flags] = m
    if (name in spells) continue
    spells[name] = /spflag::(dir_or_target|target)\b|SPFLAG_(DIR_OR_TARGET|TARGET)\b/.test(flags)
  }
  if (!n) throw new Error(`${ref}: no spells read`)
  console.log(`${ref}: ${n} spells`)
}
const sorted = Object.fromEntries(Object.keys(spells).sort().map((k) => [k, spells[k]]))
fs.writeFileSync(out, JSON.stringify(sorted, null, 1) + '\n')
console.log(`${Object.keys(sorted).length} spells, ${Object.values(sorted).filter(Boolean).length} aimed → ${path.relative(root, out)}`)
