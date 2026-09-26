import type { ClientMessage, ServerMessage } from '@orbrun/webtiles'
import { DEFAULT_PROFILE, profileSaveDir } from './channels.js'
import type { SaveBook } from './saves.js'

/**
 * What a WebTiles server does around the game, for a game that runs on this
 * device: the lobby's login and game links, and the relay between the client
 * and the engine that ws_handler.py and process_handler.py do.
 *
 * Only the deltas from a server are here. Every account is a profile on this
 * device, so any login succeeds, as the name it gives, and its token lasts
 * ten years; each profile keeps its saves apart (profileSaveDir); nobody else
 * is in the lobby, so there is nothing to watch and no chat; and a game's
 * files never leave the device, so there is no dump URL.
 *
 * Crawl starts with the profile's name, as a server starts it with the
 * account's, which skips crawl's main menu (`name_bypasses_menu`): a profile
 * is one character, which Play resumes if saved and starts if not. The game
 * links carry the save info a server with `show_save_info` shows (SaveBook).
 */

/** One playable engine build (engine/dist/builds/<commit>/), as a game the lobby offers. */
export interface OfflineChannel {
  /** The game id `play` names, e.g. `offline-0.34`, `offline-trunk`. */
  id: string
  /** The name the lobby shows, e.g. `DCSS 0.34`: a version or `trunk`, which the client sorts rows by. */
  label: string
  /** The crawl commit built, which names its files. */
  commit: string
  /** The gamedata version `game_client` announces: a directory under the connection's gamedataBase. */
  gamedata: string
  /** Where this build keeps its saves (engine/wasm/pre.js `saveDir`). */
  saveDir: string
}

/** A running engine, however it runs (a worker in the browser, in-process in tests). */
export interface EngineHandle {
  control(json: string): void
  keys(text: string): void
  terminate(): void
}

export interface EngineEvents {
  output(text: string): void
  exit(code: number): void
  error(message: string): void
}

export type EngineLauncher = (channel: OfflineChannel, args: string[], events: EngineEvents) => EngineHandle

export interface OfflineServerOptions {
  /** The builds on offer, or how to find them: asked again at each Play, so a build installed since is the one played. */
  channels: OfflineChannel[] | (() => Promise<OfflineChannel[]>)
  launch: EngineLauncher
  /** The name a token login with no name in it plays as. */
  username?: string
  /** What the game links say of each profile's saves; none, and they say nothing. */
  saves?: SaveBook
  emit(msgs: ServerMessage[]): void
  onDiagnostic?(text: string, detail?: unknown): void
}

/** How long a stop waits for the engine to confirm its save before it is terminated anyway. */
const STOP_SAVE_MS = 3000

/** A token names its account (`offline:<name>`) and lasts ten years: the account is only ever this device's. */
const TOKEN_PREFIX = 'offline:'
const TOKEN_DAYS = 3650

/**
 * A profile's name, from what the login form was given: what crawl accepts in
 * a name (newgame.cc `validate_player_name`), no longer than a server lets an
 * account be. It names the profile's save directory too, so it is safe there.
 */
export function profileName(name: unknown): string | null {
  const n = typeof name === 'string' ? name.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20) : ''
  return n || null
}

interface Game {
  channel: OfflineChannel
  /** The profile's save directory for the channel (profileSaveDir). */
  saveDir: string
  engine: EngineHandle
  /** Output after the last newline, waiting for the rest of its line. */
  partial: string
  /** Once crawl asks for flushes, lines wait for them (process_handler.py `queue_messages`). */
  queueing: boolean
  pending: ServerMessage[]
  exitReason: { type: string; message?: string } | null
  /** A save commit reached IndexedDB since the last stop was asked for. */
  saved: boolean
  onSaved: (() => void) | null
  ended: boolean
}

export class OfflineServer {
  private game: Game | null = null
  private starting = false
  private loggedIn = false
  private user: string
  /** The game links last sent. */
  private gameLinks: string | null = null

  constructor(private readonly o: OfflineServerOptions) {
    this.user = profileName(o.username) ?? DEFAULT_PROFILE
  }

