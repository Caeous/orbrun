/**
 * Play Orbrun in this terminal, no browser: `npm run term [-- --name Ada --dcss trunk]`,
 * `--help` for the rest; options also come from ~/.config/orbrun/config.toml
 * (config.ts). Ctrl-\ saves and quits. Needs Node 24 or later (crawl's
 * WebAssembly uses JSPI, `WebAssembly.Suspending`).
 */
import os from 'node:os'
import path from 'node:path'
import { runGame } from './client'
import { ConfigError, USAGE, resolveConfig, settingsList } from './config'
import { builtChannels, pickChannel } from './engine'

if (typeof (WebAssembly as unknown as { Suspending?: unknown }).Suspending !== 'function') {
  console.error(`Orbrun's engine needs Node 24 or later (WebAssembly JSPI); this is ${process.version}.`)
  process.exit(1)
}

// what to play and how: told wrong, say so and stop, before the screen is taken
let config: ReturnType<typeof resolveConfig>
let channel: ReturnType<typeof pickChannel>
try {
  config = resolveConfig(process.argv.slice(2))
  if (config.help === 'usage') {
    console.log(USAGE)
    process.exit(0)
  }
  if (config.help === 'settings') {
    console.log(`The game's settings, for --set KEY=VALUE or [settings] in ${config.file ?? '~/.config/orbrun/config.toml'}:\n\n${settingsList()}`)
    process.exit(0)
  }
  channel = pickChannel(builtChannels(), config.dcss)
} catch (e) {
  if (!(e instanceof ConfigError)) throw e
  console.error(`orbrun: ${e.message}`)
  process.exit(2)
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
  { ...config, stateDir: path.join(os.homedir(), '.cache', 'orbrun-term'), channel },
)
