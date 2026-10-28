#!/usr/bin/env node
// Start the terminal client (main.ts) under vite-node, on a node that runs crawl: Node 24 or later, for
// WebAssembly JSPI. When this node is older, the first that will do of ORBRUN_NODE, Homebrew's and the system's.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const viteNode = createRequire(import.meta.url).resolve('vite-node/vite-node.mjs')
const jspi = (bin) => spawnSync(bin, ['-e', 'process.exit(typeof WebAssembly.Suspending === "function" ? 0 : 1)']).status === 0
const node = [process.execPath, process.env.ORBRUN_NODE, '/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node'].find((b) => b && existsSync(b) && jspi(b))
if (!node) {
  console.error(`Orbrun's engine needs Node 24 or later (WebAssembly JSPI); this is ${process.version}. Set ORBRUN_NODE to one.`)
  process.exit(1)
}
const r = spawnSync(node, [viteNode, path.join(here, 'main.ts'), ...process.argv.slice(2)], { stdio: 'inherit' })
process.exit(r.status ?? 1)
