import {
  RemoteConnection,
  initialState,
  reduce,
  cm,
  type ClientMessage,
  type Connection,
  type GameState,
  type ServerMessage,
} from '@orbrun/webtiles'
import { loadGamedata, browserIo, type Gamedata } from '@orbrun/gamedata'
import { buildScene } from '@orbrun/scene-webtiles'
import { emptyScene, type Scene } from '@orbrun/scene'
import { LocalWasmConnection, browserSaveBook } from '@orbrun/offline'
import { engines } from './engines'
import type { ServerInfo } from './servers'
import { gamedataBaseFor, getToken, setToken } from './servers'

/**
 * A close with no reason of its own, in words (RFC 6455 §7.4.1): the server
 * ends a socket with 1000 or 1001 when it stops or the player leaves, the
 * browser reports 1005 when the close frame carried no status and 1006 when
 * there was no close frame at all (the network went, or the server did).
 */
function closeWord(code: number): string {
  switch (code) {
    case 1000: return 'closed by the server'
    case 1001: return 'the server went away'
    case 1005: return 'closed without a reason'
    case 1006: return 'the connection dropped'
    case 1011: return 'the server hit an error'
    case 1012: return 'the server is restarting'
    case 1013: return 'the server is busy'
    default: return `code ${code}`
  }
}

export type SessionEvent =
  | { type: 'state'; msg: ServerMessage }
  | { type: 'scene'; scene: Scene }
  | { type: 'gamedata'; status: 'loading' | 'ready' | 'error'; detail?: string; done?: number; total?: number }
  | { type: 'closed'; reason: string }
  | { type: 'open' }
  | { type: 'sent'; msg: ClientMessage }

/**
 * One connection to one server: owns the state, gamedata loading (with the
 * message queue while loading), and scene rebuilding. Emits coarse events.
 */
export class Session {
  readonly server: ServerInfo
  /**
   * The account this connection is for: its token logs in when the socket
   * opens. None while an account is being added, until the login says who
   * (`login_success`), from which point the connection is that account's, so
   * the account's lobby follows this one instead of opening a second.
   */
  username: string | null
  /**
   * A token login is out and not yet answered. The token is forgotten as it is sent, so without this the
   * moment between would read as nobody logged in and nothing to log in with.
   */
  loggingIn = false
  readonly conn: Connection
  state: GameState = initialState()
  gamedata: Gamedata | null = null
  scene: Scene = emptyScene()
  private listeners = new Set<(e: SessionEvent) => void>()
  private queue: ServerMessage[] = []
  private loadingVersion: string | null = null
  /** Counts gamedata loads started; a load that is no longer the latest, or whose session closed, publishes nothing. */
  private loadGeneration = 0
  /** Ends the gamedata load in flight: pulled when a newer version supersedes it or the session closes, so it stops fetching and decoding too. */
  private loadAbort: AbortController | null = null
  /**
   * A load that makes no progress for this long is given up as stalled. The messages the load holds back
   * (`queue`) are every one the game sends meanwhile, and none can be dropped (a map delta left out is a
   * level drawn wrong), so the queue is bounded in time instead: a fetch the browser would let hang for
   * minutes ends here, the error reaches the screen, and the queue drains.
   */
  static readonly LOAD_STALL_MS = 30_000
  /** A gamedata fetch is in flight; a `gamedata` event with `ready` or `error` ends it. */
  get loading(): boolean {
    return this.loadingVersion !== null
  }
  private sceneDirty = false
  private lastSceneRev = { map: -1, player: -1, ui: -1 }
  diagnostics: string[] = []
  closed = false
  private unwatchEngines: (() => void) | null = null
  /** a `probe` waiting on its answer */
  private probing: { resolve: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> } | null = null

