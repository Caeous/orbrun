import type { ClientMessage, CloseReason, Connection, ServerMessage, TrafficEvent, Unsubscribe } from '@orbrun/webtiles'
import { OfflineServer, type EngineLauncher, type OfflineChannel } from './server.js'
import type { SaveBook } from './saves.js'
import type { FromWorker, ToWorker } from './worker.js'

export interface LocalWasmConnectionOptions {
  /** The builds on offer, or how to find them (@orbrun/offline `EngineStore.channels`). */
  channels: OfflineChannel[] | (() => Promise<OfflineChannel[]>)
  /** Where a build's engine files are (engine/dist/builds/<commit>/, as a URL ending in `/`). */
  engineBase(channel: OfflineChannel): string
  /** The base gamedata is served under, `<base>/gamedata/<version>/` (engine/dist/). */
  gamedataBase: string
  /** The name a token login with no name in it plays as. */
  username?: string
  /** What the game links say of the saves on this device (OfflineServer `saves`). */
  saves?: SaveBook
  /** Runs an engine; a Web Worker per game by default. */
  launch?: EngineLauncher
  onDiagnostic?: (text: string, detail?: unknown) => void
}

/**
 * A WebTiles connection to a game on this device. It behaves as a socket
 * that is always up: it opens on the next tick, never drops, and delivers a
 * server's batches in order, each batch's messages synchronously, like
 * RemoteConnection. Like a socket, it never answers inside `send`: what the
 * server says in reply arrives on a later microtask, after the caller has
 * finished (Session sends `token_login` and then forgets the token it used; a
 * reply delivered inside that send would file the new token first, and the
 * forgetting would take it).
 */
export class LocalWasmConnection implements Connection {
  readonly kind = 'local-wasm' as const
  readonly gamedataBase: string
  open = false
  onTraffic: ((e: TrafficEvent) => void) | null = null

  private server: OfflineServer
  private closed = false
  private messageHandlers = new Set<(msg: ServerMessage) => void>()
  /** Batches the server emitted that have not been delivered yet. */
  private inbox: ServerMessage[][] = []
  private closeHandlers = new Set<(reason: CloseReason) => void>()
  private openHandlers = new Set<() => void>()

  constructor(private readonly o: LocalWasmConnectionOptions) {
    this.gamedataBase = o.gamedataBase
    this.server = this.newServer()
    this.connect()
  }

  send(msg: ClientMessage) {
    if (this.closed) {
      this.o.onDiagnostic?.('send after the offline connection closed; dropped', msg)
      return
    }
    this.onTraffic?.({ dir: 'out', bytes: JSON.stringify(msg).length, msgs: 1, name: msg.msg })
    this.server.receive(msg)
  }

  onMessage(handler: (msg: ServerMessage) => void): Unsubscribe {
    this.messageHandlers.add(handler)
    return () => this.messageHandlers.delete(handler)
  }

  onClose(handler: (reason: CloseReason) => void): Unsubscribe {
    this.closeHandlers.add(handler)
    return () => this.closeHandlers.delete(handler)
  }

  onOpen(handler: () => void): Unsubscribe {
    this.openHandlers.add(handler)
    return () => this.openHandlers.delete(handler)
  }

  /** Closes the connection; a game in progress is saved first (OfflineServer.shutdown). */
  close() {
    if (this.closed) return
    this.closed = true
    this.open = false
    void this.server.shutdown()
    for (const h of this.closeHandlers) h({ code: 1000, reason: '', clean: true })
  }

  /** Saves the game in progress without ending it (OfflineServer.checkpoint). */
  checkpoint() {
    if (!this.closed) this.server.checkpoint()
  }

  /** The builds on offer changed: the lobby's game links are sent again. */
  channelsChanged() {
    if (!this.closed) this.server.channelsChanged()
  }

  reopen() {
    if (!this.closed) return
    this.closed = false
    this.server = this.newServer()
    this.connect()
  }

  private connect() {
    queueMicrotask(() => {
      if (this.closed) return
      this.open = true
      // the server's greeting is on its way before the client's first message, as on a socket
      this.server.connected()
      for (const h of this.openHandlers) h()
    })
  }

  private newServer() {
    return new OfflineServer({
      channels: this.o.channels,
      launch: this.o.launch ?? workerLauncher(this.o.engineBase),
      username: this.o.username,
      saves: this.o.saves,
      emit: (msgs) => this.deliver(msgs),
      onDiagnostic: this.o.onDiagnostic,
    })
  }

  private deliver(msgs: ServerMessage[]) {
    if (this.closed) return
    if (!this.inbox.length) queueMicrotask(() => this.drain())
    this.inbox.push(msgs)
  }

  private drain() {
    while (this.inbox.length && !this.closed) {
      const msgs = this.inbox.shift()!
      this.onTraffic?.({ dir: 'in', bytes: 0, msgs: msgs.length })
      for (const m of msgs) {
        for (const h of this.messageHandlers) {
          try {
            h(m)
          } catch (err) {
            this.o.onDiagnostic?.(`handler threw on "${m.msg}"`, err)
          }
        }
      }
    }
    this.inbox = []
  }
}

/** Runs each game's engine in its own module Web Worker. */
export function workerLauncher(engineBase: (channel: OfflineChannel) => string): EngineLauncher {
  return (channel, args, events) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    const post = (m: ToWorker) => worker.postMessage(m)
    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data
      if (m.type === 'output') events.output(m.text)
      else if (m.type === 'exit') {
        worker.terminate()
        events.exit(m.code)
      } else {
        worker.terminate()
        events.error(m.message)
      }
    }
    worker.onerror = (e) => {
      worker.terminate()
      events.error(e.message || 'the offline engine failed to load')
    }
    post({ type: 'start', base: new URL(engineBase(channel), location.href).href, saveDir: channel.saveDir, args })
    return {
      control: (json) => post({ type: 'control', json }),
      keys: (text) => post({ type: 'keys', text }),
      terminate: () => worker.terminate(),
    }
  }
}
