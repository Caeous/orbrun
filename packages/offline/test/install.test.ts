import { afterEach, describe, expect, it, vi } from 'vitest'
import { EngineStore, ENGINE_CACHE, type EngineInfo } from '../src/index.js'

const BASE = 'https://orbrun.test/engine/'

/** A build of `commit`: two engine files and a gamedata file, `size` bytes each. `recipe` puts the build under its own directory, as pointer.mjs does. */
function build(channel: string, commit: string, version: string, size = 10, recipe?: string): EngineInfo {
  const dir = recipe ? `${commit}-${recipe}` : commit
  return {
    channel,
    commit,
    ...(recipe ? { build: dir } : {}),
    version,
    stamp: '1',
    gamedata: commit,
    files: [
      [`builds/${dir}/crawl.js`, size],
      [`builds/${dir}/crawl.wasm`, size],
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
  /** every request made, answered or not */
  let asked = 0
  let online = true
  /** a status every engine.json answers with instead, as a server in trouble would */
  let pointerStatus = 0
  /** file path → bytes short of its size, to cut a download off */
  const cut = new Map<string, number>()
  let onFile: (path: string) => void = () => {}
  const fetchFn = (async (input: RequestInfo | URL) => {
    asked++
    if (!online) throw new TypeError('Failed to fetch')
    const path = String(input).slice(BASE.length)
    const pointer = /^(\w+)\/engine\.json$/.exec(path)
    if (pointer) {
      if (pointerStatus) return new Response('', { status: pointerStatus })
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
    asked: () => asked,
    cut,
    publish: (info: EngineInfo) => channels.set(info.channel, info),
    offline: () => (online = false),
    online: () => (online = true),
    pointerStatus: (status: number) => (pointerStatus = status),
    onFile: (f: (path: string) => void) => (onFile = f),
  }
}

function setup(o: { saves?: Set<string>; caches?: ReturnType<typeof memoryCaches>; pub?: ReturnType<typeof publisher> } = {}) {
  const caches = o.caches ?? memoryCaches()
  const pub = o.pub ?? publisher()
  let busy = false
  let metered = false
  const saves = o.saves ?? new Set<string>()
  const store = new EngineStore({ base: BASE, caches: caches.caches, fetch: pub.fetch, busy: () => busy, metered: () => metered, hasSaves: async (slot) => saves.has(slot) })
  let changes = 0
  store.onChange(() => changes++)
  const ids = async () => (await store.channels()).map((c) => c.id)
  return { store, caches, pub, ids, saves, setBusy: (b: boolean) => (busy = b), setMetered: (m: boolean) => (metered = m), changes: () => changes }
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

  it('says when its record is read, so a row drawn before it names its build after', async () => {
    const s = setup()
    s.pub.publish(build('trunk', 'bb', '0.35-a0-9-gbb'))
    await s.store.played('offline-trunk')
    await s.store.update()

    s.pub.offline()
    const next = setup({ caches: s.caches, pub: s.pub })
    expect(next.store.build('offline-trunk')).toBeNull()
    const seen: unknown[] = []
    next.store.onChange(() => seen.push(next.store.build('offline-trunk')?.version))
    await next.store.update()
    expect(seen).toContain('0.35-a0-9-gbb')
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

  it('looks for an update, downloads it beside the build it replaces, and switches to it once whole, saying nothing after', async () => {
    const s = setup()
    s.pub.publish(build('trunk', 'bb', '0.35-a0-9-gbb'))
    await s.store.played('offline-trunk')
    await s.store.update()

    const next = setup({ caches: s.caches, pub: s.pub })
    s.pub.publish(build('trunk', 'cc', '0.35-a0-10-gcc'))
    const during: unknown[] = []
    next.store.onChange(() => during.push(next.store.note('offline-trunk')))
    next.pub.onFile(async () => {
      during.push(next.store.note('offline-trunk'))
      // the build being replaced is still the one Play starts
      during.push((await next.store.channels())[0].commit)
      // and the build its row names
      during.push(next.store.build('offline-trunk')?.version)
    })
    await next.store.update()
    expect(during).toContainEqual({ kind: 'checking' })
    expect(during).toContainEqual({ kind: 'updating', percent: 0 })
    expect(during).toContain('bb')
    expect(during).toContain('0.35-a0-9-gbb')
    expect(next.store.build('offline-trunk')?.version).toBe('0.35-a0-10-gcc')
    expect((await next.store.channels())[0].commit).toBe('cc')
    // its version is the word that it changed
    expect(next.store.note('offline-trunk')).toBeNull()
    // the old build's files are gone
    expect(s.caches.files()).toEqual(['builds/cc/crawl.js', 'builds/cc/crawl.wasm', 'gamedata/cc/main.png'])
  })

  it('downloads a rebuild of the same commit with a new recipe, and plays it from its own directory', async () => {
    const s = setup()
    s.pub.publish(build('trunk', 'bb', '0.35-a0-9-gbb', 10, 'r1'))
    await s.store.played('offline-trunk')
    await s.store.update()

    s.pub.publish(build('trunk', 'bb', '0.35-a0-9-gbb', 10, 'r2'))
    const next = setup({ caches: s.caches, pub: s.pub })
    await next.store.update()
    expect(next.store.engineBase((await next.store.channels())[0])).toBe(`${BASE}builds/bb-r2/`)
    expect(s.caches.files()).toEqual(['builds/bb-r2/crawl.js', 'builds/bb-r2/crawl.wasm', 'gamedata/bb/main.png'])
  })

  describe('coming back online', () => {
    const MINUTE = 60 * 1000
    afterEach(() => {
      vi.useRealTimers()
    })

    /** trunk bb installed, then a store opened with no connection, which looks for an update and reaches nothing; cc is published meanwhile */
    async function offlineWithUpdate() {
      vi.useFakeTimers({ toFake: ['Date'] })
      const s = setup()
      s.pub.publish(build('trunk', 'bb', '0.35-a0-9-gbb'))
      await s.store.played('offline-trunk')
      await s.store.update()
      s.pub.offline()
      const next = setup({ caches: s.caches, pub: s.pub })
      await next.store.update()
      expect((await next.store.channels())[0].commit).toBe('bb')
      s.pub.publish(build('trunk', 'cc', '0.35-a0-10-gcc'))
      s.pub.online()
      return next
    }

    it('looks again at once when the connection comes back, after a look that reached nothing', async () => {
      const s = await offlineWithUpdate()
      s.store.reconnected()
      await s.store.update()
      expect((await s.store.channels())[0].commit).toBe('cc')
    })

    it('looks again a minute after a look that reached nothing, not ten, with no word that the connection is back', async () => {
      const s = await offlineWithUpdate()
      vi.advanceTimersByTime(30 * 1000)
      await s.store.update()
      expect((await s.store.channels())[0].commit).toBe('bb')
      vi.advanceTimersByTime(MINUTE)
      await s.store.update()
      expect((await s.store.channels())[0].commit).toBe('cc')
    })

    it('lets a look that was answered stand ten minutes, connection back or not', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      const s = setup()
      s.pub.publish(build('trunk', 'bb', '0.35-a0-9-gbb'))
      await s.store.played('offline-trunk')
      await s.store.update()
      s.pub.publish(build('trunk', 'cc', '0.35-a0-10-gcc'))
      s.store.reconnected()
      vi.advanceTimersByTime(5 * MINUTE)
      await s.store.update()
      expect((await s.store.channels())[0].commit).toBe('bb')
      vi.advanceTimersByTime(6 * MINUTE)
      await s.store.update()
      expect((await s.store.channels())[0].commit).toBe('cc')
    })

    it('never looks again on its own while there is no connection: a row redrawn after a look that reached nothing asks nothing', async () => {
      const s = await offlineWithUpdate()
      s.pub.offline()
      const asked = s.pub.asked()
      for (let i = 0; i < 5; i++) await s.store.update()
      expect(s.pub.asked()).toBe(asked)
      expect(s.store.note('offline-trunk')).toBeNull()
    })
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

  describe('on mobile data', () => {
    it('holds an update until the connection is not metered, saying so on its row, and downloads it then', async () => {
      const s = setup()
      s.pub.publish(build('trunk', 'bb', '0.35-a0-9-gbb'))
      await s.store.played('offline-trunk')
      await s.store.update()

      const next = setup({ caches: s.caches, pub: s.pub })
      next.setMetered(true)
      s.pub.publish(build('trunk', 'cc', '0.35-a0-10-gcc'))
      const fetched = s.pub.fetched.length
      await next.store.update()
      expect(s.pub.fetched.length).toBe(fetched)
      expect(next.store.note('offline-trunk')).toEqual({ kind: 'held' })
      expect((await next.store.channels())[0].commit).toBe('bb')

      next.setMetered(false)
      await next.store.update()
      expect((await next.store.channels())[0].commit).toBe('cc')
      expect(next.store.note('offline-trunk')).toBeNull()
    })

    it('still finishes a build that was played: its game fetched most of it, and with no connection it would not start', async () => {
      const s = setup()
      s.setMetered(true)
      s.pub.publish(build('trunk', 'bb', '0.35-a0-9-gbb'))
      await s.store.played('offline-trunk')
      await s.store.update()
      expect(s.caches.files()).toEqual(['builds/bb/crawl.js', 'builds/bb/crawl.wasm', 'gamedata/bb/main.png'])
      expect(s.store.note('offline-trunk')).toBeNull()
    })

    it('holds a new release, saying so on the release it would join', async () => {
      const s = setup()
      s.pub.publish(build('stable', 'aa', '0.34.1-4-gaa'))
      await s.store.played('offline-0.34')
      await s.store.update()

      const next = setup({ caches: s.caches, pub: s.pub })
      next.setMetered(true)
      s.pub.publish(build('stable', 'dd', '0.35.0-0-gdd'))
      await next.store.update()
      expect(await next.ids()).toEqual(['offline-0.34'])
      expect(next.store.note('offline-0.34')).toEqual({ kind: 'held' })
      expect(s.caches.files().some((f) => f.includes('/dd/'))).toBe(false)
    })

    it('stops an update when the connection turns metered, keeping every whole file', async () => {
      const s = setup()
      s.pub.publish(build('trunk', 'bb', '0.35-a0-9-gbb'))
      await s.store.played('offline-trunk')
      await s.store.update()

      const next = setup({ caches: s.caches, pub: s.pub })
      s.pub.publish(build('trunk', 'cc', '0.35-a0-10-gcc'))
      s.pub.onFile((path) => {
        if (path.endsWith('cc/crawl.wasm')) next.setMetered(true)
      })
      await next.store.update()
      expect(s.caches.files().filter((f) => f.includes('/cc/'))).toEqual(['builds/cc/crawl.js'])
      expect(next.store.note('offline-trunk')).toEqual({ kind: 'held' })
      expect((await next.store.channels())[0].commit).toBe('bb')
    })
  })

  it('keeps a channel and its download when engine.json answers with a server error, not a 404', async () => {
    const s = setup()
    s.pub.publish(build('trunk', 'bb', '0.35-a0-9-gbb'))
    await s.store.played('offline-trunk')
    s.pub.onFile((path) => {
      if (path.endsWith('crawl.wasm')) s.setBusy(true)
    })
    await s.store.update()
    expect(s.caches.files()).toEqual(['builds/bb/crawl.js'])

    s.pub.onFile(() => {})
    s.pub.pointerStatus(503)
    const again = setup({ caches: s.caches, pub: s.pub })
    await again.store.update()
    expect(again.caches.files()).toContain('builds/bb/crawl.js')
    expect(s.pub.fetched.filter((p) => p === 'builds/bb/crawl.js')).toHaveLength(1)
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
