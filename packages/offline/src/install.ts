import { CHANNEL_NAMES, channelOf, hasSaves, releaseOf, slotOf, type EngineInfo } from './channels.js'
import type { OfflineChannel } from './server.js'

/**
 * The engine builds kept on this device, and their updates.
 *
 * Every file is kept in Cache Storage under the URL it is served at, and
 * builds are served under their commit (engine/pointer.mjs), so a new build
 * downloads beside the one being played and never mixes with it. A build is
 * installed once every file of it is here; until then the one before plays.
 * The page's service worker (apps/orbrun/public/sw.js) answers the engine's
 * own requests from the same cache, and keeps what a game fetches from the
 * network: a first game played online installs its build as it goes.
 *
 * Play never waits on a download. Updates are fetched only while no game is
 * running (`busy`), a file at a time, keeping every file already whole, and
 * switch in at the next game start. Trunk updates in place. A new release is
 * a slot of its own, offered once whole, beside the last one; an older
 * release is dropped once no profile has a character saved in it, since
 * crawl carries a save into a new release and never back.
 */

/** The Cache Storage cache the builds and the device's record of them are kept in; sw.js reads it by this name. */
export const ENGINE_CACHE = 'orbrun-engine'

/** The record of what is installed, kept in the cache beside the files, under this name in the engine base. */
const STATE = 'device.json'

/** How long a check for new builds stands before the next one is made. */
const CHECK_EVERY_MS = 10 * 60 * 1000
const CHECK_TIMEOUT_MS = 8000

interface Installed extends EngineInfo {
  /** What to say about it on its row, until the next game starts: an update switched in, or a new release. */
  news?: 'updated' | 'new'
}

interface State {
  /** The build each slot plays, every file of it here. */
  installed: Record<string, Installed>
  /** Each channel's engine.json as last read, so a download can go on with no connection. */
  published: Record<string, EngineInfo>
  /** Slots played before they were installed: they download the rest of their build. */
  wanted: string[]
}

/** What a game's row says about its build. */
export type EngineNote =
  | { kind: 'downloading' | 'updating'; percent: number }
  /** `version`: the release's own, `0.34.2`; null for trunk, whose versions say nothing to a player */
  | { kind: 'updated' | 'new'; version: string | null }

export interface EngineStoreOptions {
  /** The engine base, as an absolute URL ending in `/`: `<base><channel>/engine.json`, `<base>builds/<commit>/`. */
  base: string
  /** Where builds are kept; with none (node, an insecure page) nothing is, and every game plays from the network. */
  caches?: CacheStorage
  fetch?: typeof fetch
  /** Whether a game is running or starting: downloads wait for it to end. */
  busy?(): boolean
  /** Whether any profile has a character saved in a slot (channels `hasSaves`). */
  hasSaves?(slot: string): Promise<boolean>
}

const empty = (): State => ({ installed: {}, published: {}, wanted: [] })

export class EngineStore {
  private state: Promise<State> | null = null
  /** The state, once loaded: what `note` reads, synchronously. */
  private stateNow: State | null = null
  /** Slots whose engine.json was read in this session: only those are offered before they are installed. */
  private reachable = new Set<string>()
  private checked: Promise<void> | null = null
  private checkedAt = 0
  private progress = new Map<string, number>()
  private listeners = new Set<() => void>()
  private running: Promise<void> | null = null
  private readonly fetch: typeof fetch

  constructor(private readonly o: EngineStoreOptions) {
    this.fetch = o.fetch ?? ((...a) => fetch(...a))
  }

  /**
   * The games on offer: every installed build; and, while this device can
   * reach the published ones, a build not yet installed where nothing of its
   * kind is (the first trunk, the first release), played from the network. A
   * new release beside an installed one waits until it is whole.
   */
  async channels(): Promise<OfflineChannel[]> {
    const s = await this.load()
    if (!Object.keys(s.installed).length) await this.check()
    const offered = new Map(Object.entries(s.installed).map(([slot, info]) => [slot, channelOf(info)]))
    const release = Object.values(s.installed).some((i) => releaseOf(i))
    for (const info of Object.values(s.published)) {
      const slot = slotOf(info)
      if (offered.has(slot) || !this.reachable.has(slot) || (releaseOf(info) && release)) continue
      offered.set(slot, channelOf(info))
    }
    return [...offered.values()]
  }

