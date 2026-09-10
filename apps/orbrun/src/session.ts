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
  readonly conn: Connection
  state: GameState = initialState()
  gamedata: Gamedata | null = null
  scene: Scene = emptyScene()
  private listeners = new Set<(e: SessionEvent) => void>()
  private queue: ServerMessage[] = []
  private loadingVersion: string | null = null
  /** A gamedata fetch is in flight; a `gamedata` event with `ready` or `error` ends it. */
  get loading(): boolean {
    return this.loadingVersion !== null
  }
  private sceneDirty = false
  private lastSceneRev = { map: -1, player: -1, ui: -1 }
  diagnostics: string[] = []
  closed = false

  constructor(server: ServerInfo, username: string | null = null) {
    this.server = server
    this.username = username
    this.conn = new RemoteConnection({
      url: server.ws,
      gamedataBase: gamedataBaseFor(server),
      WebSocket: window.WebSocket as never,
      onDiagnostic: (t, d) => this.diag(t + (d ? ' ' + safeString(d) : '')),
    })
    this.conn.onMessage((m) => this.handle(m))
    this.conn.onOpen(() => {
      const token = username ? getToken(server.id, username) : null
      if (token) this.send(cm.tokenLogin(token))
      this.emit({ type: 'open' })
    })
    this.conn.onClose((r) => {
      this.closed = true
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
    this.conn.close()
  }

  private handle(m: ServerMessage) {
    if (m.msg === 'login_success') {
      // the name the server answered with: an account just added had none on this connection until now
      this.username = (m.username as string) || this.username
      // ask for a token so we never store the password
      this.send(cm.setLoginCookie())
    }
    if (m.msg === 'login_cookie') {
      // filed under the name the server answered `login_success` with (the account's, as the server spells it)
      const who = this.state.lobby.username || this.username
      if (who) setToken(this.server.id, who, m.cookie as string)
    }
    if (m.msg === 'login_fail' && this.username) {
      // a stale token: drop it
      setToken(this.server.id, this.username, null)
    }
    if (m.msg === 'game_client') {
      reduce(this.state, m)
      this.emit({ type: 'state', msg: m })
      const version = m.version as string
      if (!this.gamedata || this.gamedata.version !== version) this.startLoad(version)
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
    this.loadingVersion = version
    this.emit({ type: 'gamedata', status: 'loading', done: 0, total: 1 })
    try {
      const gd = await loadGamedata({
        base: this.conn.gamedataBase,
        version,
        io: browserIo(),
        onProgress: (done, total, what) => this.emit({ type: 'gamedata', status: 'loading', detail: what, done, total }),
      })
      this.gamedata = gd
      this.emit({ type: 'gamedata', status: 'ready' })
    } catch (e) {
      this.diag('gamedata load failed: ' + safeString(e))
      this.emit({ type: 'gamedata', status: 'error', detail: safeString(e) })
    } finally {
      this.loadingVersion = null
      const q = this.queue
      this.queue = []
      for (const m of q) this.apply(m)
      this.flushScene()
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
    this.scene = buildScene(this.state, this.gamedata, { previous: this.scene })
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
