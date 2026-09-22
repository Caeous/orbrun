/**
 * Getting a game back after its connection went: a device that slept, a
 * network that dropped, a server that restarted, or a game Orbrun closed
 * itself because the player had walked away.
 *
 * What the server does decides the shape of it. A WebTiles server stops, and
 * so saves, the game whose socket closes (ws_handler.py `on_close`), so there
 * is never a game to reattach to: coming back is always a new socket, a
 * login, and `play` again, which starts the game from its save. How long that
 * takes depends on whether the server has noticed the old socket is gone:
 *
 * - closed cleanly, the game is free and `play` is back in the dungeon in
 *   about a second and a half (measured on CDI, 2026-09-22);
 * - left open by a device that slept, the server only finds out through its
 *   own `ping`, sent every `connection_timeout` (10 minutes) and given as long
 *   again to be answered — CDI dropped a silent socket after 19.9 minutes.
 *   Until then the old game holds its lock, and `play` makes the server stop
 *   it first: `stale_processes`, a fixed 10 s wait, a SIGHUP
 *   (process_handler.py `_purge_locks_and_start`), and `force_terminate?` if
 *   that did not take — 12.5 s on CDI.
 *
 * Hence what is done here: the game is closed cleanly whenever Orbrun can see
 * the player has stopped (idle at the command prompt), a socket that may have
 * outlived a sleep is asked before it is given up on (main.ts `suspect`), the
 * server's own wait is shown as the countdown it is, and nobody's game is
 * taken over without asking: `play` on a game that is being played elsewhere
 * stops that one, so it is only sent on the player's word.
 *
 * This is the state and its timing only. main.ts wires it to the session and
 * the game screen draws it (game.ts `drawRelink`).
 */

export type RelinkPhase =
  /** connected, or nothing to get back */
  | { kind: 'live' }
  /** after a sleep or a network change: whether the socket is still there is being asked */
  | { kind: 'checking' }
  /** closed on purpose while the player was away: the next press brings the game back */
  | { kind: 'paused' }
  /** before the next try: `at` is when it goes, null while the page is hidden or the network is down */
  | { kind: 'waiting'; at: number | null; offline: boolean }
  /** a socket opening, a login, a `play` sent: until the game has been drawn again */
  | { kind: 'connecting' }
  /** the server stopping the old game first (`stale_processes`): its wait ends at `until` */
  | { kind: 'stale'; until: number }
  /** the old game would not stop, and the server asks whether to kill it (`force_terminate?`) */
  | { kind: 'force' }
  /** the game is being played somewhere else: `play` would take it over, so the player is asked */
  | { kind: 'elsewhere' }
  /** the server stayed out of reach for every try */
  | { kind: 'failed' }

/** What the player did on the veil: the confirming button (A, Enter), the backing-out one (B, Esc), or any other. */
export type RelinkInput = 'confirm' | 'cancel' | 'other'

export interface RelinkDeps {
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(t: unknown): void
  /** the page is hidden: no try is made from a tab nobody is looking at */
  hidden(): boolean
  online(): boolean
  /** open the socket again (it logs in on its own) */
  connect(): void
  /** whether the socket is up now */
  open(): boolean
  /** whether it has closed (not merely not open yet: a socket still being made is neither) */
  closed(): boolean
  /** send what puts the player back: `play` for the address bar's game, `watch` for its spectate */
  resume(): void
  /** close the socket, which saves the game */
  close(): void
  /** answer the server's `force_terminate?` */
  forceTerminate(yes: boolean): void
  /** give up on the game: the front end */
  home(): void
}

/** The wait before each try after the first, which goes at once. The last is repeated until TRIES are spent. */
export const BACKOFF_MS = [1000, 2000, 4000, 8000, 15_000, 30_000]
/** tries before giving up and asking; with BACKOFF_MS about two minutes of trying */
export const TRIES = 8
/** a socket that has not opened and logged in by then is taken for lost, and the next try goes */
export const CONNECT_MS = 20_000
/** from `play` to the game drawn; past this the try is given up and the next goes */
export const PLAY_MS = 30_000
/** added to the server's announced stale wait: after its SIGHUP it polls the old process for up to 10 s more */
export const STALE_MARGIN_MS = 20_000