  /** Where a build's engine files are. */
  engineBase(channel: OfflineChannel): string {
    return `${this.o.base}builds/${channel.commit}/`
  }

  /** What a game's row says about its build, if anything: how far its download is, or that it is new. */
  note(id: string): EngineNote | null {
    const slot = id.replace(/^offline-/, '')
    const installed = this.stateNow?.installed[slot]
    const percent = this.progress.get(slot)
    if (percent !== undefined) return { kind: installed ? 'updating' : 'downloading', percent }
    if (installed?.news) return { kind: installed.news, version: releaseOf(installed) ? installed.version.replace(/-.*/, '') : null }
    return null
  }

  /**
   * A game is starting: its build is kept from now on, if it was not yet,
   * and what the rows said about new builds is no longer news.
   */
  async played(id: string): Promise<void> {
    const s = await this.load()
    const slot = id.replace(/^offline-/, '')
    let changed = false
    if (!s.installed[slot] && !s.wanted.includes(slot)) {
      s.wanted.push(slot)
      changed = true
    }
    for (const info of Object.values(s.installed)) {
      if (!info.news) continue
      delete info.news
      changed = true
    }
    if (changed) await this.save()
    this.changed()
  }

  /**
   * Look for new builds (at most every ten minutes) and download what this
   * device keeps, unless a game is running. Safe to call as often as a
   * screen comes up: one run at a time, and a run gives way to a game.
   */
  update(): Promise<void> {
    if (this.busy()) return Promise.resolve()
    return (this.running ??= (async () => {
      try {
        if (Date.now() - this.checkedAt > CHECK_EVERY_MS) await this.check(true)
        await this.sync()
      } catch {
        // no cache to keep builds in, or it refused: every game plays from the network
      } finally {
        this.running = null
      }
    })())
  }

