import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { networkPaths, shellFiles, withShell } from '../shell'
import { PAGES } from '../src/site'

const here = path.dirname(fileURLToPath(import.meta.url))
const sw = fs.readFileSync(path.join(here, '..', 'public', 'sw.js'), 'utf8')

/** a build's files, as dist has them */
const BUILT = [
  'index.html',
  'about.html',
  'about/new.html',
  'about/hero-1280.webp',
  'about/keys-bg.webp',
  'about/account-bg.webp',
  'assets/index-AbC123.js',
  'assets/index-AbC123.js.map',
  'assets/index-DeF456.css',
  'assets/worker-GhI789.js',
  'fonts/dejavu-sans-mono-400.woff2',
  'fonts/DEJAVU-LICENSE.txt',
  'room/atlas.json',
  'room/atlas.png',
  'room/poster.jpg',
  'room/card.jpg',
  'room/places/lair.json',
  'room/places/lair.png',
  'room/README.md',
  'icons/icon-192.png',
  'steam/grid.png',
  'favicon.svg',
  'orb.png',
  'manifest.webmanifest',
  'robots.txt',
  'sitemap.xml',
  'sw.js',
]

/** Orbrun opens with no connection: the service worker keeps what the app needs to start, and nothing else. */
describe('the app kept on the device', () => {
  it('keeps the page, the bundles, the fonts, the places the front screen stands in, the stills the menus stand in and the icons', () => {
    expect(shellFiles(BUILT)).toEqual([
      '/',
      '/about/account-bg.webp',
      '/about/keys-bg.webp',
      '/assets/index-AbC123.js',
      '/assets/index-DeF456.css',
      '/assets/worker-GhI789.js',
      '/favicon.svg',
      '/fonts/dejavu-sans-mono-400.woff2',
      '/icons/icon-192.png',
      '/manifest.webmanifest',
      '/orb.png',
      '/room/places/lair.json',
      '/room/places/lair.png',
    ])
  })

  it('sends a page load of the site’s pages and the build’s other files to the network, not to the app', () => {
    const network = networkPaths(BUILT)
    for (const p of PAGES.filter((p) => p.path !== '/')) expect(network).toContain(p.path)
    expect(network).toContain('/about/orbrun')
    expect(network).toContain('/robots.txt')
    expect(network).toContain('/about/hero-1280.webp')
    expect(network).not.toContain('/')
    expect(network).not.toContain('/assets/index-AbC123.js.map')
    for (const f of shellFiles(BUILT)) expect(network).not.toContain(f)
  })

  it('writes the list into sw.js, which keeps nothing of the app as written', () => {
    expect(sw).toContain('const SHELL = null')
    const out = withShell(sw, { version: 'v1', files: ['/'], sums: { '/': 'a1' }, network: ['/about'] })
    expect(out).toContain('const SHELL = {"version":"v1","files":["/"],"sums":{"/":"a1"},"network":["/about"]}')
    expect(() => withShell('self.addEventListener()', { version: 'v1', files: [], sums: {}, network: [] })).toThrow()
  })
})

/**
 * A device's CacheStorage, shared by every version of sw.js run on it; `addAll` fails while `failing` holds, and lists in
 * `fetched` what it got. Its connection (`network`) is down unless set otherwise.
 */
function device() {
  const stores = new Map<string, Map<string, unknown>>()
  // a Cache takes an address relative to the worker's
  const at = (url: string) => new URL(url, 'https://orbrun.app').href
  const dev = {
    failing: false,
    fetched: [] as string[],
    network: 'down' as 'down' | 'up',
    caches: {
      open: async (name: string) => {
        if (!stores.has(name)) stores.set(name, new Map())
        const m = stores.get(name)!
        return {
          // a Response is read once, and a Cache hands out a fresh one each time
          match: async (url: string) => {
            const hit = m.get(at(url))
            return hit instanceof Response ? hit.clone() : hit
          },
          put: async (url: string, res: unknown) => void m.set(at(url), res),
          addAll: async (rs: { url: string }[]) => {
            if (dev.failing) throw new Error('a file would not come')
            dev.fetched.push(...rs.map((r) => r.url))
            for (const r of rs) m.set(at(r.url), `${name} ${r.url === '/' ? 'page' : r.url}`)
          },
        }
      },
      keys: async () => [...stores.keys()],
      delete: async (name: string) => stores.delete(name),
      // as CacheStorage looks: in every cache, the oldest first
      match: async (url: string) => [...stores.values()].map((m) => m.get(at(url))).find((hit) => hit !== undefined),
    },
  }
  return dev
}

/**
 * sw.js of app version `version` keeping `files`, whose contents are `sums` (each file's own by default), on
 * `dev`: its install, a page load of `/` and a fetch of a file, once all each set off has settled
 */
