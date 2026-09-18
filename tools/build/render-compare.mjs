#!/usr/bin/env node
/**
 * The renderer's acceptance harness (docs/custom-renderer-plan.md, step 0):
 * drives apps/orbrun/testbed/compare.html in a headless Chrome, saves one
 * PNG per pose and viewport with the frame times beside them (means over
 * steady frames paced on animation frames), and diffs two such runs pixel by
 * pixel.
 *
 *   node tools/build/render-compare.mjs capture <dir> [url]
 *   node tools/build/render-compare.mjs eval <script.js> [url]
 *   node tools/build/render-compare.mjs diff <dirA> <dirB> [--threshold N] [--out <dir>]
 *
 * `capture` starts the dev server itself unless given a url; with GPU=1 in
 * the environment Chrome draws on the machine's GPU instead of SwiftShader
 * (for frame times; the diff is against SwiftShader's frames). `eval` runs a
 * script file in the page once it is ready (as an async function body, with
 * `r`, `poses`, `frame(i)` and the rest on `window`) and prints what it
 * returns: for looking into a frame without a browser to hand. WebGL comes from
 * SwiftShader, so no GPU is needed; Chrome is found as tools/build/poster.mjs
 * finds it (CHROME=<path> to say which). `diff` reports, per frame, how many
 * pixels differ and the largest channel delta, writes a picture of the
 * difference under --out (default <dirB>/diff), and fails when any frame has
 * more differing pixels than the threshold (0 unless said).
 *
 * The baseline frames (shot before @orbrun/gl, from be59577) live under
 * tools/build/render-baseline/.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..', '..')
const PORT = 5198
const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'phone', width: 390, height: 844 },
]
/** GPU=1 leaves SwiftShader out, so Chrome draws on the machine's own GPU: for frame times, not for the diff (a GPU's rounding is its own). */
const GPU = process.env.GPU === '1'
const CHROME =
  process.env.CHROME ||
  ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))


// ---------------------------------------------------------------- capture

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

async function capture(args, script = null) {
  const outDir = args[0]
  if (!outDir) throw new Error('capture needs an output directory')
  if (!CHROME) {
    console.error('no Chrome found; set CHROME=<path to the binary>')
    process.exit(2)
  }
  let vite = null
  let url = args[1]
  if (!url) {
    vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: path.join(root, 'apps/orbrun'), stdio: 'ignore' })
    url = `http://localhost:${PORT}`
  }
  const page = `${url.replace(/\/$/, '')}/testbed/compare.html`
  const profile = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'orbrun-compare-'))
  const chrome = spawn(
    CHROME,
    ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, ...(GPU ? [] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']), '--ignore-gpu-blocklist', '--enable-webgl', '--no-first-run', 'about:blank'],
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
      /* a stale temp dir is no harm */
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
    const ws = new WebSocket(wsUrl, { maxPayload: 512 * 1024 * 1024 })
    await new Promise((r, j) => {
      ws.on('open', r)
      ws.on('error', j)
    })
    let id = 0
    const waits = new Map()
    const logs = []
    ws.on('message', (d) => {
      const m = JSON.parse(String(d))
      if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.args.map((a) => a.value ?? a.description).join(' '))
      if (m.method === 'Runtime.exceptionThrown') logs.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text))
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
    const evaluate = async (expression) => {
      const r = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
      return r.result.value
    }
    await s('Page.enable')
    await s('Runtime.enable')
    await s('Emulation.setDeviceMetricsOverride', { width: VIEWPORTS[0].width, height: VIEWPORTS[0].height, deviceScaleFactor: 1, mobile: false })
    await s('Page.navigate', { url: page })
    let ready = false
    for (let i = 0; i < 150 && !ready; i++) {
      await sleep(200)
      ready = (await evaluate('window.__ready === true')) === true
    }
    if (!ready) throw new Error(`${page} never drew its first frame (is WebGL up?)\n${logs.join('\n')}`)
    if (script) {
      // eval mode: the script file's text runs in the page (as an async function body) and its result is printed
      const result = await evaluate(`(async () => { ${fs.readFileSync(script, 'utf8')} })()`)
      console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 1))
      if (logs.length) console.log(logs.join('\n'))
      ws.close()
      return
    }
    const poses = await evaluate('window.poses')
    const summary = {}
    for (const vp of VIEWPORTS) {
      await s('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: false })
      await sleep(300)
      const dir = path.join(outDir, vp.name)
      fs.mkdirSync(dir, { recursive: true })
      const frames = await evaluate('capture()')
      frames.forEach((dataUrl, i) => {
        fs.writeFileSync(path.join(dir, `${String(i).padStart(2, '0')}-${poses[i]}.png`), Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'))
      })
      const times = await evaluate('frameTimes()')
      fs.writeFileSync(path.join(dir, 'times.json'), JSON.stringify(times, null, 1))
      summary[vp.name] = times
      console.log(`${vp.name} ${vp.width}x${vp.height}: ${frames.length} frames`)
      for (const t of times) console.log(`  ${t.name.padEnd(18)} ${t.ms.toFixed(2).padStart(6)} ms  ${String(t.draws).padStart(4)} draws`)
    }
    if (logs.length) console.log(logs.join('\n'))
    ws.close()
  } finally {
    await stop()
  }
}

