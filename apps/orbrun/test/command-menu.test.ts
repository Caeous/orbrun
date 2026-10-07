// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadGamedata, type Gamedata } from '@orbrun/gamedata'
import { initialState, MouseMode, reduce, type ClientMessage } from '@orbrun/webtiles'
import { emptyScene } from '@orbrun/scene'
import { Overlays, commandTileId } from '../src/overlays'
import { PAGES } from '../src/pack-tabs'
import { CHARACTER_COMMANDS, GAMEPAD_COMMAND_KEYS, REPEAT_COMMAND } from '../src/command-menu'
import { ACTION_TABS } from '../src/action-tabs'
import { deriveContext } from '../src/context'
import { resolve, type Action } from '../src/bindings'
import commands from '../data/commands.json'
import pickup from './fixtures/menus/menu-pickup-1.json'

function setup() {
  const sent: ClientMessage[] = []
  const host = document.createElement('div')
  document.body.append(host)
  const changed = vi.fn()
  const ov = new Overlays(host, {
    send: (m) => sent.push(m), gamedata: () => null, watching: () => false,
    onClientOverlayChange: changed, onSystemAction: () => {},
    settingsPanel: () => ({ el: document.createElement('div'), rows: [] }),
  })
  const run = vi.fn<(a: Action) => void>()
  const focused = () => host.querySelector('.command-menu .focused .label, .sysmenu .focused .label')?.textContent
  const system = (spectating = false) => ov.showSystem({ spectating, inGame: true, run })
  /** a small list of choices, as a client menu is shown (Overlays.showChoices) */
  const list = () => ov.showChoices('Actions', ROWS.map((label) => ({ label, run: () => run({ kind: 'keys', label, seq: [] }) })))
  return { ov, host, sent, run, focused, changed, system, list }
}

const ROWS = ['Cast spell', 'Use ability', 'Evoke item', 'Swap weapons', 'Quiver item / action', 'Primary attack', 'Shout / order allies']

afterEach(() => { document.body.replaceChildren() })

