// The recipe a build was made with: a hash of everything in engine/ that goes
// into the binary (the patches, wasm/, build.sh), by content, so a working
// tree and its commit hash alike. engine.json records it (pointer.mjs), and a
// channel whose recipe changed is built again even when crawl has not moved
// (plan.mjs).
//
//   node engine/recipe.mjs

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ENGINE = import.meta.dirname

function walk(path) {
  // dotfiles (.DS_Store) are no part of it: a Mac and CI must agree
  const entries = readdirSync(path, { withFileTypes: true }).filter((e) => !e.name.startsWith('.'))
  return entries.flatMap((e) => (e.isDirectory() ? walk(join(path, e.name)) : [join(path, e.name)]))
}

export function recipe() {
  const hash = createHash('sha256')
  const files = [...walk(join(ENGINE, 'patches')), ...walk(join(ENGINE, 'wasm')), join(ENGINE, 'build.sh')]
  for (const f of files.map((f) => relative(ENGINE, f).split('\\').join('/')).sort()) {
    hash.update(`${f}\0`).update(readFileSync(join(ENGINE, f))).update('\0')
  }
  return hash.digest('hex').slice(0, 16)
}

if (process.argv[1] === import.meta.filename) console.log(recipe())
