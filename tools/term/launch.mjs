// How the terminal client (game/main.ts) is started, by game/run.mjs and ssh.mjs: on a node that runs crawl, from
// one script esbuild makes of it and all it imports, kept in dist/ and made again only when a file it was made of
// has changed since. Under vite-node, which transformed every module on every start, the front screen took a second
// longer to come up.
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const DIST = path.join(here, 'dist')
/** what is not bundled: native or itself a bundler, found where it is installed */
const EXTERNAL = ['sharp', 'esbuild', 'ssh2']
/** import.meta.env as vite-node gives it: the app reads it (servers.ts `offlineOffered`, analytics.ts) */
const ENV = { MODE: 'development', DEV: true, PROD: false, SSR: true, BASE_URL: '/' }

const runsCrawl = (bin) =>
  require('node:child_process').spawnSync(bin, ['-e', 'process.exit(typeof WebAssembly.Suspending === "function" ? 0 : 1)']).status === 0

/**
 * A node that runs crawl: Node 24 or later, for WebAssembly JSPI. This one when it does (`self`, and no second node
 * to start), else the first that does of ORBRUN_NODE, Homebrew's and the system's; null if none.
 */
export function crawlNode() {
  if (typeof WebAssembly.Suspending === 'function') return { bin: process.execPath, self: true }
  const bin = [process.env.ORBRUN_NODE, '/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node'].find((b) => b && fs.existsSync(b) && runsCrawl(b))
  return bin ? { bin, self: false } : null
}

/** esbuild's version, which a bundle was made by, so a new one makes them again */
const esbuildVersion = () => JSON.parse(fs.readFileSync(require.resolve('esbuild/package.json'), 'utf8')).version

/** whether the bundles in dist/ were made by this esbuild, after each file they were made of last changed */
function fresh(manifest) {
  try {
    const m = JSON.parse(fs.readFileSync(manifest, 'utf8'))
    if (m.esbuild !== esbuildVersion()) return false
    for (const f of m.inputs) if (fs.statSync(f).mtimeMs > m.built) return false
    return true
  } catch {
    return false
  }
}

/**
 * Each file's own `import.meta.url` where it is used, as it was before it was bundled: game/engine.ts, home.ts and
 * glyph/threads.ts find the files beside them by it.
 */
const ownUrl = {
  name: 'own-url',
  setup(b) {
    b.onLoad({ filter: /\.[cm]?[jt]s$/ }, (a) => {
      if (a.path.includes(`${path.sep}node_modules${path.sep}`)) return undefined
      const src = fs.readFileSync(a.path, 'utf8')
      if (!src.includes('import.meta.url')) return undefined
      return { contents: src.replaceAll('import.meta.url', JSON.stringify(pathToFileURL(a.path).href)), loader: /\.[cm]?ts$/.test(a.path) ? 'ts' : 'js' }
    })
  },
}

/**
 * The client and the glyph view's worker (glyph/worker.ts, which glyph/threads.ts runs from ORBRUN_TERM_WORKER) as
 * scripts in dist/, made again where they are not `fresh`. Each is written beside itself and moved into place, so a
 * second start at the same time never runs half of one.
 */
export function clientBundle() {
  const main = path.join(DIST, 'main.mjs')
  const worker = path.join(DIST, 'worker.cjs')
  if (fresh(path.join(DIST, 'inputs.json'))) return Promise.resolve({ main, worker })
  // one build at a time in this process: two games starting at once on the SSH server wait on the same
  building ??= build(main, worker).finally(() => (building = null))
  return building
}

let building = null

async function build(main, worker) {
  const manifest = path.join(DIST, 'inputs.json')
  const esbuild = await import('esbuild')
  const started = Date.now()
  const common = { bundle: true, platform: 'node', target: 'node24', external: EXTERNAL, metafile: true, logLevel: 'error', plugins: [ownUrl] }
  const [m, w] = await Promise.all([
    esbuild.build({
      ...common,
      entryPoints: [path.join(here, 'game', 'main.ts')],
      format: 'esm',
      write: false,
      outfile: main,
      sourcemap: 'linked',
      define: { 'import.meta.env': JSON.stringify(ENV) },
      // what it bundles of CommonJS calls require, which an ES module has not of itself
      banner: { js: "import { createRequire as __orbrunRequire } from 'node:module'; const require = __orbrunRequire(import.meta.url);" },
    }),
    esbuild.build({ ...common, entryPoints: [path.join(here, 'glyph', 'worker.ts')], format: 'cjs', write: false, outfile: worker }),
  ])
  fs.mkdirSync(DIST, { recursive: true })
  const tmp = `.${process.pid}.tmp`
  const files = [...m.outputFiles, ...w.outputFiles]
  for (const f of files) fs.writeFileSync(f.path + tmp, f.contents)
  for (const f of files) fs.renameSync(f.path + tmp, f.path)
  const inputs = [...new Set([...Object.keys(m.metafile.inputs), ...Object.keys(w.metafile.inputs)])].map((f) => path.resolve(f))
  fs.writeFileSync(manifest + tmp, JSON.stringify({ esbuild: esbuildVersion(), built: started, inputs }))
  fs.renameSync(manifest + tmp, manifest)
  return { main, worker }
}
