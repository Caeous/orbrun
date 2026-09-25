// Plays the built engine under node, the way a host in a worker drives it:
// boot, attach, a new game on a fixed seed, a few steps, save and quit, then
// a second boot that must resume the save instead of starting over.
//
//   node engine/smoke.mjs                      # every channel in engine/dist
//   node engine/smoke.mjs engine/dist/stable   # one
//
// Exits non-zero, with the last messages the engine sent, on any failure.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

if (!process.argv[2]) {
  const root = join(import.meta.dirname, 'dist')
  const channels = readdirSync(root).filter((d) => existsSync(join(root, d, 'engine.json')))
  if (!channels.length) {
    console.error('smoke: nothing built in engine/dist')
    process.exit(1)
  }
  let failed = false
  for (const c of channels) {
    console.log(`smoke: ${c} (${JSON.parse(readFileSync(join(root, c, 'engine.json'), 'utf8')).version})`)
    const r = spawnSync(process.execPath, [import.meta.filename, join(root, c)], { stdio: 'inherit' })
    failed ||= r.status !== 0
  }
  process.exit(failed ? 1 : 0)
}

// a channel's directory holds only its engine.json, which names the build
const arg = resolve(process.argv[2])
const dist = existsSync(join(arg, 'engine.json'))
  ? join(arg, '..', 'builds', JSON.parse(readFileSync(join(arg, 'engine.json'), 'utf8')).commit)
  : arg
const factory = (await import(join(dist, 'crawl.js'))).default
const wasmBinary = readFileSync(join(dist, 'crawl.wasm'))
const data = readFileSync(join(dist, 'crawl.data'))
const prewarm = JSON.parse(readFileSync(join(dist, 'prewarm', 'manifest.json'), 'utf8'))
const prewarmBin = readFileSync(join(dist, 'prewarm', 'prewarm.bin'))

const ARGS = ['-headless', '-webtiles-socket', 'bridge', '-dir', '/crawl', '-name', 'smoke']
const NEW_GAME = ['-seed', '1', '-species', 'minotaur', '-background', 'fighter']

/** Boots one engine. `files` are written under /crawl before main() runs. */
async function boot(args, files = {}) {
  const msgs = []
  const special = []
  let partial = ''
  let exited = null
  const onExit = new Promise((r) => (exited = r))
  // The factory's promise settles only once main() returns, and main()
  // suspends waiting for input: work with the Module object itself, which
  // Emscripten fills in place (bridge from pre.js, FS once the runtime is up).
  const mod = {
    arguments: args,
    wasmBinary,
    getPreloadedPackage: () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    preRun: [
      (m) => {
        const FS = m.FS
        // node has no IndexedDB, so pre.js never calls seedCaches: seed here,
        // which also proves the baked caches load.
        for (const f of prewarm.files) {
          FS.mkdirTree('/crawl/' + f.path.split('/').slice(0, -1).join('/'))
          FS.writeFile('/crawl/' + f.path, prewarmBin.subarray(f.offset, f.offset + f.size))
        }
        for (const [path, bytes] of Object.entries(files)) {
          FS.mkdirTree('/crawl/' + path.split('/').slice(0, -1).join('/'))
          FS.writeFile('/crawl/' + path, bytes)
        }
      },
    ],
    onBridgeOutput: (text) => {
      const lines = (partial + text).split('\n')
      partial = lines.pop()
      for (const line of lines) {
        if (!line) continue
        if (line.startsWith('*')) special.push(JSON.parse(line.slice(1)))
        else msgs.push(JSON.parse(line))
      }
    },
    print: () => {},
    printErr: (l) => process.env.SMOKE_VERBOSE && console.error('[engine]', l),
    onExit: (code) => exited(code),
  }
  factory(mod).catch((err) => {
    console.error('smoke: the engine failed to start', err)
    process.exit(1)
  })
  // pre.js runs after the factory's first await (its node import).
  while (!mod.bridge) await new Promise((r) => setTimeout(r, 5))
  return { mod, msgs, special, onExit }
}

function fail(why, e) {
  console.error(`smoke: ${why}`)
  const tail = e.msgs.slice(-8).map((m) => JSON.stringify(m).slice(0, 200))
  console.error('last messages:\n  ' + tail.join('\n  '))
  process.exit(1)
}

async function until(e, what, test, ms = 20000) {
  const start = Date.now()
  while (!test()) {
    if (Date.now() - start > ms) fail(`timed out waiting for ${what}`, e)
    await new Promise((r) => setTimeout(r, 20))
  }
}

const has = (e, name, from = 0) => e.msgs.slice(from).some((m) => m.msg === name)
const attach = (e) => e.mod.bridge.pushControl(JSON.stringify({ msg: 'attach', primary: true }))

// 1. A new game reaches the map.
let t = Date.now()
const a = await boot([...ARGS, ...NEW_GAME])
attach(a)
// Species and background come from argv; any choice left (a Fighter's
// weapon) takes its first entry.
let choices = 0
await until(a, 'the first map', () => {
  const asked = a.msgs.filter((m) => m.msg === 'ui-push' && m.type === 'newgame-choice').length
  if (asked > choices) {
    choices = asked
    a.mod.bridge.pushKeys('a')
  }
  return has(a, 'map') && has(a, 'player')
})
console.log(`smoke: new game on the map in ${Date.now() - t} ms`)

// 2. Steps are answered (a turn each, so a fresh player message).
let from = a.msgs.length
for (const k of 'hjkl') {
  a.mod.bridge.pushKeys(k)
  await until(a, `an answer to "${k}"`, () => has(a, 'player', from))
  from = a.msgs.length
}
console.log('smoke: four steps answered')

// 3. Save and quit, and the save commit is announced.
a.mod.bridge.pushKeys('S')
await new Promise((r) => setTimeout(r, 200))
a.mod.bridge.pushKeys('y')
const code = await Promise.race([a.onExit, new Promise((r) => setTimeout(() => r('timeout'), 20000))])
if (code === 'timeout') fail('save and quit did not exit', a)
if (!a.special.some((m) => m.msg === 'checkpoint')) fail('no checkpoint was announced for the save', a)
const saves = a.mod.FS.readdir('/crawl/saves').filter((f) => f.endsWith('.cs'))
if (saves.length !== 1) fail(`expected one save, found ${saves.join(', ') || 'none'}`, a)
const save = a.mod.FS.readFile('/crawl/saves/' + saves[0])
console.log(`smoke: saved ${saves[0]} (${save.length} bytes), exit ${code}`)

// 4. A second boot resumes it: the map, and no new-game menu first.
t = Date.now()
const b = await boot(ARGS, { ['saves/' + saves[0]]: save })
attach(b)
await until(b, 'the resumed map', () => has(b, 'map') && has(b, 'player'))
if (b.msgs.some((m) => m.msg === 'ui-push' && m.type === 'newgame-choice')) fail('the resume showed the new-game menu', b)
console.log(`smoke: resumed on the map in ${Date.now() - t} ms`)
console.log('smoke: ok')
process.exit(0)
