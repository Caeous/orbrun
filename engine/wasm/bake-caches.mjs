// Pre-builds the engine's derived data caches for shipping.
//
// Runs the built wasm engine once under node with -builddb (plain MEMFS --
// wasm/pre.js skips the IDBFS mount when there's no indexedDB), then packs
// everything the run wrote under /crawl into wasm/dist/prewarm/ plus a
// manifest.json. A host seeds these into a device's IDBFS on first boot
// (Module.seedCaches), so no device pays the multi-second description-DB +
// des-cache build.
//
// The caches validate against file_modtime() == WASM_DAT_STAMP baked into
// this same build (files.cc), which is why they must come from the wasm
// engine itself: a native crawl's caches would embed real mtimes (and its
// host sqlite's file format). manifest.stamp records the build's stamp so a
// host can re-seed after an engine update instead of letting the engine
// rebuild in the browser.
//
// Run from crawl-ref/source, after make -f wasm/Makefile.emscripten:
//   node wasm/bake-caches.mjs

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const wasmDir = dirname(fileURLToPath(import.meta.url))
const distDir = join(wasmDir, 'dist')
const prewarmDir = join(distDir, 'prewarm')
const stamp = readFileSync(join(wasmDir, 'build', 'dat-stamp'), 'utf8').trim()

const factory = (await import(join(distDir, 'crawl.js'))).default

const wasmBinary = readFileSync(join(distDir, 'crawl.wasm'))
const dataBuf = readFileSync(join(distDir, 'crawl.data'))

let exitCode = null
let resolveExit
const exited = new Promise(r => { resolveExit = r })

const module_ = await factory({
  arguments: [
    '-headless',
    '-webtiles-socket', 'bridge',
    '-dir', '/crawl',
    '-name', 'local',
    '-builddb',
  ],
  wasmBinary,
  getPreloadedPackage: () =>
    dataBuf.buffer.slice(dataBuf.byteOffset, dataBuf.byteOffset + dataBuf.byteLength),
  onBridgeOutput: () => {}, // -builddb emits nothing, but be safe
  print: line => console.log('[engine]', line),
  printErr: line => console.error('[engine]', line),
  onExit: code => { exitCode = code; resolveExit() },
})

await exited
if (exitCode !== 0)
  throw new Error(`engine -builddb run exited with code ${exitCode}`)

// Everything under /crawl: the run started from an empty MEMFS dir, so all
// of it is derived first-boot state (db/*, des cache).
const FS = module_.FS
const files = []
const walk = dir => {
  for (const name of FS.readdir(dir)) {
    if (name === '.' || name === '..') continue
    const path = `${dir}/${name}`
    if (FS.isDir(FS.stat(path).mode)) walk(path)
    else files.push(path)
  }
}
walk('/crawl')

// One blob + an offset manifest: the des cache alone is ~550 small files,
// and a host seeds with two fetches instead of one per file.
files.sort()
rmSync(prewarmDir, { recursive: true, force: true })
mkdirSync(prewarmDir, { recursive: true })
const chunks = []
const manifestFiles = []
let offset = 0
for (const path of files) {
  const bytes = FS.readFile(path)
  chunks.push(bytes)
  manifestFiles.push({ path: path.slice('/crawl/'.length), offset, size: bytes.length })
  offset += bytes.length
}

writeFileSync(join(prewarmDir, 'prewarm.bin'), Buffer.concat(chunks))
writeFileSync(
  join(prewarmDir, 'manifest.json'),
  JSON.stringify({ stamp, files: manifestFiles }) + '\n',
)

console.log(`baked ${manifestFiles.length} cache files into prewarm.bin, ` +
  `${(offset / 1024 / 1024).toFixed(1)} MB, stamp ${stamp} -> ${prewarmDir}`)
