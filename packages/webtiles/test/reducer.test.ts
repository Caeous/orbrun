import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { initialState, reduce, floorItemsCount, floorItemsLabel, formattedStringToHtml, itemsUnderfoot, keyMessage, mapKey, latestGameLinks, gameLinkRows, MSGCH, type ServerMessage } from '../src/index.js'

const here = dirname(fileURLToPath(import.meta.url))

function loadFixture(name: string): ServerMessage[] {
  const text = readFileSync(join(here, 'fixtures', name), 'utf8')
  return text
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l).m as ServerMessage)
}

describe('reducer replay', () => {
  const msgs = loadFixture('cdi-0.34-watch.ndjson')

  it('replays a recorded spectating session without throwing', () => {
    const st = initialState()
    for (const m of msgs) reduce(st, m)
    expect(st.phase).toBe('watching')
    expect(st.watching?.username).toBe('KorlenTP')
    expect(st.version.gamedataVersion).toMatch(/^[0-9a-f]{40}$/)
    expect(st.player.name).toBe('KorlenTP')
    expect(st.map.cells.size).toBeGreaterThan(500)
    expect(st.map.playerOnLevel).toBe(true)
    expect(st.messages.lines.length).toBeGreaterThan(0)
    // no unknown message types in a modern session
    const unknown = st.diagnostics.filter((d) => d.text === 'unknown message type')
    expect(unknown.map((d) => d.msg)).toEqual([])
  })

  it('keeps the player located at a known cell', () => {
    const st = initialState()
    for (const m of msgs) reduce(st, m)
    const cell = st.map.cells.get(mapKey(st.player.pos.x, st.player.pos.y))
    expect(cell).toBeDefined()
    expect(cell!.t).toBeDefined()
  })

  it('merges map cells with implicit x/y', () => {
    const st = initialState()
    reduce(st, { msg: 'map', clear: true, player_on_level: true, cells: [{ x: 5, y: 7, mf: 1 }, { mf: 2 }, { mf: 3 }, { x: 1, y: 9, mf: 4 }] })
    expect(st.map.cells.get(mapKey(6, 7))?.mf).toBe(2)
    expect(st.map.cells.get(mapKey(7, 7))?.mf).toBe(3)
    expect(st.map.cells.get(mapKey(1, 9))?.mf).toBe(4)
    expect(st.map.bounds).toEqual({ left: 1, top: 7, right: 7, bottom: 9 })
  })

  it('tracks monsters by id across cells', () => {
    const st = initialState()
    reduce(st, { msg: 'map', clear: true, cells: [{ x: 0, y: 0, mon: { id: 7, name: 'rat', att: 0 } }] })
    reduce(st, { msg: 'map', cells: [{ x: 0, y: 0, mon: null }, { x: 1, y: 0, mon: { id: 7 } }] })
    expect(st.map.cells.get(mapKey(0, 0))?.mon).toBeNull()
    expect(st.map.cells.get(mapKey(1, 0))?.mon?.name).toBe('rat')
  })

  it('player updates are partial and record changed keys', () => {
    const st = initialState()
    reduce(st, { msg: 'player', hp: 10, hp_max: 20, str: 12, pos: { x: 1, y: 1 } })
    reduce(st, { msg: 'player', str: 11, time: 20 })
    expect(st.player.hp).toBe(10)
    expect(st.player.str).toBe(11)
    expect(st.player.changed.has('str')).toBe(true)
    expect(st.player.previous.str).toBe(12)
    expect(st.player.changed.has('hp')).toBe(false)
  })

  it('menus keep item chunks and hover', () => {
    const st = initialState()
    reduce(st, { msg: 'menu', tag: 'inventory', flags: 0, title: { text: 'Inventory' }, total_items: 3, chunk_start: 0, items: [{ text: 'a - sword', hotkeys: [97], level: 2 }, 'header'], last_hovered: -1 })
    reduce(st, { msg: 'update_menu_items', chunk_start: 2, items: [{ text: 'b - shield', hotkeys: [98], level: 2 }] })
    expect(st.menus.length).toBe(1)
    expect(st.menus[0].items[1]?.text).toBe('header')
    expect(st.menus[0].items[2]?.hotkeys).toEqual([98])
    reduce(st, { msg: 'close_menu' })
    expect(st.menus.length).toBe(0)
  })

  it('handles --more-- and rollback', () => {
    const st = initialState()
    reduce(st, { msg: 'msgs', messages: [{ text: 'a' }, { text: 'b' }], more: true })
    expect(st.messages.more).toBe(true)
    reduce(st, { msg: 'msgs', rollback: 1, messages: [{ text: 'c' }], more: false })
    expect(st.messages.lines.map((l) => l.text)).toEqual(['a', 'c'])
    expect(st.messages.more).toBe(false)
  })
})

