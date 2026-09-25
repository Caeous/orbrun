import { describe, expect, it } from 'vitest'
import { EngineStore, ENGINE_CACHE, type EngineInfo } from '../src/index.js'

const BASE = 'https://orbrun.test/engine/'

/** A build of `commit`: two engine files and a gamedata file, `size` bytes each. */
function build(channel: string, commit: string, version: string, size = 10): EngineInfo {
  return {
    channel,
    commit,
    version,
    stamp: '1',
    gamedata: commit,
    files: [
      [`builds/${commit}/crawl.js`, size],
      [`builds/${commit}/crawl.wasm`, size],
      [`gamedata/${commit}/main.png`, size],
    ],
  }
}

/** Cache Storage, in memory. */
function memoryCaches() {
  const entries = new Map<string, Response>()
  const key = (r: RequestInfo | URL) => (typeof r === 'string' ? r : r instanceof URL ? r.href : r.url)
  const cache = {
    match: async (r: RequestInfo | URL) => entries.get(key(r))?.clone(),
    put: async (r: RequestInfo | URL, res: Response) => {
      entries.set(key(r), new Response(await res.arrayBuffer(), { headers: res.headers }))
    },
    keys: async () => [...entries.keys()].map((u) => new Request(u)),
    delete: async (r: RequestInfo | URL) => entries.delete(key(r)),
  } as unknown as Cache
  const caches = { open: async (name: string) => (name === ENGINE_CACHE ? cache : null) } as unknown as CacheStorage
  const files = () => [...entries.keys()].filter((u) => !u.endsWith('device.json')).map((u) => u.slice(BASE.length)).sort()
  return { caches, files }
}

/** The published engine: each channel's engine.json and every build's files, with what was fetched. */
function publisher() {
  const channels = new Map<string, EngineInfo>()
  const fetched: string[] = []
  let online = true
  /** file path → bytes short of its size, to cut a download off */
  const cut = new Map<string, number>()
  let onFile: (path: string) => void = () => {}
  const fetchFn = (async (input: RequestInfo | URL) => {
    if (!online) throw new TypeError('Failed to fetch')
    const path = String(input).slice(BASE.length)
    const pointer = /^(\w+)\/engine\.json$/.exec(path)
    if (pointer) {
      const info = channels.get(pointer[1])
      return info ? Response.json(info) : new Response('', { status: 404 })
    }
    const file = [...channels.values()].flatMap((i) => i.files).find(([p]) => p === path)
    if (!file) return new Response('', { status: 404 })
    fetched.push(path)
    onFile(path)
    return new Response(new Uint8Array(file[1] - (cut.get(path) ?? 0)), { headers: { 'Content-Type': 'text/javascript' } })
  }) as typeof fetch
  return {
    fetch: fetchFn,
    fetched,
    cut,
    publish: (info: EngineInfo) => channels.set(info.channel, info),
    offline: () => (online = false),
    online: () => (online = true),
    onFile: (f: (path: string) => void) => (onFile = f),
  }
}

function setup(o: { saves?: Set<string>; caches?: ReturnType<typeof memoryCaches>; pub?: ReturnType<typeof publisher> } = {}) {
  const caches = o.caches ?? memoryCaches()
  const pub = o.pub ?? publisher()
  let busy = false
  const saves = o.saves ?? new Set<string>()
  const store = new EngineStore({ base: BASE, caches: caches.caches, fetch: pub.fetch, busy: () => busy, hasSaves: async (slot) => saves.has(slot) })
  let changes = 0
  store.onChange(() => changes++)
  const ids = async () => (await store.channels()).map((c) => c.id)
  return { store, caches, pub, ids, saves, setBusy: (b: boolean) => (busy = b), changes: () => changes }
}