  constructor(server: ServerInfo, username: string | null = null) {
    this.server = server
    this.username = username
    const onDiagnostic = (t: string, d?: unknown) => this.diag(t + (d ? ' ' + safeString(d) : ''))
    this.conn = server.offline
      ? new LocalWasmConnection({
          channels: () => engines.channels(),
          engineBase: (c) => engines.engineBase(c),
          gamedataBase: gamedataBaseFor(server),
          saves: browserSaveBook(),
          onDiagnostic,
        })
      : new RemoteConnection({
          url: server.ws,
          gamedataBase: gamedataBaseFor(server),
          WebSocket: window.WebSocket as never,
          onDiagnostic,
        })
    this.conn.onMessage((m) => this.handle(m))
    // a build that finished downloading is a game the lobby offers
    if (this.conn instanceof LocalWasmConnection) {
      const conn = this.conn
      this.unwatchEngines = engines.onChange(() => conn.channelsChanged())
    }
    this.conn.onOpen(() => {
      // the account as it stands now, not as the session was made: a connection reopened after a drop logs in as
      // whoever this one turned out to be
      const who = this.username
      // the offline server takes any login: its token is just the name (@orbrun/offline), so none need be stored
      const token = who ? (server.offline ? 'offline:' + who : getToken(server.id, who)) : null
      if (token) {
        this.send(cm.tokenLogin(token))
        this.loggingIn = true
        // the server forgets a token as it is used (ws_handler.py `token_login`), so it is forgotten here too, as
        // client.js `start_login` does; `login_cookie` brings the next one
        setToken(server.id, who!, null)
      }
      this.emit({ type: 'open' })
    })
    this.conn.onClose((r) => {
      this.closed = true
      this.loggingIn = false
      this.endProbe(false)
      // a load for a connection that is gone: stop it, and let the messages it was holding go with it
      this.loadAbort?.abort()
      this.loadAbort = null
      this.loadingVersion = null
      this.queue = []
      this.emit({ type: 'closed', reason: r.reason || closeWord(r.code) })
    })
  }