describe('helpers', () => {
  it('marks the player sheet as received only once a player message has arrived', () => {
    const st = initialState()
    expect(st.player.received).toBe(false)
    reduce(st, { msg: 'ui_state', state: 1 } as ServerMessage)
    reduce(st, { msg: 'options', options: { tile_display_mode: 'tiles' } } as ServerMessage)
    expect(st.player.received).toBe(false)
    reduce(st, { msg: 'player', name: 'Orb', hp: 12, hp_max: 12 } as ServerMessage)
    expect(st.player.received).toBe(true)
    reduce(st, { msg: 'go_lobby' } as ServerMessage)
    expect(st.player.received).toBe(false)
  })
  it('formats colour tags like the official client', () => {
    expect(formattedStringToHtml('<red>hi<lightgrey> there')).toBe("<span class='fg4'>hi</span><span class='fg7'> there</span>")
    expect(formattedStringToHtml('a << b')).toBe('a &lt; b')
    expect(formattedStringToHtml('x > y')).toBe('x &gt; y')
  })
  it('routes printable text as input and control keys as key', () => {
    expect(keyMessage('a'.charCodeAt(0))).toEqual({ msg: 'input', text: 'a' })
    expect(keyMessage(27)).toEqual({ msg: 'key', keycode: 27 })
    expect(keyMessage(-254)).toEqual({ msg: 'key', keycode: -254 })
  })
})

describe('latestGameLinks', () => {
  it('keeps trunk and the newest stable release, all variants', () => {
    const games = [
      { id: 'dcss-web-trunk', label: 'DCSS trunk' },
      { id: 'dcss-web-0.34', label: 'DCSS 0.34' },
      { id: 'dcss-web-0.33', label: 'DCSS 0.33' },
      { id: 'dcss-web-0.9', label: 'DCSS 0.9' },
      { id: 'sprint-web-0.34', label: 'Sprint 0.34' },
      { id: 'sprint-web-0.33', label: 'Sprint 0.33' },
      { id: 'tut-web-trunk', label: 'Tutorial trunk' },
      { id: 'spr-git', label: 'Sprint trunk' },
    ]
    expect(latestGameLinks(games).map((g) => g.id)).toEqual(['dcss-web-trunk', 'dcss-web-0.34', 'sprint-web-0.34', 'tut-web-trunk', 'spr-git'])
  })

  it('compares versions numerically and keeps unversioned links', () => {
    const games = [
      { id: 'a', label: 'DCSS 0.10' },
      { id: 'b', label: 'DCSS 0.9' },
      { id: 'c', label: 'Something odd' },
    ]
    expect(latestGameLinks(games).map((g) => g.id)).toEqual(['a', 'c'])
  })

  it('splits the kept links into the latest-version and trunk rows, dropping seed, sprint and tutorial', () => {
    const games = [
      { id: 'dcss-web-trunk', label: 'DCSS trunk' },
      { id: 'dcss-web-0.34', label: 'DCSS 0.34' },
      { id: 'dcss-web-0.33', label: 'DCSS 0.33' },
      { id: 'seeded-web-0.34', label: 'Custom seed 0.34' },
      { id: 'sprint-web-0.34', label: 'Sprint 0.34' },
      { id: 'tut-web-trunk', label: 'Tutorial trunk' },
      { id: 'odd', label: 'Something odd' },
      { id: 'odd-sprint', label: 'Odd sprint' },
    ]
    const rows = gameLinkRows(games)
    expect(rows.latestVersion).toBe('0.34')
    expect(rows.latest.map((g) => g.id)).toEqual(['dcss-web-0.34'])
    expect(rows.trunk.map((g) => g.id)).toEqual(['dcss-web-trunk'])
    expect(rows.other.map((g) => g.id)).toEqual(['odd'])
  })
})

