import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ServerMessage } from '@orbrun/webtiles'

/**
 * A dropped front-end connection comes back as the same session (main.ts
 * `scheduleRetry`): the account is the same, so the token login goes out
 * again on the fresh socket, and what comes back is a blank state.
 */
vi.mock('@orbrun/gamedata', () => ({
  browserIo: () => ({}),
  loadGamedata: () => new Promise(() => {}),
}))

class FakeSocket {
  static made: FakeSocket[] = []
  binaryType = ''
  readyState = 0
  sent: string[] = []
  onopen: (() => void) | null = null
  onclose: ((e: { code: number; reason: string; wasClean: boolean }) => void) | null = null
  onmessage: ((e: { data: unknown }) => void) | null = null
  onerror: unknown = null
  constructor() {
    FakeSocket.made.push(this)
  }
  send(s: string) {
    this.sent.push(s)
  }
  opens() {
    this.readyState = 1
    this.onopen?.()
  }
  close() {
    this.readyState = 3
    this.onclose?.({ code: 1006, reason: '', wasClean: false })
  }
  get msgs() {
    return this.sent.map((s) => JSON.parse(s).msg)
  }
}

const store = new Map<string, string>()
const storage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
}

async function make() {
  ;(globalThis as { window?: unknown }).window = { WebSocket: FakeSocket, localStorage: storage }
  ;(globalThis as { localStorage?: unknown }).localStorage = storage
  const { Session } = await import('../src/session')
  const { setToken } = await import('../src/servers')
  setToken('x', 'caeo', 'tok1')
  const s = new Session({ id: 'x', name: 'x', host: 'x', ws: 'ws://x', http: 'http://x' } as never, 'caeo')
  const events: string[] = []
  s.on((e) => events.push(e.type))
  const handle = (m: ServerMessage) => (s as unknown as { handle(m: ServerMessage): void }).handle(m)
  return { s, events, handle, setToken }
}

describe('a session that dropped', () => {
  beforeEach(() => {
    store.clear()
    FakeSocket.made = []
  })

  it('logs in again on a fresh socket, on a blank state, keeping the tiles it already has', async () => {
    const { s, events, handle, setToken } = await make()
    const first = FakeSocket.made[0]
    first.opens()
    expect(first.msgs).toEqual(['token_login'])
    // logged in, playing, with the next token in hand
    handle({ msg: 'login_success', username: 'caeo' })
    handle({ msg: 'login_cookie', cookie: 'tok2', expires: 7 })
    s.gamedata = { version: '0.33' } as never
    s.state.phase = 'playing'
    setToken('x', 'caeo', 'tok2')

    first.close()
    expect(s.closed).toBe(true)
    expect(events).toContain('closed')

    expect(s.reconnect()).toBe(true)
    expect(s.closed).toBe(false)
    // nothing of the game survives the socket; the tiles do
    expect(s.state.phase).toBe('lobby')
    expect(s.state.lobby.username).toBe(null)
    expect(s.gamedata).toEqual({ version: '0.33' })

    const second = FakeSocket.made[1]
    expect(second).toBeDefined()
    second.opens()
    expect(second.msgs).toEqual(['token_login'])
    expect(JSON.parse(second.sent[0]).cookie).toBe('tok2')
    // the old socket has nothing left to say: a late close of its own is not this session's
    const before = events.length
    first.close()
    expect(events.length).toBe(before)
  })

  it('does nothing while the connection is still up', async () => {
    const { s } = await make()
    FakeSocket.made[0].opens()
    expect(s.reconnect()).toBe(false)
    expect(FakeSocket.made).toHaveLength(1)
  })
})

describe('asking whether a socket is still there', () => {
  beforeEach(() => {
    store.clear()
    FakeSocket.made = []
  })

  it('asks with get_rc and takes the rc file for a yes, without it reaching the state', async () => {
    const { s, handle } = await make()
    const sock = FakeSocket.made[0]
    sock.opens()
    handle({ msg: 'login_success', username: 'caeo' })
    const answer = s.probe('dcss-0.34', 5000)
    expect(sock.msgs.at(-1)).toBe('get_rc')
    expect(JSON.parse(sock.sent.at(-1)!).game_id).toBe('dcss-0.34')
    handle({ msg: 'rcfile_contents', game_id: 'dcss-0.34', contents: '' })
    await expect(answer).resolves.toBe(true)
    expect(s.state.lobby.rcfile).toBeFalsy()
  })

  it('takes silence for a no', async () => {
    vi.useFakeTimers()
    try {
      const { s, handle } = await make()
      FakeSocket.made[0].opens()
      handle({ msg: 'login_success', username: 'caeo' })
      const answer = s.probe('dcss-0.34', 5000)
      vi.advanceTimersByTime(5000)
      await expect(answer).resolves.toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('takes a close for a no', async () => {
    const { s, handle } = await make()
    const sock = FakeSocket.made[0]
    sock.opens()
    handle({ msg: 'login_success', username: 'caeo' })
    const answer = s.probe('dcss-0.34', 5000)
    sock.close()
    await expect(answer).resolves.toBe(false)
  })

  it('cannot ask without a login or a game id, and says no at once', async () => {
    const { s, handle } = await make()
    const sock = FakeSocket.made[0]
    sock.opens()
    await expect(s.probe('dcss-0.34', 5000)).resolves.toBe(false)
    handle({ msg: 'login_success', username: 'caeo' })
    await expect(s.probe(null, 5000)).resolves.toBe(false)
    expect(sock.msgs).not.toContain('get_rc')
  })

  it('answers two askers with one question', async () => {
    const { s, handle } = await make()
    const sock = FakeSocket.made[0]
    sock.opens()
    handle({ msg: 'login_success', username: 'caeo' })
    const a = s.probe('dcss-0.34', 5000)
    const b = s.probe('dcss-0.34', 5000)
    handle({ msg: 'rcfile_contents', game_id: 'dcss-0.34', contents: '' })
    await expect(Promise.all([a, b])).resolves.toEqual([true, true])
    expect(sock.msgs.filter((m) => m === 'get_rc')).toHaveLength(1)
  })
})
