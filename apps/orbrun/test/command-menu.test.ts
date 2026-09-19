// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadGamedata, type Gamedata } from '@orbrun/gamedata'
import { initialState, MouseMode, reduce, type ClientMessage } from '@orbrun/webtiles'
import { emptyScene } from '@orbrun/scene'
import { Overlays, commandTileId } from '../src/overlays'
import { BATTLE_COMMANDS, CHARACTER_COMMANDS, COMMAND_MENUS, EQUIPMENT_COMMANDS, GAMEPAD_COMMAND_KEYS, REPEAT_COMMAND, TRAVEL_COMMANDS } from '../src/command-menu'
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
  return { ov, host, sent, run, focused, changed, system }
}

afterEach(() => { document.body.replaceChildren() })

describe('the command menus', () => {
  it('offers native commands in stable order and sends exactly their keys', () => {
    const h = setup()
    for (const menu of COMMAND_MENUS) {
      h.ov.showCommands(h.run, menu.id)
      expect([...h.host.querySelectorAll('.command-menu ol .label')].map((r) => r.textContent)).toEqual(menu.entries.map((c) => c.label))
      expect(new Set(menu.entries.map((c) => c.key)).size).toBe(menu.entries.length)
      for (const c of menu.entries) {
        if (c.action.kind !== 'keys' || c.action.seq.length !== 1) continue
        const step = c.action.seq[0]
        const native = 'text' in step ? step.text : String.fromCharCode(step.key)
        expect(commands.some((entry) => entry.mode === 'command' && entry.key === native)).toBe(true)
        h.ov.showCommands(h.run, menu.id)
        expect(h.ov.clientOverlayHotkey(c.key)).toBe(true)
        expect(h.run).toHaveBeenLastCalledWith(c.action)
        expect(h.ov.hasClientOverlay).toBe(false)
      }
    }
  })

  it('puts the whole menu away on Select, wherever in it the cursor stands', () => {
    const h = setup()
    h.ov.showCommands(h.run, 'travel')
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

  it('gives each button its own list, with no command on two of them', () => {
    expect(BATTLE_COMMANDS.map((c) => c.key)).toEqual(['q', 'r', 'z *', 'a *', 'V', "'", 'Q', 'v', 't'])
    // the quiver cycles (`)` and `(`) are the palette's, not the button's
    expect(BATTLE_COMMANDS.some((c) => c.key === ')' || c.key === '(')).toBe(false)
    // Y is the gear button, and the pack is the first thing it opens
    expect(EQUIPMENT_COMMANDS[0].key).toBe('i')
    const lists = [...COMMAND_MENUS.map((m) => m.entries), CHARACTER_COMMANDS]
    const every = lists.flat()
    expect(new Set(every.map((c) => c.key)).size).toBe(every.length)
    for (const c of every) expect(GAMEPAD_COMMAND_KEYS.has(c.key)).toBe(false)
    // Repeat and Save are the Start menu's own rows, not commands on a list
    expect(REPEAT_COMMAND.key).toBe('`')
    expect(every.some((c) => c.key === '`' || c.key === 'S')).toBe(false)
  })

  it('a button menu has no tabs, search or More, and tab navigation stays in it', () => {
    const h = setup()
    for (const menu of COMMAND_MENUS) {
      h.ov.showCommands(h.run, menu.id)
      expect(h.host.querySelector('.title')?.textContent).toBe(menu.title)
      expect(h.host.querySelector('.command-tabs')).toBeNull()
      h.ov.clientOverlayInput('right')
      h.ov.clientOverlayInput('catNext')
      expect([...h.host.querySelectorAll('.command-menu .label')].map((r) => r.textContent)).toEqual(menu.entries.map((c) => c.label))
      expect(h.host.textContent).not.toContain('All commands / search')
      expect(h.host.textContent).not.toContain('More…')
      expect(h.host.querySelector('input')).toBeNull()
    }
    expect(h.run).not.toHaveBeenCalled()
    expect(h.sent).toEqual([])
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
    expect(h.focused()).toBe('Repeat previous command (`)')
    h.host.querySelectorAll<HTMLButtonElement>('.command-tabs button')[0].click()
    expect(h.focused()).toBe('Character status')
    expect(h.host.querySelector('.command-tabs .current')?.textContent).toBe('Character')
    h.ov.clientOverlayInput('cancel')
    expect(h.ov.hasClientOverlay).toBe(false)
    expect(h.run).not.toHaveBeenCalled()
    expect(h.sent).toEqual([])
  })

  it('the footer reads in the words of the device that spoke last: key caps on the keyboard, glyphs on the pad', () => {
    const h = setup()
    h.system()
    const more = h.host.querySelector('.command-menu .more')!
    // by default and after the keyboard, the pad reading is hidden and the keyboard one carries key caps, no glyphs
    h.ov.setDevice('keyboard')
    expect(h.host.querySelector('.overlay-stack')?.classList.contains('device-keyboard')).toBe(true)
    expect([...more.querySelectorAll('.kbd-only kbd')].map((k) => k.textContent)).toEqual(['←', '→', 'Enter', 'Esc'])
    expect(more.querySelector('.kbd-only svg')).toBeNull()
    expect(more.querySelector('.pad-only svg')).not.toBeNull()
    expect(more.querySelector('.pad-only')?.textContent).not.toContain('Back')
    expect(more.querySelectorAll('.pad-only svg')).toHaveLength(3) // LB, RB and A only
    // the pad speaks: the class flips without a rebuild, the same footer element
    h.ov.setDevice('pad')
    expect(h.host.querySelector('.overlay-stack')?.classList.contains('device-pad')).toBe(true)
    expect(h.host.querySelector('.command-menu .more')).toBe(more)
    // a pointer counts as the keyboard's side, as the prompt card does
    h.ov.setDevice('pointer')
    expect(h.host.querySelector('.overlay-stack')?.classList.contains('device-keyboard')).toBe(true)
    // a button's own list has no tabs to switch, so its footer says only what fires a row
    h.ov.showCommands(h.run, 'travel')
    const flat = h.host.querySelector('.command-menu .more')!
    expect([...flat.querySelectorAll('.kbd-only kbd')].map((k) => k.textContent)).toEqual(['Enter', 'Esc'])
    expect(flat.querySelectorAll('.pad-only svg')).toHaveLength(1)
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
    h.ov.showCommands(h.run)
    h.ov.clientOverlayInput('bumperNext')
    expect(h.focused()).toBe('Shout / order allies')
    h.ov.clientOverlayInput('bumperPrev')
    expect(h.focused()).toBe('Quaff potion')
    expect(h.run).not.toHaveBeenCalled()
  })

  it('does not spend a turn browsing, remembers selection, and Start submits it', () => {
    const h = setup()
    h.ov.showCommands(h.run)
    h.ov.clientOverlayInput('next')
    h.ov.clientOverlayInput('cancel')
    expect(h.run).not.toHaveBeenCalled()
    expect(h.sent).toEqual([])
    h.ov.showCommands(h.run)
    expect(h.focused()).toBe('Read scroll')
    h.ov.clientOverlayInput('submit')
    expect(h.run).toHaveBeenCalledExactlyOnceWith(BATTLE_COMMANDS[1].action)
    expect(h.ov.hasClientOverlay).toBe(false)
  })

  it('each button comes back to the row a command was picked from, by click or by pad', () => {
    const h = setup()
    h.ov.showCommands(h.run, 'equipment')
    expect(h.focused()).toBe('Inventory')
    const wear = [...h.host.querySelectorAll<HTMLElement>('.command-menu ol li')].find((r) => r.textContent?.startsWith('Wear armour'))!
    wear.click()
    expect(h.run).toHaveBeenCalledTimes(1)
    expect(h.ov.hasClientOverlay).toBe(false)
    // another button's list keeps its own cursor, untouched by the one next door
    h.ov.showCommands(h.run, 'travel')
    expect(h.focused()).toBe('Level map')
    h.ov.clientOverlayInput('next')
    h.ov.clientOverlayInput('submit')
    expect(h.run).toHaveBeenCalledTimes(2)
    h.ov.showCommands(h.run, 'equipment')
    expect(h.focused()).toBe('Wear armour')
    h.ov.clientOverlayInput('close')
    h.ov.showCommands(h.run, 'travel')
    expect(h.focused()).toBe('Go down a floor')
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
    expect(options()).toEqual(['Resume', 'Repeat previous command (`)', 'Game menu (F1)', 'Help (?)', 'Chat (F12)', 'Gamepad', 'Settings', 'Save and exit (S)'])
    expect([...h.host.querySelectorAll('.sysrows li.sep .label')].map((r) => r.textContent)).toEqual(['Gamepad', 'Save and exit (S)'])
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
    expect(options()).toEqual(['Resume', 'Chat (F12)', 'Gamepad', 'Settings', 'Stop watching'])
    expect([...h.host.querySelectorAll('.sysrows li.sep .label')].map((r) => r.textContent)).toEqual(['Gamepad', 'Stop watching'])
    expect(h.run).not.toHaveBeenCalled()
    expect(h.sent).toEqual([])
  })

  it('Select offers map and G travel, with prompt-gated nearest-stairs shortcuts', () => {
    const h = setup()
    h.ov.showCommands(h.run, 'travel')
    expect(h.focused()).toBe('Level map')
    h.ov.clientOverlayHotkey('G')
    expect(h.run).toHaveBeenLastCalledWith(expect.objectContaining({ seq: [{ text: 'G' }] }))
    expect(TRAVEL_COMMANDS.find((c) => c.key === 'G <')!.action).toMatchObject({ seq: [{ text: 'G' }, { text: '<', await: 'prompt' }] })
    expect(TRAVEL_COMMANDS.find((c) => c.key === 'G >')!.action).toMatchObject({ seq: [{ text: 'G' }, { text: '>', await: 'prompt' }] })
  })

  it('recorded pickup: A marks an item, Start sends Enter instead of selecting another item', () => {
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
    expect(resolve({ type: 'press', button: 'START', t: 1 }, ctx)).toMatchObject({ kind: 'keys', seq: [{ key: 13 }] })
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
    const named = [...BATTLE_COMMANDS, ...TRAVEL_COMMANDS, ...EQUIPMENT_COMMANDS, ...CHARACTER_COMMANDS].filter((c) => c.tile)
    expect(named.length).toBeGreaterThan(0)
    expect(named.filter((c) => commandTileId(gd, c.tile) === undefined).map((c) => `${c.label}: ${c.tile}`)).toEqual([])
  })

  // the menu a button opens should read as icons, not as a column of gaps
  it("gives every travel command an icon of crawl's own", () => {
    expect(TRAVEL_COMMANDS.filter((c) => !c.tile)).toEqual([])
  })

  it('has no icon where gamedata has not loaded', () => {
    expect(commandTileId(null, 'CMD_DISPLAY_MAP')).toBeUndefined()
    expect(commandTileId(gd, undefined)).toBeUndefined()
  })
})