describe('session messages the official client handles outside the game', () => {
  it('keeps the rc file, stale-process notices and account hold on the lobby', () => {
    const st = initialState()
    reduce(st, { msg: 'rcfile_contents', game_id: 'dcss-web-trunk', contents: 'autopickup = $?!' })
    expect(st.lobby.rcfile).toEqual({ gameId: 'dcss-web-trunk', contents: 'autopickup = $?!' })
    reduce(st, { msg: 'stale_processes', game: 'dcss-web-trunk', timeout: 30 })
    expect(st.lobby.staleProcesses).toEqual({ game: 'dcss-web-trunk', timeout: 30 })
    reduce(st, { msg: 'force_terminate?' })
    expect(st.lobby.forceTerminate).toBe(true)
    // process_handler.py sends hide_dialog once the stale game is stopped: both notices go
    reduce(st, { msg: 'hide_dialog' })
    expect(st.lobby.staleProcesses).toBeNull()
    expect(st.lobby.forceTerminate).toBe(false)
    reduce(st, { msg: 'stale_processes', game: 'dcss-web-trunk', timeout: 10 })
    reduce(st, { msg: 'game_started' })
    expect(st.lobby.staleProcesses).toBeNull()
    reduce(st, { msg: 'set_account_hold' })
    expect(st.lobby.accountHold).toBe(true)
    reduce(st, { msg: 'clear_account_hold' })
    expect(st.lobby.accountHold).toBe(false)
    reduce(st, { msg: 'reload_url' })
    expect(st.lobby.reloadUrl).toBe(true)
    reduce(st, { msg: 'go_admin' })
    expect(st.lobby.admin).toBe(true)
    reduce(st, { msg: 'admin_log', text: 'x' })
    expect(st.lobby.adminLog).toEqual(['x'])
    expect(st.diagnostics.filter((d) => d.text === 'unhandled session message')).toEqual([])
  })

  it('collects chat, spectators, announcements and dump urls as chat.js does', () => {
    const st = initialState()
    const rev = st.rev.chat
    reduce(st, { msg: 'update_spectators', count: 2, names: '<span>a</span>, <span>b</span>' })
    expect(st.spectators?.count).toBe(2)
    reduce(st, { msg: 'chat', sender: 'a', content: '<span class="chat_sender">a</span>: <span class="chat_msg">hi</span>' })
    reduce(st, { msg: 'server_announcement', text: 'restart soon' })
    reduce(st, { msg: 'dump', url: 'https://x/morgue-a' })
    expect(st.chat.map((c) => c.sender)).toEqual(['a', 'server', ''])
    expect(st.chat[1].meta).toBe(true)
    expect(st.chat[1].html).toContain('Serverwide announcement')
    expect(st.chat[2].html).toContain('morgue-a.txt')
    expect(st.rev.chat).toBeGreaterThan(rev)
    reduce(st, { msg: 'toggle_chat' })
    expect(st.chatVisible).toBe(false)
    reduce(st, { msg: 'super_hide_chat' })
    expect(st.chatSuperHidden).toBe(true)
    // a new game starts with an empty chat (client.js game_cleanup)
    reduce(st, { msg: 'game_client', version: 'abc', content: '' })
    expect(st.chat).toEqual([])
  })
})

describe('game phase', () => {
  it("stays 'playing' when game_client follows game_started, as crawl.dcss.io sends them (recorded playing dcss-git 2026-09-09)", () => {
    const st = initialState()
    reduce(st, { msg: 'game_started' })
    expect(st.phase).toBe('playing')
    reduce(st, { msg: 'game_client', version: 'abc', content: '' })
    expect(st.phase).toBe('playing')
    reduce(st, { msg: 'game_ended', reason: 'saved' })
    expect(st.phase).toBe('ended')
    expect(st.exit).toEqual({ reason: 'saved', message: undefined, dump: undefined, watched: undefined })
    // a watched game's end remembers whose it was, for the lobby's wording
    const w = initialState()
    reduce(w, { msg: 'watching_started', username: 'alice' })
    reduce(w, { msg: 'game_ended', reason: 'dead', dump: '/morgue/alice/morgue-alice-1' })
    expect(w.exit).toEqual({ reason: 'dead', message: undefined, dump: '/morgue/alice/morgue-alice-1', watched: 'alice' })
    // a game_client before any game_started is a game still on its way
    const fresh = initialState()
    reduce(fresh, { msg: 'game_client', version: 'abc', content: '' })
    expect(fresh.phase).toBe('loading')
  })
})

describe('popup scroll lines from the server', () => {
  it('counts each arrival so the client can apply a repeat of the same line (ui-layouts.js recv_ui_scroll, formatted_scroller_update)', () => {
    const st = initialState()
    reduce(st, { msg: 'ui-push', type: 'describe-item', title: 't', body: 'b' })
    const p = st.ui[0]
    expect(p.scrollSeq).toBeUndefined()
    reduce(st, { msg: 'ui-scroller-scroll', scroll: 0, from_webtiles: false })
    expect(p).toMatchObject({ scroll: 0, scrollFromWebtiles: false, scrollSeq: 1 })
    // an echo of the client's own scrolling is marked as such
    reduce(st, { msg: 'ui-scroller-scroll', scroll: 0, from_webtiles: true })
    expect(p).toMatchObject({ scroll: 0, scrollFromWebtiles: true, scrollSeq: 2 })
    // a formatted scroller gets its line on its ui-state, not on ui-scroller-scroll
    reduce(st, { msg: 'ui-push', type: 'formatted-scroller', title: 'help', text: 'x' })
    const fs = st.ui[1]
    reduce(st, { msg: 'ui-scroller-scroll', scroll: 5, from_webtiles: false })
    expect(fs.scrollSeq).toBeUndefined()
    reduce(st, { msg: 'ui-state', type: 'formatted-scroller', scroll: 7, from_webtiles: false })
    expect(fs).toMatchObject({ scroll: 7, scrollFromWebtiles: false, scrollSeq: 1 })
    reduce(st, { msg: 'ui-state', type: 'formatted-scroller', text: 'page two' })
    expect(fs.scrollSeq).toBe(1)
    expect(fs.data.text).toBe('page two')
  })
})

/**
 * Items under the player are not on the map: `tileidx_player` (tilepick-p.cc)
 * sets no S_UNDER flag on the player's tile, so the only word the server
 * gives is `item_check`'s line on MSGCH_FLOOR_ITEMS (items.cc). Pinned to the
 * recorded session: the `player` update with the new `pos` precedes the
 * `msgs` line, both on the arrival turn; one stale line arrives ten turns
 * after its pile was left.
 */