describe('EngineStore', () => {
  it('offers what is published before anything is installed, and downloads nothing until one is played', async () => {
    const s = setup()
    s.pub.publish(build('stable', 'aa', '0.34.1-4-gaa'))
    s.pub.publish(build('trunk', 'bb', '0.35-a0-9-gbb'))
    expect(await s.ids()).toEqual(['offline-0.34', 'offline-trunk'])
    await s.store.update()
    expect(s.pub.fetched).toEqual([])
    expect(s.store.engineBase((await s.store.channels())[1])).toBe(`${BASE}builds/bb/`)
  })

  it('installs a build that was played: the rest of it downloads, and it stays offered with no connection', async () => {
    const s = setup()
    s.pub.publish(build('trunk', 'bb', '0.35-a0-9-gbb'))
    await s.store.channels()
    await s.store.played('offline-trunk')
    const notes: unknown[] = []
    s.store.onChange(() => notes.push(s.store.note('offline-trunk')))
    await s.store.update()
    expect(notes).toContainEqual({ kind: 'downloading', percent: 33 })
    expect(s.store.note('offline-trunk')).toBeNull()
    expect(s.caches.files()).toEqual(['builds/bb/crawl.js', 'builds/bb/crawl.wasm', 'gamedata/bb/main.png'])

    s.pub.offline()
    const again = setup({ caches: s.caches, pub: s.pub })
    expect(await again.ids()).toEqual(['offline-trunk'])
  })

  it('offers trunk beside an installed release once it is reached again, with nothing new published', async () => {
    const s = setup()
    s.pub.publish(build('stable', 'aa', '0.34.1-4-gaa'))
    s.pub.publish(build('trunk', 'bb', '0.35-a0-9-gbb'))
    await s.store.channels()
    await s.store.played('offline-0.34')
    await s.store.update()

    // a reload: the release is installed, so nothing is read before the first answer
    const again = setup({ caches: s.caches, pub: s.pub })
    expect(await again.ids()).toEqual(['offline-0.34'])
    await again.store.update()
    expect(again.changes()).toBeGreaterThan(0)
    expect(await again.ids()).toEqual(['offline-0.34', 'offline-trunk'])
  })

  it('offers nothing with no connection and nothing installed', async () => {
    const s = setup()
    s.pub.publish(build('trunk', 'bb', '0.35-a0-9-gbb'))
    s.pub.offline()
    expect(await s.ids()).toEqual([])
  })

  it('downloads an update beside the build it replaces, switches to it once whole, and says so until the next game', async () => {
    const s = setup()
    s.pub.publish(build('trunk', 'bb', '0.35-a0-9-gbb'))
    await s.store.played('offline-trunk')
    await s.store.update()

    const next = setup({ caches: s.caches, pub: s.pub })
    s.pub.publish(build('trunk', 'cc', '0.35-a0-10-gcc'))
    const during: unknown[] = []
    next.pub.onFile(async () => {
      during.push(next.store.note('offline-trunk'))
      // the build being replaced is still the one Play starts
      during.push((await next.store.channels())[0].commit)
    })
    await next.store.update()
    expect(during).toContainEqual({ kind: 'updating', percent: 0 })
    expect(during).toContain('bb')
    expect((await next.store.channels())[0].commit).toBe('cc')
    expect(next.store.note('offline-trunk')).toEqual({ kind: 'updated', version: null })
    // the old build's files are gone
    expect(s.caches.files()).toEqual(['builds/cc/crawl.js', 'builds/cc/crawl.wasm', 'gamedata/cc/main.png'])

    await next.store.played('offline-trunk')
    expect(next.store.note('offline-trunk')).toBeNull()
  })

  it('stops for a game, keeps every whole file, and picks up where it stopped', async () => {
    const s = setup()
    s.pub.publish(build('trunk', 'bb', '0.35-a0-9-gbb'))
    await s.store.played('offline-trunk')
    s.pub.onFile((path) => {
      if (path.endsWith('crawl.wasm')) s.setBusy(true)
    })
    await s.store.update()
    expect(s.caches.files()).toEqual(['builds/bb/crawl.js'])
    expect(s.store.note('offline-trunk')).toBeNull()
    // nothing runs while the game does
    await s.store.update()
    expect(s.pub.fetched).toEqual(['builds/bb/crawl.js', 'builds/bb/crawl.wasm'])

    s.setBusy(false)
    s.pub.onFile(() => {})
    await s.store.update()
    expect(s.pub.fetched.slice(2)).toEqual(['builds/bb/crawl.wasm', 'gamedata/bb/main.png'])
    expect(await s.ids()).toEqual(['offline-trunk'])
  })

  it('never installs a file that was cut short', async () => {
    const s = setup()
    s.pub.publish(build('trunk', 'bb', '0.35-a0-9-gbb'))
    await s.store.played('offline-trunk')
    s.pub.cut.set('gamedata/bb/main.png', 3)
    await s.store.update()
    expect(s.caches.files()).toEqual(['builds/bb/crawl.js', 'builds/bb/crawl.wasm'])
    s.pub.offline()
    expect(await setup({ caches: s.caches, pub: s.pub }).ids()).toEqual([])
  })

  it('brings a new release in as a row of its own once whole, and lets the old one go when nothing is saved in it', async () => {
    const s = setup({ saves: new Set(['0.34']) })
    s.pub.publish(build('stable', 'aa', '0.34.1-4-gaa'))
    await s.store.played('offline-0.34')
    await s.store.update()

    const next = setup({ caches: s.caches, pub: s.pub, saves: s.saves })
    s.pub.publish(build('stable', 'dd', '0.35.0-0-gdd'))
    const offered: string[][] = []
    next.pub.onFile(async () => offered.push(await next.ids()))
    await next.store.update()
    expect(offered[0]).toEqual(['offline-0.34'])
    expect(await next.ids()).toEqual(['offline-0.34', 'offline-0.35'])
    expect(next.store.note('offline-0.35')).toEqual({ kind: 'new', version: '0.35.0' })
    expect(next.store.note('offline-0.34')).toBeNull()
    // a character is still saved in 0.34, so its build stays
    expect(s.caches.files()).toContain('builds/aa/crawl.wasm')

    s.saves.delete('0.34')
    await next.store.update()
    expect(await next.ids()).toEqual(['offline-0.35'])
    expect(s.caches.files().some((f) => f.includes('/aa/'))).toBe(false)
  })

  it('never takes an older release for a new one', async () => {
    const s = setup()
    s.pub.publish(build('stable', 'dd', '0.35.0-0-gdd'))
    await s.store.played('offline-0.35')
    await s.store.update()
    s.pub.publish(build('stable', 'aa', '0.34.1-4-gaa'))
    const next = setup({ caches: s.caches, pub: s.pub })
    await next.store.update()
    expect(await next.ids()).toEqual(['offline-0.35'])
  })
})
