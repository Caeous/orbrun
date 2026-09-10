// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { initialState, reduce, MouseMode, MenuFlag, type ClientMessage, type GameState } from '@orbrun/webtiles'
import { Overlays } from '../src/overlays'
import { deriveContext, type Context } from '../src/context'

/**
 * Orbrun's own row on the game menu (main.cc `GameMenu`): the server's list is
 * fixed on the server, so the settings row is the client's, drawn into the
 * same list above the separator before Quit. What is pinned here: the row is
 * kept out of the server's index space (a hover the server sends still lights
 * the row it means), the cursor walks onto it where it is drawn, choosing it
 * opens the settings without sending a key, and the menu opens again on the
 * row it was left on.
 */

const scene = { player: { x: 0, y: 0 }, cells: new Map(), billboards: [], playerOnLevel: false } as never
const cam = { facing: 0 } as never

function setup() {
  const sent: ClientMessage[] = []
  const host = document.createElement('div')
  document.body.append(host)
  const panel = document.createElement('div')
  panel.className = 'settings-panel'
  const ov = new Overlays(host, {
    send: (m) => sent.push(m),
    gamedata: () => null,
    watching: () => false,
    onClientOverlayChange: () => {},
    onSystemAction: () => {},
    settingsPanel: () => panel,
  })
  const st = initialState()
  st.phase = 'playing' as GameState['phase']
  st.inputMode = MouseMode.COMMAND
  const frame = (): Context => {
    ov.update(st)
    const ctx = deriveContext(st, scene, cam, 'micro')
    ov.updatePrompt(ctx.mode, ctx.prompt)
    ov.syncFocus(ctx)
    return ctx
  }
  const rows = () => Array.from(host.querySelectorAll('li')).map((li) => li.textContent?.trim() ?? '')
  const hovered = () => {
    const li = host.querySelector('li.hovered')
    return li ? li.textContent?.trim() ?? '' : null
  }
  return { ov, st, sent, host, frame, rows, hovered }
}

/**
 * The game menu as crawl sends it (main.cc `GameMenu::fill_entries`, with
 * `MenuEntry::get_text`'s " <key> - " preface): a blank subtitle, the options,
 * a second blank subtitle, then Quit. MF_ARROWS_SELECT, MF_WRAP and
 * MF_INIT_HOVER, its hover seated on the first row.
 */
function openGameMenu(st: GameState, hovered = 1) {
  const row = (key: string, code: number, label: string) => ({ text: ` ${key} - ${label}`, hotkeys: [code], level: 2 })
  reduce(st, {
    msg: 'menu',
    tag: 'game_menu',
    flags: MenuFlag.SINGLESELECT | MenuFlag.ALLOW_FORMATTING | MenuFlag.ARROWS_SELECT | MenuFlag.WRAP | MenuFlag.INIT_HOVER,
    last_hovered: hovered,
    title: { text: '<w>Dungeon Crawl Stone Soup 0.35-a0' },
    more: '',
    alt_more: '',
    items: [
      { text: '', level: 1 },
      row('Esc', 27, 'Return to game'),
      row('S', 83, 'Save and exit'),
      row('#', 35, 'Generate and view character dump'),
      row('~', 126, 'Edit macros'),
      row('?', 63, 'Help and manual'),
      row('/', 47, 'Lookup info'),
      { text: '', level: 1 },
      row('Q', 81, 'Quit and <lightred>abandon character</lightred>'),
    ],
  } as never)
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('the game menu', () => {
  it('draws Orbrun settings above the separator before Quit, and nowhere else', () => {
    const { st, frame, rows } = setup()
    openGameMenu(st)
    frame()
    expect(rows()).toEqual([
      '',
      'Esc - Return to game',
      'S - Save and exit',
      '# - Generate and view character dump',
      '~ - Edit macros',
      '? - Help and manual',
      '/ - Lookup info',
      '⚙ o - Orbrun settings',
      '',
      'Q - Quit and abandon character',
    ])
  })

  it('leaves the server rows their own indices: a hover the server sends lights the row it means', () => {
    const { st, frame, hovered } = setup()
    openGameMenu(st, 8)
    frame()
    expect(hovered()).toBe('Q - Quit and abandon character')
  })

  it('walks onto the row where it is drawn, and off it both ways', () => {
    const { ov, st, sent, frame, hovered } = setup()
    openGameMenu(st)
    frame()
    // Lookup info is the last row above ours
    for (let i = 0; i < 5; i++) ov.menuOp(st, 'next')
    expect(hovered()).toBe('/ - Lookup info')
    ov.menuOp(st, 'next')
    expect(hovered()).toBe('⚙ o - Orbrun settings')
    // the cursor is ours: nothing went to the server for that step
    expect(sent.filter((m) => m.msg === 'menu_hover').length).toBe(5)
    ov.menuOp(st, 'next')
    expect(hovered()).toBe('Q - Quit and abandon character')
    ov.menuOp(st, 'prev')
    expect(hovered()).toBe('⚙ o - Orbrun settings')
    ov.menuOp(st, 'prev')
    expect(hovered()).toBe('/ - Lookup info')
  })

  it('opens the settings without sending a key, from the pad and from the row s letter', () => {
    const { ov, st, sent, host, frame } = setup()
    openGameMenu(st)
    frame()
    for (let i = 0; i < 6; i++) ov.menuOp(st, 'next')
    const before = sent.length
    ov.menuOp(st, 'select')
    expect(sent.length).toBe(before)
    expect(host.querySelector('.settings-panel')).toBeTruthy()
    ov.closeClientOverlay()
    // the letter reaches the row from anywhere on the menu, and never the server
    expect(ov.menuKey(st, { key: 'o', code: 'KeyO', shiftKey: false, ctrlKey: false, altKey: false })).toBe(true)
    expect(sent.length).toBe(before)
    expect(host.querySelector('.settings-panel')).toBeTruthy()
  })

  it('opens again on the row it was left on', () => {
    const { ov, st, frame, hovered } = setup()
    openGameMenu(st)
    frame()
    for (let i = 0; i < 2; i++) ov.menuOp(st, 'next')
    expect(hovered()).toBe('# - Generate and view character dump')
    reduce(st, { msg: 'close_menu' } as never)
    frame()
    openGameMenu(st)
    frame()
    expect(hovered()).toBe('# - Generate and view character dump')
    // and on our own row when that is where it was left
    for (let i = 0; i < 4; i++) ov.menuOp(st, 'next')
    expect(hovered()).toBe('⚙ o - Orbrun settings')
    reduce(st, { msg: 'close_menu' } as never)
    frame()
    openGameMenu(st)
    frame()
    expect(hovered()).toBe('⚙ o - Orbrun settings')
  })
})