describe('items underfoot', () => {
  const msgs = loadFixture('cdi-0.34-watch.ndjson')
  const textOf = (m: ServerMessage) => ((m.messages as { text: string }[] | undefined) || []).map((l) => l.text).join('\n')

  it('is announced on arrival and gone on the next step (recorded)', () => {
    const st = initialState()
    const at = msgs.findIndex((m) => m.msg === 'msgs' && textOf(m).includes('You see here a +0 halberd.'))
    expect(at).toBeGreaterThan(0)
    for (let i = 0; i < at; i++) reduce(st, msgs[i])
    // the player update with the new pos came first, at the same turn as the line
    expect(msgs[at - 1].msg).toBe('player')
    expect(st.player.arrivedTurn).toBe(12258)
    expect(itemsUnderfoot(st)).toBe(false)
    reduce(st, msgs[at])
    expect(itemsUnderfoot(st)).toBe(true)
    // the name in the log's own words and colours, the line's own <lightgrey> and all
    expect(floorItemsLabel(st)).toBe('<lightgrey>a +0 halberd')
    // the next player update moves on
    let j = at + 1
    while (msgs[j].msg !== 'player') reduce(st, msgs[j++])
    expect(itemsUnderfoot(st)).toBe(true)
    reduce(st, msgs[j])
    expect(st.player.pos).toEqual({ x: 39, y: 5 })
    expect(itemsUnderfoot(st)).toBe(false)
  })

  it('ignores a line about a pile already left (recorded: turn 12185 delivered at turn 12195)', () => {
    const st = initialState()
    const at = msgs.findIndex((m) => m.msg === 'msgs' && ((m.messages as { turn: number }[]) || []).some((l) => l.turn === 12185 && l.channel === MSGCH.FLOOR_ITEMS))
    expect(at).toBeGreaterThan(0)
    for (let i = 0; i <= at; i++) reduce(st, msgs[i])
    expect(st.player.turn).toBe(12195)
    expect(st.player.floorItems).toMatchObject({ turn: 12185 })
    expect(itemsUnderfoot(st)).toBe(false)
    expect(floorItemsLabel(st)).toBeNull()
  })

  it('names the pile in the words of each item_check form (recorded lines)', () => {
    const st = initialState()
    reduce(st, { msg: 'player', pos: { x: 1, y: 1 }, turn: 12163 })
    // the glyph summary (this rc's item_stack_summary_minimum is 4): one glyph per item, classes spaced;
    // the two corpses (††) are not offered, `pickup` would not either (items.cc `count_movable_items`)
    reduce(st, { msg: 'msgs', messages: [{ text: '<lightgrey>You feel sick.', turn: 12162, channel: 0 }, { text: '<lightgrey>Items here: <darkgrey>) [ ††<lightgrey>.', turn: 12163, channel: 21 }] })
    // the glyphs as the log printed them: the summary is the log's own shorthand, corpses and all (the count is not, `floorItemsCount`)
    expect(floorItemsLabel(st)).toBe('<darkgrey>) [ ††')
    expect(floorItemsCount(st.player.floorItems!.lines)).toBe(2)
    // the two-line listing: the names follow on the plain channel
    reduce(st, { msg: 'msgs', messages: [{ text: '<lightgrey>Things that are here:', turn: 12163, channel: 21 }, { text: '<lightgrey>a +0 mace; <green>a +2 robe of positive energy<lightgrey>', turn: 12163, channel: 0 }] })
    expect(floorItemsLabel(st)).toBe('<lightgrey>a +0 mace; <green>a +2 robe of positive energy<lightgrey>')
    // a later plain line is not part of the listing
    reduce(st, { msg: 'msgs', messages: [{ text: 'You feel sick.', turn: 12164, channel: 0 }] })
    expect(floorItemsLabel(st)).toBe('<lightgrey>a +0 mace; <green>a +2 robe of positive energy<lightgrey>')
    reduce(st, { msg: 'msgs', messages: [{ text: '<lightgrey>There are many items here.', turn: 12164, channel: 21 }] })
    expect(floorItemsLabel(st)).toBe('many items')
    reduce(st, { msg: 'msgs', messages: [{ text: 'Items here: <darkgrey>)<lightgrey>.', turn: 12164, channel: 21 }] })
    expect(floorItemsLabel(st)).toBe('<darkgrey>)')
  })

  it('keeps the colours the log printed, so the prompt for the pile reads as its line does', () => {
    const st = initialState()
    reduce(st, { msg: 'player', pos: { x: 1, y: 1 }, turn: 10 })
    // the item in its menu colour, the sentence around it in the log's default (crawl.dcss.io 0.34)
    reduce(st, { msg: 'msgs', messages: [{ text: '<lightgrey>You see here <lightgreen>a staff of alchemy<lightgrey>.', turn: 10, channel: MSGCH.FLOOR_ITEMS }] })
    expect(floorItemsLabel(st)).toBe('<lightgreen>a staff of alchemy')
    expect(formattedStringToHtml(floorItemsLabel(st)!)).toBe("<span class='fg10'>a staff of alchemy</span>")
    // a name that closes its colour rather than reopening the one before it
    reduce(st, { msg: 'msgs', messages: [{ text: 'You see here <yellow>27 gold pieces</yellow>.', turn: 10, channel: MSGCH.FLOOR_ITEMS }] })
    expect(floorItemsLabel(st)).toBe('<yellow>27 gold pieces')
  })

  it('holds while standing still, clears on "There are no items here.", a new level, or a move', () => {
    const st = initialState()
    reduce(st, { msg: 'player', pos: { x: 1, y: 1 }, turn: 10, place: 'D:1', depth: 1 })
    reduce(st, { msg: 'msgs', messages: [{ text: '<lightgrey>Things that are here:', turn: 10, channel: MSGCH.FLOOR_ITEMS }, { text: 'a +0 mace; a robe', turn: 10, channel: 0 }] })
    expect(itemsUnderfoot(st)).toBe(true)
    // resting: turns pass, the pos does not
    reduce(st, { msg: 'player', turn: 25 })
    expect(itemsUnderfoot(st)).toBe(true)
    // the pick-up that found nothing
    reduce(st, { msg: 'msgs', messages: [{ text: '<lightgrey>There are no items here.', turn: 26, channel: 0 }] })
    expect(itemsUnderfoot(st)).toBe(false)
    // the msgs line may precede the player update in a batch: same turn still counts
    reduce(st, { msg: 'msgs', messages: [{ text: '<lightgrey>You see here a dagger.', turn: 30, channel: MSGCH.FLOOR_ITEMS }] })
    reduce(st, { msg: 'player', pos: { x: 2, y: 1 }, turn: 30 })
    expect(itemsUnderfoot(st)).toBe(true)
    // stairs to a level where the same coordinates are a different cell
    reduce(st, { msg: 'player', turn: 31, place: 'D:2', depth: 2 })
    expect(itemsUnderfoot(st)).toBe(false)
    // a line without a turn takes the player's
    reduce(st, { msg: 'msgs', messages: [{ text: 'Items here: ) [.', channel: MSGCH.FLOOR_ITEMS }] })
    expect(itemsUnderfoot(st)).toBe(true)
    reduce(st, { msg: 'player', pos: { x: 3, y: 1 }, turn: 32 })
    expect(itemsUnderfoot(st)).toBe(false)
  })

  /**
   * A manual pick-up prints no new floor-items line (items.cc `pickup` does
   * not call `item_check`); what it does send is the `player` update with
   * the slot the item went to (tileweb.cc `_send_item`), ahead of the
   * "T - a scroll of torment" line in the same batch (orbrun-rec.ndjson,
   * where the pick-up is autopickup's). The pile is counted down by it.
   */
  it('counts the pile down as inventory or gold grows while standing on it', () => {
    const st = initialState()
    reduce(st, { msg: 'player', pos: { x: 1, y: 1 }, turn: 100, gold: 20, inv: { 0: { base_type: 5, quantity: 1, name: 'scroll of identify' } } })
    // the single item: one gain empties the pile
    reduce(st, { msg: 'msgs', messages: [{ text: '<lightgrey>You see here a +0 halberd.', turn: 100, channel: MSGCH.FLOOR_ITEMS }] })
    expect(floorItemsLabel(st)).toBe('<lightgrey>a +0 halberd')
    reduce(st, { msg: 'player', turn: 101, inv: { 1: { base_type: 0, quantity: 1, name: '+0 halberd' } } })
    reduce(st, { msg: 'msgs', messages: [{ text: '<lightgrey>b - a +0 halberd', turn: 100, channel: 0 }] })
    expect(itemsUnderfoot(st)).toBe(false)
    expect(floorItemsLabel(st)).toBeNull()
    // a stack merging into a slot counts as one item ("i - 9 scrolls of identify (gained 1)")
    reduce(st, { msg: 'msgs', messages: [{ text: 'Items here: <darkgrey>) [ ?<lightgrey>.', turn: 101, channel: MSGCH.FLOOR_ITEMS }] })
    expect(floorItemsLabel(st)).toBe('<darkgrey>) [ ?')
    reduce(st, { msg: 'player', turn: 102, inv: { 0: { quantity: 2 } } })
    expect(floorItemsLabel(st)).toBe('2 items')
    // gold is a floor item too (items.cc `get_gold`: "You now have 34 gold pieces (gained 14).")
    reduce(st, { msg: 'player', turn: 103, gold: 34 })
    expect(floorItemsLabel(st)).toBe('1 item')
    // using up an item is not a pick-up; neither is a slot the server empties (base_type unassigned, quantity 0)
    reduce(st, { msg: 'player', turn: 104, inv: { 0: { quantity: 1 }, 1: { base_type: 100, quantity: 0 } } })
    expect(floorItemsLabel(st)).toBe('1 item')
    reduce(st, { msg: 'player', turn: 105, inv: { 2: { base_type: 2, quantity: 1, name: '+0 robe' } } })
    expect(itemsUnderfoot(st)).toBe(false)
    // the listing by name loses its names once part of it is gone: the server did not say which
    reduce(st, { msg: 'msgs', messages: [{ text: '<lightgrey>Things that are here:', turn: 105, channel: MSGCH.FLOOR_ITEMS }, { text: '<lightgrey>a +0 mace; <green>a +2 robe of positive energy<lightgrey>', turn: 105, channel: 0 }] })
    expect(floorItemsLabel(st)).toBe('<lightgrey>a +0 mace; <green>a +2 robe of positive energy<lightgrey>')
    reduce(st, { msg: 'player', turn: 106, inv: { 3: { base_type: 0, quantity: 1, name: '+0 mace' } } })
    expect(floorItemsLabel(st)).toBe('1 item')
    reduce(st, { msg: 'player', turn: 107, inv: { 4: { base_type: 2, quantity: 1 } } })
    expect(itemsUnderfoot(st)).toBe(false)
    // a pile of unstated size cannot be counted down: it stays until the step away
    reduce(st, { msg: 'msgs', messages: [{ text: 'There are many items here.', turn: 107, channel: MSGCH.FLOOR_ITEMS }] })
    reduce(st, { msg: 'player', turn: 108, inv: { 5: { base_type: 2, quantity: 1 } } })
    expect(floorItemsLabel(st)).toBe('many items')
    reduce(st, { msg: 'player', pos: { x: 2, y: 1 }, turn: 109 })
    expect(itemsUnderfoot(st)).toBe(false)
  })

  it('leaves corpses out: they are stationary and `g` refuses them (items.cc pickup_single_item, item-prop.cc item_is_stationary)', () => {
    const st = initialState()
    reduce(st, { msg: 'player', pos: { x: 1, y: 1 }, turn: 100, gold: 20, inv: {} })
    // a corpse alone: nothing to pick up. Darkgrey is the default menu colour of a useless item (dat/defaults/menu_colours.txt)
    reduce(st, { msg: 'msgs', messages: [{ text: '<lightgrey>You see here <darkgrey>a bat corpse</darkgrey>.', turn: 100, channel: MSGCH.FLOOR_ITEMS }] })
    expect(itemsUnderfoot(st)).toBe(false)
    expect(floorItemsLabel(st)).toBeNull()
    reduce(st, { msg: 'msgs', messages: [{ text: '<lightgrey>You see here <darkgrey>a jackal skeleton</darkgrey>.', turn: 100, channel: MSGCH.FLOOR_ITEMS }] })
    expect(itemsUnderfoot(st)).toBe(false)
    // the listing: the corpse is dropped from the name and from the count
    reduce(st, { msg: 'msgs', messages: [{ text: '<lightgrey>Things that are here:', turn: 100, channel: MSGCH.FLOOR_ITEMS }, { text: '<lightgrey>a +0 mace; <darkgrey>a bat corpse</darkgrey>; <darkgrey>a rat corpse</darkgrey>', turn: 100, channel: 0 }] })
    expect(floorItemsCount(st.player.floorItems!.lines)).toBe(1)
    expect(floorItemsLabel(st)).toBe('<lightgrey>a +0 mace')
    reduce(st, { msg: 'player', turn: 101, inv: { 0: { base_type: 0, quantity: 1, name: '+0 mace' } } })
    expect(itemsUnderfoot(st)).toBe(false)
    reduce(st, { msg: 'msgs', messages: [{ text: '<lightgrey>Things that are here:', turn: 101, channel: MSGCH.FLOOR_ITEMS }, { text: '<darkgrey>a bat corpse</darkgrey>; <darkgrey>a rat corpse</darkgrey>', turn: 101, channel: 0 }] })
    expect(itemsUnderfoot(st)).toBe(false)
    // the glyph summary: † is a corpse, ÷ a skeleton (viewchar.cc dchar_table); "Items here: ) [ ††" holds two items to take
    reduce(st, { msg: 'msgs', messages: [{ text: 'Items here: <darkgrey>) [ ††<lightgrey>.', turn: 101, channel: MSGCH.FLOOR_ITEMS }] })
    expect(floorItemsCount(st.player.floorItems!.lines)).toBe(2)
    reduce(st, { msg: 'msgs', messages: [{ text: 'Items here: <darkgrey>†† ÷<lightgrey>.', turn: 101, channel: MSGCH.FLOOR_ITEMS }] })
    expect(itemsUnderfoot(st)).toBe(false)
  })

  it('does not count autopickup on arrival against the pile it leaves behind (recorded)', () => {
    // cdi-0.34-autopickup.ndjson: a step onto a pile during explore, gold and a scroll autopicked up, a morningstar left
    const rec = loadFixture('cdi-0.34-autopickup.ndjson')
    const st = initialState()
    reduce(st, rec[0])
    expect(st.player.turn).toBe(29814)
    // as if the last cell had been a pile too
    reduce(st, { msg: 'msgs', messages: [{ text: 'Items here: <darkgrey>) [<lightgrey>.', turn: 29814, channel: MSGCH.FLOOR_ITEMS }] })
    reduce(st, { msg: 'player', pos: { x: 26, y: 14 }, turn: 29814 })
    expect(itemsUnderfoot(st)).toBe(true)
    for (const m of rec.slice(1)) reduce(st, m)
    // the arrival: one gained slot (84; slot 79 changed without a quantity) and gold, so the pile line is a turn behind
    expect(st.player.turn).toBe(29816)
    expect(st.player.arrivedTurn).toBe(29816)
    expect(st.player.arrivedPickup).toBe(true)
    expect(st.player.floorItems).toMatchObject({ turn: 29815, picked: 0 })
    expect(itemsUnderfoot(st)).toBe(true)
    expect(floorItemsLabel(st)).toBe('<lightgrey>a +0 morningstar')
    // the manual pick-up that follows: the slot arrives, no floor line does
    reduce(st, { msg: 'player', turn: 29817, inv: { 85: { base_type: 0, quantity: 1, name: '+0 morningstar' } } })
    reduce(st, { msg: 'msgs', messages: [{ text: '<lightgrey>d - a +0 morningstar', turn: 29816, channel: 0 }] })
    expect(itemsUnderfoot(st)).toBe(false)
    // and the next step is not owed the one-turn allowance
    reduce(st, { msg: 'msgs', messages: [{ text: 'You see here a +0 dagger.', turn: 29817, channel: MSGCH.FLOOR_ITEMS }] })
    reduce(st, { msg: 'player', pos: { x: 28, y: 14 }, turn: 29818 })
    expect(st.player.arrivedPickup).toBe(false)
    expect(itemsUnderfoot(st)).toBe(false)
  })
})