  on(fn: (e: SessionEvent) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(e: SessionEvent) {
    for (const l of this.listeners) {
      try {
        l(e)
      } catch (err) {
        this.diag('listener error: ' + safeString(err))
      }
    }
  }

  diag(text: string) {
    this.diagnostics.push(text)
    if (this.diagnostics.length > 100) this.diagnostics.shift()
  }

  send(msg: ClientMessage) {
    this.conn.send(msg)
    this.emit({ type: 'sent', msg })
  }

  close() {
    this.unwatchEngines?.()
    this.conn.close()
  }

  /**
   * Open the connection again after it dropped, as this same session: the
   * account is the same and every screen following it stays attached, so a
   * drop can be ridden out in place rather than by starting over. The game is
   * not carried over — a WebTiles server stops the game whose socket went,
   * which saves it (ws_handler.py `on_close`) — so the state starts blank and
   * the caller says what to do once the socket is up (a `play` on the same
   * game picks the save up). The gamedata is kept: the same server on the same
   * version wants the same tiles. Answers whether anything was reopened;
   * nothing is while the connection is still up.
   */
  reconnect(): boolean {
    if (!this.closed || !this.conn.reopen) return false
    this.state = initialState()
    this.scene = emptyScene()
    this.lastSceneRev = { map: -1, player: -1, ui: -1 }
    this.sceneDirty = false
    this.queue = []
    this.closed = false
    this.conn.reopen()
    return true
  }

  /**
   * Ask the server something only a live socket can answer, and say whether
   * it did within `ms`. `get_rc` is answered by the socket's own handler,
   * game or no game (ws_handler.py `message_handlers`), without the game ever
   * seeing it, so it tells a socket that outlived a sleep from one the
   * browser has not yet noticed is gone. It needs a login (the rc file is the
   * account's) and a game id the server knows; with either missing, or no
   * socket, the answer is no at once.
   */
  probe(gameId: string | null, ms: number): Promise<boolean> {
    if (this.probing) {
      // one already out: the same answer does for both
      const first = this.probing
      return new Promise((resolve) => {
        const was = first.resolve
        first.resolve = (ok) => {
          was(ok)
          resolve(ok)
        }
      })
    }
    if (!this.conn.open || !this.state.lobby.username || !gameId) return Promise.resolve(false)
    return new Promise((resolve) => {
      this.probing = { resolve, timer: setTimeout(() => this.endProbe(false), ms) }
      this.send(cm.getRc(gameId))
    })
  }

  private endProbe(ok: boolean) {
    const p = this.probing
    if (!p) return
    this.probing = null
    clearTimeout(p.timer)
    p.resolve(ok)
  }

  private handle(m: ServerMessage) {
    // a probe's answer is the probe's: nothing else asked for the rc file, and a load in progress must not hold it
    if (m.msg === 'rcfile_contents' && this.probing) {
      this.endProbe(true)
      return
    }
    if (m.msg === 'login_success' || m.msg === 'login_fail') this.loggingIn = false
    if (m.msg === 'login_success') {
      // the name the server answered with: an account just added had none on this connection until now
      this.username = (m.username as string) || this.username
      // ask for a token so we never store the password
      this.send(cm.setLoginCookie())
    }
    if (m.msg === 'login_cookie') {
      // filed under the name the server answered `login_success` with (the account's, as the server spells it)
      const who = this.state.lobby.username || this.username
      if (who) setToken(this.server.id, who, m.cookie as string, m.expires as number)
    }
    if (m.msg === 'login_fail' && this.username) {
      // a stale token: drop it
      setToken(this.server.id, this.username, null)
    }
    if (m.msg === 'logout') {
      // the server ended the login (an account disabled mid-session, ws_handler.py `send_message("logout")`):
      // its token is no good now, as client.js `handle_logout` treats its cookie
      const who = this.state.lobby.username || this.username
      if (who) setToken(this.server.id, who, null)
    }
    if (m.msg === 'game_client') {
      reduce(this.state, m)
      this.emit({ type: 'state', msg: m })
      const version = m.version as string
      // a new game on the version already loaded, or already loading, needs no fetch
      if ((!this.gamedata || this.gamedata.version !== version) && this.loadingVersion !== version) this.startLoad(version)
      return
    }
    if (this.loadingVersion) {
      this.queue.push(m)
      return
    }
    this.apply(m)
  }

  private apply(m: ServerMessage) {
    reduce(this.state, m)
    if (m.msg === 'map' || m.msg === 'player' || m.msg === 'game_client' || m.msg === 'go_lobby') this.sceneDirty = true
    this.emit({ type: 'state', msg: m })
  }

  private async startLoad(version: string) {
    const gen = ++this.loadGeneration
    // a load this one supersedes is stopped where it is: the queue it was holding is this one's now
    this.loadAbort?.abort()
    const abort = (this.loadAbort = new AbortController())
    let stall: ReturnType<typeof setTimeout> | undefined
    const watch = () => {
      clearTimeout(stall)
      stall = setTimeout(() => abort.abort(new Error(`no progress in ${Session.LOAD_STALL_MS / 1000}s`)), Session.LOAD_STALL_MS)
    }
    watch()
    this.loadingVersion = version
    this.emit({ type: 'gamedata', status: 'loading', done: 0, total: 1 })
    const current = () => gen === this.loadGeneration && !this.closed
    try {
      const gd = await loadGamedata({
        base: this.conn.gamedataBase,
        version,
        io: browserIo(),
        signal: abort.signal,
        onProgress: (done, total, what) => {
          watch()
          if (current()) this.emit({ type: 'gamedata', status: 'loading', detail: what, done, total })
        },
      })
      if (!current()) {
        // landed anyway (the abort came after the last byte): nobody will draw with it
        gd.dispose()
        return
      }
      this.gamedata = gd
      this.emit({ type: 'gamedata', status: 'ready' })
    } catch (e) {
      if (!current()) return
      this.diag('gamedata load failed: ' + safeString(e))
      this.emit({ type: 'gamedata', status: 'error', detail: safeString(e) })
    } finally {
      clearTimeout(stall)
      if (current()) {
        this.loadAbort = null
        this.loadingVersion = null
        const q = this.queue
        this.queue = []
        for (const m of q) this.apply(m)
        this.flushScene()
      }
    }
  }

  /** Rebuild the scene if anything relevant changed. Call once per frame. */
  flushScene(): boolean {
    if (!this.sceneDirty) return false
    this.sceneDirty = false
    if (!this.gamedata) return false
    const r = this.state.rev
    if (r.map === this.lastSceneRev.map && r.player === this.lastSceneRev.player) return false
    this.lastSceneRev = { map: r.map, player: r.player, ui: r.ui }
    // only the cells the messages touched are built again; the rest of the level stands as it was
    this.scene = buildScene(this.state, this.gamedata, { previous: this.scene, dirty: { cells: this.state.dirtyCells, mapCleared: this.state.mapCleared } })
    this.state.dirtyCells.clear()
    this.state.mapCleared = false
    this.emit({ type: 'scene', scene: this.scene })
    return true
  }

  get playing(): boolean {
    return this.state.phase === 'playing'
  }
  get watching(): boolean {
    return this.state.phase === 'watching' || !!this.state.watching
  }
}

function safeString(x: unknown): string {
  if (x instanceof Error) return x.message
  try {
    return typeof x === 'string' ? x : JSON.stringify(x)
  } catch {
    return String(x)
  }
}