  /** Called when the games on offer, or what their rows say, change. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private load(): Promise<State> {
    return (this.state ??= (async () => {
      let s = empty()
      try {
        const res = await (await this.cache())?.match(this.url(STATE))
        if (res) s = { ...s, ...((await res.json()) as State) }
      } catch {
        // an unreadable record is an empty one: builds download again
      }
      return (this.stateNow = s)
    })())
  }

  private async save() {
    const cache = await this.cache()
    if (!cache || !this.stateNow) return
    await cache.put(this.url(STATE), new Response(JSON.stringify(this.stateNow), { headers: { 'Content-Type': 'application/json' } }))
  }

  private async cache(): Promise<Cache | null> {
    return this.o.caches ? this.o.caches.open(ENGINE_CACHE) : null
  }

  private url(path: string) {
    return new URL(path, this.o.base).href
  }

  private busy() {
    return this.o.busy?.() ?? false
  }

  private changed() {
    for (const fn of this.listeners) fn()
  }

  /** Read each channel's engine.json. Once a session, unless `again`; a failure leaves the last one read standing. */
  private check(again = false): Promise<void> {
    if (this.checked && !again) return this.checked
    return (this.checked = (async () => {
      const s = await this.load()
      const before = JSON.stringify(s.published)
      const reached = this.reachable.size
      await Promise.all(
        CHANNEL_NAMES.map(async (name) => {
          try {
            const res = await this.fetch(this.url(`${name}/engine.json`), { cache: 'no-store', signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) })
            if (!res.ok) {
              // the channel is not published (any more)
              delete s.published[name]
              return
            }
            const info = (await res.json()) as EngineInfo
            s.published[name] = info
            this.reachable.add(slotOf(info))
          } catch {
            // no connection: what was read last stands
          }
        }),
      )
      this.checkedAt = Date.now()
      const published = JSON.stringify(s.published) !== before
      if (published) await this.save()
      // a build newly reached is newly offered, even one read before and kept in the record unchanged
      if (published || this.reachable.size !== reached) this.changed()
    })())
  }

  /** Download what this device keeps, install what is whole, and let go of what nothing plays. */
  private async sync() {
    const s = await this.load()
    const cache = await this.cache()
    if (!cache) return
    const newest = newestRelease(Object.values(s.installed))
    for (const info of Object.values(s.published)) {
      const slot = slotOf(info)
      const release = releaseOf(info)
      const kept =
        !!s.installed[slot] ||
        s.wanted.includes(slot) ||
        // a new release, where this device plays the one before it
        (!!release && !!newest && compareReleases(release, newest) > 0)
      if (!kept || s.installed[slot]?.commit === info.commit) continue
      if (!(await this.download(cache, slot, info))) return
      const before = s.installed[slot]
      s.installed[slot] = { ...info, news: before ? 'updated' : release && newest ? 'new' : undefined }
      s.wanted = s.wanted.filter((w) => w !== slot)
      await this.save()
      this.changed()
    }
    await this.prune(s)
    await this.sweep(cache, s)
  }

  /** Every file of a build into the cache, a file at a time. False if it stopped short: a game started, or the network went. */
  private async download(cache: Cache, slot: string, info: EngineInfo): Promise<boolean> {
    const total = info.files.reduce((n, [, size]) => n + size, 0) || 1
    let done = 0
    const missing: [string, number][] = []
    for (const [path, size] of info.files) {
      if (await cache.match(this.url(path))) done += size
      else missing.push([path, size])
    }
    const report = () => {
      const percent = Math.min(99, Math.floor((done / total) * 100))
      if (this.progress.get(slot) === percent) return
      this.progress.set(slot, percent)
      this.changed()
    }
    const stop = () => {
      this.progress.delete(slot)
      this.changed()
      return false
    }
    if (missing.length) report()
    for (const [path, size] of missing) {
      if (this.busy()) return stop()
      let res: Response
      try {
        res = await this.fetch(this.url(path))
      } catch {
        return stop()
      }
      if (!res.ok || !res.body) return stop()
      const reader = res.body.getReader()
      const chunks: Uint8Array[] = []
      let got = 0
      try {
        for (;;) {
          const { done: end, value } = await reader.read()
          if (end) break
          chunks.push(value)
          got += value.byteLength
          done += value.byteLength
          report()
          if (this.busy()) {
            await reader.cancel()
            return stop()
          }
        }
      } catch {
        return stop()
      }
      // a short read is a file cut off, not a file
      if (got !== size) return stop()
      const type = res.headers.get('Content-Type')
      await cache.put(this.url(path), new Response(new Blob(chunks as BlobPart[]), type ? { headers: { 'Content-Type': type } } : undefined))
    }
    this.progress.delete(slot)
    return true
  }

  /** An older release goes once no profile has a character saved in it: the newest installed one always stays. */
  private async prune(s: State) {
    const newest = newestRelease(Object.values(s.installed))
    for (const [slot, info] of Object.entries(s.installed)) {
      const release = releaseOf(info)
      if (!release || release === newest || this.busy()) continue
      if (await (this.o.hasSaves ?? hasSaves)(slot)) continue
      delete s.installed[slot]
      await this.save()
      this.changed()
    }
  }

  /** Drop the files of every build nothing installed or published points at any more. */
  private async sweep(cache: Cache, s: State) {
    if (this.busy()) return
    const commits = new Set([...Object.values(s.installed), ...Object.values(s.published)].map((i) => i.commit))
    const builds = this.url('builds/')
    const gamedata = this.url('gamedata/')
    for (const req of await cache.keys()) {
      const under = req.url.startsWith(builds) ? builds : req.url.startsWith(gamedata) ? gamedata : null
      if (under && !commits.has(req.url.slice(under.length).split('/')[0])) await cache.delete(req)
    }
  }
}

function compareReleases(a: string, b: string): number {
  const [am, an] = a.split('.').map(Number)
  const [bm, bn] = b.split('.').map(Number)
  return am - bm || an - bn
}

function newestRelease(infos: EngineInfo[]): string | null {
  return infos
    .map(releaseOf)
    .filter((r): r is string => !!r)
    .sort(compareReleases)
    .pop() ?? null
}
