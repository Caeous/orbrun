// One crawl engine in a worker thread, for the terminal client (engine.ts).
// The e2e harness's worker (apps/orbrun/test/e2e/engine-worker.mjs) with a
// real clock and real entropy, for play, and with the save directory kept on
// disk: node has no IndexedDB, so the files are loaded into crawl's memory
// file system before main() and written back whenever crawl goes quiet.
//
// main -> worker: { type: 'start', glue, dir, saveDir, hostDir, args, rootFiles, module }
//                 { type: 'control', json }
// worker -> main: { type: 'output', text } { type: 'exit', code } { type: 'error', message } { type: 'log', line }

import { parentPort } from 'node:worker_threads'
import fs from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const post = (m) => parentPort.postMessage(m)

let bridge = null
let mod = null
const pending = []

/** every file under `dir` in crawl's file system, by path relative to it */
function walk(FS, dir, rel = '', out = []) {
  let names
  try {
    names = FS.readdir(dir)
  } catch {
    return out
  }
  for (const n of names) {
    if (n === '.' || n === '..') continue
    const p = `${dir}/${n}`
    const st = FS.stat(p)
    if (FS.isDir(st.mode)) walk(FS, p, rel + n + '/', out)
    else out.push({ path: rel + n, mtime: st.mtime.getTime(), size: st.size })
  }
  return out
}

/** what has been written to disk: path -> mtime in crawl's file system */
const synced = new Map()
let cacheFiles = new Set()

function syncOut(saveDir, hostDir) {
  if (!mod?.FS) return
  const now = walk(mod.FS, saveDir)
  const seen = new Set()
  for (const f of now) {
    if (cacheFiles.has(f.path)) continue
    seen.add(f.path)
    if (synced.get(f.path) === f.mtime) continue
    const host = join(hostDir, f.path)
    fs.mkdirSync(host.slice(0, host.lastIndexOf('/')), { recursive: true })
    fs.writeFileSync(host, mod.FS.readFile(`${saveDir}/${f.path}`))
    synced.set(f.path, f.mtime)
  }
  // a save crawl deleted (a character died, a game was abandoned) goes from disk too
  for (const p of [...synced.keys()])
    if (!seen.has(p)) {
      fs.rmSync(join(hostDir, p), { force: true })
      synced.delete(p)
    }
}

function hostFiles(dir, rel = '', out = []) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) hostFiles(join(dir, e.name), rel + e.name + '/', out)
    else out.push(rel + e.name)
  }
  return out
}

parentPort.on('message', async (m) => {
  if (m.type === 'control') {
    if (bridge) bridge.pushControl(m.json)
    else pending.push(m.json)
    return
  }
  if (m.type === 'sync') {
    syncOut(m.saveDir, m.hostDir)
    post({ type: 'synced' })
    return
  }
  if (m.type !== 'start') return
  const prewarm = JSON.parse(fs.readFileSync(join(m.dir, 'prewarm', 'manifest.json'), 'utf8'))
  const prewarmBin = fs.readFileSync(join(m.dir, 'prewarm', 'prewarm.bin'))
  cacheFiles = new Set(prewarm.files.map((f) => f.path))
  const data = fs.readFileSync(join(m.dir, 'crawl.data'))
  const factory = (await import(pathToFileURL(join(m.dir, 'crawl.js')).href)).default
  mod = {
    arguments: m.args,
    saveDir: m.saveDir,
    locateFile: (f) => join(m.dir, f),
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
        // no IndexedDB: the caches pre.js would seed, then the saves from disk
        for (const f of prewarm.files) {
          const p = `${m.saveDir}/${f.path}`
          mm.FS.mkdirTree(p.slice(0, p.lastIndexOf('/')))
          mm.FS.writeFile(p, prewarmBin.subarray(f.offset, f.offset + f.size))
        }
        for (const rel of hostFiles(m.hostDir)) {
          const p = `${m.saveDir}/${rel}`
          mm.FS.mkdirTree(p.slice(0, p.lastIndexOf('/')))
          mm.FS.writeFile(p, fs.readFileSync(join(m.hostDir, rel)))
          synced.set(rel, mm.FS.stat(p).mtime.getTime())
        }
        for (const [p, text] of Object.entries(m.rootFiles ?? {})) {
          mm.FS.mkdirTree(p.slice(0, p.lastIndexOf('/')) || '/')
          mm.FS.writeFile(p, text)
        }
      },
    ],
    onBridgeOutput: (text) => post({ type: 'output', text }),
    onExit: (code) => {
      syncOut(m.saveDir, m.hostDir)
      post({ type: 'exit', code })
    },
    onAbort: (what) => post({ type: 'error', message: `engine aborted: ${String(what)}` }),
    print: () => {},
    printErr: (line) => post({ type: 'log', line }),
  }
  factory(mod).catch((err) => post({ type: 'error', message: String(err) }))
  while (!mod.bridge) await new Promise((r) => setTimeout(r, 1))
  bridge = mod.bridge
  for (const j of pending.splice(0)) bridge.pushControl(j)
  // crawl waiting on its queue with nothing in it: a good moment to put what it wrote on disk
  let wake = bridge.wake
  let syncTimer = null
  Object.defineProperty(bridge, 'wake', {
    get: () => wake,
    set: (v) => {
      wake = v
      if (v && bridge.queue.length === 0 && !syncTimer)
        syncTimer = setTimeout(() => {
          syncTimer = null
          syncOut(m.saveDir, m.hostDir)
        }, 300)
    },
  })
})
