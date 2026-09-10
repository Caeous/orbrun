#!/usr/bin/env node
/**
 * The front room's poster: the room drawn once, headless, at rest, to a
 * JPEG the menus stand on before WebGL is up (and if it never is), and the
 * site's social card. Written to apps/orbrun/public/room/poster.jpg and
 * committed, like the atlas; run it again when the room changes.
 *
 *   node tools/build/poster.mjs [url]
 *
 * With no url it starts the dev server itself on a port of its own and stops
 * it after. Needs Chrome (CHROME=<path> to say which); WebGL comes from
 * SwiftShader, so no GPU is needed. Nothing else: raw DevTools protocol over
 * the `ws` package.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..', '..')
const OUT = path.join(root, 'apps/orbrun/public/room/poster.jpg')
const WIDTH = 1280
const HEIGHT = 720
const PORT = 5197
const CHROME =
  process.env.CHROME ||
  ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p))
if (!CHROME) {
  console.error('no Chrome found; set CHROME=<path to the binary>')
  process.exit(2)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function up(url) {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(url)
      if (r.ok) return
    } catch {
      /* not yet */
    }
    await sleep(200)
  }
  throw new Error(`${url} never answered`)
}

let vite = null
let url = process.argv[2]
if (!url) {
  vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: path.join(root, 'apps/orbrun'), stdio: 'ignore' })
  url = `http://127.0.0.1:${PORT}`
}
const page = `${url.replace(/\/$/, '')}/testbed/room.html?poster`
const profile = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'orbrun-poster-'))
const chrome = spawn(
  CHROME,
  ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-first-run', 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'] },
)
let stopped = false
const stop = async () => {
  if (stopped) return
  stopped = true
  vite?.kill()
  if (chrome.exitCode === null) {
    const gone = new Promise((r) => chrome.once('exit', r))
    chrome.kill()
    await Promise.race([gone, sleep(3000)])
  }
  try {
    fs.rmSync(profile, { recursive: true, force: true })
  } catch {
    /* Chrome may still be writing its profile; a stale temp dir is no harm */
  }
}
process.on('SIGINT', () => void stop().then(() => process.exit(130)))

try {
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = ''
    chrome.stderr.on('data', (d) => {
      buf += d
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf)
      if (m) resolve(m[1])
    })
    chrome.on('exit', (c) => reject(new Error(`Chrome exited ${c}: ${buf}`)))
    setTimeout(() => reject(new Error('Chrome gave no DevTools address')), 15000)
  })
  await up(`${url}/`)
  const ws = new WebSocket(wsUrl)
  await new Promise((r, j) => {
    ws.on('open', r)
    ws.on('error', j)
  })
  let id = 0
  const waits = new Map()
  ws.on('message', (d) => {
    const m = JSON.parse(String(d))
    if (m.id && waits.has(m.id)) {
      const { resolve, reject } = waits.get(m.id)
      waits.delete(m.id)
      m.error ? reject(new Error(m.error.message)) : resolve(m.result)
    }
  })
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const n = ++id
      waits.set(n, { resolve, reject })
      ws.send(JSON.stringify({ id: n, method, params, sessionId }))
    })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const s = (method, params) => send(method, params, sessionId)
  await s('Page.enable')
  await s('Runtime.enable')
  await s('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false })
  await s('Page.navigate', { url: page })
  let ready = false
  for (let i = 0; i < 150 && !ready; i++) {
    await sleep(200)
    const r = await s('Runtime.evaluate', { expression: 'window.__poster === true', returnByValue: true })
    ready = r.result.value === true
  }
  if (!ready) throw new Error(`${page} never drew its first frame (is WebGL up?)`)
  // one more frame settles the fade; then the drawing buffer is what the screenshot reads
  await sleep(300)
  const shot = await s('Page.captureScreenshot', { format: 'jpeg', quality: 70, captureBeyondViewport: false })
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'))
  console.log(`${path.relative(root, OUT)}: ${WIDTH}x${HEIGHT}, ${fs.statSync(OUT).size} bytes`)
  ws.close()
} finally {
  await stop()
}
