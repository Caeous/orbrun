/**
 * Starts one WebAssembly engine (engine/: crawl's webtiles binary) and wires
 * its bridge. Knows nothing of workers or the page: the worker (worker.ts)
 * and the node tests both run it, each with their own way of reading files.
 */

/** The files of one built channel, as engine/build.sh writes them into dist/<channel>/. */
export type EngineFile = 'crawl.wasm' | 'crawl.data' | 'prewarm/manifest.json' | 'prewarm/prewarm.bin'

export interface EngineSource {
  /** The engine's ES module factory (dist/<channel>/crawl.js). */
  factory(): Promise<EngineFactory>
  read(file: EngineFile): Promise<ArrayBuffer>
}

export interface EngineOptions {
  source: EngineSource
  /** Where saves, morgues and caches live. One per channel: IDBFS names its database after it. */
  saveDir: string
  args: string[]
  /** One flush of the engine's output: newline-terminated JSON lines, `*`-prefixed for the server. */
  onOutput(text: string): void
  onExit(code: number): void
  onLog?(line: string): void
}

export interface RunningEngine {
  /** A control message, as a server would send it down the socket. */
  control(json: string): void
  /** Typed text, as a server would write it to the pty. */
  keys(text: string): void
}

export type EngineFactory = (mod: EngineModule) => Promise<unknown>

/** The Emscripten Module the engine is started with, and what wasm/pre.js adds to it. */
interface EngineModule {
  arguments: string[]
  saveDir: string
  wasmBinary: ArrayBuffer
  getPreloadedPackage(): ArrayBuffer
  seedCaches(fs: EngineFS, dir: string): Promise<void>
  preRun: ((mod: EngineModule) => void)[]
  onBridgeOutput(text: string): void
  onExit(code: number): void
  onAbort(what: unknown): void
  print(line: string): void
  printErr(line: string): void
  bridge?: { pushControl(json: string): void; pushKeys(text: string): void }
  FS?: EngineFS
}

interface EngineFS {
  mkdirTree(path: string): void
  writeFile(path: string, data: Uint8Array | string): void
  readFile(path: string, opts: { encoding: 'utf8' }): string
}

interface Prewarm {
  stamp: string
  files: { path: string; offset: number; size: number }[]
}

/** Which prewarm pack a save dir was last seeded with, so an engine update seeds again. */
const SEEDED = '.prewarm-stamp'

/**
 * Starts the engine and resolves once its bridge is live. The factory's own
 * promise settles only when main() returns -- when the game is over -- so the
 * engine is driven through the Module object it fills in place.
 */
export async function startEngine(o: EngineOptions): Promise<RunningEngine> {
  const [factory, wasmBinary, data, manifest] = await Promise.all([
    o.source.factory(),
    o.source.read('crawl.wasm'),
    o.source.read('crawl.data'),
    o.source.read('prewarm/manifest.json').then((b) => JSON.parse(new TextDecoder().decode(b)) as Prewarm),
  ])
  const log = o.onLog ?? (() => {})

  const seed = (fs: EngineFS, dir: string, bin: ArrayBuffer) => {
    const bytes = new Uint8Array(bin)
    for (const f of manifest.files) {
      const path = `${dir}/${f.path}`
      fs.mkdirTree(path.slice(0, path.lastIndexOf('/')))
      fs.writeFile(path, bytes.subarray(f.offset, f.offset + f.size))
    }
    fs.writeFile(`${dir}/${SEEDED}`, manifest.stamp)
  }
  const seeded = (fs: EngineFS, dir: string) => {
    try {
      return fs.readFile(`${dir}/${SEEDED}`, { encoding: 'utf8' }) === manifest.stamp
    } catch {
      return false
    }
  }
  // With no IndexedDB (node), pre.js mounts nothing and never calls
  // seedCaches, and preRun cannot wait: read the pack up front.
  const persistent = typeof indexedDB !== 'undefined'
  const early = persistent ? null : await o.source.read('prewarm/prewarm.bin')

  let exited = false
  const exit = (code: number) => {
    if (exited) return
    exited = true
    o.onExit(code)
  }
  const mod: EngineModule = {
    arguments: o.args,
    saveDir: o.saveDir,
    wasmBinary,
    getPreloadedPackage: () => data,
    // after the save dir is hydrated from IndexedDB, before main()
    seedCaches: async (fs, dir) => {
      if (seeded(fs, dir)) return
      seed(fs, dir, await o.source.read('prewarm/prewarm.bin'))
    },
    preRun: [
      (m) => {
        if (early && m.FS) {
          m.FS.mkdirTree(o.saveDir)
          seed(m.FS, o.saveDir, early)
        }
      },
    ],
    onBridgeOutput: (text) => o.onOutput(text),
    onExit: exit,
    onAbort: (what) => {
      log(`engine aborted: ${String(what)}`)
      exit(-1)
    },
    print: log,
    printErr: log,
  }
  factory(mod).catch((err: unknown) => {
    log(`engine failed: ${err instanceof Error ? err.message : String(err)}`)
    exit(-1)
  })
  // wasm/pre.js runs after the factory's first await
  while (!mod.bridge) {
    if (exited) throw new Error('the engine exited before it started')
    await new Promise((r) => setTimeout(r, 5))
  }
  const bridge = mod.bridge
  return {
    control: (json) => bridge.pushControl(json),
    keys: (text) => bridge.pushKeys(text),
  }
}
