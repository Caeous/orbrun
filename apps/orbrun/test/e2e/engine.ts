/**
 * The offline engine (engine/dist: crawl built to WebAssembly) as a launcher
 * for @orbrun/offline's OfflineServer, one worker thread per game
 * (engine-worker.mjs), with what the app's own worker has no use for:
 *
 *  - idle: crawl suspends in `wasm_bridge_await_message` (engine/wasm/bridge.h)
 *    when its queue is empty, and the worker says so, tagged with the last
 *    message it had been sent; so "idle" is a fact, not a guess with a timer.
 *  - the same game every time: crawl's seed covers the game but not the
 *    system entropy its cosmetics draw, nor the wall clock its delays and
 *    animations read. The worker hands every game the same entropy, and the
 *    glue's two clocks are replaced by one that moves a millisecond a reading
 *    (`virtualClockGlue`), so however fast a run goes it plays the same game.
 *  - a clean end: terminating the worker gives its WebAssembly memory back
 *    at once, which a suspended engine left in this thread never does.
 *
 * The module is compiled once per build and handed to every worker.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { channelOf, type EngineInfo, type EngineLauncher, type OfflineChannel } from '@orbrun/offline'

export const DIST = join(import.meta.dirname, '../../../../engine/dist')

/** The channels built here (engine/build.sh). */
export const builtChannels = ['stable', 'trunk'].filter((c) => existsSync(join(DIST, c, 'engine.json')))

export function channel(name: string): OfflineChannel {
  return channelOf(JSON.parse(readFileSync(join(DIST, name, 'engine.json'), 'utf8')) as EngineInfo)
}

/**
 * The glue with its two clocks handed to the Module (the worker gives each
 * game a clock of its own). Written beside the build, which is not committed.
 */
function virtualClockGlue(dir: string): string {
  const out = join(dir, 'crawl.e2e.mjs')
  const src = readFileSync(join(dir, 'crawl.js'), 'utf8')
  const clocks: [string, string][] = [
    ['_emscripten_get_now=()=>performance.now();', '_emscripten_get_now=()=>Module.__now();'],
    ['emscripten_date_now=()=>Date.now();', 'emscripten_date_now=()=>Module.__date();'],
  ]
  let patched = src
  for (const [from, to] of clocks) {
    if (!patched.includes(from)) throw new Error(`the engine's glue has no ${from}: the e2e harness needs its clock`)
    patched = patched.replace(from, to)
  }
  if (!existsSync(out) || readFileSync(out, 'utf8') !== patched) writeFileSync(out, patched)
  return out
}

/**
 * Options that take time out of the game: crawl animates tiles and beams as
 * wall-clock time passes, drawing on the game's own generator as it does.
 */
const QUIET = ['-extra-opt-first', 'tile_misc_anim=false', '-extra-opt-first', 'tile_water_anim=false', '-extra-opt-first', 'use_animations=']

/** One build, compiled once per process. */
const builds = new Map<string, Promise<{ dir: string; glue: string; module: WebAssembly.Module }>>()
function build(commit: string) {
  let b = builds.get(commit)
  if (!b) {
    const dir = join(DIST, 'builds', commit)
    b = (async () => ({ dir, glue: virtualClockGlue(dir), module: await WebAssembly.compile(readFileSync(join(dir, 'crawl.wasm'))) }))()
    builds.set(commit, b)
  }
  return b
}

export interface InProcessEngine {
  launch: EngineLauncher
  /** crawl is waiting for input with nothing queued, or has exited; never before it was launched */
  idle(): boolean
  /** files to put in the save dir before main() runs (a scenario's save) */
  files: Record<string, Uint8Array>
  /** what crawl printed on stderr, for a failure's report */
  log: string[]
  /** the game is over for the harness: the worker goes, and crawl with it, without the save a closing connection would ask for */
  kill(): void
}

export function inProcessEngine(extraArgs: string[] = []): InProcessEngine {
  let worker: Worker | null = null
  let launched = false
  let running = false
  let sent = 0
  let idleAt = -1
  const e: InProcessEngine = {
    files: {},
    log: [],
    // not before the game is launched: Play reaches the engine a tick or two after it is sent
    idle: () => launched && (!running || idleAt === sent),
    kill: () => {
      running = false
      void worker?.terminate()
      worker = null
    },
    launch: (ch, args, events, rootFiles) => {
      launched = true
      running = true
      const w = new Worker(join(import.meta.dirname, 'engine-worker.mjs'))
      worker = w
      w.on('message', (m: { type: string; text?: string; seq?: number; code?: number; message?: string; line?: string }) => {
        if (worker !== w) return
        switch (m.type) {
          case 'output':
            events.output(m.text!)
            break
          case 'idle':
            idleAt = m.seq!
            break
          case 'exit':
            running = false
            events.exit(m.code!)
            break
          case 'error':
            running = false
            e.log.push(m.message!)
            events.error(m.message!)
            break
          case 'log':
            e.log.push(m.line!)
            if (e.log.length > 200) e.log.shift()
            break
        }
      })
      w.on('error', (err) => {
        if (worker !== w) return
        running = false
        e.log.push(String(err))
        events.error(String(err))
      })
      void build(ch.commit).then((b) =>
        w.postMessage({ type: 'start', glue: b.glue, dir: b.dir, saveDir: ch.saveDir, args: [...args, ...QUIET, ...extraArgs], files: e.files, rootFiles, module: b.module }),
      )
      const control = (json: string) => {
        if (worker !== w) return
        w.postMessage({ type: 'control', json, seq: ++sent })
      }
      return {
        control,
        keys: (text) => control(JSON.stringify({ msg: 'text_input', text })),
        terminate: () => e.kill(),
      }
    },
  }
  return e
}
