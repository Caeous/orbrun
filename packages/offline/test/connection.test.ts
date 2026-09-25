import { describe, expect, it } from 'vitest'
import type { ServerMessage } from '@orbrun/webtiles'
import { LocalWasmConnection, channelOf } from '../src/index.js'

const TRUNK = channelOf({ channel: 'trunk', commit: 'bb', version: '0.35-a0-1', stamp: '2', gamedata: 'bb22', files: [] })

function connect() {
  return new LocalWasmConnection({
    channels: [TRUNK],
    engineBase: () => '/engine/trunk/',
    gamedataBase: '/engine',
    launch: () => ({ control: () => {}, keys: () => {}, terminate: () => {} }),
  })
}

describe('LocalWasmConnection', () => {
  it('opens on a later tick, greeting with the empty lobby', async () => {
    const conn = connect()
    const got: string[] = []
    conn.onMessage((m) => got.push(m.msg))
    expect(conn.open).toBe(false)
    await new Promise<void>((r) => conn.onOpen(r))
    expect(conn.open).toBe(true)
    await Promise.resolve()
    expect(got).toEqual(['lobby_clear', 'lobby_complete'])
  })

  it('never answers inside send, so what the caller does next comes first (Session forgets a used token)', async () => {
    const conn = connect()
    const log: string[] = []
    conn.onMessage((m: ServerMessage) => {
      log.push(m.msg)
      if (m.msg === 'login_success') conn.send({ msg: 'set_login_cookie' })
    })
    conn.onOpen(() => {
      conn.send({ msg: 'token_login', cookie: 'offline:Kai' })
      log.push('forgot the old token')
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(log).toEqual(['forgot the old token', 'lobby_clear', 'lobby_complete', 'login_success', 'login_cookie', 'set_game_links'])
  })

  it('drops what the server says after a close', async () => {
    const conn = connect()
    const got: string[] = []
    conn.onMessage((m) => got.push(m.msg))
    const closed: number[] = []
    conn.onClose((r) => closed.push(r.code))
    await new Promise<void>((r) => conn.onOpen(r))
    conn.send({ msg: 'token_login', cookie: '' })
    conn.close()
    await new Promise((r) => setTimeout(r, 0))
    // the greeting came before the close; the answer to the login did not
    expect(got).toEqual(['lobby_clear', 'lobby_complete'])
    expect(closed).toEqual([1000])
  })
})
