import type { ClientMessage, ServerMessage } from './protocol.js'

export type Unsubscribe = () => void
export type CloseReason = { code: number; reason: string; clean: boolean }

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
      this.dispatchText(text)
    }
    ws.onclose = (ev) => {
      this.open = false
      for (const h of this.closeHandlers) h({ code: ev.code, reason: ev.reason, clean: ev.wasClean })
    }
    ws.onerror = (ev) => {
      this.opts.onDiagnostic?.('websocket error', ev)
    }
  }

  private dispatchText(text: string) {
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
    if (this.ws && this.open && this.ws.readyState === 1) this.ws.send(s)
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

