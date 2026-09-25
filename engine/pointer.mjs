// Writes a channel's engine.json: which build it points at, and every file a
// device keeps to play it with no connection (the build and its gamedata),
// with their sizes, so a download can say how far along it is.
//
//   node engine/pointer.mjs <dist> <channel> <commit> <version> <stamp>
//
// build.sh runs it after each build. Files are listed relative to <dist>.

import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { recipe } from './recipe.mjs'

const [dist, channel, commit, version, stamp] = process.argv.slice(2)
if (!stamp) {
  console.error('usage: node engine/pointer.mjs <dist> <channel> <commit> <version> <stamp>')
  process.exit(1)
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  )
}

const files = [join(dist, 'builds', commit), join(dist, 'gamedata', commit)]
  .flatMap(walk)
  .sort()
  .map((f) => [relative(dist, f).split('\\').join('/'), statSync(f).size])

mkdirSync(join(dist, channel), { recursive: true })
writeFileSync(
  join(dist, channel, 'engine.json'),
  JSON.stringify({ channel, commit, version, stamp, gamedata: commit, recipe: recipe(), files }) + '\n',
)
