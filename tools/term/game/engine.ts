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
import { channelOf, saveDesc, type EngineInfo, type EngineLauncher, type OfflineChannel, type SaveBook } from '@orbrun/offline'
import { ConfigError } from './config'

const here = path.dirname(fileURLToPath(import.meta.url))
export const DIST = path.resolve(here, '../../../engine/dist')

export function builtChannels(): OfflineChannel[] {
  return ['stable', 'trunk'].filter((c) => fs.existsSync(path.join(DIST, c, 'engine.json'))).map((c) => channelOf(JSON.parse(fs.readFileSync(path.join(DIST, c, 'engine.json'), 'utf8')) as EngineInfo))
}

/**
 * The built crawl that `want` names (config.ts `dcss`): `stable`, the newest
 * release built; `trunk`; or a release (`0.34`). A ConfigError naming those
 * there are, where it is not built.
 */
export function pickChannel(channels: OfflineChannel[], want: string): OfflineChannel {
  if (!channels.length) throw new ConfigError('no crawl is built: run engine/build.sh first')
  const releases = channels.filter((c) => c.id !== 'offline-trunk')
  const ch = want === 'stable' ? releases[releases.length - 1] : channels.find((c) => c.id === `offline-${want}`)
  if (!ch) throw new ConfigError(`dcss ${want} is not built; there are: ${['stable', ...channels.map((c) => c.id.replace(/^offline-/, ''))].join(', ')}`)
  return ch
}

/**
 * What the menu says of a player's saves (offline saves.ts), kept beside
 * them in `hostDir` (the player's, as it is now): each character as crawl last named it in a milestone,
 * in `<channel>.characters.json` by its name. Whether a character is
 * waiting is crawl's save file's to say: it is deleted when the character
 * dies, wins or quits.
 */
export function saveBook(hostDir: () => string, channels: OfflineChannel[]): SaveBook {
  // a game's save directory to its channel: the channel's own, or it and `~profile` (offline channels `profileSaveDir`)
  const of = (dir: string) => channels.find((c) => dir === c.saveDir || dir.startsWith(c.saveDir + '~'))
  return {
    note(dir, fields) {
      const c = of(dir)
      const desc = saveDesc(fields)
      if (!c || !desc) return
      fs.mkdirSync(hostDir(), { recursive: true })
      fs.writeFileSync(notesFile(hostDir(), c), JSON.stringify({ ...notes(hostDir(), c), [String(fields.name)]: desc }))
    },
    info: async (dir) => {
      const c = of(dir)
      return (c && savedCharacters(hostDir(), c)[0]?.desc) ?? null
    },
  }
}

/** A character waiting in a channel's saves: its name, and it as a server's lobby words it ("Kai, a level 3 Minotaur Berserker"). */
export interface SavedCharacter {
  name: string
  desc: string
}

/** The characters waiting in a channel's saves, the one played last first, as console crawl lists its saved games. */
export function savedCharacters(hostDir: string, c: OfflineChannel): SavedCharacter[] {
  // crawl keeps its saves in the save directory's `saves/`
  const dir = path.join(hostDir, c.id, 'saves')
  if (!fs.existsSync(dir)) return []
  const said = notes(hostDir, c)
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.cs'))
    .map((f) => ({ f, at: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.at - a.at)
    .map(({ f }) => {
      const name = f.slice(0, -'.cs'.length)
      // a save from before the words were kept: its name alone
      return { name, desc: said[name] ?? name }
    })
}

const notesFile = (hostDir: string, c: OfflineChannel) => path.join(hostDir, `${c.id}.characters.json`)

function notes(hostDir: string, c: OfflineChannel): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(notesFile(hostDir, c), 'utf8')) as Record<string, string>
  } catch {
    return {}
  }
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
  /** the game's worker gone, what crawl saved on disk first; at once when none is running, or after `ms` */
  stopped(ms: number): Promise<void>
  /** keep the next game's saves in `dir`: another player's */
  setHostDir(dir: string): void
}

/** what crawl has saved in `w`'s file system (`saveDir`), written to `host` on disk; or after two seconds */
function flush(w: Worker, saveDir: string, host: string): Promise<void> {
  return new Promise((resolve) => {
    const done = (m: { type: string }) => {
      if (m.type !== 'synced') return
      w.off('message', done)
      resolve()
    }
    w.on('message', done)
    w.postMessage({ type: 'sync', saveDir, hostDir: host })
    setTimeout(resolve, 2000)
  })
}

export function engine(hostDir: string): Engine {
  let worker: Worker | null = null
  let saveDir = ''
  let chHost = ''
  /** the last worker's save, on its way to disk before it is terminated */
  let stopping: Promise<void> = Promise.resolve()
  /** who waits for the running worker to stop (`stopped`) */
  const waiting = new Set<() => void>()
  const e: Engine = {
    log: [],
    setHostDir: (dir) => (hostDir = dir),
    sync: () => (worker ? flush(worker, saveDir, chHost) : stopping),
    stopped: (ms) =>
      worker
        ? new Promise((resolve) => {
            const done = () => {
              waiting.delete(done)
              clearTimeout(timer)
              void stopping.then(resolve)
            }
            const timer = setTimeout(done, ms)
            waiting.add(done)
          })
        : stopping,
    launch: (ch, args, events, rootFiles) => {
      const w = new Worker(path.join(here, 'engine-worker.mjs'))
      worker = w
      const host = path.join(hostDir, ch.id)
      saveDir = ch.saveDir
      chHost = host
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
        // the server stops a game once crawl has saved it (offline server.ts `stop`), but only in crawl's memory: it
        // goes to disk before the worker does
        terminate: () => {
          if (worker !== w) return void w.terminate()
          worker = null
          stopping = flush(w, ch.saveDir, host).then(() => void w.terminate())
          for (const done of [...waiting]) done()
        },
      }
    },
  }
  return e
}
