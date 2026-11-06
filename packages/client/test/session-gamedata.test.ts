import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { ServerMessage } from '@orbrun/webtiles'

/**
 * The gamedata load's lifetime is the session's, and the latest load's: one
 * that a newer version superseded, or whose session closed while it fetched,
 * publishes nothing and touches neither the gamedata nor the queue the newer
 * load holds. Every fetch here resolves by hand.
 */
type Resolvers = { resolve: (gd: unknown) => void; reject: (e: unknown) => void; version: string; signal: AbortSignal; progress: (done: number, total: number, what: string) => void }
const loads: Resolvers[] = []
vi.mock('@orbrun/gamedata', () => ({
  browserIo: () => ({}),
  loadGamedata: (opts: { version: string; signal: AbortSignal; onProgress: Resolvers['progress'] }) =>
    new Promise((resolve, reject) => loads.push({ resolve, reject, version: opts.version, signal: opts.signal, progress: opts.onProgress })),
}))

class FakeSocket {
  static last: FakeSocket | null = null
  binaryType = ''
  readyState = 0
  onopen: (() => void) | null = null
  onclose: ((e: { code: number; reason: string }) => void) | null = null
  onmessage: unknown = null
  onerror: unknown = null
  constructor() {
    FakeSocket.last = this
  }
  send() {}
  close() {
    this.onclose?.({ code: 1000, reason: '' })
  }
}

const gd = (version: string) => ({ version, dispose: vi.fn() })

async function make() {
  ;(globalThis as { window?: unknown }).window = { WebSocket: FakeSocket, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } }
  ;(globalThis as { localStorage?: unknown }).localStorage = (globalThis as { window: { localStorage: unknown } }).window.localStorage
  const { Session } = await import('../src/session')
  const s = new Session({ id: 'x', name: 'x', host: 'x', ws: 'ws://x', http: 'http://x' } as never)
  const events: string[] = []
  s.on((e) => events.push(e.type === 'gamedata' ? `gamedata:${e.status}` : e.type))
  const handle = (m: ServerMessage) => (s as unknown as { handle(m: ServerMessage): void }).handle(m)
  return { s, events, handle }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('the gamedata load', () => {
  beforeEach(() => void loads.splice(0))
  afterEach(() => vi.useRealTimers())

  it('gives up a load that stalls, so the messages it holds back stop piling up and the screen hears why', async () => {
    vi.useFakeTimers()
    const { s, events, handle } = await make()
    const { Session } = await import('../src/session')
    handle({ msg: 'game_client', version: 'a' })
    handle({ msg: 'msgs', messages: [] })
    // bytes still arriving keep it alive, however long the whole takes
    await vi.advanceTimersByTimeAsync(Session.LOAD_STALL_MS - 1)
    loads[0].progress(1, 9, 'enums.js')
    await vi.advanceTimersByTimeAsync(Session.LOAD_STALL_MS - 1)
    expect(loads[0].signal.aborted).toBe(false)
    expect(s.loading).toBe(true)
    // and then nothing at all for the whole span: the load is over, the queue drained, the error told
    await vi.advanceTimersByTimeAsync(2)
    expect(loads[0].signal.aborted).toBe(true)
    // a real fetch rejects with the abort's reason once the signal is pulled
    loads[0].reject(loads[0].signal.reason)
    await vi.advanceTimersByTimeAsync(0)
    expect(s.loading).toBe(false)
    expect((s as unknown as { queue: unknown[] }).queue).toEqual([])
    expect(events.filter((e) => e.startsWith('gamedata:')).at(-1)).toBe('gamedata:error')
    expect(events.filter((e) => e === 'state').length).toBeGreaterThanOrEqual(2)
  })

  it('runs once per version: a second game on the version already loading starts no fetch', async () => {
    const { s, handle } = await make()
    handle({ msg: 'game_client', version: 'a' })
    handle({ msg: 'game_client', version: 'a' })
    expect(loads.map((l) => l.version)).toEqual(['a'])
    loads[0].resolve(gd('a'))
    await flush()
    expect(s.gamedata).toMatchObject({ version: 'a' })
    expect(s.loading).toBe(false)
  })

  it('lets the latest version win: a load a newer one superseded publishes nothing and drains no queue', async () => {
    const { s, events, handle } = await make()
    handle({ msg: 'game_client', version: 'a' })
    handle({ msg: 'game_client', version: 'b' })
    expect(loads.map((l) => l.version)).toEqual(['a', 'b'])
    handle({ msg: 'msgs', messages: [] })
    // the superseded load was told to stop; landing late anyway, its atlases are let go
    expect(loads[0].signal.aborted).toBe(true)
    expect(loads[1].signal.aborted).toBe(false)
    const late = gd('a')
    loads[0].resolve(late)
    await flush()
    expect(late.dispose).toHaveBeenCalledOnce()
    expect(s.gamedata).toBeNull()
    expect(s.loading).toBe(true)
    expect(events.filter((e) => e === 'gamedata:ready')).toEqual([])
    loads[1].resolve(gd('b'))
    await flush()
    expect(s.gamedata).toMatchObject({ version: 'b' })
    expect(s.loading).toBe(false)
    expect(events.filter((e) => e === 'gamedata:ready')).toEqual(['gamedata:ready'])
  })

  it('goes quiet with the session: a load that lands after the close neither errors nor readies', async () => {
    const { s, events, handle } = await make()
    handle({ msg: 'game_client', version: 'a' })
    handle({ msg: 'msgs', messages: [] })
    FakeSocket.last!.close()
    expect(s.closed).toBe(true)
    // the close stops the load and lets the messages it was holding go
    expect(loads[0].signal.aborted).toBe(true)
    expect(s.loading).toBe(false)
    expect((s as unknown as { queue: unknown[] }).queue).toEqual([])
    loads[0].reject(new Error('late'))
    await flush()
    expect(s.gamedata).toBeNull()
    expect(events.filter((e) => e.startsWith('gamedata:'))).toEqual(['gamedata:loading'])
  })
})
