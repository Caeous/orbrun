#!/usr/bin/env node
/**
 * Orbrun over SSH: `npm run term:ssh`, then `ssh -p 2222 localhost` (or
 * `ssh -p 2222 ada@localhost` to play as Ada). Each connection is a game of
 * its own: a process running the terminal client (game/main.ts), its keys
 * and screen through the connection; the SSH user name is the player's, and
 * so are the saves. Ctrl-\ saves and quits.
 *
 * Anyone who can reach the port plays without a password, so it listens on
 * 127.0.0.1 unless HOST says otherwise (PORT for the port). The host key is
 * made on the first run and kept in ~/.cache/orbrun.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ssh2 from 'ssh2'
import { stateDir } from './state.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOST = process.env.HOST || '127.0.0.1'
const PORT = Number(process.env.PORT || 2222)
const STATE_DIR = stateDir()

// a node that runs crawl: Node 24 or later, for WebAssembly JSPI (game/run.mjs picks the same way)
const jspi = (bin) => spawnSync(bin, ['-e', 'process.exit(typeof WebAssembly.Suspending === "function" ? 0 : 1)']).status === 0
const node = [process.execPath, process.env.ORBRUN_NODE, '/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node'].find((b) => b && fs.existsSync(b) && jspi(b))
if (!node) {
  console.error(`Orbrun's engine needs Node 24 or later (WebAssembly JSPI); this is ${process.version}. Set ORBRUN_NODE to one.`)
  process.exit(1)
}
const viteNode = createRequire(import.meta.url).resolve('vite-node/vite-node.mjs')

const keyFile = path.join(STATE_DIR, 'host_ed25519')
if (!fs.existsSync(keyFile)) {
  fs.mkdirSync(STATE_DIR, { recursive: true })
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'orbrun', '-f', keyFile])
}

/** a player's name from an SSH user name: what crawl takes in a name */
function playerName(user) {
  const n = String(user || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20)
  return n || 'Player'
}

const server = new ssh2.Server({ hostKeys: [fs.readFileSync(keyFile)] }, (client) => {
  let name = 'Player'
  client.on('authentication', (ctx) => {
    name = playerName(ctx.username)
    ctx.accept()
  })
  client.on('error', () => {})
  client.on('session', (accept) => {
    const session = accept()
    let cols = 80
    let rows = 24
    let term = 'xterm-256color'
    let game = null
    session.on('pty', (ok, _no, info) => {
      cols = info.cols || cols
      rows = info.rows || rows
      term = info.term || term
      ok?.()
    })
    session.on('window-change', (ok, _no, info) => {
      ok?.()
      cols = info.cols
      rows = info.rows
      game?.connected && game.send({ type: 'resize', cols, rows })
    })
    session.on('shell', (ok) => {
      const stream = ok()
      game = spawn(node, [viteNode, path.join(here, 'game', 'main.ts'), '--name', name], {
        cwd: path.resolve(here, '../..'),
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        // the player's terminal, not this one: what the server's own terminal is says nothing of theirs
        env: { ...withoutTerminal(process.env), TERM: term, ORBRUN_TERM_COLS: String(cols), ORBRUN_TERM_ROWS: String(rows) },
      })
      stream.pipe(game.stdin, { end: false })
      game.stdout.pipe(stream)
      let errors = ''
      game.stderr.on('data', (d) => (errors = (errors + d).slice(-2000)))
      game.on('exit', (code) => {
        if (code) stream.write(`\r\nThe game stopped (${code}).\r\n${errors.replace(/\n/g, '\r\n')}\r\n`)
        stream.exit(code ?? 0)
        stream.end()
      })
      // the connection dropped: the game saves and goes, as Ctrl-\ would have it
      stream.on('close', () => game.exitCode === null && game.stdin.write('\x1c'))
    })
  })
})

server.listen(PORT, HOST, () => console.log(`Orbrun over SSH: ssh -p ${PORT} ${HOST === '127.0.0.1' ? 'localhost' : HOST}   (name@ to play as name; Ctrl-C stops)`))
process.on('SIGINT', () => {
  server.close()
  process.exit(0)
})

/** The environment less what names the terminal the server runs in. */
function withoutTerminal(env) {
  const out = { ...env }
  for (const k of ['TERM', 'TERM_PROGRAM', 'TERM_PROGRAM_VERSION', 'COLORTERM', 'GHOSTTY_RESOURCES_DIR', 'KITTY_WINDOW_ID'])
    delete out[k]
  return out
}