describe('ui_cutoff hides what is up when it arrives, not what comes after', () => {
  it('leaves the description look mode opens visible (directn.cc choose_direction cutoff_point, game.js handle_set_ui_cutoff)', () => {
    const st = initialState()
    // `x` from the main screen: the stack is empty, so the cutoff is 0 and hides nothing that exists
    reduce(st, { msg: 'ui_cutoff', cutoff: 0 })
    expect(st.uiCutoff).toBe(0)
    // `v` on a monster: the popup pushed after the cutoff is shown
    reduce(st, { msg: 'ui-push', type: 'describe-monster', title: 'a goblin', body: 'b' })
    expect(st.ui[0].hidden).toBeFalsy()
    reduce(st, { msg: 'ui-pop' })
    reduce(st, { msg: 'ui_cutoff', cutoff: -1 })
    expect(st.uiCutoff).toBe(-1)
  })

  it('counts menus and popups on the one stack, in push order, like #ui-stack', () => {
    const st = initialState()
    // an inventory menu, then a cutoff pushed over it (adjust.cc adjust_item): the menu is hidden, index 0 <= 1
    reduce(st, { msg: 'menu', tag: 'inventory', flags: 0, title: { text: 'Inventory' }, items: [] })
    reduce(st, { msg: 'ui_cutoff', cutoff: 1 })
    expect(st.menus[0].hidden).toBe(true)
    // the popup that follows is not
    reduce(st, { msg: 'ui-push', type: 'describe-item', title: 't', body: 'b' })
    expect(st.ui[0].hidden).toBeFalsy()
    // the pop restores the menu
    reduce(st, { msg: 'ui-pop' })
    reduce(st, { msg: 'ui_cutoff', cutoff: -1 })
    expect(st.menus[0].hidden).toBe(false)
  })
})

