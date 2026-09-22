import type { ClientMessage, ServerMessage } from './protocol.js'

export type Unsubscribe = () => void
export type CloseReason = { code: number; reason: string; clean: boolean }

/**
 * A frame on the wire, for a profiler in the app (perf.ts there). The
 * connection is the only layer that sees bytes and batches: above it a
 * message has already been unpacked from whatever arrived with it, and a
 * burst of twenty in one frame is indistinguishable from twenty frames.
 */
export interface TrafficEvent {
  dir: 'in' | 'out'
  bytes: number
  /** messages the frame unpacked to; 1 going out */
  msgs: number
  /** the client message's name, going out */
  name?: string
}

export interface Connection {
  readonly kind: 'remote' | 'local-native' | 'local-wasm'
  /** Where tileinfo/enums/atlases are served from, without the version segment. */
  readonly gamedataBase: string
  send(msg: ClientMessage): void
  onMessage(handler: (msg: ServerMessage) => void): Unsubscribe
  onClose(handler: (reason: CloseReason) => void): Unsubscribe
  onOpen(handler: () => void): Unsubscribe
  close(): void
  readonly open: boolean
  /** Set to watch the wire; nothing is measured while it is unset. */
  onTraffic?: ((e: TrafficEvent) => void) | null
}

export interface WebSocketLike {
  binaryType: string
  readyState: number
  send(data: string): void
  close(): void
  onopen: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: { code: number; reason: string; wasClean: boolean }) => void) | null
  onerror: ((ev: unknown) => void) | null
}

export type WebSocketCtor = new (url: string, protocols?: string | string[]) => WebSocketLike

export interface RemoteConnectionOptions {
  url: string
  gamedataBase: string
  WebSocket: WebSocketCtor
  /** Prefer the uncompressed subprotocol. Set false if a server refuses it. */
  noCompression?: boolean
  onDiagnostic?: (text: string, detail?: unknown) => void
}

/**
 * A WebTiles WebSocket connection. Unpacks `{msgs: [...]}` batches in order,
 * answers pings, and delivers every message synchronously to handlers.
 */
export class RemoteConnection implements Connection {
  readonly kind = 'remote' as const
  readonly gamedataBase: string
  private ws: WebSocketLike | null = null
  private messageHandlers = new Set<(msg: ServerMessage) => void>()
  private closeHandlers = new Set<(reason: CloseReason) => void>()
  private openHandlers = new Set<() => void>()
  private decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null
  private opts: RemoteConnectionOptions
  open = false
  /** The socket has closed for good: this class never reconnects, so nothing sent from now on can go out. */
  closed = false
  /** Set by a profiler to watch the wire (perf.ts); unset, nothing is measured. */
  onTraffic: ((e: TrafficEvent) => void) | null = null
  /** What was sent before the socket opened, to go out in order once it has. Only while connecting: a closed socket keeps nothing. */
  private queue: string[] = []

  constructor(opts: RemoteConnectionOptions) {
    this.opts = opts
    this.gamedataBase = opts.gamedataBase
    this.connect()
  }

  private connect() {
    const { url, WebSocket } = this.opts
    const ws = (this.ws =
      this.opts.noCompression === false ? new WebSocket(url) : new WebSocket(url, ['no-compression']))
    ws.binaryType = 'arraybuffer'
    ws.onopen = () => {
      this.open = true
      for (const s of this.queue) ws.send(s)
      this.queue = []
      for (const h of this.openHandlers) h()
    }
    ws.onmessage = (ev) => {
      let text: string
      if (typeof ev.data === 'string') text = ev.data
      else if (ev.data instanceof ArrayBuffer && this.decoder) text = this.decoder.decode(ev.data)
      else {
        this.opts.onDiagnostic?.('binary frame received; compression is not supported', ev.data)
        return
      }
      // the bytes as they arrived, not as they decode: a UTF-8 frame is longer than its characters
      this.dispatchText(text, ev.data instanceof ArrayBuffer ? ev.data.byteLength : text.length)
    }
    ws.onclose = (ev) => {
      this.open = false
      this.closed = true
      // whatever was waiting for the socket to open never will now
      this.queue = []
      for (const h of this.closeHandlers) h({ code: ev.code, reason: ev.reason, clean: ev.wasClean })
    }
    ws.onerror = (ev) => {
      this.opts.onDiagnostic?.('websocket error', ev)
    }
  }

  private dispatchText(text: string, bytes: number) {
    if (!text.startsWith('{')) {
      this.opts.onDiagnostic?.('non-JSON message ignored', text.slice(0, 200))
      return
    }
    let obj: { msgs?: ServerMessage[] } & ServerMessage
    try {
      obj = JSON.parse(text)
    } catch (e) {
      this.opts.onDiagnostic?.('JSON parse error', text.slice(0, 200))
      return
    }
    const msgs: ServerMessage[] = Array.isArray(obj.msgs) ? obj.msgs : [obj]
    // before the handlers run: what arrived is the network's, what they then cost is the frame's
    this.onTraffic?.({ dir: 'in', bytes, msgs: msgs.length })
    for (const m of msgs) this.dispatch(m)
  }

  private dispatch(m: ServerMessage) {
    if (m.msg === 'ping') {
      this.send({ msg: 'pong' })
      return
    }
    for (const h of this.messageHandlers) {
      try {
        h(m)
      } catch (e) {
        this.opts.onDiagnostic?.('handler error for ' + m.msg, e)
      }
    }
  }

  send(msg: ClientMessage): void {
    const s = JSON.stringify(msg)
    this.onTraffic?.({ dir: 'out', bytes: s.length, msgs: 1, name: msg.msg })
    if (this.ws && this.open && this.ws.readyState === 1) this.ws.send(s)
    else if (this.closed) this.opts.onDiagnostic?.('message dropped: the connection is closed', msg.msg)
    else this.queue.push(s)
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

  close(): void {
    this.ws?.close()
  }
}