describe('the command menus', () => {
  it('puts the whole menu away on Select, wherever in it the cursor stands', () => {
    const h = setup()
    h.list()
    expect(h.ov.hasClientOverlay).toBe(true)
    expect(h.ov.clientOverlayInput('close')).toBe(true)
    expect(h.ov.hasClientOverlay).toBe(false)
    // browsing sends nothing, and closing is browsing
    expect(h.run).not.toHaveBeenCalled()
    expect(h.sent).toEqual([])
    // a screen reached from another goes too: Select closes, it does not step back
    const back = vi.fn()
    h.ov.showChoices('Deeper', [{ label: 'Row', run: () => {} }], back)
    h.ov.clientOverlayInput('close')
    expect(h.ov.hasClientOverlay).toBe(false)
    expect(back).not.toHaveBeenCalled()
  })

  it("gives the Start menu its own commands, with none of the pad's own among them", () => {
    expect(new Set(CHARACTER_COMMANDS.map((c) => c.key)).size).toBe(CHARACTER_COMMANDS.length)
    for (const c of CHARACTER_COMMANDS) expect(GAMEPAD_COMMAND_KEYS.has(c.key)).toBe(false)
    // Repeat and Save are the Start menu's own rows, not commands on a list
    expect(REPEAT_COMMAND.key).toBe('`')
    expect(CHARACTER_COMMANDS.some((c) => c.key === '`' || c.key === 'S')).toBe(false)
  })

  it('search omits direct gamepad commands but keeps battle actions and other modes intact', () => {
    const h = setup()
    h.ov.showPalette('command')
    const labels = [...h.host.querySelectorAll('.palette .item > span:first-child')].map((r) => r.textContent)
    for (const c of commands.filter((c) => c.mode === 'command')) {
      expect(labels.includes(c.label)).toBe(!GAMEPAD_COMMAND_KEYS.has(c.key))
    }
    h.ov.showPalette('targeting')
    expect(h.host.querySelectorAll('.palette .item').length).toBe(commands.filter((c) => c.mode === 'targeting').length)
  })

  it('the Start menu switches tabs with arrows or clicks, wraps, and remembers each selection without sending keys', () => {
    const h = setup()
    h.system()
    expect([...h.host.querySelectorAll('.command-tabs button')].map((r) => r.textContent)).toEqual(['Character', 'System'])
    expect(h.focused()).toBe('Skills')
    h.ov.clientOverlayInput('next')
    h.ov.clientOverlayInput('right')
    expect(h.focused()).toBe('Resume')
    h.ov.clientOverlayInput('next')
    h.ov.clientOverlayInput('right')
    expect(h.focused()).toBe('Character status')
    h.ov.clientOverlayInput('left')
    expect(h.focused()).toBe('Repeat previous command')
    h.host.querySelectorAll<HTMLButtonElement>('.command-tabs button')[0].click()
    expect(h.focused()).toBe('Character status')
    expect(h.host.querySelector('.command-tabs .current')?.textContent).toBe('Character')
    h.ov.clientOverlayInput('cancel')
    expect(h.ov.hasClientOverlay).toBe(false)
    expect(h.run).not.toHaveBeenCalled()
    expect(h.sent).toEqual([])
  })

  it('the footer is the keyboard\'s, with key caps; the pad\'s prompts stand under the panel instead', () => {
    const h = setup()
    h.system()
    const more = h.host.querySelector('.command-menu .more')!
    h.ov.setDevice('keyboard')
    expect(h.host.querySelector('.overlay-stack')?.classList.contains('device-keyboard')).toBe(true)
    expect(more.classList.contains('kbd-only')).toBe(true)
    expect([...more.querySelectorAll('kbd')].map((k) => k.textContent)).toEqual(['←', '→', 'Enter', 'Esc'])
    expect(more.querySelector('svg')).toBeNull()
    expect(h.ov.padPrompts?.map((l) => l.button + ' ' + l.label)).toEqual(['A select'])
    // the pad speaks: the class flips without a rebuild, the same footer element, hidden by it
    h.ov.setDevice('pad')
    expect(h.host.querySelector('.overlay-stack')?.classList.contains('device-pad')).toBe(true)
    expect(h.host.querySelector('.command-menu .more')).toBe(more)
    // a pointer counts as the keyboard's side, as the prompt card does
    h.ov.setDevice('pointer')
    expect(h.host.querySelector('.overlay-stack')?.classList.contains('device-keyboard')).toBe(true)
    // a list with no tabs to switch: its footer says only what fires a row
    h.list()
    const flat = h.host.querySelector('.command-menu .more')!
    expect([...flat.querySelectorAll('kbd')].map((k) => k.textContent)).toEqual(['Enter', 'Esc'])
  })

  it('keeps the dialog and tabs mounted when bumpers, arrows or pointer change tabs', () => {
    const h = setup()
    h.system()
    const dialog = h.host.querySelector('.command-menu')!
    const tabs = h.host.querySelector('.command-tabs')!
    const panels = [...h.host.querySelectorAll<HTMLOListElement>('[role="tabpanel"]')]
    h.changed.mockClear()
    h.ov.clientOverlayInput('next')
    for (const op of ['bumperPrev', 'bumperPrev', 'bumperNext', 'bumperNext'] as const) {
      h.ov.clientOverlayInput(op)
      expect(h.host.querySelector('.command-menu')).toBe(dialog)
      expect(h.host.querySelector('.command-tabs')).toBe(tabs)
      expect(panels.filter((p) => !p.inert)).toHaveLength(1)
    }
    expect(h.host.querySelector('.command-tabs .current')?.textContent).toBe('Character')
    expect(h.focused()).toBe('Character status')
    h.ov.clientOverlayInput('right')
    h.host.querySelector<HTMLButtonElement>('#command-tab-character')!.click()
    expect(h.host.querySelector('.command-menu')).toBe(dialog)
    expect([...h.host.querySelectorAll('[role="tabpanel"]')]).toEqual(panels)
    expect(h.ov.clientOverlayHotkey('a')).toBe(false) // inactive System panel
    expect(h.changed).not.toHaveBeenCalled()
    expect(h.run).not.toHaveBeenCalled()
    expect(h.sent).toEqual([])
  })

  it('keeps Page Up / Down for rows, and bumpers page a menu without tabs', () => {
    const h = setup()
    h.system()
    h.ov.clientOverlayInput('pageNext')
    expect(h.focused()).toBe('Runes collected')
    expect(h.host.querySelector('.command-tabs .current')?.textContent).toBe('Character')
    h.ov.clientOverlayInput('pagePrev')
    expect(h.focused()).toBe('Skills')
    h.list()
    h.ov.clientOverlayInput('bumperNext')
    expect(h.focused()).toBe('Shout / order allies')
    h.ov.clientOverlayInput('bumperPrev')
    expect(h.focused()).toBe('Cast spell')
    expect(h.run).not.toHaveBeenCalled()
  })

  it('does not spend a turn browsing, remembers selection, and Start submits it', () => {
    const h = setup()
    h.list()
    h.ov.clientOverlayInput('next')
    h.ov.clientOverlayInput('cancel')
    expect(h.run).not.toHaveBeenCalled()
    expect(h.sent).toEqual([])
    h.list()
    expect(h.focused()).toBe('Use ability')
    h.ov.clientOverlayInput('submit')
    expect(h.run).toHaveBeenCalledExactlyOnceWith({ kind: 'keys', label: 'Use ability', seq: [] })
    expect(h.ov.hasClientOverlay).toBe(false)
  })

  it('the list comes back to the row a command was picked from, by click or by pad', () => {
    const h = setup()
    h.list()
    expect(h.focused()).toBe('Cast spell')
    const evoke = [...h.host.querySelectorAll<HTMLElement>('.command-menu ol li')].find((r) => r.textContent?.startsWith('Evoke item'))!
    evoke.click()
    expect(h.run).toHaveBeenCalledTimes(1)
    expect(h.ov.hasClientOverlay).toBe(false)
    h.list()
    expect(h.focused()).toBe('Evoke item')
    h.ov.clientOverlayInput('next')
    h.ov.clientOverlayInput('submit')
    expect(h.run).toHaveBeenCalledTimes(2)
    h.list()
    expect(h.focused()).toBe('Swap weapons')
    expect(h.sent).toEqual([])
  })

  it('the Start menu comes back to the tab it was left on', () => {
    const h = setup()
    h.system()
    h.ov.clientOverlayInput('right')
    expect(h.host.querySelector('.command-tabs .current')?.textContent).toBe('System')
    h.ov.clientOverlayInput('cancel')
    h.system()
    expect(h.host.querySelector('.command-tabs .current')?.textContent).toBe('System')
    expect(h.focused()).toBe('Resume')
    expect(h.sent).toEqual([])
  })

  it('the Start menu holds the character screens and the game options, and a spectator only the options', () => {
    const h = setup()
    const options = () => [...h.host.querySelectorAll('.sysrows .label')].map((r) => r.textContent)
    h.system()
    expect([...h.host.querySelectorAll('#command-panel-character .label')].map((r) => r.textContent)).toEqual(CHARACTER_COMMANDS.map((c) => c.label))
    expect(options()).toEqual(['Resume', 'Repeat previous command', 'Game menu', 'Help', 'Chat', 'Gamepad controls', 'Settings', 'Save and exit'])
    // the game's key on the right, as the Character tab's commands carry theirs
    expect([...h.host.querySelectorAll('.sysrows li')].map((r) => r.querySelector('.hotkey')?.textContent ?? '')).toEqual(['Esc', '`', 'F1', '?', 'F12', '', '', 'S'])
    expect([...h.host.querySelectorAll('.sysrows li.sep .label')].map((r) => r.textContent)).toEqual(['Gamepad controls', 'Save and exit'])
    // the System tab, from its third row: the game's own menu
    h.ov.clientOverlayInput('right')
    h.ov.clientOverlayInput('next')
    h.ov.clientOverlayInput('next')
    h.ov.clientOverlayInput('select')
    expect(h.sent).toEqual([{ msg: 'input', text: '~' }])
    h.sent.length = 0
    h.system()
    h.ov.clientOverlayInput('last')
    h.ov.clientOverlayInput('select')
    expect(h.sent).toEqual([{ msg: 'input', text: 'S' }])
    h.sent.length = 0
    // a spectator sends no keys, so there is no character to read and no tabs
    h.system(true)
    expect(h.host.querySelector('.command-tabs')).toBeNull()
    expect(options()).toEqual(['Resume', 'Chat', 'Gamepad controls', 'Settings', 'Stop watching'])
    expect([...h.host.querySelectorAll('.sysrows li.sep .label')].map((r) => r.textContent)).toEqual(['Gamepad controls', 'Stop watching'])
    expect(h.run).not.toHaveBeenCalled()
    expect(h.sent).toEqual([])
  })

  it('recorded pickup: A marks an item, and once one is marked Start sends Enter instead of selecting another item', () => {
    const h = setup()
    const st = initialState()
    st.phase = 'playing'
    st.inputMode = MouseMode.COMMAND
    for (const m of pickup.msgs) {
      if (m.msg === 'close_menu' || m.msg === 'close_all_menus') break
      reduce(st, m as never)
    }
    h.ov.update(st)
    const ctx = deriveContext(st, emptyScene(), { facing: 0 } as never, 'micro')
    const select = resolve({ type: 'press', button: 'A', t: 0 }, ctx)
    expect(select).toEqual({ kind: 'menu', op: 'select' })
    h.sent.length = 0
    h.ov.menuOp(st, 'select')
    expect(h.sent.some((m) => m.msg === 'key' && m.keycode === 13)).toBe(false)
    expect(h.sent.some((m) => m.msg === 'key')).toBe(true)
    // nothing marked yet: Enter would take nothing, and Start is not offered
    expect(resolve({ type: 'press', button: 'START', t: 1 }, ctx)).toBeNull()
    // the server marks the row (menu.cc MenuEntry::get_text: `a + ...`), and Start takes it
    const menu = st.menus[st.menus.length - 1]
    const row = menu.items.findIndex((it) => !!it?.hotkeys?.length)
    menu.items[row] = { ...menu.items[row]!, text: menu.items[row]!.text!.replace(/^(\s*\S) - /, '$1 + ') }
    const marked = deriveContext(st, emptyScene(), { facing: 0 } as never, 'micro')
    expect(resolve({ type: 'press', button: 'START', t: 2 }, marked)).toMatchObject({ kind: 'keys', seq: [{ key: 13 }] })
  })
})

