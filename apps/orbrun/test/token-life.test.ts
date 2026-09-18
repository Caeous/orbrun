// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { getToken, setToken, loginState, type Account } from '../src/servers'
import { Session } from '../src/session'

// happy-dom's localStorage has no working methods; give servers.ts a plain one
const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
})

const DAY = 24 * 60 * 60 * 1000
const caeo: Account = { serverId: 'cdi', username: 'caeo' }

/**
 * A token lives as the official client's login cookie does (client.js
 * `start_login`, `set_login_cookie`; ws_handler.py `token_login`,
 * `set_login_cookie`): once sent it is gone, the `login_cookie` answer is the
 * next one, and one the server will have forgotten is not tried.
 */
describe('token store', () => {
  beforeEach(() => store.clear())

  it('keeps a token with the day count the server gave, and forgets it once that has passed', () => {
    const t0 = 1_000_000
    setToken('cdi', 'caeo', 'tok', 7, t0)
    expect(getToken('cdi', 'caeo', t0)).toBe('tok')
    expect(getToken('cdi', 'caeo', t0 + 7 * DAY - 1)).toBe('tok')
    expect(getToken('cdi', 'caeo', t0 + 7 * DAY)).toBeNull()
    // dropped, not just hidden: the next read is at a time the token would have been good
    expect(getToken('cdi', 'caeo', t0)).toBeNull()
  })

  it('keeps a token without an expiry when the server gave none', () => {
    setToken('cdi', 'caeo', 'tok')
    expect(getToken('cdi', 'caeo', Number.MAX_SAFE_INTEGER)).toBe('tok')
    setToken('cdi', 'caeo', 'tok2', 0)
    expect(getToken('cdi', 'caeo', Number.MAX_SAFE_INTEGER)).toBe('tok2')
  })

  it('reads the bare string an older build stored as a token that has not expired', () => {
    store.set('orbrun.tokens', JSON.stringify({ 'cdi/caeo': 'old' }))
    expect(getToken('cdi', 'caeo')).toBe('old')
    expect(loginState(caeo, null)).toBe('pending')
  })

  it('files the name as the server spells it, and forgets on null', () => {
    setToken('cdi', 'Caeo', 'tok', 7)
    expect(getToken('cdi', 'caeo')).toBe('tok')
    setToken('cdi', 'caeo', null)
    expect(getToken('cdi', 'Caeo')).toBeNull()
    expect(loginState(caeo, null)).toBe('out')
  })

  it('shrugs off a token store that is not an object', () => {
    store.set('orbrun.tokens', JSON.stringify('junk'))
    expect(getToken('cdi', 'caeo')).toBeNull()
    expect(() => setToken('cdi', 'caeo', 'tok', 7)).not.toThrow()
    expect(getToken('cdi', 'caeo')).toBe('tok')
  })
})

/** A WebSocket that records what went out and lets the test speak for the server. */
class FakeSocket {
  static last: FakeSocket | null = null
  binaryType = ''
  readyState = 1
  sent: string[] = []
  onopen: ((ev: unknown) => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onclose: ((ev: { code: number; reason: string; wasClean: boolean }) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null
  constructor(public url: string) {
    FakeSocket.last = this
  }
  send(s: string) {
    this.sent.push(s)
  }
  close() {}
  open() {
    this.onopen?.({})
  }
  say(msg: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(msg) })
  }
  msgs(): string[] {
    return this.sent.map((s) => (JSON.parse(s) as { msg: string }).msg)
  }
}

const cdi = { id: 'cdi', name: 'CDI', ws: 'wss://crawl.dcss.io/socket', http: 'https://crawl.dcss.io', host: 'crawl.dcss.io' }

describe('a session and its token', () => {
  beforeEach(() => {
    store.clear()
    Object.defineProperty(window, 'WebSocket', { configurable: true, value: FakeSocket })
  })

  it('sends the token once and forgets it as it goes, then keeps the one the server answers with', () => {
    setToken('cdi', 'caeo', 'tok', 7)
    new Session(cdi, 'caeo')
    const ws = FakeSocket.last!
    ws.open()
    expect(ws.msgs()).toEqual(['token_login'])
    expect(JSON.parse(ws.sent[0])).toEqual({ msg: 'token_login', cookie: 'tok' })
    // burned on the server as it was read (ws_handler.py `token_login`), so gone here too
    expect(getToken('cdi', 'caeo')).toBeNull()
    ws.say({ msg: 'login_success', username: 'caeo' })
    expect(ws.msgs()).toEqual(['token_login', 'set_login_cookie'])
    const t0 = Date.now()
    ws.say({ msg: 'login_cookie', cookie: 'caeo%20123', expires: 7 })
    expect(getToken('cdi', 'caeo', t0 + 6 * DAY)).toBe('caeo%20123')
    expect(getToken('cdi', 'caeo', t0 + 8 * DAY)).toBeNull()
  })

  it('opens without a token login when there is none, and none when the token has expired', () => {
    setToken('cdi', 'caeo', 'tok', 7, Date.now() - 8 * DAY)
    new Session(cdi, 'caeo')
    const ws = FakeSocket.last!
    ws.open()
    expect(ws.msgs()).toEqual([])
    expect(getToken('cdi', 'caeo')).toBeNull()
  })

  it('forgets the token when the server ends the login', () => {
    new Session(cdi, 'caeo')
    const ws = FakeSocket.last!
    ws.open()
    ws.say({ msg: 'login_success', username: 'caeo' })
    ws.say({ msg: 'login_cookie', cookie: 'caeo%20123', expires: 7 })
    expect(getToken('cdi', 'caeo')).toBe('caeo%20123')
    ws.say({ msg: 'logout', reason: 'Account is disabled.' })
    expect(getToken('cdi', 'caeo')).toBeNull()
  })

  it('drops a token the server refused', () => {
    setToken('cdi', 'caeo', 'stale', 7)
    new Session(cdi, 'caeo')
    const ws = FakeSocket.last!
    ws.open()
    ws.say({ msg: 'login_fail' })
    expect(getToken('cdi', 'caeo')).toBeNull()
  })
})
