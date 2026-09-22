import { describe, expect, it, vi } from 'vitest'
import { RemoteConnection } from '../src/connection.js'

class FakeSocket {
  static last: FakeSocket | null = null
  binaryType = ''
  readyState = 0
  sent: string[] = []
  onopen: ((ev: unknown) => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onclose: ((ev: { code: number; reason: string; wasClean: boolean }) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null
  constructor() {
    FakeSocket.last = this
  }
  send(s: string) {
    this.sent.push(s)
  }
  close() {
    this.readyState = 3
    this.onclose?.({ code: 1000, reason: '', wasClean: true })
  }
  opens() {
    this.readyState = 1
    this.onopen?.({})
  }
}

const make = (onDiagnostic?: (t: string, d?: unknown) => void) =>
  new RemoteConnection({ url: 'ws://x', gamedataBase: 'http://x', WebSocket: FakeSocket as never, onDiagnostic })

describe('RemoteConnection.send', () => {
  it('holds what is sent while connecting and lets it out, in order, once the socket opens', () => {
    const c = make()
    c.send({ msg: 'pong' })
    c.send({ msg: 'go_lobby' })
    const ws = FakeSocket.last!
    expect(ws.sent).toEqual([])
    ws.opens()
    expect(ws.sent.map((s) => JSON.parse(s).msg)).toEqual(['pong', 'go_lobby'])
    c.send({ msg: 'pong' })
    expect(ws.sent).toHaveLength(3)
  })

  it('keeps nothing once the socket has closed: there is no socket left for it to go out on', () => {
    const diag = vi.fn()
    const c = make(diag)
    const ws = FakeSocket.last!
    ws.opens()
    // one in flight when the socket goes: held, then let go with the close
    ws.readyState = 0
    c.send({ msg: 'pong' })
    ws.close()
    expect(c.closed).toBe(true)
    expect((c as unknown as { queue: string[] }).queue).toEqual([])
    c.send({ msg: 'go_lobby' })
    c.send({ msg: 'go_lobby' })
    expect((c as unknown as { queue: string[] }).queue).toEqual([])
    expect(ws.sent).toEqual([])
    expect(diag).toHaveBeenCalledWith('message dropped: the connection is closed', 'go_lobby')
  })
})

describe('RemoteConnection.reopen', () => {
  it('makes another socket for the same handlers, and stops listening to the old one', () => {
    const c = make()
    const opened = vi.fn()
    const closed = vi.fn()
    const msgs: string[] = []
    c.onOpen(opened)
    c.onClose(closed)
    c.onMessage((m) => msgs.push(m.msg))
    const first = FakeSocket.last!
    first.opens()
    first.close()
    expect(closed).toHaveBeenCalledTimes(1)

    c.reopen()
    expect(c.closed).toBe(false)
    const second = FakeSocket.last!
    expect(second).not.toBe(first)
    // sent while it connects, out once it is up, as on the first socket
    c.send({ msg: 'go_lobby' })
    second.opens()
    expect(opened).toHaveBeenCalledTimes(2)
    expect(second.sent.map((s) => JSON.parse(s).msg)).toEqual(['go_lobby'])
    second.onmessage?.({ data: '{"msg":"ping"}' })
    expect(second.sent.map((s) => JSON.parse(s).msg)).toEqual(['go_lobby', 'pong'])

    // the socket left behind: whatever it says now is nobody's
    first.onmessage?.({ data: '{"msg":"go_lobby"}' })
    first.close()
    expect(msgs).toEqual([])
    expect(closed).toHaveBeenCalledTimes(1)
    expect(c.open).toBe(true)
  })

  it('does nothing while a socket is up or on its way', () => {
    const c = make()
    const first = FakeSocket.last!
    c.reopen()
    expect(FakeSocket.last).toBe(first)
    first.opens()
    c.reopen()
    expect(FakeSocket.last).toBe(first)
  })
})
