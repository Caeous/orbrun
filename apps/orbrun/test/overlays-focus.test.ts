// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { initialState, reduce, MouseMode, Keys, type ClientMessage, type GameState } from '@orbrun/webtiles'
import { Overlays } from '../src/overlays'
import { deriveContext, type Context } from '../src/context'
import { bindingTable, actionLabel } from '../src/bindings'
import { isTextEntry } from '../src/keys'
import skills from './fixtures/skills-crt.json'

/**
 * Focus order per overlay type, through the real renderers: what the cursor
 * walks, in which order, and exactly what activation sends.
 */

const scene = { player: { x: 0, y: 0 }, cells: new Map(), billboards: [], playerOnLevel: false } as never
const cam = { facing: 0 } as never

function setup() {
  const sent: ClientMessage[] = []
  const host = document.createElement('div')
  document.body.append(host)
  const ov = new Overlays(host, {
    send: (m) => sent.push(m),
    gamedata: () => null,
    watching: () => false,
    onClientOverlayChange: () => {},
    onSystemAction: () => {},
    settingsPanel: () => document.createElement('div'),
  })
  const st = initialState()
  st.phase = 'playing' as GameState['phase']
  st.inputMode = MouseMode.COMMAND
  /** one frame of the game loop: overlays, context, prompt strip, focus */
  const frame = (device: 'pad' | 'keyboard' | 'pointer' = 'pad'): Context => {
    ov.setDevice(device)
    ov.update(st)
    const ctx = deriveContext(st, scene, cam, 'micro')
    if (ctx.mode === 'popup') ctx.popupActions = ov.popupActions()
    ov.updatePrompt(ctx.mode, ctx.prompt, device)
    ov.syncFocus(ctx)
    const fi = ov.focusInfo(ctx)
    if (fi) ctx.focus = fi
    return ctx
  }
  /** the focused item's text (a prompt chip's label, without the glyph's letter) */
  const focusedText = () => {
    const f = host.querySelector('.focused') as HTMLElement | null
    return (f?.querySelector('.label') ?? f)?.textContent?.trim() ?? null
  }
  return { ov, st, sent, host, frame, focusedText }
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('describe popup', () => {
  it('walks the spells then the verbs; A sends the verb, up/down at the edge fall through to scroll', () => {
    const { ov, st, sent, frame } = setup()
    reduce(st, {
      msg: 'ui-push',
      type: 'describe-item',
      title: 'a book of Flames',
      body: 'A book.',
      spellset: [{ label: 'Spells', spells: [{ letter: 'a', title: 'Flame Tongue' }, { letter: 'b', title: 'Fireball' }] }],
      actions: '(r)ead, (d)rop, or (i)nscribe.',
    })
    let ctx = frame()
    expect(ctx.mode).toBe('popup')
    expect(ctx.focus).toMatchObject({ label: 'Flame Tongue', count: 5 })
    expect(actionLabel(bindingTable(ctx).A!, ctx)).toBe('Flame Tongue')
    ov.focusOp(st, ctx, 'next')
    ov.focusOp(st, ctx, 'next')
    ctx = frame()
    expect(ctx.focus?.label).toBe('Read')
    ov.focusOp(st, ctx, 'right')
    expect(ov.focusInfo(ctx)?.label).toBe('Drop')
    ov.focusOp(st, ctx, 'select')
    expect(sent).toEqual([{ msg: 'input', text: 'd' }])
    sent.length = 0
    // the verbs are the last row: down scrolls the body on the client, as
    // ui-layouts.js scroller_handle_key does; nothing reaches the server
    ov.focusOp(st, ctx, 'next')
    expect(sent).toEqual([])
    // B: no cancel item on a popup, so Esc closes it
    ov.focusOp(st, ctx, 'cancel')
    expect(sent).toEqual([{ msg: 'key', keycode: Keys.ESC }])
  })
  it('a spell entry sends its letter as text input, as the official click does', () => {
    const { ov, st, sent, frame } = setup()
    reduce(st, { msg: 'ui-push', type: 'describe-item', title: 't', body: 'b', spellset: [{ label: '', spells: [{ letter: 'a', title: 'Flame Tongue' }] }] })
    const ctx = frame()
    ov.focusOp(st, ctx, 'select')
    expect(sent).toEqual([{ msg: 'text_input', text: 'a' }])
  })
  it('a popup with nothing to focus: A closes, the d-pad scrolls the text on the client', () => {
    const { ov, st, sent, frame } = setup()
    reduce(st, { msg: 'ui-push', type: 'formatted-scroller', title: 'Help', text: 'lots' })
    const ctx = frame()
    expect(ctx.focus?.count).toBe(0)
    expect(actionLabel(bindingTable(ctx).A!, ctx)).toBe('Close')
    ov.focusOp(st, ctx, 'select')
    expect(sent).toEqual([{ msg: 'key', keycode: Keys.ESC }])
    sent.length = 0
    // ui-layouts.js scroller_handle_key: the client scrolls and, for a formatted
    // scroller, reports its top line with formatted_scroller_scroll (update_server_scroll)
    ov.focusOp(st, ctx, 'next')
    ov.focusOp(st, ctx, 'pageNext')
    expect(sent.map((m) => m.msg)).toEqual(['formatted_scroller_scroll', 'formatted_scroller_scroll'])
    expect(sent.some((m) => m.msg === 'key')).toBe(false)
  })
  it('a popup the official client does not scroll itself leaves the moves to the server', () => {
    const { ov, st, sent, frame } = setup()
    reduce(st, { msg: 'ui-push', type: 'progress-bar', title: 'Working', status: '', bar_text: '' })
    const ctx = frame()
    ov.focusOp(st, ctx, 'next')
    expect(sent).toEqual([{ msg: 'key', keycode: Keys.CK_DOWN }])
  })
  it("a popup's more line is walkable: its switches are cursor stops and A sends their keys", () => {
    const { ov, st, sent, frame } = setup()
    reduce(st, { msg: 'ui-push', type: 'formatted-scroller', title: 'Help', text: 'lots', more: '[<w>!</w>] toggle  [<w>Esc</w>] exit' })
    let ctx = frame()
    expect(ctx.focus?.count).toBe(2)
    expect(ctx.focus?.label).toBe('toggle')
    ov.focusOp(st, ctx, 'select')
    expect(sent).toEqual([{ msg: 'input', text: '!' }])
    sent.length = 0
    // one row, so left / right walk them and a named switch sends its keycode
    ov.focusOp(st, ctx, 'right')
    ctx = frame()
    expect(ctx.focus?.label).toBe('exit')
    ov.focusOp(st, ctx, 'select')
    expect(sent).toEqual([{ msg: 'key', keycode: 27 }])
  })
  it('the random-combo question offers its three answers as rows, not as text to read', () => {
    const { ov, st, sent, frame } = setup()
    reduce(st, { msg: 'ui-push', type: 'newgame-random-combo', prompt: 'You are a Minotaur Fighter.' })
    let ctx = frame()
    expect(ctx.focus?.count).toBe(3)
    expect(ctx.focus?.label).toBe('Yes')
    ov.focusOp(st, ctx, 'right')
    ctx = frame()
    expect(ctx.focus?.label).toBe('No')
    ov.focusOp(st, ctx, 'select')
    expect(sent).toEqual([{ msg: 'input', text: 'n' }])
  })
  it('a monster description offers the pane switch and the verbs', () => {
    const { ov, st, frame, sent } = setup()
    reduce(st, { msg: 'ui-push', type: 'describe-monster', title: 'a rat', body: 'A rat.', status: 'sleeping', quote: '', actions: '(x)amine.' })
    let ctx = frame()
    expect(ctx.focus?.label).toBe('Status')
    ov.focusOp(st, ctx, 'select')
    expect(sent).toEqual([{ msg: 'input', text: '!' }])
    ov.focusOp(st, ctx, 'next')
    ctx = frame()
    expect(ctx.focus?.label).toBe('Xamine')
  })
})

describe('skills screen (crt menu)', () => {
  const load = (st: GameState, n = 2) => {
    for (const m of (skills as { msg: string }[]).slice(0, n)) reduce(st, m as never)
  }
  it('one cursor stop per skill row and per footer switch; A sends the letter', () => {
    const { ov, st, sent, frame, focusedText, host } = setup()
    load(st)
    let ctx = frame()
    expect(ctx.mode).toBe('menu')
    expect(ctx.crtTag).toBe('skills')
    expect(bindingTable(ctx).A).toEqual({ kind: 'focus', op: 'select' })
    expect(ctx.focus).toMatchObject({ label: 'Fighting', count: 17 })
    // the lines are the server's html, verbatim, one element each; the markers sit beside them
    expect(host.querySelectorAll('.crt-line').length).toBe(24)
    expect(host.querySelector('.crt-line:nth-child(4)')?.innerHTML).toContain('Maces &amp; Flails')
    expect(focusedText()).toBe('') // the marker is an overlay, not the text
    ov.focusOp(st, ctx, 'right')
    expect(ov.focusInfo(ctx)?.label).toBe('Spellcasting')
    ov.focusOp(st, ctx, 'next')
    expect(ov.focusInfo(ctx)?.label).toBe('Conjurations')
    ov.focusOp(st, ctx, 'select')
    expect(sent).toEqual([{ msg: 'input', text: 'j' }])
    sent.length = 0
    ctx = frame()
    // the server answers with the toggled line only: the cursor stays on Conjurations
    load(st, 3)
    ctx = frame()
    expect(ctx.focus?.label).toBe('Conjurations')
    // down the right column: Translocations, then Evocations alone on its line, then back to the left column
    ov.focusOp(st, ctx, 'next')
    expect(ov.focusInfo(ctx)?.label).toBe('Translocations')
    ov.focusOp(st, ctx, 'next')
    expect(ov.focusInfo(ctx)?.label).toBe('Evocations')
    ov.focusOp(st, ctx, 'next')
    expect(ov.focusInfo(ctx)?.label).toBe('Ranged Weapons')
    // the footer switches come after the rows; the last wraps to the first
    ov.focusOp(st, ctx, 'last')
    expect(ov.focusInfo(ctx)?.label).toBe('training|cost|targets')
    ov.focusOp(st, ctx, 'select')
    expect(sent).toEqual([{ msg: 'input', text: '!' }])
    ov.focusOp(st, ctx, 'next')
    expect(ov.focusInfo(ctx)?.label).toBe('Fighting')
    sent.length = 0
    ov.focusOp(st, ctx, 'cancel')
    expect(sent).toEqual([{ msg: 'key', keycode: Keys.ESC }])
  })
  it('the keyboard drives the same cursor: arrows move, Enter fires, and a raw key stays raw', () => {
    const { ov, st, sent, frame } = setup()
    load(st)
    const ctx = frame()
    expect(ov.focusKey(st, ctx, 'next')).toBe(true)
    expect(ov.focusKey(st, ctx, 'select')).toBe(true)
    expect(sent).toEqual([{ msg: 'input', text: 'b' }])
    // Escape is not a focusable here: it goes out untouched
    expect(ov.focusKey(st, ctx, 'cancel')).toBe(false)
  })
  it('a crt screen with no scraper still offers the switches it prints, and forwards the arrows off them', () => {
    const { ov, st, sent, frame } = setup()
    reduce(st, { msg: 'menu', type: 'crt', tag: 'mystery' })
    reduce(st, { msg: 'txt', id: 'menu_txt', lines: { 0: 'a - Something   [x] do it' } })
    const ctx = frame()
    // its rows want a scraper of their own; the switch it prints is walkable now
    expect(ctx.focus?.count).toBe(1)
    expect(ctx.focus?.label).toBe('do it')
    ov.focusOp(st, ctx, 'select')
    expect(sent).toEqual([{ msg: 'input', text: 'x' }])
    sent.length = 0
    // one switch and nothing else: the move has nowhere to go and reaches the server raw
    ov.focusOp(st, ctx, 'next')
    expect(sent).toEqual([{ msg: 'key', keycode: Keys.CK_DOWN }])
  })
})

describe('prompt card', () => {
  it('yes/no: A is Yes, B is No, left/right swap them; the keyboard fires Enter only after an arrow, Escape never', () => {
    const { ov, st, sent, frame, focusedText, host } = setup()
    reduce(st, { msg: 'msgs', messages: [{ text: 'Really attack? (y/n)', channel: 2 }] })
    reduce(st, { msg: 'input_mode', mode: MouseMode.YESNO })
    const ctx = frame()
    expect(ctx.mode).toBe('yesno')
    expect(ctx.focus).toMatchObject({ label: 'Yes', cancelLabel: 'No' })
    expect(focusedText()).toBe('Yes')
    expect(actionLabel(bindingTable(ctx).B!, ctx)).toBe('No')
    // the chips wear the buttons that fire them
    expect(Array.from(host.querySelectorAll('.prompt-card .chip')).map((c) => c.className)).toEqual(['chip A focused', 'chip B'])
    // a yes/no's question is not its answers: the text stays over the chips
    expect(host.querySelector('.prompt-card .text')?.textContent).toBe('Really attack? (y/n)')
    ov.focusOp(st, ctx, 'right')
    expect(focusedText()).toBe('No')
    ov.focusOp(st, ctx, 'left')
    ov.focusOp(st, ctx, 'select')
    ov.focusOp(st, ctx, 'cancel')
    expect(sent).toEqual([
      { msg: 'input', text: 'y' },
      { msg: 'input', text: 'n' },
    ])
    sent.length = 0
    // Enter and Escape are the server's (its default answer) until an arrow has moved the cursor
    expect(ov.focusKey(st, ctx, 'select')).toBe(false)
    expect(ov.focusKey(st, ctx, 'cancel')).toBe(false)
    expect(ov.focusKey(st, ctx, 'right')).toBe(true)
    expect(focusedText()).toBe('No')
    expect(host.querySelector('.prompt-card.armed')).not.toBeNull()
    expect(ov.focusKey(st, ctx, 'cancel')).toBe(false)
    expect(ov.focusKey(st, ctx, 'select')).toBe(true)
    expect(sent).toEqual([{ msg: 'input', text: 'n' }])
  })
  it('multi-choice prompt: one chip per parsed hotkey, wrapping; the cursor and A pick, not X and Y', () => {
    const { ov, st, sent, frame, host } = setup()
    reduce(st, { msg: 'msgs', messages: [{ text: '(D)rop, (w)ield, or (e)at?', channel: 2 }] })
    reduce(st, { msg: 'input_mode', mode: MouseMode.PROMPT })
    const ctx = frame()
    expect(ctx.mode).toBe('prompt')
    expect(ctx.focus?.count).toBe(3)
    expect(host.querySelector('.prompt-card')).not.toBeNull()
    // the text is nothing but its options: the chips are the question, and there is no verb to head them
    expect(host.querySelector('.prompt-card .text')).toBeNull()
    expect(host.querySelector('.prompt-card .lead')).toBeNull()
    ov.focusOp(st, ctx, 'prev')
    expect(ov.focusInfo(ctx)?.label).toBe('eat')
    ov.focusOp(st, ctx, 'select')
    expect(sent).toEqual([{ msg: 'input', text: 'e' }])
    sent.length = 0
    const t = bindingTable(ctx)
    // the answers are not on the face buttons: the cursor and A pick one (this ctx is the frame's, cursor on the first chip)
    expect(t.X).toBeUndefined()
    expect(t.Y).toBeUndefined()
    expect(actionLabel(t.A!, ctx)).toBe('Drop')
    // Escape may cancel this prompt, so B stays the layer's cancel: no cancel chip, so it is Esc
    expect(t.B).toEqual({ kind: 'focus', op: 'cancel' })
    ov.focusOp(st, ctx, 'cancel')
    expect(sent).toEqual([{ msg: 'key', keycode: Keys.ESC }])
  })
  it('a letter picker: "Adjust to which letter?" lays out every inventory letter, starting on the one being moved; A sends the lit letter', () => {
    const { ov, st, sent, frame, host } = setup()
    reduce(st, { msg: 'player', inv: { 0: { name: 'a +0 dagger' }, 2: { name: '5 scrolls of identify' } } })
    // adjust.cc adjust_item: the item's name, then prompt_invent_item's manual-list prompt; get_ch is MOUSE_MODE_PROMPT (macro.cc)
    reduce(st, { msg: 'msgs', messages: [{ text: 'c - 5 scrolls of identify', channel: 0 }, { text: 'Adjust to which letter?  (<w>?</w> for menu, <w>Esc</w> to quit)', channel: 2 }] })
    reduce(st, { msg: 'input_mode', mode: MouseMode.PROMPT })
    let ctx = frame()
    expect(ctx.mode).toBe('prompt')
    expect(ctx.prompt).toMatchObject({ letters: 'item', from: 'c', cancel: true })
    expect(ctx.prompt?.options).toHaveLength(52)
    expect(ctx.prompt?.options[0]).toEqual({ hotkey: 'a', label: 'a', held: 'a +0 dagger' })
    expect(ctx.prompt?.options[1]).toEqual({ hotkey: 'b', label: 'b' })
    expect(ctx.prompt?.options[26]).toEqual({ hotkey: 'A', label: 'A' })
    // the cursor starts on the letter being moved, and the line under the grid names what it holds
    expect(ctx.focus).toMatchObject({ label: 'c', count: 52 })
    const letters = Array.from(host.querySelectorAll('.prompt-card .letters .chip'))
    expect(letters.map((c) => c.textContent).join('')).toBe('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ')
    expect(letters[0].className).toBe('chip letter held')
    expect(letters[1].className).toBe('chip letter')
    expect(letters[2].className).toBe('chip letter held from focused')
    expect(host.querySelector('.prompt-card .slot')?.textContent).toBe('c5 scrolls of identify')
    // a grid, not a row: down goes to the row below, the bumpers hop to the other case
    ov.focusOp(st, ctx, 'left')
    ov.focusOp(st, ctx, 'left')
    expect(ov.focusInfo(ctx)?.label).toBe('a')
    expect(host.querySelector('.prompt-card .slot')?.textContent).toBe('aa +0 dagger')
    ov.focusOp(st, ctx, 'next')
    expect(ov.focusInfo(ctx)?.label).toBe('n')
    expect(host.querySelector('.prompt-card .slot')?.textContent).toBe('nempty')
    ov.focusOp(st, ctx, 'pageNext')
    expect(ov.focusInfo(ctx)?.label).toBe('N')
    ov.focusOp(st, ctx, 'right')
    ov.focusOp(st, ctx, 'select')
    expect(sent).toEqual([{ msg: 'input', text: 'O' }])
    sent.length = 0
    // the answers are not on the face buttons; B is Esc, which prompt_invent_item takes as quit
    ctx = frame()
    const t = bindingTable(ctx)
    expect(t.X).toBeUndefined()
    expect(t.Y).toBeUndefined()
    expect(actionLabel(t.A!, ctx)).toBe('O')
    ov.focusOp(st, ctx, 'cancel')
    expect(sent).toEqual([{ msg: 'key', keycode: Keys.ESC }])
  })
  it('a spell letter picker: the letters stand bare, with no inventory line under them', () => {
    const { st, frame, host } = setup()
    reduce(st, { msg: 'player', inv: { 0: { name: 'a +0 dagger' } } })
    // adjust.cc _adjust_spell: "Adjust which spell? ", the spell's line, then the bare prompt
    reduce(st, { msg: 'msgs', messages: [{ text: 'Adjust which spell? ', channel: 2 }, { text: 'a - Flame Tongue', channel: 0 }, { text: 'Adjust to which letter? ', channel: 2 }] })
    reduce(st, { msg: 'input_mode', mode: MouseMode.PROMPT })
    const ctx = frame()
    expect(ctx.prompt).toMatchObject({ letters: 'spell', from: 'a' })
    expect(ctx.prompt?.options[0]).toEqual({ hotkey: 'a', label: 'a' })
    expect(ctx.focus?.label).toBe('a')
    expect(host.querySelectorAll('.prompt-card .letters .chip.held')).toHaveLength(0)
    expect(host.querySelector('.prompt-card .slot')).toBeNull()
  })
  it('choices spelled "k - label" on the lines after the prompt (orders to allies): one chip each, the question over them', () => {
    const { ov, st, sent, frame, host } = setup()
    // shout.cc _issue_orders_prompt: the prompt line, then the choices, two to a line where they share one
    reduce(st, {
      msg: 'msgs',
      messages: [
        { text: 'What are your orders?', channel: 2 },
        { text: ' t - Shout!', channel: 0 },
        { text: 'Orders for allies: a - Attack new target.', channel: 0 },
        { text: '                   r - Retreat!             s - Stop attacking.', channel: 0 },
        { text: '                   g - Guard the area.      f - Follow me.', channel: 0 },
        { text: ' Anything else - Cancel.', channel: 0 },
      ],
    })
    reduce(st, { msg: 'input_mode', mode: MouseMode.PROMPT })
    const ctx = frame()
    expect(ctx.mode).toBe('prompt')
    expect(ctx.prompt?.options).toEqual([
      { hotkey: 't', label: 'Shout!' },
      { hotkey: 'a', label: 'Attack new target' },
      { hotkey: 'r', label: 'Retreat!' },
      { hotkey: 's', label: 'Stop attacking' },
      { hotkey: 'g', label: 'Guard the area' },
      { hotkey: 'f', label: 'Follow me' },
    ])
    expect(host.querySelector('.prompt-card .text')?.textContent).toBe('What are your orders?')
    ov.focusOp(st, ctx, 'right')
    ov.focusOp(st, ctx, 'right')
    ov.focusOp(st, ctx, 'select')
    expect(sent).toEqual([{ msg: 'input', text: 'r' }])
  })
  it('a digit range and a "k - label" on the prompt line (waypoints): a chip per digit, then the letter', () => {
    const { st, frame } = setup()
    // travel.cc add_waypoint
    reduce(st, { msg: 'msgs', messages: [{ text: 'Existing waypoints:', channel: 0 }, { text: '(0) D:2 x:12 y:5', channel: 0 }, { text: 'Assign waypoint to what number? (0-9, D - delete waypoint) ', channel: 2 }] })
    reduce(st, { msg: 'input_mode', mode: MouseMode.PROMPT })
    const ctx = frame()
    expect(ctx.prompt?.options.map((o) => o.hotkey + '=' + o.label)).toEqual(['0=0', '1=1', '2=2', '3=3', '4=4', '5=5', '6=6', '7=7', '8=8', '9=9', 'D=Delete waypoint'])
    expect(ctx.focus?.count).toBe(11)
  })
  it('a "(K) Name" list printed after the prompt (annotate, after !): the branches join the prompt\'s own keys; the list alone is no prompt', () => {
    const { st, frame } = setup()
    // dgn-overview.cc _prompt_annotate_branch, then _show_dungeon_overview on `!` (clear_messages clears nothing on WebTiles by default)
    reduce(st, { msg: 'msgs', messages: [{ text: 'Annotate which branch? (. - D:3, ? - help, ! - show branch list)', channel: 2 }] })
    reduce(st, { msg: 'input_mode', mode: MouseMode.PROMPT })
    let ctx = frame()
    expect(ctx.prompt?.options).toEqual([
      { hotkey: '.', label: 'D:3' },
      { hotkey: '?', label: 'Help' },
      { hotkey: '!', label: 'Show branch list' },
    ])
    reduce(st, { msg: 'msgs', messages: [{ text: '(D) Dungeon        (T) Temple         (L) Lair           (O) Orc', channel: 0 }, { text: '(V) Vaults', channel: 0 }] })
    ctx = frame()
    expect(ctx.prompt?.options.map((o) => o.hotkey)).toEqual(['.', '?', '!', 'D', 'T', 'L', 'O', 'V'])
    expect(ctx.prompt?.options[3]).toEqual({ hotkey: 'D', label: 'Dungeon' })
    // the list without a prompt line near it is not a prompt
    reduce(st, { msg: 'msgs', messages: Array.from({ length: 8 }, () => ({ text: '(D) Dungeon', channel: 0 })) })
    ctx = frame()
    expect(ctx.prompt).toBeUndefined()
  })
  it('a menu shown in the message pane (travel, G): its "(K) Name" rows on the prompt channel before the prompt are the chips, then its named keys', () => {
    const { ov, st, sent, frame, host } = setup()
    // prompt.cc PromptMenu::show_in_msgpane: the rows, then the title, all MSGCH_PROMPT; travel.cc refresh_prompt for the title
    reduce(st, {
      msg: 'msgs',
      messages: [
        { text: 'You see here a stone staircase.', channel: 0 },
        { text: '(D) Dungeon             (T) Temple              (L) Lair                ', channel: 2 },
        { text: '(O) Orcish Mines        (S) Snake Pit           ', channel: 2 },
        { text: 'Where to? (Tab/Enter - D:3, ? - help) ', channel: 2 },
      ],
    })
    reduce(st, { msg: 'input_mode', mode: MouseMode.PROMPT })
    let ctx = frame()
    expect(ctx.prompt?.text).toBe('Where to? (Tab/Enter - D:3, ? - help) ')
    expect(ctx.prompt?.options).toEqual([
      { hotkey: 'D', label: 'Dungeon' },
      { hotkey: 'T', label: 'Temple' },
      { hotkey: 'L', label: 'Lair' },
      { hotkey: 'O', label: 'Orcish' },
      { hotkey: 'S', label: 'Snake' },
      { hotkey: '\t', label: 'D:3' },
      { hotkey: '?', label: 'Help' },
    ])
    expect(ctx.focus).toMatchObject({ label: 'Dungeon', count: 7 })
    ov.focusOp(st, ctx, 'right')
    ov.focusOp(st, ctx, 'right')
    ov.focusOp(st, ctx, 'select')
    expect(sent).toEqual([{ msg: 'input', text: 'L' }])
    sent.length = 0
    // the remembered target is Tab, a key, not text
    ov.focusOp(st, ctx, 'last')
    ov.focusOp(st, ctx, 'left')
    ov.focusOp(st, ctx, 'select')
    expect(sent).toEqual([{ msg: 'key', keycode: 9 }])
    // after the keyboard the chip wears the key's name
    ctx = frame('keyboard')
    expect(Array.from(host.querySelectorAll('.prompt-card .chip kbd')).map((c) => c.textContent)).toEqual(['D', 'T', 'L', 'O', 'S', 'Tab', '?'])
  })
  it('the stat-gain prompt: only the prompt line on the card, the cursor picks, no Cancel', () => {
    const { st, frame, host } = setup()
    // an earlier command's messages end at the return to command mode
    reduce(st, { msg: 'msgs', messages: [{ text: 'You see here a dagger.', channel: 0, turn: 40 }] })
    reduce(st, { msg: 'input_mode', mode: MouseMode.COMMAND })
    // player-stats.cc attribute_increase, after the level-up (Options.easy_confirm != all: uppercase)
    reduce(st, {
      msg: 'msgs',
      messages: [
        { text: 'You kill the rat!', channel: 0, turn: 41 },
        { text: 'You have reached level 3!', channel: 11, turn: 41 },
        { text: 'Your experience leads to an increase in your attributes!', channel: 11, turn: 41 },
        { text: 'Your base attributes are Str 10, Int 8, Dex 12.', channel: 2, turn: 41 },
        { text: 'Increase (S)trength, (I)ntelligence, or (D)exterity? ', channel: 2, turn: 41 },
      ],
    })
    reduce(st, { msg: 'input_mode', mode: MouseMode.PROMPT })
    const ctx = frame()
    expect(ctx.mode).toBe('prompt')
    expect(ctx.prompt).toMatchObject({
      cancel: false,
      options: [
        { hotkey: 'S', label: 'Strength' },
        { hotkey: 'I', label: 'Intelligence' },
        { hotkey: 'D', label: 'Dexterity' },
      ],
    })
    // the level-up lines stay in the message log; the card is the prompt alone
    expect(host.querySelector('.prompt-card')?.textContent).not.toContain('You have reached level 3!')
    // Escape does nothing to this prompt (CASE_ESCAPE ... break), so B offers nothing; the answers are not on X / Y either
    const t = bindingTable(ctx)
    expect(t.X).toBeUndefined()
    expect(t.Y).toBeUndefined()
    expect(t.B).toBeUndefined()
    expect(actionLabel(t.A!, ctx)).toBe('Strength')
    expect(Array.from(host.querySelectorAll('.prompt-card .chip')).map((c) => c.className)).toEqual(['chip focused', 'chip', 'chip'])
    // after the pad the chips wear no glyph: the cursor marks the answer
    expect(host.querySelector('.prompt-card .chip svg')).toBeNull()
    // the question is its options plus a verb: no question line, the verb heads the chips, so nothing reads twice
    expect(host.querySelector('.prompt-card .text')).toBeNull()
    expect(host.querySelector('.prompt-card .lead')?.textContent).toBe('Increase')
    expect(host.querySelector('.prompt-card kbd')).toBeNull()
    // the keyboard spoke last: the chips wear their letters as key caps, the case the game demands
    frame('keyboard')
    expect(host.querySelector('.prompt-card.kbd')).not.toBeNull()
    expect(Array.from(host.querySelectorAll('.prompt-card .chip kbd')).map((c) => c.textContent)).toEqual(['S', 'I', 'D'])
    expect(Array.from(host.querySelectorAll('.prompt-card .chip .label')).map((c) => c.textContent)).toEqual(['Strength', 'Intelligence', 'Dexterity'])
    expect(host.querySelector('.prompt-card .chip svg')).toBeNull()
    // back on the pad, the chips are bare again
    frame('pad')
    expect(host.querySelector('.prompt-card .chip svg')).toBeNull()
    expect(host.querySelector('.prompt-card kbd')).toBeNull()
  })
  it('a prompt that asks more than its options keeps its question over the chips', () => {
    const { st, frame, host } = setup()
    reduce(st, { msg: 'msgs', messages: [{ text: 'Really drop the (h)ammer or (s)word you are wielding?', channel: 2 }] })
    reduce(st, { msg: 'input_mode', mode: MouseMode.PROMPT })
    frame('keyboard')
    expect(host.querySelector('.prompt-card .text')?.textContent).toBe('Really drop the (h)ammer or (s)word you are wielding?')
    expect(host.querySelector('.prompt-card .lead')).toBeNull()
    expect(Array.from(host.querySelectorAll('.prompt-card .chip kbd')).map((c) => c.textContent)).toEqual(['h', 's'])
  })
  it('the card goes away with the prompt', () => {
    const { st, frame, host } = setup()
    reduce(st, { msg: 'msgs', messages: [{ text: 'Really? (y/n)', channel: 2 }] })
    reduce(st, { msg: 'input_mode', mode: MouseMode.YESNO })
    frame()
    expect(host.querySelector('.prompt-card')).not.toBeNull()
    reduce(st, { msg: 'input_mode', mode: MouseMode.COMMAND })
    const ctx = frame()
    expect(ctx.mode).toBe('command')
    expect(host.querySelector('.prompt-card')).toBeNull()
    expect(ctx.focus).toBeUndefined()
  })
  it('--more-- puts up no card and no cursor: the message pane carries it', () => {
    const { st, frame, host } = setup()
    reduce(st, { msg: 'msgs', messages: [{ text: 'You see here a scroll.', channel: 0 }], more: true })
    reduce(st, { msg: 'input_mode', mode: MouseMode.MORE })
    const ctx = frame()
    expect(ctx.mode).toBe('more')
    expect(host.querySelector('.prompt-card')).toBeNull()
    expect(ctx.focus).toBeUndefined()
  })
})

describe('newgame', () => {
  const push = (st: GameState) =>
    reduce(st, {
      msg: 'ui-push',
      type: 'newgame-choice',
      title: 'Species',
      'main-items': {
        menu_id: 'species',
        buttons: [
          { x: 0, y: 0, hotkey: 97, label: 'Human', description: 'Humans.' },
          { x: 0, y: 1, hotkey: 98, label: 'Minotaur', description: 'Minotaurs.' },
          { x: 1, y: 0, hotkey: 99, label: 'Octopode', description: 'Octopodes.' },
        ],
      },
      'sub-items': { menu_id: 'sub', buttons: [{ x: 0, y: 0, hotkey: 42, label: '* - Random', description: 'Any.' }] },
    })
  it('the cursor is ours and moves at once; each move tells the server as a hover does, A and Enter fire the button', () => {
    const { ov, st, sent, frame, focusedText, host } = setup()
    push(st)
    reduce(st, { msg: 'ui-state', button_focus: 98 })
    const ctx = frame()
    expect(ctx.mode).toBe('newgame')
    expect(focusedText()).toBe('Minotaur')
    expect(host.querySelector('.descriptions .pane.current')?.textContent).toBe('Minotaurs.')
    // down from the last species row reaches the sub grid
    ov.focusOp(st, ctx, 'next')
    expect(focusedText()).toBe('* - Random')
    expect(host.querySelector('.descriptions .pane.current')?.textContent).toBe('Any.')
    expect(host.querySelector('.button.selected')?.textContent).toBe('* - Random')
    expect(sent).toEqual([{ msg: 'outer_menu_focus', hotkey: 42, menu_id: 'sub' }])
    sent.length = 0
    // the keyboard drives the same cursor
    expect(ov.focusKey(st, ctx, 'prev')).toBe(true)
    expect(ov.focusKey(st, ctx, 'right')).toBe(false) // Minotaur has nothing to its right: the key stays raw
    expect(ov.focusKey(st, ctx, 'prev')).toBe(true)
    expect(ov.focusKey(st, ctx, 'right')).toBe(true)
    expect(focusedText()).toBe('Octopode')
    sent.length = 0
    expect(ov.focusKey(st, ctx, 'select')).toBe(true)
    expect(sent).toEqual([
      { msg: 'outer_menu_focus', hotkey: 99, menu_id: 'species' },
      { msg: 'key', keycode: 99 },
    ])
    sent.length = 0
    // Escape is not ours here
    expect(ov.focusKey(st, ctx, 'cancel')).toBe(false)
  })
  it('the server\'s own focus re-seats the cursor; an echo of ours (from_client) does not', () => {
    const { ov, st, frame, focusedText } = setup()
    push(st)
    reduce(st, { msg: 'ui-state', button_focus: 97 })
    let ctx = frame()
    expect(focusedText()).toBe('Human')
    ov.focusOp(st, ctx, 'next')
    expect(focusedText()).toBe('Minotaur')
    // the echo of our outer_menu_focus, arriving after we moved on
    reduce(st, { msg: 'ui-state', button_focus: 97, from_client: true })
    ov.focusOp(st, ctx, 'next')
    expect(focusedText()).toBe('* - Random')
    ctx = frame()
    expect(focusedText()).toBe('* - Random')
    // a move the server made itself (a hotkey typed raw)
    reduce(st, { msg: 'ui-state', button_focus: 99, from_client: false })
    ctx = frame()
    expect(focusedText()).toBe('Octopode')
    expect(ctx.focus?.label).toBe('Octopode')
  })
  it('a hover tells the server, and the echo leaves the button under the mouse alone, so the click lands', () => {
    // ui-layouts.js newgame_choice_update returns on `from_client` when not watching: the popup is not touched.
    // A rebuild on the echo would replace the button between mousedown and mouseup, and no click would fire.
    const { st, sent, frame, host } = setup()
    push(st)
    reduce(st, { msg: 'ui-state', button_focus: 97 })
    frame()
    const btn = host.querySelector('.button[data-hotkey="98"]') as HTMLElement
    btn.dispatchEvent(new MouseEvent('mouseenter'))
    expect(sent).toEqual([{ msg: 'outer_menu_focus', hotkey: 98, menu_id: 'species' }])
    sent.length = 0
    reduce(st, { msg: 'ui-state', type: 'newgame-choice', button_focus: 98, from_client: true })
    frame()
    expect(host.contains(btn)).toBe(true)
    btn.click()
    expect(sent).toEqual([
      { msg: 'outer_menu_focus', hotkey: 98, menu_id: 'species' },
      { msg: 'key', keycode: 98 },
    ])
    // a spectator follows the player's cursor: the echo re-seats it
    st.watching = { username: 'x' }
    reduce(st, { msg: 'ui-state', type: 'newgame-choice', button_focus: 99, from_client: true })
    frame()
    expect(host.querySelector('.button.selected')?.textContent).toBe('Octopode')
  })
})

describe('dialog', () => {
  it('its buttons are the choices', () => {
    const { ov, st, frame, focusedText } = setup()
    let clicked = ''
    reduce(st, { msg: 'show_dialog', html: '<p>Sure?</p><button id="ok">OK</button><button id="no">Cancel</button>' })
    const ctx = frame()
    expect(ctx.mode).toBe('dialog')
    document.getElementById('ok')!.addEventListener('click', () => (clicked = 'ok'))
    expect(focusedText()).toBe('OK')
    expect(ctx.focus?.count).toBe(2)
    ov.focusOp(st, ctx, 'select')
    expect(clicked).toBe('ok')
  })

  // dgamelaunch-config crawl-git-launcher.sh asks this one when a save is a
  // version behind; client.js handle_dialog answers it by sending [data-key]
  // as `input` bytes (send_bytes): only those reach the launcher's stdin, a
  // `key` message goes to crawl's socket, which is not open yet
  it("answers the launcher's save-transfer question with its buttons' keys", () => {
    const { ov, st, sent, host, frame } = setup()
    reduce(st, {
      msg: 'show_dialog',
      html: "<p>[T]ransfer your save to the latest version (0.35-a0)?</p><input type='button' class='button' data-key='N' value='No' style='float:right;'><input type='button' class='button' data-key='T' value='Yes' style='float:right;'>",
    })
    let ctx = frame()
    expect(ctx.mode).toBe('dialog')
    expect(ctx.focus).toMatchObject({ label: 'No', cancelLabel: 'No', count: 2 })
    // the buttons sit side by side: right walks to Yes, as up and down do
    ov.focusOp(st, ctx, 'right')
    ctx = frame()
    expect((host.querySelector('.focused') as HTMLInputElement).value).toBe('Yes')
    ov.focusOp(st, ctx, 'select')
    expect(sent).toEqual([{ msg: 'input', data: [84] }])
    sent.length = 0
    // B (and Escape) answers No, and so does a click on the button
    ov.focusOp(st, ctx, 'cancel')
    expect(sent).toEqual([{ msg: 'input', data: [78] }])
    sent.length = 0
    ;(host.querySelector("[data-key='T']") as HTMLElement).click()
    expect(sent).toEqual([{ msg: 'input', data: [84] }])
  })

  it('keeps the keyboard after a click on a button, and Enter fires what was clicked', () => {
    const { ov, st, sent, host, frame } = setup()
    reduce(st, {
      msg: 'show_dialog',
      html: "<p>[T]ransfer your save?</p><input type='button' data-key='N' value='No'><input type='button' data-key='T' value='Yes'>",
    })
    let ctx = frame()
    // a click leaves the button focused in the DOM; the game screen's keydown
    // guard must not read that as a field taking text (game.ts onKeyDown)
    const yes = host.querySelector("[data-key='T']") as HTMLInputElement
    yes.click()
    yes.focus()
    expect(isTextEntry(document.activeElement as HTMLElement)).toBe(false)
    // a field that does take text still keeps the keys (the chat line, a filter)
    expect(isTextEntry(document.createElement('textarea'))).toBe(true)
    expect(isTextEntry(Object.assign(document.createElement('input'), { type: 'text' }))).toBe(true)
    sent.length = 0
    // Enter now acts on the button that was clicked, not on where the cursor sat
    ctx = frame()
    expect(ov.focusKey(st, ctx, 'select')).toBe(true)
    expect(sent).toEqual([{ msg: 'input', data: [84] }])
  })
})

describe('server menus keep their own hover', () => {
  it('an inventory menu goes through menu_hover, not the focus layer', () => {
    const { ov, st, sent, frame } = setup()
    reduce(st, { msg: 'menu', tag: 'inventory', flags: 0, title: { text: 'Inventory' }, items: [{ text: 'a - a dagger', hotkeys: [97], level: 2 }, { text: 'b - a robe', hotkeys: [98], level: 2 }], total_items: 2 })
    const ctx = frame()
    expect(ctx.mode).toBe('menu')
    expect(ctx.focus).toBeUndefined()
    expect(bindingTable(ctx).A).toEqual({ kind: 'menu', op: 'select' })
    ov.menuOp(st, 'next')
    expect(sent[0]).toMatchObject({ msg: 'menu_hover' })
  })
})

/**
 * The client's own overlays (the pause menu, the settings, the palette): the
 * same walk as a server menu, on a cursor of their own.
 */
describe('client overlays', () => {
  it('the pause menu rings with the arrows, space and Enter fire the row, Home and End jump to the ends', () => {
    const acts: string[] = []
    const { ov, host } = setup()
    ov.showSystem({ spectating: true, inGame: true })
    const rows = () => Array.from(host.querySelectorAll('.sysmenu li')) as HTMLElement[]
    const focused = () => rows().findIndex((r) => r.classList.contains('focused'))
    expect(focused()).toBe(0)
    ov.clientOverlayInput('next')
    expect(focused()).toBe(1)
    // up from the first row rings round to the last
    ov.clientOverlayInput('prev')
    ov.clientOverlayInput('prev')
    expect(focused()).toBe(rows().length - 1)
    ov.clientOverlayInput('first')
    expect(focused()).toBe(0)
    ov.clientOverlayInput('last')
    expect(focused()).toBe(rows().length - 1)
    // space fires what the cursor is on, as it does in a server menu
    rows().forEach((r) => r.addEventListener('click', () => acts.push(r.textContent || '')))
    ov.clientOverlayInput('space')
    expect(acts).toEqual(['e-Stop watching'])
  })
})

describe('scroller popups with unprinted keys', () => {
  it('the dungeon overview: a row of what its keys do; the cursor walks it and A sends the key', () => {
    const { ov, st, sent, frame, host } = setup()
    reduce(st, { msg: 'ui-push', type: 'formatted-scroller', title: '', text: '<lightgrey>                    <white>Dungeon Overview and Level Annotations<lightgrey>\n\n<green>Branches:<lightgrey> (press <white>G<lightgrey> to reach them and <white>?/b<lightgrey> for more information)\n<yellow>Dungeon<lightgrey> <darkgrey>(2/15)<lightgrey>            \n\n<green>Altars:<lightgrey> (press <white>_<lightgrey> to reach them and <white>?/g<lightgrey> for information about gods)\n<darkgrey>Ashenzari<lightgrey>          <darkgrey>Cheibriados<lightgrey>' })
    let ctx = frame()
    expect(ctx.mode).toBe('popup')
    expect(ctx.popupActions?.map((a) => a.key + '=' + a.label)).toEqual(['G=Travel', '_=Altar', '$=Shops', '!=Annotate'])
    expect(ctx.focus).toMatchObject({ label: 'Travel', count: 4 })
    expect(host.querySelector('.popup .actions')?.textContent).toBe('(G) Travel, (_) Altar, ($) Shops, (!) Annotate')
    ov.focusOp(st, ctx, 'right')
    ov.focusOp(st, ctx, 'right')
    ov.focusOp(st, ctx, 'right')
    ov.focusOp(st, ctx, 'select')
    expect(sent).toEqual([{ msg: 'input', text: '!' }])
    sent.length = 0
    ctx = frame()
    expect(actionLabel(bindingTable(ctx).A!, ctx)).toBe('Annotate')
  })
  it("a god's description at an altar: the keyboard's Enter joins (raw to the server) until an arrow has taken the cursor; J stays raw too", () => {
    const { ov, st, sent, frame, host } = setup()
    // ui-layouts.js describe_god: the pane names sit behind ! and ^; at an altar the footer adds "J/Enter: join religion"
    reduce(st, { msg: 'ui-push', type: 'describe-god', name: 'Okawaru', colour: 14, description: 'Okawaru is a dangerous god.', title: 'the Fighter', favour: '', powers_list: '', powers: '', wrath: 'w', extra: '', is_altar: true, service_fee: '' })
    const ctx = frame('keyboard')
    expect(ctx.mode).toBe('popup')
    expect(host.querySelector('.popup .footer')?.textContent).toContain('J/Enter: join religion')
    // the cursor rests on the pane switch, but Enter is not its until the keyboard walked there
    expect(ctx.focus?.label).toBe('Powers')
    expect(ov.focusKey(st, ctx, 'select')).toBe(false)
    expect(sent).toEqual([])
    // an arrow the cursor cannot take (one item) is not a walk either: it scrolls the text, Enter stays raw
    expect(ov.focusKey(st, ctx, 'next')).toBe(false)
    expect(ov.focusKey(st, ctx, 'select')).toBe(false)
    expect(sent).toEqual([])
    // the pad's A fires the focused switch as before
    ov.focusOp(st, ctx, 'select')
    expect(sent).toEqual([{ msg: 'input', text: '!' }])
  })
  it('a popup whose row the keyboard can walk: an arrow that moves the cursor arms Enter, which then fires the focused key', () => {
    const { ov, st, sent, frame } = setup()
    reduce(st, { msg: 'ui-push', type: 'formatted-scroller', title: '', text: '<white>Dungeon Overview and Level Annotations<lightgrey>\n<yellow>Dungeon<lightgrey>' })
    const ctx = frame('keyboard')
    expect(ctx.focus).toMatchObject({ label: 'Travel', count: 4 })
    expect(ov.focusKey(st, ctx, 'select')).toBe(false)
    expect(ov.focusKey(st, ctx, 'right')).toBe(true)
    expect(ov.focusKey(st, ctx, 'select')).toBe(true)
    expect(sent).toEqual([{ msg: 'input', text: '_' }])
  })
  it('the help screen: its "k: Section" menu lines become the row, and it stays when a section replaces the text', () => {
    const { st, frame } = setup()
    reduce(st, { msg: 'ui-push', type: 'formatted-scroller', tag: 'help', title: '', text: '<h>Dungeon Crawl Help\n\nPress one of the following keys to\nobtain more information on a certain\naspect of Dungeon Crawl.\n<w>?</w>: List of commands\n<w>^</w>: Quickstart Guide\n<darkgrey>:: Browse character notes</darkgrey>\n<w>~</w>: Macros help\n<w>/</w>: Lookup description\n<w>Q</w>: FAQ' })
    let ctx = frame()
    expect(ctx.popupActions?.map((a) => a.key + '=' + a.label)).toEqual(['?=List of commands', '^=Quickstart Guide', '~=Macros help', '/=Lookup description', 'Q=FAQ'])
    reduce(st, { msg: 'ui-state', text: '<h>Macros\n\nA macro is...' })
    ctx = frame()
    expect(ctx.popupActions?.map((a) => a.key)).toEqual(['?', '^', '~', '/', 'Q'])
  })
  it('any other scroller (the message history) gets no row', () => {
    const { st, frame } = setup()
    reduce(st, { msg: 'ui-push', type: 'formatted-scroller', tag: 'message_history', title: '', text: 'You hit the rat.' })
    const ctx = frame()
    expect(ctx.popupActions).toEqual([])
  })
})

describe('the travel depth prompt', () => {
  it("comes with the keyboard up and the prompt's own keys over it as a labelled row; typing one sends it at once, Y takes the default", () => {
    const { ov, st, sent, frame, host } = setup()
    // travel.cc _prompt_travel_depth: a cancellable_get_line tagged travel_depth
    reduce(st, { msg: 'init_input', type: 'messages', tag: 'travel_depth', prompt: 'What level of Dungeon? (default D:3, ? - help) ', maxlen: 100 })
    const ctx = frame()
    expect(ctx.mode).toBe('text')
    // the keyboard is up at once, no press needed, its cursor on the prompt's first key
    expect(host.querySelectorAll('.osk').length).toBe(1)
    expect(Array.from(host.querySelectorAll('.osk .extras .key')).map((k) => k.textContent)).toEqual(['< Up', '> Down', '^ Entrance', '$ Deepest'])
    expect(host.querySelector('.osk .extras .key.focused')?.textContent).toBe('< Up')
    // an extra is sent as a key (travel.cc _travel_depth_munge `<` / `>`), with the text typed so far (none), as textinput.js does
    ov.oskOp('type')
    expect(sent).toEqual([{ msg: 'key', keycode: 21 }, { msg: 'key', keycode: 11 }, { msg: 'text_input', text: '<' }])
    sent.length = 0
    // the server asks again with the moved default, in one frame: the prompt is rebuilt, keyboard and cursor kept
    reduce(st, { msg: 'close_input' })
    reduce(st, { msg: 'init_input', type: 'messages', tag: 'travel_depth', prompt: 'What level of Dungeon? (default D:2, ? - help) ', maxlen: 100 })
    frame()
    expect(host.querySelectorAll('.osk').length).toBe(1)
    expect(host.querySelector('.osk .extras .key.focused')?.textContent).toBe('< Up')
    ov.oskOp('move', 2)
    expect(host.querySelector('.osk .extras .key.focused')?.textContent).toBe('> Down')
    ov.oskOp('type')
    expect(sent).toEqual([{ msg: 'key', keycode: 21 }, { msg: 'key', keycode: 11 }, { msg: 'text_input', text: '>' }])
    sent.length = 0
    // the keyboard follows the re-asked prompt, cursor where it was; up and down now walk its rows
    reduce(st, { msg: 'close_input' })
    reduce(st, { msg: 'init_input', type: 'messages', tag: 'travel_depth', prompt: 'What level of Dungeon? (default D:3, ? - help) ', maxlen: 100 })
    frame()
    expect(host.querySelectorAll('.osk').length).toBe(1)
    expect(host.querySelector('.osk .extras .key.focused')?.textContent).toBe('> Down')
    // down from the extras is the digit row; a digit is typed, not sent
    ov.oskOp('move', 4)
    expect(host.querySelector('.osk .keys .key.focused')?.textContent).toBe('2')
    ov.oskOp('type')
    expect(sent).toEqual([])
    ov.oskOp('submit')
    expect(sent).toEqual([{ msg: 'key', keycode: 21 }, { msg: 'key', keycode: 11 }, { msg: 'text_input', text: '2\r' }])
  })

  it('after the keyboard or the mouse the field stands alone, focused, and the on-screen keyboard waits for the pad', () => {
    const { ov, st, frame, host } = setup()
    // skill_menu.cc: a msgwin_get_line tagged skill_target, prefilled with the current target
    reduce(st, { msg: 'init_input', type: 'messages', tag: 'skill_target', prompt: 'Enter a skill target for Armour: ', maxlen: 3, size: 3, prefill: '0' })
    expect(frame('keyboard').mode).toBe('text')
    expect(host.querySelector('.osk')).toBeNull()
    const input = host.querySelector<HTMLInputElement>('.popup input.text')!
    expect(input.value).toBe('0')
    // the pad speaks: the keyboard comes up over the same field, no rebuild needed
    frame('pad')
    expect(host.querySelectorAll('.osk').length).toBe(1)
    expect(host.querySelector<HTMLInputElement>('.popup input.text')).toBe(input)
    // a physical key: it goes away again, so the field it covered shows what is typed
    frame('keyboard')
    expect(host.querySelector('.osk')).toBeNull()
    frame('pointer')
    expect(host.querySelector('.osk')).toBeNull()
    // X on the pad still brings it up on demand
    ov.oskOp('type')
    expect(host.querySelectorAll('.osk').length).toBe(1)
  })

  it('B leaves the prompt with an Escape and puts the keyboard away; X erases', () => {
    const { ov, st, sent, frame, host } = setup()
    reduce(st, { msg: 'init_input', type: 'messages', tag: 'travel_depth', prompt: 'What level of Dungeon? (default D:3, ? - help) ', maxlen: 100 })
    frame()
    expect(bindingTable(frame()).B).toEqual({ kind: 'osk', op: 'cancel' })
    expect(bindingTable(frame()).X).toEqual({ kind: 'osk', op: 'backspace' })
    // type a digit, erase it
    ov.oskOp('move', 4)
    ov.oskOp('type')
    expect((host.querySelector('.popup input.text') as HTMLInputElement).value).toBe('1')
    ov.oskOp('backspace')
    expect((host.querySelector('.popup input.text') as HTMLInputElement).value).toBe('')
    expect(sent).toEqual([])
    ov.oskOp('cancel')
    expect(sent).toEqual([{ msg: 'key', keycode: 27 }])
    expect(host.querySelector('.osk')).toBeNull()
  })

  it("spells its hint line the way the dialogs do: a glyph and a label per button, the keys at the end", () => {
    const { st, frame, host } = setup()
    reduce(st, { msg: 'init_input', type: 'messages', tag: 'travel_depth', prompt: 'What level of Dungeon? (default D:3, ? - help) ', maxlen: 100 })
    frame()
    const line = host.querySelector('.osk .more')!
    expect(Array.from(line.querySelectorAll('.osk-prompt')).map((p) => p.getAttribute('aria-label'))).toEqual(['A Type', 'X Backspace', 'RB Space', 'LB Shift', 'Y Done', 'B Cancel'])
    expect(line.querySelectorAll('.osk-prompt svg').length).toBe(6)
    expect(line.textContent!.endsWith(' · Enter / Esc')).toBe(true)
    expect(host.querySelector('.osk .muted')).toBeNull()
  })

  it('up and down keep their column: a wide row into the narrow extras row lands on its last key, not sideways', () => {
    const { ov, st, frame, host } = setup()
    reduce(st, { msg: 'init_input', type: 'messages', tag: 'travel_depth', prompt: 'What level of Dungeon? (default D:3, ? - help) ', maxlen: 100 })
    frame()
    const focused = () => host.querySelector('.osk .key.focused')?.textContent
    ov.oskOp('move', 4)
    for (let i = 0; i < 9; i++) ov.oskOp('move', 2)
    expect(focused()).toBe('0')
    ov.oskOp('move', 4)
    expect(focused()).toBe('p')
    ov.oskOp('move', 0)
    expect(focused()).toBe('0')
    ov.oskOp('move', 0)
    expect(focused()).toBe('$ Deepest')
    ov.oskOp('move', 4)
    expect(focused()).toBe('4')
  })
})
