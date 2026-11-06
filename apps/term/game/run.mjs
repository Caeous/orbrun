#!/usr/bin/env node
// Start the terminal client (main.ts), bundled (../launch.mjs), on a node that runs crawl: Node 24 or later, for
// WebAssembly JSPI. This one when it does, in this process; else the first that will do of ORBRUN_NODE, Homebrew's
// and the system's.
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { clientBundle, crawlNode } from '../launch.mjs'

const node = crawlNode()
if (!node) {
  console.error(`Orbrun's engine needs Node 24 or later (WebAssembly JSPI); this is ${process.version}. Set ORBRUN_NODE to one.`)
  process.exit(1)
}
const { main, worker } = await clientBundle()
process.env.ORBRUN_TERM_WORKER = worker
if (node.self) {
  process.setSourceMapsEnabled(true)
  // main.ts reads its options from process.argv.slice(2), which are this script's
  await import(pathToFileURL(main).href)
} else {
  const r = spawnSync(node.bin, ['--enable-source-maps', main, ...process.argv.slice(2)], { stdio: 'inherit' })
  process.exit(r.status ?? 1)
}
