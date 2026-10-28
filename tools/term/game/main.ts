/**
 * Play Orbrun in this terminal, no browser: `npm run term:play [-- --name Ada --trunk]`.
 * Ctrl-\ saves and quits. Needs Node 24 or later (crawl's WebAssembly uses
 * JSPI, `WebAssembly.Suspending`).
 */
import os from 'node:os'
import path from 'node:path'
import { runGame } from './client'

if (typeof (WebAssembly as unknown as { Suspending?: unknown }).Suspending !== 'function') {
  console.error(`Orbrun's engine needs Node 24 or later (WebAssembly JSPI); this is ${process.version}.`)
  process.exit(1)
}

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const out = process.stdout
const input = process.stdin
input.setRawMode?.(true)
input.resume()
// run by the SSH server (../ssh.mjs) the terminal is the far end's: its size comes in the environment and then over
// IPC, its keys and screen through the pipes
const piped = typeof process.send === 'function'
const size = { cols: Number(process.env.ORBRUN_TERM_COLS) || out.columns || 80, rows: Number(process.env.ORBRUN_TERM_ROWS) || out.rows || 24 }

await runGame(
  {
    ...size,
    write: (s) => new Promise((done) => out.write(s, () => done())),
    onInput: (fn) => input.on('data', fn),
    onResize: (fn) => {
      if (piped) process.on('message', (m: { type?: string; cols?: number; rows?: number }) => m.type === 'resize' && fn(m.cols!, m.rows!))
      else out.on('resize', () => fn(out.columns, out.rows))
    },
    end: (code = 0) => {
      input.setRawMode?.(false)
      process.exit(code)
    },
  },
  {
    stateDir: path.join(os.homedir(), '.cache', 'orbrun-term'),
    name: flag('--name') ?? (os.userInfo().username.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20) || 'Player'),
    channel: args.includes('--trunk') ? 'trunk' : '0.34',
    fps: Number(process.env.FPS || 120),
  },
)