/**
 * The lobby's "Play now" line (`set_game_links`) carries the save waiting in
 * each game once the server has checked the slot: game_links.html rendered
 * with the strings ws_handler.py `update_save_info` puts in `save_info`
 * (fixtures/set-game-links.json, rendered from the server's own template;
 * the bracket text is player.cc `player_save_info::short_desc`).
 */
describe('set_game_links', () => {
  const fixture = JSON.parse(readFileSync(join(here, 'fixtures', 'set-game-links.json'), 'utf8')) as { msgs: ServerMessage[] }

  it('reads every game as a plain link before the saves are checked', () => {
    const st = initialState()
    reduce(st, fixture.msgs[0])
    expect(st.lobby.games).toEqual([
      { id: 'dcss-web-trunk', label: 'DCSS trunk' },
      { id: 'seeded-web-trunk', label: 'Seeded trunk' },
      { id: 'sprint-web-trunk', label: 'Sprint trunk' },
      { id: 'tut-web-trunk', label: 'Tutorial trunk' },
      { id: 'dcss-web-0.34', label: 'DCSS 0.34' },
      { id: 'seeded-web-0.34', label: 'Seeded 0.34' },
      { id: 'sprint-web-0.34', label: 'Sprint 0.34' },
      { id: 'dcss-web-0.33', label: 'DCSS 0.33' },
    ])
  })

  it('reads the save behind each game once the slots are checked', () => {
    const st = initialState()
    reduce(st, fixture.msgs[0])
    reduce(st, fixture.msgs[1])
    const by = new Map(st.lobby.games.map((g) => [g.id, g]))
    // a save to continue: the link moves from the name to the bracket text
    expect(by.get('dcss-web-trunk')).toEqual({ id: 'dcss-web-trunk', label: 'DCSS trunk', save: 'orbruntest, a level 3 Minotaur Berserker of Trog' })
    // a game whose slot another game type holds: greyed, no link; its id comes from nowhere, so it is not listed
    expect(by.has('seeded-web-trunk')).toBe(false)
    // a save another session has open: still linked
    expect(by.get('dcss-web-0.34')).toEqual({ id: 'dcss-web-0.34', label: 'DCSS 0.34', save: 'playing' })
    expect(by.get('seeded-web-0.34')).toEqual({ id: 'seeded-web-0.34', label: 'Seeded 0.34', save: 'playing' })
    // nothing saved: a plain link
    expect(by.get('dcss-web-0.33')).toEqual({ id: 'dcss-web-0.33', label: 'DCSS 0.33' })
    expect(by.get('sprint-web-trunk')).toEqual({ id: 'sprint-web-trunk', label: 'Sprint trunk' })
    // the rows the home screen shows keep the save with the game
    const rows = gameLinkRows(st.lobby.games)
    expect(rows.trunk.map((g) => g.save)).toEqual(['orbruntest, a level 3 Minotaur Berserker of Trog'])
    expect(rows.latest.map((g) => g.save)).toEqual(['playing'])
  })

  it("reads CDI's own page: plain links for every game, a nested 'latest version:' span that is no save, and the older versions folded in a details block", () => {
    // recorded logged in on 2026-09-09 with a 0.34 save waiting: CDI does not publish save info, so nothing here
    // says so, and the home screen falls back on the roster and this device's own memory (menu.ts saveOf)
    const cdi = JSON.parse(readFileSync(join(here, 'fixtures', 'set-game-links-cdi.json'), 'utf8')) as { msgs: ServerMessage[] }
    const st = initialState()
    reduce(st, cdi.msgs[0])
    expect(st.lobby.games.some((g) => g.save || g.disabled)).toBe(false)
    expect(st.lobby.games.slice(0, 9)).toEqual([
      { id: 'dcss-0.34', label: 'DCSS 0.34' },
      { id: 'seeded-0.34', label: 'Custom seed 0.34' },
      { id: 'spr-0.34', label: 'Sprint 0.34' },
      { id: 'tut-0.34', label: 'Tutorial 0.34' },
      { id: 'dcss-git', label: 'DCSS trunk' },
      { id: 'seeded-git', label: 'Custom seed trunk' },
      { id: 'spr-git', label: 'Sprint trunk' },
      { id: 'tut-git', label: 'Tutorial trunk' },
      { id: 'dcss-0.33', label: 'DCSS 0.33' },
    ])
    expect(st.lobby.games).toHaveLength(24)
    expect(st.lobby.games.at(-1)).toEqual({ id: 'tut-0.30', label: 'Tutorial 0.30' })
    const rows = gameLinkRows(st.lobby.games)
    expect(rows.latestVersion).toBe('0.34')
    expect(rows.latest.map((g) => g.id)).toEqual(['dcss-0.34'])
    expect(rows.trunk.map((g) => g.id)).toEqual(['dcss-git'])
    expect(rows.other).toEqual([])
  })

  it("reads the names past CDI's separators, entities and all", () => {
    const st = initialState()
    reduce(st, fixture.msgs[2])
    expect(st.lobby.games).toEqual([
      { id: 'dcss-web-0.34', label: 'DCSS 0.34' },
      { id: 'seeded-web-0.34', label: 'Seeded 0.34' },
      { id: 'sprint-web-0.34', label: 'Sprint 0.34' },
      { id: 'dcss-web-trunk', label: 'DCSS trunk', save: 'caeo, a level 9 Gnoll Fighter of Okawaru' },
      { id: 'sprint-web-trunk', label: 'Sprint trunk' },
      { id: 'dcss-web-0.33', label: 'DCSS 0.33' },
    ])
    const rows = gameLinkRows(st.lobby.games)
    expect(rows.latestVersion).toBe('0.34')
    expect(rows.latest.map((g) => g.label)).toEqual(['DCSS 0.34'])
    expect(rows.trunk.map((g) => g.save)).toEqual(['caeo, a level 9 Gnoll Fighter of Okawaru'])
  })

  it('keeps a slot-full game whose id the (edit rc) link carries, unlinked', () => {
    const st = initialState()
    reduce(st, {
      msg: 'set_game_links',
      content: '<span class="fg7"><br>DCSS trunk<span>[slot full]</span><a href="javascript:" class="edit_rc_link" data-game_id="dcss-web-trunk">(edit rc)</a></span>',
    } as ServerMessage)
    expect(st.lobby.games).toEqual([{ id: 'dcss-web-trunk', label: 'DCSS trunk', save: 'slot full', disabled: true }])
  })
})