/**
 * The icons are named, not numbered, so a name that this version of crawl does
 * not have fails quietly -- the row simply keeps an empty column. This pins
 * every name in the catalogue against real gamedata, so a typo is a failure
 * here rather than a hole in the menu.
 */
describe('the command icons', () => {
  let gd: Gamedata
  beforeAll(async () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '../../../packages/scene-webtiles/test/fixtures/gamedata')
    const version = readdirSync(root)[0]
    gd = await loadGamedata({
      base: 'fixture://x', version, skipImages: true,
      io: {
        async fetchText(url) { return readFileSync(join(root, version, url.split('/').pop()!), 'utf8') },
        async loadImage() { throw new Error('no images in tests') },
      },
    })
  })

  it('names a tile crawl has, for every command that carries one', () => {
    const named = [...ACTION_TABS, ...CHARACTER_COMMANDS].filter((c) => c.tile)
    expect(named.length).toBeGreaterThan(0)
    expect(named.filter((c) => commandTileId(gd, c.tile) === undefined).map((c) => `${c.label}: ${c.tile}`)).toEqual([])
  })

  it("names a tile crawl has for every page of the pack", () => {
    expect(PAGES.filter((p) => commandTileId(gd, p.tile) === undefined).map((p) => `${p.label}: ${p.tile}`)).toEqual([])
  })

  it('has no icon where gamedata has not loaded', () => {
    expect(commandTileId(null, 'CMD_DISPLAY_MAP')).toBeUndefined()
    expect(commandTileId(gd, undefined)).toBeUndefined()
  })
})
