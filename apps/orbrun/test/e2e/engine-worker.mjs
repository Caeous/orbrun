// One crawl engine in a worker thread, for the e2e harness (engine.ts).
// A worker per game: terminating it gives its WebAssembly memory back at
// once, which a suspended engine in the main thread never does, and games
// can run side by side. Plain ESM: node runs it as it is.
//
// main -> worker: { type: 'start', glue, dir, saveDir, args, files, module }
//                 { type: 'control', json, seq }
// worker -> main: { type: 'output', text } { type: 'idle', seq } { type: 'exit', code } { type: 'error', message } { type: 'log', line }

import { parentPort } from 'node:worker_threads'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const post = (m) => parentPort.postMessage(m)

// Crawl's cosmetic draws take system entropy (the glue's randomFillSync): the same bytes for every game.
let entropy = 0x9e3779b9
const nodeCrypto = createRequire(import.meta.url)('node:crypto')
nodeCrypto.randomFillSync = (view) => {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
  for (let i = 0; i < bytes.length; i++) {
    entropy ^= entropy << 13
    entropy ^= entropy >>> 17
    entropy ^= entropy << 5
    bytes[i] = entropy & 0xff
  }
  return view
}

/** 2026-01-01T00:00:00Z: the clock (engine.ts `virtualClockGlue`) starts here and moves a millisecond a reading. */
const EPOCH = 1767225600000

let bridge = null
let lastSeq = 0
const pending = []

parentPort.on('message', async (m) => {
  if (m.type === 'control') {
    lastSeq = m.seq
    if (bridge) bridge.pushControl(m.json)
    else pending.push(m.json)
    return
  }
  if (m.type !== 'start') return
  const prewarm = JSON.parse(readFileSync(join(m.dir, 'prewarm', 'manifest.json'), 'utf8'))
  const prewarmBin = readFileSync(join(m.dir, 'prewarm', 'prewarm.bin'))
  const data = readFileSync(join(m.dir, 'crawl.data'))
  const factory = (await import(pathToFileURL(m.glue).href)).default
  let ticks = 0
  const mod = {
    __now: () => ++ticks,
    __date: () => EPOCH + ++ticks,
    arguments: m.args,
    saveDir: m.saveDir,
    locateFile: (f) => join(m.dir, f),
    // the module compiled once in the main thread: every game skips the compile
    instantiateWasm: (imports, done) => {
      WebAssembly.instantiate(m.module, imports).then(
        (inst) => done(inst),
        (err) => post({ type: 'error', message: `instantiate: ${String(err)}` }),
      )
      return {}
    },
    getPreloadedPackage: () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    preRun: [
      (mm) => {
        // node has no IndexedDB: pre.js never seeds the caches, so seed them here, and the scenario's own files
        for (const f of prewarm.files) {
          const p = `${m.saveDir}/${f.path}`
          mm.FS.mkdirTree(p.slice(0, p.lastIndexOf('/')))
          mm.FS.writeFile(p, prewarmBin.subarray(f.offset, f.offset + f.size))
        }
        for (const [path, bytes] of Object.entries(m.files ?? {})) {
          const p = `${m.saveDir}/${path}`
          mm.FS.mkdirTree(p.slice(0, p.lastIndexOf('/')))
          mm.FS.writeFile(p, bytes)
        }
      },
    ],
    onBridgeOutput: (text) => post({ type: 'output', text }),
    onExit: (code) => post({ type: 'exit', code }),
    onAbort: (what) => post({ type: 'error', message: `engine aborted: ${String(what)}` }),
    print: () => {},
    printErr: (line) => post({ type: 'log', line }),
  }
  factory(mod).catch((err) => post({ type: 'error', message: String(err) }))
  while (!mod.bridge) await new Promise((r) => setTimeout(r, 1))
  bridge = mod.bridge
  // what came before the bridge first, so nothing waits outside crawl's queue once the watch is on
  for (const j of pending.splice(0)) bridge.pushControl(j)
  // pre.js sets `wake` when crawl waits for a message: that, with nothing queued, is idle
  let wake = bridge.wake
  Object.defineProperty(bridge, 'wake', {
    get: () => wake,
    set: (v) => {
      wake = v
      if (v && bridge.queue.length === 0) post({ type: 'idle', seq: lastSeq })
    },
  })
  // already waiting before the watch was set, with nothing to read
  if (wake && bridge.queue.length === 0) post({ type: 'idle', seq: lastSeq })
})