  private builtChannels(): Promise<OfflineChannel[]> {
    const c = this.o.channels
    return Array.isArray(c) ? Promise.resolve(c) : c().catch(() => [])
  }

  /** The builds on offer may have changed (one finished downloading): the lobby's game links say so, if they differ. */
  channelsChanged() {
    if (this.loggedIn && !this.game) void this.sendGameLinks(true)
  }

  /** The socket opened: the lobby a server greets a connection with, empty. */
  connected() {
    this.o.emit([{ msg: 'lobby_clear' }, { msg: 'lobby_complete' }])
  }

  receive(msg: ClientMessage) {
    const g = this.game
    switch (msg.msg) {
      case 'login':
      case 'token_login': {
        const cookie = typeof msg.cookie === 'string' && msg.cookie.startsWith(TOKEN_PREFIX) ? msg.cookie.slice(TOKEN_PREFIX.length) : null
        this.user = profileName(msg.msg === 'login' ? msg.username : cookie) ?? this.user
        this.loggedIn = true
        this.o.emit([{ msg: 'login_success', username: this.user }])
        void this.sendGameLinks()
        return
      }
      case 'set_login_cookie':
        this.o.emit([{ msg: 'login_cookie', cookie: TOKEN_PREFIX + this.user, expires: TOKEN_DAYS }])
        return
      case 'register':
        this.o.emit([{ msg: 'register_fail', reason: 'Offline play needs no account.' }])
        return
      case 'get_rc':
        this.o.emit([{ msg: 'rcfile_contents', game_id: msg.game_id, contents: '' }])
        return
      case 'play':
        void this.play(String(msg.game_id))
        return
      case 'go_lobby':
        if (g) void this.stop()
        else this.o.emit([{ msg: 'go_lobby' }])
        return
      case 'pong':
      case 'watch':
      case 'chat_msg':
      case 'forget_login_cookie':
      case 'force_terminate':
        return
    }
    if (!g) return
    // process_handler.py handle_input: `input` is written to the pty; every
    // other message goes down the socket as it is
    if (msg.msg === 'input') {
      const data = Array.isArray(msg.data) ? String.fromCharCode(...(msg.data as number[])) : ''
      const text = data + (typeof msg.text === 'string' ? msg.text : '')
      if (text) g.engine.keys(text)
    } else g.engine.control(JSON.stringify(msg))
  }

  /**
   * Save the game in progress where it stands and keep playing: the page may
   * be about to go without a word (a hidden tab a phone discards), which a
   * server's SIGHUP save covers and a tab has nothing for. The engine holds
   * the request until the player has control (tileweb.cc `_maybe_checkpoint`).
   */
  checkpoint() {
    const g = this.game
    if (g && !g.ended) g.engine.control(JSON.stringify({ msg: 'checkpoint' }))
  }

  /** The connection closed: save the game in progress, if any, and end it. */
  shutdown(): Promise<void> {
    return this.game ? this.stop() : Promise.resolve()
  }

  private async play(id: string) {
    if (this.game || this.starting) return
    this.starting = true
    const channel = (await this.builtChannels()).find((c) => c.id === id)
    this.starting = false
    if (this.game) return
    if (!channel) {
      this.o.emit([{ msg: 'game_ended', reason: 'error', message: `No offline game "${id}".` }, { msg: 'go_lobby' }])
      return
    }
    const game: Game = {
      channel,
      saveDir: profileSaveDir(channel.saveDir, this.user),
      engine: null as unknown as EngineHandle,
      partial: '',
      queueing: false,
      pending: [],
      exitReason: null,
      saved: false,
      onSaved: null,
      ended: false,
    }
    this.game = game
    game.engine = this.o.launch({ ...channel, saveDir: game.saveDir }, ['-headless', '-webtiles-socket', 'bridge', '-name', this.user], {
      output: (text) => this.output(game, text),
      exit: (code) => this.ended(game, code),
      error: (message) => {
        game.exitReason = { type: 'error', message }
        this.ended(game, -1)
      },
    })
    // the socket connection a server makes to the new process (connection.py)
    game.engine.control(JSON.stringify({ msg: 'attach', primary: true }))
    // A server sends game_client when crawl names its client_path, which only
    // an installed build does (WEB_DIR_PATH). The channel's gamedata is known
    // before the engine starts, so it goes out now, and the client loads it
    // while the engine boots.
    this.o.emit([{ msg: 'game_started' }, { msg: 'game_client', version: channel.gamedata, content: '' }])
  }

