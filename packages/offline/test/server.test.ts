import { describe, expect, it, vi } from 'vitest'
import { gameLinkRows, initialState, reduce, type ServerMessage } from '@orbrun/webtiles'
import { OfflineServer, channelOf, deleteProfileSaves, saveDesc, type EngineEvents, type OfflineChannel, type SaveBook } from '../src/index.js'

const STABLE = channelOf({ channel: 'stable', commit: 'aa', version: '0.34.1-4-g0e95e087e2', stamp: '1', gamedata: 'aa11', files: [] })
const TRUNK = channelOf({ channel: 'trunk', commit: 'bb', version: '0.35-a0-1079-ga0251cc2b5', stamp: '2', gamedata: 'bb22', files: [] })

/** A server with a fake engine: what it was sent, and a hand on its output. */
function setup(channels: OfflineChannel[] | (() => Promise<OfflineChannel[]>) = [STABLE, TRUNK], saves?: SaveBook) {
  const out: ServerMessage[][] = []
  const sent: { control: string[]; keys: string[]; terminated: boolean; args: string[]; channel: OfflineChannel } = {
    control: [],
    keys: [],
    terminated: false,
    args: [],
    channel: STABLE,
  }
  let events: EngineEvents | null = null
  const server = new OfflineServer({
    channels,
    username: 'Kai',
    saves,
    emit: (msgs) => out.push(msgs),
    launch: (channel, args, ev) => {
      events = ev
      sent.args = args
      sent.channel = channel
      return {
        control: (j) => sent.control.push(j),
        keys: (t) => sent.keys.push(t),
        terminate: () => (sent.terminated = true),
      }
    },
  })
  const engine = () => events as unknown as EngineEvents
  const flat = () => out.flat()
  const names = () => flat().map((m) => m.msg)
  return { server, out, sent, engine, flat, names }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('OfflineServer lobby', () => {
  it('greets with an empty lobby and logs any account in', async () => {
    const s = setup()
    s.server.connected()
    s.server.receive({ msg: 'token_login', cookie: 'whatever' })
    await tick()
    expect(s.names()).toEqual(['lobby_clear', 'lobby_complete', 'login_success', 'set_game_links'])
    expect(s.flat()[2]).toMatchObject({ username: 'Kai' })
  })

  it('lists both channels as game links the client reads, stable as a release and trunk as trunk', async () => {
    const s = setup()
    s.server.receive({ msg: 'login', username: 'x', password: 'y' })
    await tick()
    let state = initialState()
    for (const m of s.flat()) state = reduce(state, m)
    expect(state.lobby.games).toEqual([
      { id: 'offline-0.34', label: 'DCSS 0.34' },
      { id: 'offline-trunk', label: 'DCSS trunk' },
    ])
    const rows = gameLinkRows(state.lobby.games)
    expect(rows.latestVersion).toBe('0.34')
    expect(rows.trunk.map((g) => g.id)).toEqual(['offline-trunk'])
  })

  it('hands out a token, and answers the rc probe the client checks the socket with', async () => {
    const s = setup()
    s.server.receive({ msg: 'set_login_cookie' })
    s.server.receive({ msg: 'get_rc', game_id: 'offline-0.34' })
    expect(s.flat()).toEqual([
      { msg: 'login_cookie', cookie: 'offline:Kai', expires: 3650 },
      { msg: 'rcfile_contents', game_id: 'offline-0.34', contents: '' },
    ])
  })

  it('logs in as the name the login gives, made safe for crawl, and its token logs back in as it', async () => {
    const s = setup()
    s.server.receive({ msg: 'login', username: 'Ann Marie!', password: 'anything' })
    s.server.receive({ msg: 'set_login_cookie' })
    expect(s.flat()[0]).toEqual({ msg: 'login_success', username: 'AnnMarie' })
    expect(s.flat()[1]).toEqual({ msg: 'login_cookie', cookie: 'offline:AnnMarie', expires: 3650 })
    const again = setup()
    again.server.receive({ msg: 'token_login', cookie: 'offline:AnnMarie' })
    again.server.receive({ msg: 'play', game_id: 'offline-0.34' })
    await tick()
    expect(again.flat()[0]).toEqual({ msg: 'login_success', username: 'AnnMarie' })
  })

  it('asks for its builds at each Play, so one installed since is the one played', async () => {
    let offered = [{ ...TRUNK, commit: 'old' }]
    let launched: OfflineChannel | null = null
    const s = new OfflineServer({
      channels: async () => offered,
      emit: () => {},
      launch: (c) => ((launched = c), { control: () => {}, keys: () => {}, terminate: () => {} }),
    })
    s.receive({ msg: 'token_login', cookie: '' })
    offered = [{ ...TRUNK, commit: 'new' }]
    s.receive({ msg: 'play', game_id: 'offline-trunk' })
    await tick()
    expect(launched!.commit).toBe('new')
  })

  it('sends its game links again when the builds on offer change, but not over a game', async () => {
    let offered = [STABLE]
    const s = setup(async () => offered)
    s.server.receive({ msg: 'token_login', cookie: '' })
    await tick()
    s.server.channelsChanged()
    await tick()
    offered = [STABLE, TRUNK]
    s.server.channelsChanged()
    await tick()
    const links = s.flat().filter((m) => m.msg === 'set_game_links')
    expect(links).toHaveLength(2)
    expect(String(links[1].content)).toContain('offline-trunk')
  })
})

describe('OfflineServer game', () => {
  it('starts the channel asked for, headless and named for the profile, so crawl skips its main menu, and attaches to it', async () => {
    const s = setup()
    s.server.receive({ msg: 'play', game_id: 'offline-trunk' })
    await tick()
    expect(s.sent.channel).toEqual({ ...TRUNK, saveDir: '/crawl-trunk~kai' })
    expect(s.sent.args).toEqual(['-headless', '-webtiles-socket', 'bridge', '-name', 'Kai'])
    expect(s.sent.control).toEqual([JSON.stringify({ msg: 'attach', primary: true })])
    expect(s.flat()).toEqual([{ msg: 'game_started' }, { msg: 'game_client', version: 'bb22', content: '' }])
  })

  it("keeps each profile's saves in a directory of its own, the default profile's where saves were before profiles", async () => {
    const s = setup()
    s.server.receive({ msg: 'token_login', cookie: 'offline:Sam' })
    s.server.receive({ msg: 'play', game_id: 'offline-0.34' })
    await tick()
    expect(s.sent.channel).toEqual({ ...STABLE, saveDir: '/crawl-0.34~sam' })
    const p = setup()
    p.server.receive({ msg: 'token_login', cookie: 'offline:player' })
    p.server.receive({ msg: 'play', game_id: 'offline-trunk' })
    await tick()
    expect(p.sent.channel.saveDir).toBe('/crawl-trunk')
  })

  it("deletes a profile's saves in every slot, and no one else's", async () => {
    const deleted: string[] = []
    const idb = {
      databases: async () => ['/crawl-0.34', '/crawl-0.34~sam', '/crawl-0.34~samuel', '/crawl-trunk~sam', '/crawl-0.35~kai', 'other'].map((name) => ({ name })),
      deleteDatabase(name: string) {
        deleted.push(name)
        const req = {} as IDBOpenDBRequest
        queueMicrotask(() => req.onsuccess?.({} as Event))
        return req
      },
    } as unknown as IDBFactory
    await deleteProfileSaves('Sam', idb)
    expect(deleted).toEqual(['/crawl-0.34~sam', '/crawl-trunk~sam'])
  })

  it("says in its game links what the profile has saved, as a server's lobby does, from crawl's milestones", async () => {
    const notes = new Map<string, string>()
    const onDisk = new Set<string>()
    const saves: SaveBook = {
      note: (dir, f) => notes.set(dir, saveDesc(f) ?? notes.get(dir) ?? ''),
      info: async (dir) => (onDisk.has(dir) ? (notes.get(dir) ?? null) : null),
    }
    const s = setup([STABLE, TRUNK], saves)
    s.server.receive({ msg: 'token_login', cookie: '' })
    s.server.receive({ msg: 'play', game_id: 'offline-0.34' })
    await tick()
    s.engine().output('*{"msg":"milestone","name":"Kai","lvl":"0","status":"chargen"}\n')
    s.engine().output('*{"msg":"milestone","name":"Kai","xl":"3","race":"Minotaur","cls":"Berserker","god":"Trog","place":"D::2","status":""}\n')
    expect(notes.get('/crawl-0.34~kai')).toBe('Kai, a level 3 Minotaur Berserker of Trog')
    onDisk.add('/crawl-0.34~kai')
    s.engine().output('*{"msg":"exit_reason","type":"saved"}\n')
    s.engine().exit(0)
    await tick()
    let st = initialState()
    for (const m of s.flat()) st = reduce(st, m)
    expect(st.lobby.games).toEqual([
      { id: 'offline-0.34', label: 'DCSS 0.34', save: 'Kai, a level 3 Minotaur Berserker of Trog' },
      { id: 'offline-trunk', label: 'DCSS trunk' },
    ])
    // the character died: crawl took the save file with it
    onDisk.clear()
    s.server.channelsChanged()
    await tick()
    st = reduce(st, s.flat().at(-1)!)
    expect(st.lobby.games[0]).toEqual({ id: 'offline-0.34', label: 'DCSS 0.34' })
  })

  it('refuses a game id it does not have', async () => {
    const s = setup()
    s.server.receive({ msg: 'play', game_id: 'dcss-web-trunk' })
    await tick()
    expect(s.names()).toEqual(['game_ended', 'go_lobby'])
  })

  it('passes lines on as they come, then batches them once crawl asks for flushes', async () => {
    const s = setup()
    s.server.receive({ msg: 'play', game_id: 'offline-0.34' })
    await tick()
    s.out.length = 0
    s.engine().output('*{"msg":"client_path","path":"x"}\n{"msg":"version","text":"v"}\n')
    expect(s.out).toEqual([[{ msg: 'version', text: 'v' }]])
    s.out.length = 0
    // a line split across two flushes, then the flush signal
    s.engine().output('*{"msg":"flush_messages"}\n{"msg":"map","cel')
    s.engine().output('ls":[]}\n{"msg":"player"}\n')
    expect(s.out).toEqual([])
    s.engine().output('*{"msg":"flush_messages"}\n')
    expect(s.out).toEqual([[{ msg: 'map', cells: [] }, { msg: 'player' }]])
  })

  it('writes input to the keys and sends everything else down as a control message', async () => {
    const s = setup()
    s.server.receive({ msg: 'play', game_id: 'offline-0.34' })
    await tick()
    s.server.receive({ msg: 'input', text: 'za' })
    s.server.receive({ msg: 'input', data: [27, 106] })
    s.server.receive({ msg: 'key', keycode: -254 })
    s.server.receive({ msg: 'click_cell', x: 1, y: 2, button: 1 })
    expect(s.sent.keys).toEqual(['za', '\x1bj'])
    expect(s.sent.control.slice(1)).toEqual([
      JSON.stringify({ msg: 'key', keycode: -254 }),
      JSON.stringify({ msg: 'click_cell', x: 1, y: 2, button: 1 }),
    ])
  })

  it('ends with the reason crawl gave, back in the lobby with fresh game links', async () => {
    const s = setup()
    s.server.receive({ msg: 'login', username: 'x', password: 'y' })
    s.server.receive({ msg: 'play', game_id: 'offline-0.34' })
    await tick()
    await tick()
    s.out.length = 0
    s.engine().output('*{"msg":"exit_reason","type":"dead","message":"slain by a jackal"}\n')
    s.engine().exit(0)
    await tick()
    expect(s.flat()).toEqual([
      { msg: 'go_lobby' },
      { msg: 'game_ended', reason: 'dead', message: 'slain by a jackal' },
      expect.objectContaining({ msg: 'set_game_links' }),
    ])
  })

  it('reports an engine that fails to load as an error', async () => {
    const s = setup()
    s.server.receive({ msg: 'play', game_id: 'offline-0.34' })
    await tick()
    s.out.length = 0
    s.engine().error('crawl.wasm: HTTP 404')
    expect(s.flat()).toEqual([{ msg: 'go_lobby' }, { msg: 'game_ended', reason: 'error', message: 'crawl.wasm: HTTP 404' }])
  })

  it('stops a game on go_lobby by saving it first, and terminates once the save has landed', async () => {
    const s = setup()
    s.server.receive({ msg: 'play', game_id: 'offline-0.34' })
    await tick()
    s.out.length = 0
    s.server.receive({ msg: 'go_lobby' })
    expect(s.sent.control.at(-1)).toBe(JSON.stringify({ msg: 'checkpoint' }))
    expect(s.sent.terminated).toBe(false)
    s.engine().output('*{"msg":"checkpoint"}\n')
    await tick()
    expect(s.sent.terminated).toBe(true)
    expect(s.flat()).toEqual([{ msg: 'go_lobby' }, { msg: 'game_ended', reason: 'saved' }])
  })

  it('saves a game in progress on request and keeps it running', async () => {
    const s = setup()
    s.server.checkpoint()
    expect(s.sent.control).toEqual([])
    s.server.receive({ msg: 'play', game_id: 'offline-0.34' })
    await tick()
    s.out.length = 0
    s.server.checkpoint()
    expect(s.sent.control.at(-1)).toBe(JSON.stringify({ msg: 'checkpoint' }))
    s.engine().output('*{"msg":"checkpoint"}\n')
    await tick()
    expect(s.sent.terminated).toBe(false)
    expect(s.flat()).toEqual([])
  })

  it('terminates a stopping engine that never confirms its save', async () => {
    vi.useFakeTimers()
    try {
      const s = setup()
      s.server.receive({ msg: 'play', game_id: 'offline-0.34' })
      await vi.advanceTimersByTimeAsync(0)
      const stopped = s.server.shutdown()
      vi.advanceTimersByTime(3000)
      await stopped
      expect(s.sent.terminated).toBe(true)
      expect(s.flat().at(-1)).toEqual({
        msg: 'game_ended',
        reason: 'error',
        message: 'The game could not be saved before it stopped.',
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
