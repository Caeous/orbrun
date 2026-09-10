#!/usr/bin/env node
/**
 * Menu collector: spectates players on a WebTiles server in turn and writes
 * every menu they open, from its `menu` message to the `close_menu`, as a
 * fixture (apps/orbrun/test/fixtures/menus/<tag>-<n>.json). The menu tests
 * pin the rooms they draw to these.
 *
 *   node tools/record/menus.mjs wss://crawl.dcss.io/socket <minutes> <outdir> [secs per player] [per tag]
 *
 * A menu instance is the `menu` message that opened it and every message
 * the server sent while it was open (`update_menu`, `update_menu_items`,
 * `menu_scroll`, `txt`, ...), ending with the `close_menu` or
 * `close_all_menus`, so a test can replay it through the reducer as the
 * client saw it. Nested menus (a describe popup over the inventory) are
 * kept inside the outer instance.
 */
import fs from 'node:fs'
import path from 'node:path'

const url = process.argv[2] || 'wss://crawl.dcss.io/socket'
const minutes = Number(process.argv[3] || 30)
const outdir = process.argv[4] || 'menus'
const perPlayer = Number(process.argv[5] || 120) * 1000
const perTag = Number(process.argv[6] || 3)
fs.mkdirSync(outdir, { recursive: true })

const entries = []
const seen = new Set()
const counts = new Map()
let watching = null
let hopTimer = 0
let quietTimer = 0
/** open menu instances, innermost last */
let open = []
let version = ''

function tagOf(m) {
  return `${m.type || 'menu'}${m.tag ? '-' + m.tag : ''}`.replace(/[^A-Za-z0-9_-]+/g, '_')
}

function write(inst) {
  const n = (counts.get(inst.tag) || 0) + 1
  if (n > perTag) return
  counts.set(inst.tag, n)
  const file = path.join(outdir, `${inst.tag}-${n}.json`)
  fs.writeFileSync(file, JSON.stringify({ server: url, version, player: inst.player, tag: inst.tag, msgs: inst.msgs }, null, 1))
  console.log(`wrote ${file} (${inst.msgs.length} msgs, title ${JSON.stringify(inst.msgs[0]?.title?.text || '')})`)
}

function closeAll(reason) {
  while (open.length) {
    const inst = open.pop()
    inst.msgs.push({ msg: 'close_menu', _reason: reason })
    write(inst)
  }
}

function hop() {
  clearTimeout(hopTimer)
  clearTimeout(quietTimer)
  closeAll('hop')
  const awake = entries.filter((e) => e.username && (e.idle_time || 0) < 240 && !seen.has(e.username))
  awake.sort((a, b) => (a.idle_time || 0) - (b.idle_time || 0))
  const e = awake[0]
  if (!e) {
    console.log('nobody new to watch; resetting')
    seen.clear()
    watching = null
    ws.send(JSON.stringify({ msg: 'go_lobby' }))
    return
  }
  seen.add(e.username)
  watching = e.username
  console.log(new Date().toISOString(), 'watching', e.username, e.game_id, e.place)
  ws.send(JSON.stringify({ msg: 'watch', username: e.username }))
  hopTimer = setTimeout(() => ws.send(JSON.stringify({ msg: 'go_lobby' })), perPlayer)
}

function handle(m) {
  if (m.msg === 'ping') ws.send(JSON.stringify({ msg: 'pong' }))
  if (m.msg === 'version') version = m.text || ''
  if (m.msg === 'lobby_entry') {
    const i = entries.findIndex((e) => e.id === m.id)
    if (i >= 0) entries[i] = m
    else entries.push(m)
  }
  if (m.msg === 'lobby_remove') {
    const i = entries.findIndex((e) => e.id === m.id)
    if (i >= 0) entries.splice(i, 1)
  }
  if (m.msg === 'lobby_complete' && !watching) hop()
  if (m.msg === 'go_lobby') {
    closeAll('go_lobby')
    watching = null
    setTimeout(hop, 800)
  }
  if (!watching) return
  // a player who sends nothing for a while is idle: move on
  clearTimeout(quietTimer)
  quietTimer = setTimeout(() => ws.send(JSON.stringify({ msg: 'go_lobby' })), 45000)
  if (m.msg === 'menu') {
    if (m.replace && open.length) {
      open[open.length - 1].msgs.push(m)
      return
    }
    const inst = { tag: tagOf(m), player: watching, msgs: [m] }
    open.push(inst)
    console.log(new Date().toISOString(), 'menu', inst.tag, JSON.stringify(m.title?.text || '').slice(0, 60), 'items', m.total_items ?? m.items?.length)
    // nested: the outer instance sees the inner menu's messages too
    for (const o of open) if (o !== inst) o.msgs.push(m)
    return
  }
  if (!open.length) return
  for (const o of open) o.msgs.push(m)
  if (m.msg === 'close_menu') write(open.pop())
  if (m.msg === 'close_all_menus') closeAll('close_all_menus')
}

let ending = false

/** CDI drops spectators every so often (close 1006): reconnect and go on until the time is up */
function connect() {
  const sock = new WebSocket(url, ['no-compression'])
  sock.binaryType = 'arraybuffer'
  sock.onopen = () => console.log(new Date().toISOString(), 'open', url)
  sock.onerror = (e) => console.log('error', e.message || '')
  sock.onclose = (e) => {
    console.log(new Date().toISOString(), 'close', e.code, e.reason)
    closeAll('socket closed')
    watching = null
    entries.length = 0
    clearTimeout(hopTimer)
    clearTimeout(quietTimer)
    if (ending) process.exit(0)
    setTimeout(() => (ws = connect()), 5000)
  }
  sock.onmessage = (ev) => {
    const s = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data)
    let o
    try {
      o = JSON.parse(s)
    } catch {
      return
    }
    if (o.msgs) for (const m of o.msgs) handle(m)
    else handle(o)
  }
  return sock
}

let ws = connect()

setTimeout(() => {
  ending = true
  closeAll('end')
  ws.close()
}, minutes * 60 * 1000)