// ------------------------------------------------------------------- diff

function diff(args) {
  const dirs = args.filter((a) => !a.startsWith('--'))
  const opt = (name, def) => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : def
  }
  const [a, b] = dirs
  if (!a || !b) throw new Error('diff needs two directories')
  const threshold = Number(opt('--threshold', '0'))
  const outDir = opt('--out', path.join(b, 'diff'))
  let failed = 0
  let maxDelta = 0
  const rows = []
  for (const vp of VIEWPORTS) {
    const da = path.join(a, vp.name), db = path.join(b, vp.name)
    if (!fs.existsSync(da) || !fs.existsSync(db)) {
      console.log(`${vp.name}: missing on one side`)
      continue
    }
    const names = fs.readdirSync(da).filter((n) => n.endsWith('.png')).sort()
    for (const n of names) {
      const pb = path.join(db, n)
      if (!fs.existsSync(pb)) {
        rows.push([vp.name, n, 'missing', '', ''])
        failed++
        continue
      }
      const A = decodePng(fs.readFileSync(path.join(da, n)))
      const B = decodePng(fs.readFileSync(pb))
      if (A.width !== B.width || A.height !== B.height) {
        rows.push([vp.name, n, `size ${A.width}x${A.height} vs ${B.width}x${B.height}`, '', ''])
        failed++
        continue
      }
      let differing = 0, worst = 0
      const out = new Uint8Array(A.width * A.height * 4)
      for (let i = 0; i < A.width * A.height; i++) {
        let d = 0
        for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(A.data[i * 4 + c] - B.data[i * 4 + c]))
        if (d > 0) differing++
        if (d > worst) worst = d
        // the difference picture: the baseline dimmed, differing pixels lit by how far they are off
        const g = A.data[i * 4] * 0.3 + A.data[i * 4 + 1] * 0.59 + A.data[i * 4 + 2] * 0.11
        out[i * 4] = d > 0 ? 255 : g * 0.25
        out[i * 4 + 1] = d > 0 ? Math.max(0, 255 - d * 4) : g * 0.25
        out[i * 4 + 2] = g * 0.25
        out[i * 4 + 3] = 255
      }
      if (differing > 0) {
        fs.mkdirSync(path.join(outDir, vp.name), { recursive: true })
        fs.writeFileSync(path.join(outDir, vp.name, n), encodePng(out, A.width, A.height))
      }
      if (differing > threshold) failed++
      maxDelta = Math.max(maxDelta, worst)
      rows.push([vp.name, n, String(differing), String(worst), ((differing / (A.width * A.height)) * 100).toFixed(3) + '%'])
    }
  }
  console.log(['viewport', 'frame', 'pixels differing', 'max delta', 'share'].join('\t'))
  for (const r of rows) console.log(r.join('\t'))
  console.log(`${failed} frame(s) over the threshold of ${threshold}; largest channel delta ${maxDelta}`)
  process.exit(failed ? 1 : 0)
}

// ------------------------------------------------------------ png codec

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

/** 8-bit RGB/RGBA non-interlaced PNG (what a canvas's toDataURL writes) to RGBA bytes. */
function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG')
  let pos = 8
  let width = 0, height = 0, colorType = 0, bitDepth = 0, interlace = 0
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 6 && colorType !== 2)) throw new Error(`unsupported PNG: depth ${bitDepth} type ${colorType} interlace ${interlace}`)
  const bpp = colorType === 6 ? 4 : 3
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * bpp
  const out = new Uint8Array(width * height * 4)
  const prev = new Uint8Array(stride)
  const line = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0
      const b = prev[i]
      const c = i >= bpp ? prev[i - bpp] : 0
      let v = src[i]
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      line[i] = v & 255
    }
    for (let x = 0; x < width; x++) {
      out[(y * width + x) * 4] = line[x * bpp]
      out[(y * width + x) * 4 + 1] = line[x * bpp + 1]
      out[(y * width + x) * 4 + 2] = line[x * bpp + 2]
      out[(y * width + x) * 4 + 3] = bpp === 4 ? line[x * bpp + 3] : 255
    }
    prev.set(line)
  }
  return { width, height, data: out }
}

function encodePng(rgba, width, height) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1)
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// -------------------------------------------------------------------- main

const [mode, ...rest] = process.argv.slice(2)
if (mode === 'capture') await capture(rest)
else if (mode === 'eval') await capture(['-', rest[1]], rest[0])
else if (mode === 'diff') diff(rest)
else {
  console.error('usage: render-compare.mjs capture <dir> [url] | eval <script.js> [url] | diff <dirA> <dirB> [--threshold N] [--out <dir>]')
  process.exit(2)
}
