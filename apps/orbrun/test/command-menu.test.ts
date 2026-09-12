// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initialState, MouseMode, reduce, type ClientMessage } from '@orbrun/webtiles'
import { emptyScene } from '@orbrun/scene'
import { Overlays } from '../src/overlays'
import { BATTLE_COMMANDS, COMMAND_GROUPS, GAMEPAD_COMMAND_KEYS, REPEAT_COMMAND, TRAVEL_COMMANDS } from '../src/command-menu'
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
    settingsPanel: () => document.createElement('div'),
  })
  const run = vi.fn<(a: Action) => void>()
  const focused = () => host.querySelector('.command-menu .focused .label')?.textContent
  return { ov, host, sent, run, focused, changed }
}

afterEach(() => { document.body.replaceChildren() })

describe('the grouped command menu', () => {
  it('offers native commands in stable order and sends exactly their keys', () => {
    const h = setup()
    for (const group of [{ id: 'battle' as const, entries: BATTLE_COMMANDS }, ...COMMAND_GROUPS]) {
      h.ov.showCommands(h.run, group.id)
      expect([...h.host.querySelectorAll('.command-menu ol:not(.inactive) .label')].map((r) => r.textContent)).toEqual([
        ...group.entries.map((c) => c.label),
      ])
      expect(new Set(group.entries.map((c) => c.key)).size).toBe(group.entries.length)
      for (const c of group.entries) {
        if (c.action.kind !== 'keys' || c.action.seq.length !== 1) continue
        const step = c.action.seq[0]
        const native = 'text' in step ? step.text : String.fromCharCode(step.key)
        expect(commands.some((entry) => entry.mode === 'command' && entry.key === native)).toBe(true)
        h.ov.showCommands(h.run, group.id)
        expect(h.ov.clientOverlayHotkey(c.key)).toBe(true)
        expect(h.run).toHaveBeenLastCalledWith(c.action)
        expect(h.ov.hasClientOverlay).toBe(false)
      }
    }
  })

  it('puts the whole menu away on Select, wherever in it the cursor stands', () => {
    const h = setup()
    h.ov.showCommands(h.run, 'select')
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

  it('keeps battle actions on RB and non-battle commands on Select', () => {
    expect(BATTLE_COMMANDS.map((c) => c.key)).toEqual(['q', 'r', 'z *', 'a *', 'V', "'", 'Q', ')', '(', 'v', 't'])
    const expected = [
      ['Ctrl-F', 'G', 'Ctrl-O', 'X', 'G <', 'G >'],
      ['e', 'w', 'W', 'T', 'P', 'R', 'd'],
      ['@', '%', '^', '=', 'A', 'm', '}', '\\', '$', 'M', 'I'],
    ]
    COMMAND_GROUPS.forEach((g, i) => {
      expect(g.entries.map((c) => c.key)).toEqual(expect.arrayContaining(expected[i]))
      expect(g.entries.some((c) => BATTLE_COMMANDS.some((b) => b.key === c.key))).toBe(false)
    })
    for (const c of [...BATTLE_COMMANDS, ...COMMAND_GROUPS.flatMap((g) => g.entries)]) {
      expect(GAMEPAD_COMMAND_KEYS.has(c.key)).toBe(false)
    }
    expect(REPEAT_COMMAND.key).toBe('`')
    expect(COMMAND_GROUPS.flatMap((g) => g.entries).some((c) => c.key === '`' || c.key === 'S')).toBe(false)
  })

  it('RB has no management tabs, search or More, and group navigation stays in battle', () => {
    const h = setup()
    h.ov.showCommands(h.run)
    expect(h.host.querySelector('.title')?.textContent).toBe('Actions')
    expect(h.host.querySelector('.command-tabs')).toBeNull()
    h.ov.clientOverlayInput('right')
    h.ov.clientOverlayInput('catNext')
    expect([...h.host.querySelectorAll('.command-menu .label')].map((r) => r.textContent)).toEqual(BATTLE_COMMANDS.map((c) => c.label))
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

  it('switches groups with arrows or tabs, wraps, and remembers each selection without sending keys', () => {
    const h = setup()
    h.ov.showCommands(h.run, 'travel')
    h.ov.clientOverlayInput('next')
    h.ov.clientOverlayInput('right')
    expect(h.focused()).toBe('Wield weapon')
    h.ov.clientOverlayInput('next')
    h.ov.clientOverlayInput('right')
    expect(h.focused()).toBe('Skills')
    h.ov.clientOverlayInput('right')
    expect(h.focused()).toBe('Find downstairs')
    h.ov.clientOverlayInput('left')
    expect(h.focused()).toBe('Skills')
    h.host.querySelectorAll<HTMLButtonElement>('.command-tabs button')[1].click()
    expect(h.focused()).toBe('Wear armour')
    expect(h.host.querySelector('.command-tabs .current')?.textContent).toBe('Equipment')
    h.ov.clientOverlayInput('cancel')
    expect(h.ov.hasClientOverlay).toBe(false)
    expect(h.run).not.toHaveBeenCalled()
    expect(h.sent).toEqual([])
  })
  it('the footer reads in the words of the device that spoke last: key caps on the keyboard, glyphs on the pad', () => {
    const h = setup()
    h.ov.showCommands(h.run, 'select')
    const more = h.host.querySelector('.command-menu .more')!
    const shown = () => [...more.querySelectorAll<HTMLElement>('.pad-only, .kbd-only')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.className)
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
    void shown
  })

  it('keeps the dialog and tabs mounted when bumpers, arrows or pointer change tabs', () => {
    const h = setup()
    h.ov.showCommands(h.run, 'travel')
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
    expect(h.host.querySelector('.command-tabs .current')?.textContent).toBe('Travel')
    expect(h.focused()).toBe('Find downstairs')
    h.ov.clientOverlayInput('right')
    h.host.querySelector<HTMLButtonElement>('#command-tab-info')!.click()
    expect(h.host.querySelector('.command-menu')).toBe(dialog)
    expect([...h.host.querySelectorAll('[role="tabpanel"]')]).toEqual(panels)
    expect(h.ov.clientOverlayHotkey('G')).toBe(false) // inactive Travel panel
    expect(h.changed).not.toHaveBeenCalled()
    expect(h.run).not.toHaveBeenCalled()
    expect(h.sent).toEqual([])
  })

  it('keeps Page Up / Down for rows and bumpers page a menu without tabs', () => {
    const h = setup()
    h.ov.showCommands(h.run, 'info')
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

  it('uses only the command tabs, with no search or More submenu', () => {
    const h = setup()
    for (const group of COMMAND_GROUPS) {
      h.ov.showCommands(h.run, group.id)
      expect([...h.host.querySelectorAll('.command-tabs button')].map((r) => r.textContent)).toEqual(['Travel', 'Equipment', 'Character'])
      expect(h.host.textContent).not.toContain('All commands / search')
      expect(h.host.textContent).not.toContain('More…')
      expect(h.host.querySelector('input')).toBeNull()
    }
    expect(h.run).not.toHaveBeenCalled()
    expect(h.sent).toEqual([])
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

  it('Select comes back to the tab and row a command was picked from, by click or by pad', () => {
    const h = setup()
    h.ov.showCommands(h.run, 'select')
    expect(h.host.querySelector('.command-tabs .current')?.textContent).toBe('Travel')
    h.ov.clientOverlayInput('right')
    const wear = [...h.host.querySelectorAll<HTMLElement>('.command-menu ol:not(.inactive) li')].find((r) => r.textContent?.startsWith('Wear armour'))!
    wear.click()
    expect(h.run).toHaveBeenCalledTimes(1)
    expect(h.ov.hasClientOverlay).toBe(false)
    h.ov.showCommands(h.run, 'select')
    expect(h.host.querySelector('.command-tabs .current')?.textContent).toBe('Equipment')
    expect(h.focused()).toBe('Wear armour')
    h.ov.clientOverlayInput('right')
    h.ov.clientOverlayInput('next')
    h.ov.clientOverlayInput('submit')
    expect(h.run).toHaveBeenCalledTimes(2)
    h.ov.showCommands(h.run, 'select')
    expect(h.host.querySelector('.command-tabs .current')?.textContent).toBe('Character')
    expect(h.focused()).toBe(COMMAND_GROUPS[2].entries[1].label)
    expect(h.sent).toEqual([])
  })

  it('the Start menu holds the game options, Save and exit last while playing and Stop watching last as a spectator', () => {
    const h = setup()
    const labels = () => [...h.host.querySelectorAll('.sysmenu .label')].map((r) => r.textContent)
    h.ov.showSystem({ spectating: false, inGame: true })
    expect(labels()).toEqual(['Resume', 'Repeat previous command (`)', 'Game menu (F1)', 'Help (?)', 'Chat (F12)', 'Gamepad', 'Settings', 'Save and exit (S)'])
    expect([...h.host.querySelectorAll('.sysmenu li.sep .label')].map((r) => r.textContent)).toEqual(['Gamepad', 'Save and exit (S)'])
    h.ov.clientOverlayInput('next')
    h.ov.clientOverlayInput('next')
    h.ov.clientOverlayInput('select')
    expect(h.sent).toEqual([{ msg: 'input', text: '~' }])
    h.sent.length = 0
    h.ov.showSystem({ spectating: false, inGame: true })
    h.ov.clientOverlayInput('last')
    h.ov.clientOverlayInput('select')
    expect(h.sent).toEqual([{ msg: 'input', text: 'S' }])
    h.ov.showSystem({ spectating: true, inGame: true })
    expect(labels()).toEqual(['Resume', 'Chat (F12)', 'Gamepad', 'Settings', 'Stop watching'])
    expect([...h.host.querySelectorAll('.sysmenu li.sep .label')].map((r) => r.textContent)).toEqual(['Gamepad', 'Stop watching'])
    expect(h.run).not.toHaveBeenCalled()
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