export class Relink {
  phase: RelinkPhase = { kind: 'live' }
  /** tries made since the game was last drawn */
  tries = 0
  private deps: RelinkDeps
  private timer: unknown = null
  /** a second's tick while a countdown is on screen */
  private ticker: unknown = null
  private listeners = new Set<() => void>()

  constructor(deps: RelinkDeps) {
    this.deps = deps
  }

  on(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Anything but live: the game screen is veiled and its input comes here. */
  get busy(): boolean {
    return this.phase.kind !== 'live'
  }

  /** Between a try and the game drawn: what the server says now belongs to the try. */
  get resuming(): boolean {
    const k = this.phase.kind
    return k === 'connecting' || k === 'stale' || k === 'force' || k === 'elsewhere'
  }

  /** The socket is being asked whether it survived (main.ts `suspect`). Only from live: anything else already knows. */
  checking() {
    if (this.phase.kind === 'live') this.set({ kind: 'checking' })
  }

  /** It answered: carry on. It did not: the close that follows says `dropped`. */
  checked(ok: boolean) {
    if (ok && this.phase.kind === 'checking') this.set({ kind: 'live' })
  }

  /** The player has been away: close the game cleanly now, so the server is not left holding it (main.ts `idle`). */
  pause() {
    if (this.phase.kind !== 'live') return
    this.set({ kind: 'paused' })
    this.deps.close()
  }

  /** The socket closed under a game. A pause stays paused; anything else tries again. */
  dropped() {
    if (this.phase.kind === 'paused') return
    this.schedule()
  }

  /** The page is visible again, or the network is back: a try that was waiting on it goes now. */
  wake() {
    const p = this.phase
    if (p.kind === 'waiting' || (p.kind === 'failed' && this.deps.online())) {
      this.tries = 0
      this.attempt()
    }
  }

  /**
   * Logged in (a `play`) or open (a `watch`) on a try: send it, unless the
   * game is being played elsewhere, in which case the player says whether to
   * take it over.
   */
  ready(elsewhere: boolean) {
    if (this.phase.kind !== 'connecting') return
    if (elsewhere) {
      this.clearTimer()
      this.set({ kind: 'elsewhere' })
      return
    }
    this.deps.resume()
    this.arm(PLAY_MS)
  }

  /** `stale_processes`: the server is stopping the old game, and says how long it waits before it does. */
  stale(timeoutS: number) {
    if (!this.resuming) return
    const wait = (Number.isFinite(timeoutS) && timeoutS > 0 ? timeoutS : 10) * 1000
    this.set({ kind: 'stale', until: this.deps.now() + wait })
    this.arm(wait + STALE_MARGIN_MS)
  }

  /** `force_terminate?`: the old game would not stop. The server waits for an answer, so no deadline. */
  force() {
    if (!this.resuming) return
    this.clearTimer()
    this.set({ kind: 'force' })
  }

  /** The game is drawn again: done. */
  drawn() {
    if (this.phase.kind === 'live') return
    this.tries = 0
    this.clearTimer()
    this.set({ kind: 'live' })
  }

  /** Out of the game some other way (the server's `go_lobby`, a refused login, the player leaving): nothing to get back. */
  reset() {
    this.tries = 0
    this.clearTimer()
    if (this.phase.kind !== 'live') this.set({ kind: 'live' })
  }

  /** The player pressed something while the veil was up. Answers whether it was taken (always, while busy). */
  input(i: RelinkInput): boolean {
    const p = this.phase
    switch (p.kind) {
      case 'live':
        return false
      case 'checking':
        // a few tens of milliseconds: nothing to do but let it finish
        return true
      case 'paused':
        if (i === 'cancel') this.giveUp()
        else {
          this.tries = 0
          this.attempt()
        }
        return true
      case 'waiting':
      case 'failed':
        if (i === 'cancel') this.giveUp()
        else if (i === 'confirm') {
          this.tries = 0
          this.attempt()
        }
        return true
      case 'connecting':
      case 'stale':
        if (i === 'cancel') this.giveUp()
        return true
      case 'force':
        // no: the server keeps the old game and sends the lobby (process_handler.py `_do_force_terminate`)
        if (i === 'confirm' || i === 'cancel') {
          this.deps.forceTerminate(i === 'confirm')
          if (i === 'confirm') {
            this.set({ kind: 'connecting' })
            this.arm(PLAY_MS)
          }
        }
        return true
      case 'elsewhere':
        if (i === 'cancel') this.giveUp()
        else if (i === 'confirm') {
          this.set({ kind: 'connecting' })
          if (this.deps.open()) {
            this.deps.resume()
            this.arm(PLAY_MS)
          } else {
            this.tries = 0
            this.attempt()
          }
        }
        return true
    }
  }

  private giveUp() {
    this.reset()
    this.deps.home()
  }

  private schedule() {
    this.clearTimer()
    if (this.tries >= TRIES) {
      this.set({ kind: 'failed' })
      return
    }
    // no try from a hidden page, or with no network: `wake` makes it the moment either comes back
    const offline = !this.deps.online()
    if (this.deps.hidden() || offline) {
      this.set({ kind: 'waiting', at: null, offline })
      return
    }
    const wait = this.tries === 0 ? 0 : BACKOFF_MS[Math.min(this.tries - 1, BACKOFF_MS.length - 1)]
    if (wait === 0) {
      this.attempt()
      return
    }
    this.set({ kind: 'waiting', at: this.deps.now() + wait, offline: false })
    this.timer = this.deps.setTimeout(() => {
      this.timer = null
      this.attempt()
    }, wait)
  }

  private attempt() {
    this.clearTimer()
    this.tries++
    this.set({ kind: 'connecting' })
    this.arm(CONNECT_MS)
    if (this.deps.open()) this.deps.resume()
    else this.deps.connect()
  }

  /** A deadline on the try in hand: past it the socket is closed, and the close brings the next try. */
  private arm(ms: number) {
    this.clearTimer()
    this.timer = this.deps.setTimeout(() => {
      this.timer = null
      if (!this.resuming) return
      // a socket still up, or still being made, is closed, and its close brings the next try; one already gone cannot
      if (this.deps.closed()) this.schedule()
      else this.deps.close()
    }, ms)
  }

  private clearTimer() {
    if (this.timer !== null) this.deps.clearTimeout(this.timer)
    this.timer = null
  }

  private set(p: RelinkPhase) {
    this.phase = p
    // the countdowns on screen move each second
    const counting = (p.kind === 'waiting' && p.at !== null) || p.kind === 'stale'
    if (counting && this.ticker === null) this.tick()
    for (const l of this.listeners) l()
  }

  private tick() {
    this.ticker = this.deps.setTimeout(() => {
      this.ticker = null
      const p = this.phase
      if ((p.kind === 'waiting' && p.at !== null) || p.kind === 'stale') {
        for (const l of this.listeners) l()
        this.tick()
      }
    }, 1000)
  }
}

/** What `playedElsewhere` reads of a lobby entry (webtiles `LobbyEntry`). */
export interface PlayedEntry {
  username: string
  game_id?: string
  idle_time?: number
}

/**
 * Whether `me`'s game `gameId` is being played somewhere else: the lobby
 * lists it, and it has been played since this connection last heard from it
 * (`lastGameAt`, Session). The lobby's `idle_time` counts from the game's
 * last output (process_handler.py `note_activity`), in whole seconds and as
 * 0 until it has been idle for 30 (`is_idle`); this connection's own game,
 * held by a socket that slept, last spoke when this connection last heard
 * it. A `play` now would stop the other one (`_purge_locks_and_start`), so
 * the player is asked first.
 */
export function playedElsewhere(entries: Iterable<PlayedEntry>, me: string, gameId: string, lastGameAt: number, now: number): boolean {
  for (const e of entries) {
    if (e.username !== me || e.game_id !== gameId) continue
    const idle = (e.idle_time ?? 0) * 1000
    // the latest the game is sure to have been played: an idle of 0 says only "within the last 30 s"
    const playedBy = now - (idle > 0 ? idle : 30_000)
    // a few seconds' grace for the time between the game speaking and this connection hearing it
    return playedBy > lastGameAt + 5000
  }
  return false
}