function serviceWorker(dev: ReturnType<typeof device>, version: string, files = ['/'], sums = Object.fromEntries(files.map((f) => [f, version]))) {
  const on: Record<string, (e: unknown) => void> = {}
  const self = {
    location: { href: 'https://orbrun.app/sw.js', origin: 'https://orbrun.app' },
    addEventListener: (type: string, f: (e: unknown) => void) => (on[type] = f),
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  }
  class Request {
    constructor(readonly url: string) {}
  }
  const fetch = (req: { mode?: string }) =>
    dev.network === 'up' ? Promise.resolve({ ok: true, page: req.mode === 'navigate' ? 'deployed page' : 'deployed' }) : Promise.reject(new TypeError('offline'))
  new Function('self', 'caches', 'Request', 'fetch', withShell(sw, { version, files, sums, network: [] }))(self, dev.caches, Request, fetch)
  const settle = async (type: string, event: object) => {
    const waits: Promise<unknown>[] = []
    let answer: Promise<unknown> = Promise.resolve()
    on[type]({ ...event, waitUntil: (p: Promise<unknown>) => waits.push(p), respondWith: (p: Promise<unknown>) => (answer = p) })
    const out = await answer
    await Promise.all(waits)
    return out
  }
  return {
    install: () => settle('install', {}),
    load: () => settle('fetch', { request: { method: 'GET', url: 'https://orbrun.app/', mode: 'navigate' } }),
    get: (path: string) => settle('fetch', { request: { method: 'GET', url: 'https://orbrun.app' + path, mode: 'cors' } }),
    /** what it answers a page asking whether it keeps `url` */
    keeps: (url: string) =>
      new Promise((done) => on.message({ data: { type: 'keeps', url }, ports: [{ postMessage: done }] })),
  }
}

describe('a page load', () => {
  it('is the version deployed now wherever there is a connection, not the one kept', async () => {
    const dev = device()
    const v1 = serviceWorker(dev, 'v1')
    await v1.install()
    dev.network = 'up'
    expect(await v1.load()).toEqual({ ok: true, page: 'deployed page' })
  })

  it('is the kept page with no connection', async () => {
    const dev = device()
    const v1 = serviceWorker(dev, 'v1')
    await v1.install()
    expect(await v1.load()).toBe('orbrun-app-v1 page')
  })

  it('gets the files kept under a fixed name as deployed now too, and the hashed bundles from what is kept', async () => {
    const dev = device()
    const v1 = serviceWorker(dev, 'v1', ['/', '/manifest.webmanifest', '/assets/v1.js'])
    await v1.install()
    dev.network = 'up'
    expect(await v1.get('/manifest.webmanifest')).toEqual({ ok: true, page: 'deployed' })
    expect(await v1.get('/assets/v1.js')).toBe('orbrun-app-v1 /assets/v1.js')
    dev.network = 'down'
    expect(await v1.get('/manifest.webmanifest')).toBe('orbrun-app-v1 /manifest.webmanifest')
  })

  it('tells a page whether its bundle is this version’s, so one loaded from the network does not reload for it', async () => {
    const v2 = serviceWorker(device(), 'v2', ['/', '/assets/v2.js'])
    expect(await v2.keeps('https://orbrun.app/assets/v2.js')).toBe(true)
    expect(await v2.keeps('https://orbrun.app/assets/v1.js')).toBe(false)
  })
})

describe('a new version of the app', () => {
  it('is kept on a later page load when keeping it failed at install, rather than the older one standing in for good', async () => {
    const dev = device()
    await serviceWorker(dev, 'v1').install()
    const v2 = serviceWorker(dev, 'v2')
    dev.failing = true
    await v2.install()
    // the older version stands in, so the app still opens; and this load tries again
    expect(await v2.load()).toBe('orbrun-app-v1 page')
    dev.failing = false
    expect(await v2.load()).toBe('orbrun-app-v1 page')
    expect(await v2.load()).toBe('orbrun-app-v2 page')
  })

  it('answers with its own copy of a file kept under a fixed name, such as the manifest, not the older version’s', async () => {
    const dev = device()
    await serviceWorker(dev, 'v1', ['/', '/manifest.webmanifest', '/assets/v1.js']).install()
    const v2 = serviceWorker(dev, 'v2', ['/', '/manifest.webmanifest', '/assets/v2.js'])
    await v2.install()
    expect(await v2.get('/manifest.webmanifest')).toBe('orbrun-app-v2 /manifest.webmanifest')
    // a page opened before the deploy still finds its own bundles
    expect(await v2.get('/assets/v1.js')).toBe('orbrun-app-v1 /assets/v1.js')
  })

  it('copies the files an older version kept that have not changed, and fetches only the rest', async () => {
    const dev = device()
    await serviceWorker(dev, 'v1', ['/', '/room/places/lair.png', '/manifest.webmanifest'], { '/': 'p1', '/room/places/lair.png': 'l', '/manifest.webmanifest': 'm1' }).install()
    const v2 = serviceWorker(dev, 'v2', ['/', '/room/places/lair.png', '/manifest.webmanifest'], { '/': 'p2', '/room/places/lair.png': 'l', '/manifest.webmanifest': 'm2' })
    dev.fetched = []
    await v2.install()
    expect(dev.fetched).toEqual(['/', '/manifest.webmanifest'])
    expect(await v2.get('/room/places/lair.png')).toBe('orbrun-app-v1 /room/places/lair.png')
    expect(await v2.get('/manifest.webmanifest')).toBe('orbrun-app-v2 /manifest.webmanifest')
    expect(await v2.load()).toBe('orbrun-app-v2 page')
  })
})