  /** One flush of engine output: process_handler.py `_on_socket_message`, line by line. */
  private output(game: Game, text: string) {
    if (game.ended) return
    const lines = (game.partial + text).split('\n')
    game.partial = lines.pop() ?? ''
    for (const line of lines) {
      if (!line) continue
      let m: ServerMessage
      try {
        m = JSON.parse(line.startsWith('*') ? line.slice(1) : line) as ServerMessage
      } catch {
        this.o.onDiagnostic?.('offline engine sent a line that is not JSON; skipped', line)
        continue
      }
      if (line.startsWith('*')) {
        this.special(game, m)
        continue
      }
      if (game.queueing) game.pending.push(m)
      else this.o.emit([m])
    }
  }

  /** A `*` line: a message to the server, not the client. */
  private special(game: Game, m: ServerMessage) {
    switch (m.msg) {
      case 'flush_messages':
        game.queueing = true
        this.flush(game)
        return
      case 'exit_reason':
        game.exitReason = { type: String(m.type), message: typeof m.message === 'string' ? m.message : undefined }
        return
      case 'checkpoint':
        game.saved = true
        game.onSaved?.()
        return
      case 'milestone':
        this.o.saves?.note(game.saveDir, m)
        return
      case 'client_path':
      case 'ending':
      case 'dump':
        return
    }
    this.o.onDiagnostic?.(`offline engine sent an unknown server message "${m.msg}"`, m)
  }

  private flush(game: Game) {
    if (!game.pending.length) return
    const batch = game.pending
    game.pending = []
    this.o.emit(batch)
  }

  /**
   * Ends the game in progress with its state saved, as a server's SIGHUP
   * does: ask the engine for a checkpoint save, and terminate it once that
   * save has reached IndexedDB (or after STOP_SAVE_MS, whichever is first).
   */
  private stop(): Promise<void> {
    const game = this.game
    if (!game || game.ended) return Promise.resolve()
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer)
        game.onSaved = null
        if (!game.ended) {
          // crawl's own reason is still the "unknown" it starts with: it
          // never exits, it is terminated, so the reason is what the save did
          game.exitReason = game.saved
            ? { type: 'saved' }
            : { type: 'error', message: 'The game could not be saved before it stopped.' }
          game.engine.terminate()
          this.ended(game, 0)
        }
        resolve()
      }
      const timer = setTimeout(done, STOP_SAVE_MS)
      game.saved = false
      game.onSaved = done
      game.engine.control(JSON.stringify({ msg: 'checkpoint' }))
    })
  }

  private ended(game: Game, code: number) {
    if (game.ended) return
    game.ended = true
    this.flush(game)
    if (this.game === game) this.game = null
    const reason = game.exitReason ?? { type: code === 0 ? 'quit' : 'crash' }
    const ended: ServerMessage = { msg: 'game_ended', reason: reason.type }
    if (reason.message) ended.message = reason.message
    this.o.emit([{ msg: 'go_lobby' }, ended])
    if (this.loggedIn) void this.sendGameLinks()
  }

  /**
   * The lobby's "Play now" line (game_links.html): a link per channel, on
   * the save in brackets after its name when the profile has one waiting.
   */
  private async sendGameLinks(onlyChanged = false) {
    const spans = await Promise.all(
      (await this.builtChannels()).map(async (c) => {
        const href = `#play-${encodeURIComponent(c.id)}`
        const save = await this.o.saves?.info(profileSaveDir(c.saveDir, this.user)).catch(() => null)
        return save
          ? `<span>${escapeHtml(c.label)} <span><a href="${href}">[${escapeHtml(save)}]</a></span></span>`
          : `<span><a href="${href}">${escapeHtml(c.label)}</a></span>`
      }),
    )
    const content = spans.join('\n')
    if (onlyChanged && content === this.gameLinks) return
    this.gameLinks = content
    this.o.emit([{ msg: 'set_game_links', content }])
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}
