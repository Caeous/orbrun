/**
 * The Web Worker one engine runs in. The page posts `start` once, then
 * control messages and keys; the worker posts the engine's output and its
 * exit. The engine blocks in a JSPI suspension while it waits for the player,
 * so an idle game costs this thread nothing.
 */
import { startEngine, type EngineFile, type EngineFactory, type RunningEngine } from './engine.js'

export type ToWorker =
  | { type: 'start'; base: string; saveDir: string; args: string[] }
  | { type: 'control'; json: string }
  | { type: 'keys'; text: string }

export type FromWorker =
  | { type: 'output'; text: string }
  | { type: 'exit'; code: number }
  | { type: 'error'; message: string }

// the worker's global, typed to the two members used (the app compiles against DOM, not WebWorker)
const scope = self as unknown as {
  postMessage(m: FromWorker): void
  onmessage: ((e: { data: ToWorker }) => void) | null
}

let engine: RunningEngine | null = null
const early: ToWorker[] = []

scope.onmessage = (e) => {
  const m = e.data
  if (m.type === 'start') {
    void start(m)
    return
  }
  if (!engine) early.push(m)
  else if (m.type === 'control') engine.control(m.json)
  else engine.keys(m.text)
}

async function start(m: Extract<ToWorker, { type: 'start' }>) {
  const url = (file: string) => new URL(file, m.base).href
  try {
    engine = await startEngine({
      source: {
        factory: async () => ((await import(/* @vite-ignore */ url('crawl.js'))) as { default: EngineFactory }).default,
        read: async (file: EngineFile) => {
          const res = await fetch(url(file))
          if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`)
          return res.arrayBuffer()
        },
      },
      saveDir: m.saveDir,
      args: m.args,
      onOutput: (text) => scope.postMessage({ type: 'output', text }),
      onExit: (code) => scope.postMessage({ type: 'exit', code }),
      onLog: (line) => console.debug('[engine]', line),
    })
  } catch (err) {
    scope.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    return
  }
  for (const q of early.splice(0)) {
    if (q.type === 'control') engine.control(q.json)
    else if (q.type === 'keys') engine.keys(q.text)
  }
}
