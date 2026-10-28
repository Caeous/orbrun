/**
 * The offline engine as a launcher for @orbrun/offline's server, one worker
 * thread per game (engine-worker.mjs), its saves kept in `hostDir`: crawl's
 * save directory is loaded from there before main() and written back as
 * crawl goes quiet and when it exits.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { channelOf, type EngineInfo, type EngineLauncher, type OfflineChannel } from '@orbrun/offline'

const here = path.dirname(fileURLToPath(import.meta.url))
export const DIST = path.resolve(here, '../../../engine/dist')

export function builtChannels(): OfflineChannel[] {
  return ['stable', 'trunk'].filter((c) => fs.existsSync(path.join(DIST, c, 'engine.json'))).map((c) => channelOf(JSON.parse(fs.readFileSync(path.join(DIST, c, 'engine.json'), 'utf8')) as EngineInfo))
}

const modules = new Map<string, Promise<WebAssembly.Module>>()
function wasm(dir: string) {
  let m = modules.get(dir)
  if (!m) modules.set(dir, (m = WebAssembly.compile(fs.readFileSync(path.join(dir, 'crawl.wasm')))))
  return m
}

export interface Engine {
  launch: EngineLauncher
  /** what crawl printed on stderr, the last of it */
  log: string[]
  /** write what crawl has saved to disk now */
  sync(): Promise<void>
}

export function engine(hostDir: string): Engine {
  let worker: Worker | null = null
  let saveDir = ''
  let chHost = ''
  const e: Engine = {
    log: [],
    sync: () =>
      new Promise((resolve) => {
        if (!worker) return resolve()
        const w = worker
        const done = (m: { type: string }) => {
          if (m.type !== 'synced') return
          w.off('message', done)
          resolve()
        }
        w.on('message', done)
        w.postMessage({ type: 'sync', saveDir, hostDir: chHost })
        setTimeout(resolve, 2000)
      }),
    launch: (ch, args, events, rootFiles) => {
      const w = new Worker(path.join(here, 'engine-worker.mjs'))
      worker = w
      saveDir = ch.saveDir
      chHost = path.join(hostDir, ch.id)
      w.on('message', (m: { type: string; text?: string; code?: number; message?: string; line?: string }) => {
        if (worker !== w) return
        switch (m.type) {
          case 'output':
            events.output(m.text!)
            break
          case 'exit':
            events.exit(m.code!)
            break
          case 'error':
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
        e.log.push(String(err))
        events.error(String(err))
      })
      const dir = path.join(DIST, 'builds', ch.commit)
      fs.mkdirSync(chHost, { recursive: true })
      void wasm(dir).then((module) => w.postMessage({ type: 'start', dir, saveDir: ch.saveDir, hostDir: chHost, args, rootFiles, module }))
      const control = (json: string) => {
        if (worker === w) w.postMessage({ type: 'control', json })
      }
      return {
        control,
        keys: (text) => control(JSON.stringify({ msg: 'text_input', text })),
        terminate: () => {
          if (worker === w) worker = null
          void w.terminate()
        },
      }
    },
  }
  return e
}
