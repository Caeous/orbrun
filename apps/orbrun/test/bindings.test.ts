import { describe, it, expect } from 'vitest'
import { Keys, MouseMode, initialState, type MenuState } from '@orbrun/webtiles'
import { actionLabel, armsTapOrHold, barLabels, bindingTable, contextualLabel, controlSheet, holdAction, NO_ACTION, promptLabels, resolve } from '../src/bindings'
import { deriveMode, readiedAction, shopContext, type Context } from '../src/context'
import commands from '../data/commands.json'

const ctx = (over: Partial<Context>): Context => ({
  mode: 'command',
  layer: 'micro',
  ahead: { kind: 'none', label: '' },
  under: { kind: 'none', label: '' },
  hostilesInView: 0,
  ...over,
})

describe('modes come from the server, never from message text', () => {
  it('maps every inputMode the official client knows', () => {
    const st = initialState()
    st.phase = 'playing' as typeof st.phase
    const expect_ = (mode: number, want: string) => {
      st.inputMode = mode
      expect(deriveMode(st)).toBe(want)
    }
    expect_(MouseMode.COMMAND, 'command')
    expect_(MouseMode.MORE, 'more')
    expect_(MouseMode.YESNO, 'yesno')
    expect_(MouseMode.PROMPT, 'prompt')
    expect_(MouseMode.TARGET, 'targeting')
    expect_(MouseMode.TARGET_DIR, 'targeting')
    expect_(MouseMode.TARGET_PATH, 'targeting')
    // macro capture reads raw keys: not command mode, so no facing-relative rewrite
    expect_(MouseMode.MACRO, 'macro')
  })
  it('a yes/no the server asks as its own popup menu is a menu, not a prompt card', () => {
    // prompt.cc `yesno` with `use_popup` (inside a layout, or `prompt_menu`): fixture menu-prompt-1
    const st = initialState()
    st.phase = 'playing' as typeof st.phase
    st.inputMode = MouseMode.YESNO
    st.menus.push({ tag: 'prompt', items: [] } as unknown as (typeof st.menus)[number])
    expect(deriveMode(st)).toBe('menu')
    st.menus[0].tag = 'inventory'
    expect(deriveMode(st)).toBe('yesno')
  })
  it('in macro capture the pad offers nothing that would send a rotated key', () => {
    const t = bindingTable(ctx({ mode: 'macro' }))
    for (const a of Object.values(t)) expect(a.kind).not.toBe('step')
    expect(resolve({ type: 'dir', source: 'dpad', dir: 0 }, ctx({ mode: 'macro' }))).toBeNull()
  })
})

describe('focus modes share one binding set', () => {
  const focusModes = ['popup', 'newgame', 'crt', 'yesno', 'prompt', 'dialog', 'ended'] as const
  it('A selects the focused item, B cancels, the bumpers page, the d-pad moves the cursor', () => {
    for (const mode of focusModes) {
      const c = ctx({ mode })
      const t = bindingTable(c)
      expect(t.A, mode).toEqual({ kind: 'focus', op: 'select' })
      expect(t.B, mode).toEqual({ kind: 'focus', op: 'cancel' })
      if (mode !== 'dialog') {
        expect(t.LB, mode).toEqual({ kind: 'focus', op: 'pagePrev' })
        expect(t.RB, mode).toEqual({ kind: 'focus', op: 'pageNext' })
      }
      expect(resolve({ type: 'dir', source: 'dpad', dir: 0 }, c)).toEqual({ kind: 'focus', op: 'prev' })
      expect(resolve({ type: 'dir', source: 'dpad', dir: 4 }, c)).toEqual({ kind: 'focus', op: 'next' })
      expect(resolve({ type: 'dir', source: 'dpad', dir: 6 }, c)).toEqual({ kind: 'focus', op: 'left' })
      expect(resolve({ type: 'dir', source: 'dpad', dir: 2 }, c)).toEqual({ kind: 'focus', op: 'right' })
      expect(resolve({ type: 'dirRepeat', source: 'dpad', dir: 4, n: 1 }, c)).toEqual({ kind: 'focus', op: 'next' })
      // diagonals mean nothing to a cursor
      expect(resolve({ type: 'dir', source: 'dpad', dir: 1 }, c)).toBeNull()
    }
  })
  it('never sends a raw arrow key from the tables: the overlays decide the fallback', () => {
    for (const mode of focusModes) {
      const a = resolve({ type: 'dir', source: 'dpad', dir: 4 }, ctx({ mode }))
      expect(a?.kind).toBe('focus')
    }
  })
  it('labels A and B from the focus cursor, falling back to close / confirm', () => {
    const focus = { label: 'Fighting', cancelLabel: null, index: 0, count: 12 }
    expect(actionLabel({ kind: 'focus', op: 'select' }, ctx({ mode: 'crt', focus }))).toBe('Fighting')
    expect(actionLabel({ kind: 'focus', op: 'cancel' }, ctx({ mode: 'crt', focus }))).toBe('Cancel')
    expect(actionLabel({ kind: 'focus', op: 'select' }, ctx({ mode: 'popup' }))).toBe('Close')
    expect(actionLabel({ kind: 'focus', op: 'cancel' }, ctx({ mode: 'popup' }))).toBe('Close')
    expect(actionLabel({ kind: 'focus', op: 'select' }, ctx({ mode: 'prompt' }))).toBe('Confirm')
    const yn = { label: 'Yes', cancelLabel: 'No', index: 0, count: 2 }
    expect(actionLabel({ kind: 'focus', op: 'select' }, ctx({ mode: 'yesno', focus: yn }))).toBe('Yes')
    expect(actionLabel({ kind: 'focus', op: 'cancel' }, ctx({ mode: 'yesno', focus: yn }))).toBe('No')
  })
  it('the skills screen is a crt menu: focus, not the server-hover menu set', () => {
    const crtMenu = { menu: { tag: 'skills', type: 'crt', items: [], flags: 0 } as never, hoverable: [], arrowsSelect: false, multiselect: false, wrap: false }
    const c = ctx({ mode: 'menu', menu: crtMenu, crtTag: 'skills' })
    expect(bindingTable(c).A).toEqual({ kind: 'focus', op: 'select' })
    expect(resolve({ type: 'dir', source: 'dpad', dir: 4 }, c)).toEqual({ kind: 'focus', op: 'next' })
    // an ordinary menu keeps the server hover
    const c2 = ctx({ mode: 'menu', menu: { ...crtMenu, menu: { tag: 'inventory', items: [], flags: 0 } as never } })
    expect(bindingTable(c2).A).toEqual({ kind: 'menu', op: 'select' })
    expect(resolve({ type: 'dir', source: 'dpad', dir: 4 }, c2)).toEqual({ kind: 'menu', op: 'next' })
    // left / right reach the server raw (the inventory's category pages); the bumpers walk the sections
    expect(resolve({ type: 'dir', source: 'dpad', dir: 2 }, c2)).toEqual({ kind: 'menu', op: 'right' })
    expect(bindingTable(c2).LB).toEqual({ kind: 'menu', op: 'sectionPrev' })
    expect(bindingTable(c2).RB).toEqual({ kind: 'menu', op: 'sectionNext' })
  })
  it('X examines the hovered row of a menu that describes its rows; the label shows only on such a row', () => {
    const row = (letter: string) => ({ text: ` ${letter} - x`, hotkeys: [letter.charCodeAt(0)], level: 2 })
    const spells = { menu: { tag: 'spell', type: 'menu', items: [{ text: ' Spells', level: 1 }, row('a'), row('b')], flags: 0x40002, last_hovered: 1 } as never, hoverable: [1, 2], arrowsSelect: true, multiselect: false, wrap: false }
    const c = ctx({ mode: 'menu', menu: spells })
    expect(bindingTable(c).X).toEqual({ kind: 'menu', op: 'examine' })
    expect(actionLabel(bindingTable(c).X!, c)).toBe('Examine')
    expect(promptLabels(c).map((l) => l.button + ' ' + l.label)).toContain('X Examine')
    // on a header, or with no hover, the row has nothing to describe
    expect(promptLabels(ctx({ mode: 'menu', menu: { ...spells, menu: { ...(spells.menu as object), last_hovered: 0 } as never } })).map((l) => l.button)).not.toContain('X')
    expect(promptLabels(ctx({ mode: 'menu', menu: { ...spells, menu: { ...(spells.menu as object), last_hovered: -1 } as never } })).map((l) => l.button)).not.toContain('X')
    // the travel and prompt menus answer CMD_MENU_EXAMINE with nothing (Menu::examine_index), so the bar keeps quiet
    for (const tag of ['travel', 'prompt', 'game_menu']) {
      const c2 = ctx({ mode: 'menu', menu: { ...spells, menu: { ...(spells.menu as object), tag } as never } })
      expect(promptLabels(c2).map((l) => l.button), tag).not.toContain('X')
    }
    // the ones that describe: InvMenu's, spells, abilities, the stash search
    for (const tag of ['inventory', 'pickup', 'use_item', 'ability', 'stash']) {
      const c2 = ctx({ mode: 'menu', menu: { ...spells, menu: { ...(spells.menu as object), tag } as never } })
      expect(promptLabels(c2).map((l) => l.button + ' ' + l.label), tag).toContain('X Examine')
    }
  })
  it('newgame keeps its random / recommended shortcuts; an unparsed prompt keeps list and help', () => {
    const ng = bindingTable(ctx({ mode: 'newgame' }))
    expect(ng.X).toMatchObject({ kind: 'keys', label: 'Random' })
    expect(ng.Y).toMatchObject({ kind: 'keys', label: 'Recommended' })
    const bare = bindingTable(ctx({ mode: 'prompt' }))
    expect(bare.X).toMatchObject({ kind: 'keys', label: 'List' })
    // a parsed prompt is a plain focus set: its answers are chips, not face buttons
    const parsed = bindingTable(ctx({ mode: 'prompt', prompt: { text: '', options: [{ hotkey: 'w', label: 'wield' }], yesno: false, cancel: true } }))
    expect(parsed.X).toBeUndefined()
    expect(parsed.Y).toBeUndefined()
    expect(parsed.A).toEqual({ kind: 'focus', op: 'select' })
    expect(parsed.B).toEqual({ kind: 'focus', op: 'cancel' })
  })
  it('--more-- is not a focus mode: every face button still continues', () => {
    const t = bindingTable(ctx({ mode: 'more' }))
    expect(t.A).toMatchObject({ kind: 'keys', seq: [{ key: Keys.SPACE }] })
    expect(t.B).toMatchObject({ kind: 'keys', seq: [{ key: Keys.SPACE }] })
  })
})

describe('every non-command mode can reach its section of the palette', () => {
  for (const [mode, section] of [
    ['targeting', 'targeting'],
    ['levelmap', 'levelmap'],
    ['menu', 'menu'],
    ['crt', 'command'],
    ['prompt', 'command'],
  ] as const) {
    it(`${mode} -> ${section}`, () => {
      const t = bindingTable(ctx({ mode, menu: mode === 'menu' ? ({ menu: { items: [], flags: 0 } as never, hoverable: [], arrowsSelect: false, multiselect: false, wrap: false }) : undefined }))
      const pal = Object.values(t).find((a) => a.kind === 'ui' && a.op === 'palette')
      expect(pal).toMatchObject({ category: section })
    })
  }
})

describe('command catalogue', () => {
  type C = { id: string; mode: string; key?: string; ck?: string; label: string }
  const all = commands as C[]
  it('has a key for every entry and every CK name resolves', () => {
    for (const c of all) {
      expect(c.key !== undefined || c.ck !== undefined, c.id).toBe(true)
      if (c.ck) expect((Keys as Record<string, number>)[c.ck], c.ck).toBeTypeOf('number')
    }
  })
  it('has no duplicate ids within a section', () => {
    const seen = new Set<string>()
    for (const c of all) {
      expect(seen.has(c.mode + c.id), c.id).toBe(false)
      seen.add(c.mode + c.id)
    }
  })
  it('matches cmd-keys.h for the entries that used to be wrong', () => {
    const k = (id: string) => all.find((c) => c.id === id && c.mode === 'command')?.key
    expect(k('CMD_EXPERIENCE_CHECK')).toBe('E')
    expect(k('CMD_MACRO_ADD')).toBe('\x05') // Ctrl-E
    expect(k('CMD_GAME_MENU')).toBe('~')
    expect(k('CMD_AUTOFIRE')).toBe('p')
    expect(k('CMD_WEAR_JEWELLERY')).toBe('P')
    expect(k('CMD_FIRE_ITEM_NO_QUIVER')).toBe('F')
    for (const gone of ['CMD_TRAVEL_UP', 'CMD_LUA_CONSOLE', 'CMD_EXPLORE_ADJACENT', 'CMD_AUTOFIGHT_NOMOVE', 'CMD_PUT_ON_JEWELLERY', 'CMD_THROW_ITEM']) expect(k(gone), gone).toBeUndefined()
  })
  it('covers the command-mode keys the audit found unreachable', () => {
    const keys = new Set(all.filter((c) => c.mode === 'command').map((c) => c.key))
    for (const key of ['v', 'D', ';', '|', ')', '(', ']', '[', '"', '$', 'Z', '\\', '}', '\x04', '\x13', '\x17', '\x03', '\x14', '{', ':', '_', 'p', 'e', 'c', '`', '0']) expect(keys.has(key), JSON.stringify(key)).toBe(true)
  })
})

describe('direct command controls', () => {
  const stairsDown = { kind: 'feature' as const, feature: { type: 'stairs' as const, dir: 'down' as const }, label: 'stairs' }
  const ogre = { kind: 'monster' as const, monster: { id: 1, name: 'ogre' } as never, hostile: true, label: 'ogre' }
  it('a tap-or-hold binding waits for release, then splits on HOLD_MS', () => {
    const c = ctx({})
    expect(resolve({ type: 'press', button: 'LB', t: 0 }, c)).toBeNull()
    expect(resolve({ type: 'release', button: 'LB', t: 100, held: 100 }, c)).toMatchObject({ seq: [{ text: '.' }] })
    expect(resolve({ type: 'release', button: 'LB', t: 900, held: 900 }, c)).toBeNull()
    expect(holdAction('LB', c)).toMatchObject({ seq: [{ text: '5' }] })
  })
  it('a press that acted at once never becomes a tap when the server changes mode under it', () => {
    // A on a --more-- while standing on stairs: space goes on press, the
    // --more-- clears, and the release lands in command mode where A is the
    // contextual tap (Ascend). Only a press that opened a tap-or-hold arms
    // the release; game.ts `pad` drops the rest.
    const more = ctx({ mode: 'more' })
    expect(resolve({ type: 'press', button: 'A', t: 0 }, more)).toMatchObject({ seq: [{ key: 32 }] })
    expect(armsTapOrHold('A', more)).toBe(false)
    expect(armsTapOrHold('A', ctx({ mode: 'menu' }))).toBe(false)
    expect(armsTapOrHold('A', ctx({ mode: 'yesno' }))).toBe(false)
    const stairsUp = { kind: 'feature' as const, feature: { type: 'stairs' as const, dir: 'up' as const }, label: 'stairs' }
    const command = ctx({ under: stairsUp })
    expect(contextualLabel(command)).toBe('Ascend')
    expect(armsTapOrHold('A', command)).toBe(false)
    expect(armsTapOrHold('LB', command)).toBe(true)
    expect(armsTapOrHold('B', command)).toBe(false)
    expect(armsTapOrHold('Y', command)).toBe(false)
    expect(resolve({ type: 'press', button: 'Y', t: 0 }, command)).toMatchObject({ seq: [{ text: 'i' }] })
    expect(resolve({ type: 'release', button: 'Y', t: 100, held: 100 }, command)).toBeNull()
    // X acts on press in command mode too: its release is never a tap
    expect(armsTapOrHold('X', command)).toBe(false)
  })
  it('a held direction is a typewriter of single steps, never a run', () => {
    const c = ctx({})
    expect(resolve({ type: 'dir', source: 'lstick', dir: 0 }, c)).toEqual({ kind: 'step', dir: 0, turns: true })
    // every repeat tick offers one held step; the runner paces them (HELD_STEP_MS), never a Shift run
    const held = resolve({ type: 'dirRepeat', source: 'lstick', dir: 0, n: 1 }, c)
    expect(held).toEqual({ kind: 'step', dir: 0, turns: true, held: true })
    expect((held as { run?: boolean }).run).toBeUndefined()
    expect(resolve({ type: 'dirRepeat', source: 'dpad', dir: 4, n: 2 }, c)).toEqual({ kind: 'step', dir: 4, turns: true, held: true })
    // the stick walks under either trigger too; only a keyboard Shift+dir runs
    expect(resolve({ type: 'dirRepeat', source: 'lstick', dir: 0, n: 1 }, ctx({ layer: 'macro' }))).toEqual({ kind: 'step', dir: 0, turns: true, held: true })
    // the left stick is a d-pad: its left / right turn the camera rather than strafe
    expect(resolve({ type: 'dir', source: 'lstick', dir: 2 }, ctx({ layer: 'info' }))).toEqual({ kind: 'step', dir: 2, turns: true })
  })
  it('triggers are actions, never modifiers', () => {
    for (const layer of ['micro', 'macro', 'info'] as const) {
      const t = bindingTable(ctx({ layer }))
      expect(t.A).toEqual({ kind: 'contextual' })
      expect(t.LT).toEqual({ kind: 'fire' })
      expect(t.RT).toEqual({ kind: 'fight' })
      expect(t.RB).toEqual({ kind: 'ui', op: 'commands' })
      expect(t.SELECT).toEqual({ kind: 'ui', op: 'travel' })
      expect(t.START).toEqual({ kind: 'ui', op: 'system' })
    }
  })
  it('the d-pad always moves, even with a trigger held', () => {
    for (const layer of ['micro', 'macro', 'info'] as const) {
      expect(resolve({ type: 'dir', source: 'dpad', dir: 1 }, ctx({ layer }))).toEqual({ kind: 'step', dir: 1, turns: true })
      expect(resolve({ type: 'dirRepeat', source: 'dpad', dir: 4, n: 1 }, ctx({ layer }))).toEqual({ kind: 'step', dir: 4, turns: true, held: true })
    }
  })
  it('offers wait/rest on LB only while hurt with nothing in view', () => {
    const hurt = ctx({ injured: true })
    const b = promptLabels(hurt).find((l) => l.button === 'LB')!
    expect(b).toMatchObject({ label: 'Wait one turn', hold: 'Rest', contextual: true })
    // whole: nothing to rest for
    expect(promptLabels(ctx({})).find((l) => l.button === 'LB')).toBeUndefined()
    // a hostile in view: resting is not the move, so autofight takes the corner instead
    const fight = ctx({ injured: true, hostilesInView: 1 })
    expect(promptLabels(fight).find((l) => l.button === 'LB')).toBeUndefined()
    // not outside command mode
    expect(promptLabels(ctx({ injured: true, mode: 'menu' })).find((l) => l.button === 'LB')).toBeUndefined()
  })
  it('shows the server-provided readied action on LT', () => {
    const c = ctx({ readiedAction: 'Stone Arrow' })
    expect(promptLabels(c)).toContainEqual(expect.objectContaining({ button: 'LT', label: 'Stone Arrow' }))
    expect(bindingTable(c).LT).toEqual({ kind: 'fire' })
    // with nothing quivered the bar does not volunteer it
    expect(actionLabel({ kind: 'fire' }, ctx({}))).toBe('Fire')
    expect(promptLabels(ctx({})).find((l) => l.button === 'LT')).toBeUndefined()
  })
  it('reads the readied action from the formatted quiver line; an empty quiver is no action', () => {
    expect(readiedAction('<brown>Throw: <lightgreen>23 darts (poison)')).toBe('Throw: 23 darts (poison)')
    // quiver.cc quiver_description: the empty quiver is spelled out, not blank
    expect(readiedAction('<darkgrey>Nothing quivered</darkgrey>')).toBeUndefined()
    expect(readiedAction('')).toBeUndefined()
    expect(readiedAction(undefined)).toBeUndefined()
    expect(promptLabels(ctx({ readiedAction: readiedAction('<darkgrey>Nothing quivered</darkgrey>') })).find((l) => l.button === 'LT')).toBeUndefined()
  })
  it('A takes the stairs underfoot even with a monster ahead; RT offers autofight', () => {
    const c = ctx({ ahead: ogre, under: stairsDown })
    expect(contextualLabel(c)).toBe('Descend')
    expect(actionLabel({ kind: 'fight' }, c)).toBe('Autofight')
    expect(actionLabel({ kind: 'fight' }, ctx({}))).toBe('Autofight')
  })
  it('items on stairs use a chooser instead of a hold binding', () => {
    const c = ctx({ under: { ...stairsDown, items: 'a +0 mace' } })
    expect(contextualLabel(c)).toBe('Descend')
    expect(contextualLabel(c, true)).toBe('a +0 mace')
    expect(actionLabel({ kind: 'contextual' }, c)).toBe('Interact')
    expect(holdAction('A', c)).toBeNull()
    expect(actionLabel({ kind: 'contextual', alt: false }, c)).toBe('Descend')
    expect(actionLabel({ kind: 'contextual', alt: true }, c)).toBe('a +0 mace')
    expect(contextualLabel(ctx({ under: stairsDown }), true)).toBe(NO_ACTION)
  })
  it('RT fires once on press; neither holding nor releasing repeats it', () => {
    const c = ctx({})
    expect(resolve({ type: 'press', button: 'RT', t: 0 }, c)).toEqual({ kind: 'fight' })
    for (let n = 1; n <= 20; n++) expect(resolve({ type: 'repeat', button: 'RT', n }, c)).toBeNull()
    expect(resolve({ type: 'release', button: 'RT', t: 1000, held: 1000 }, c)).toBeNull()
  })
  it('inventory, explore and commands have direct buttons; no stick clicks are needed', () => {
    const t = bindingTable(ctx({}))
    expect(t.Y).toMatchObject({ seq: [{ text: 'i' }] })
    expect(t.R3).toEqual({ kind: 'examine' })
    expect(t.X).toMatchObject({ seq: [{ text: 'o' }] })
    expect(t.RB).toEqual({ kind: 'ui', op: 'commands' })
    expect(t.LB).toMatchObject({ kind: 'hold', tap: { seq: [{ text: '.' }] }, hold: { seq: [{ text: '5' }] } })
    expect(t.L3).toBeUndefined()
    expect(t.B).toMatchObject({ seq: [{ key: Keys.ESC }] })
  })
  it('the controls sheet describes Cancel, LB wait/rest and R3 examine', () => {
    const sheet = controlSheet()
    expect(sheet.find((r) => r.button === 'B')?.action).toEqual({ tap: 'Cancel' })
    expect(sheet.find((r) => r.button === 'LB')?.action).toEqual({ tap: 'Wait one turn', hold: 'Rest' })
    expect(sheet.find((r) => r.button === 'R3')?.action).toEqual({ tap: 'Examine' })
  })
  it('R3 examines once on press without repeating or acting on release', () => {
    const c = ctx({})
    expect(resolve({ type: 'press', button: 'R3', t: 0 }, c)).toEqual({ kind: 'examine' })
    expect(armsTapOrHold('R3', c)).toBe(false)
    expect(resolve({ type: 'repeat', button: 'R3', n: 1 }, c)).toBeNull()
    expect(resolve({ type: 'release', button: 'R3', t: 100, held: 100 }, c)).toBeNull()
  })
  it('A is only ever contextual: no bare step, no attack', () => {
    expect(contextualLabel(ctx({}))).toBe(NO_ACTION)
    expect(contextualLabel(ctx({ ahead: ogre }))).toBe(NO_ACTION)
    expect(contextualLabel(ctx({ ahead: { kind: 'wall', label: 'wall' } }))).toBe(NO_ACTION)
    expect(contextualLabel(ctx({ ahead: stairsDown }))).toBe(NO_ACTION)
    expect(contextualLabel(ctx({ ahead: { kind: 'door-closed', label: 'door' } }))).toBe('Open door')
  })
  it('items are picked up by A underfoot only; ahead A does nothing', () => {
    // crawl picks up from the cell you stand on: the player steps onto the pile and the prompt appears underfoot
    expect(contextualLabel(ctx({ ahead: { kind: 'item', label: 'dagger' } }))).toBe(NO_ACTION)
    expect(contextualLabel(ctx({ ahead: { kind: 'item', label: 'items' } }))).toBe(NO_ACTION)
    expect(contextualLabel(ctx({ under: { kind: 'item', label: 'a +0 halberd' } }))).toBe('a +0 halberd')
  })
  it('Start is Enter in menus and prompts, distinct from selecting a row', () => {
    for (const mode of ['menu', 'popup', 'prompt', 'yesno', 'crt', 'newgame', 'dialog', 'targeting', 'levelmap', 'more', 'macro'] as const) {
      expect(bindingTable(ctx({ mode })).START).toMatchObject({ seq: [{ key: Keys.ENTER }] })
    }
    expect(bindingTable(ctx({ mode: 'menu' })).A).toEqual({ kind: 'menu', op: 'select' })
    expect(bindingTable(ctx({ mode: 'menu' })).RT).toBeUndefined()
  })
})

describe('look mode (x): A describes, named for what the cursor rests on', () => {
  // directn.cc: `x` is `just_looking`; `v` is CMD_TARGET_DESCRIBE, while Enter and `.` select, which do_look_around turns into travel
  const look = (over: Partial<Context> = {}) => ctx({ mode: 'targeting', examining: true, ...over })
  it('A sends v as "Examine <thing>", X travels with `.`, B cancels, the bumpers cycle', () => {
    const t = bindingTable(look({ cursor: { kind: 'monster', monster: {} as never, hostile: true, label: 'goblin' } }))
    expect(t.A).toEqual({ kind: 'examine' })
    expect(t.X).toMatchObject({ seq: [{ text: '.' }], label: 'Travel here' })
    expect(t.B).toMatchObject({ seq: [{ key: Keys.ESC }] })
    expect(t.LB).toMatchObject({ seq: [{ text: '-' }] })
    expect(t.RB).toMatchObject({ seq: [{ text: '+' }] })
    // Enter would travel, not describe: no RT confirm in look mode
    expect(t.RT).toBeUndefined()
  })
  it('the bar shows A unasked, naming the monster, the pile, the feature, or "here" on the player', () => {
    const show = (c: Context) => promptLabels(c).map((l) => l.button + ' ' + l.label)
    expect(show(look({ cursor: { kind: 'monster', monster: {} as never, hostile: true, label: 'goblin' } }))).toEqual(['A Examine goblin'])
    expect(show(look({ cursor: { kind: 'item', label: 'a +0 halberd' } }))).toEqual(['A Examine a +0 halberd'])
    expect(show(look({ cursor: { kind: 'feature', feature: { type: 'stairs', dir: 'down' } as never, label: 'stone staircase' } }))).toEqual(['A Examine stone staircase'])
    expect(show(look({ cursor: { kind: 'none', label: 'here' } }))).toEqual(['A Examine here'])
    expect(show(look())).toEqual(['A Examine here'])
  })
  it('an aim (a throw, a spell) is shaped like the look: A fires, named for the target; X describes', () => {
    const aim = ctx({ mode: 'targeting', cursor: { kind: 'monster', monster: {} as never, hostile: true, label: 'goblin' } })
    const t = bindingTable(aim)
    expect(t.A).toEqual({ kind: 'fire' })
    expect(t.X).toMatchObject({ seq: [{ text: 'v' }] })
    expect(promptLabels(aim).map((l) => l.button + ' ' + l.label)).toEqual(['A Fire at goblin', 'LT Fire at goblin'])
    expect(promptLabels(ctx({ mode: 'targeting' })).map((l) => l.label)).toEqual(['Fire', 'Fire'])
  })
  it('LT is the same action before and inside the aim, so tapping it fires shot after shot as `f f f` does', () => {
    // the second tap may land either side of the server reporting the aim; both send f (CMD_TARGET_SELECT inside the prompt)
    expect(resolve({ type: 'press', button: 'LT', t: 0 }, ctx({}))).toEqual({ kind: 'fire' })
    expect(resolve({ type: 'press', button: 'LT', t: 0 }, ctx({ mode: 'targeting' }))).toEqual({ kind: 'fire' })
    // holding never repeats, as with every button
    expect(resolve({ type: 'repeat', button: 'LT', n: 1 }, ctx({ mode: 'targeting' }))).toBeNull()
    // a look is not an aim: LT there stays what the look table says
    expect(bindingTable(look()).LT).not.toEqual({ kind: 'fire' })
  })
  it('the d-pad still moves the cursor, facing-relative', () => {
    expect(resolve({ type: 'dir', source: 'dpad', dir: 0 }, look())).toEqual({ kind: 'cursor', dir: 0 })
  })
})

describe('the shop menu', () => {
  // rows as ShopEntry::get_text prints them; the more line as ShopMenu::update_help sets it
  const row = (letter: string, sign: string, name: string) => ({ text: `<lightgreen>${letter} ${sign} </lightgreen><lightgrey>  30 gold   ${name}</lightgrey>`, hotkeys: [letter.charCodeAt(0)] })
  const shopMenu = (mode: 'buy' | 'examine' | 'none', rows: ReturnType<typeof row>[], hovered = 0) => {
    const modeText = mode === 'buy' ? '[<w>!</w>] <w>buy</w>|examine items' : mode === 'examine' ? '[<w>!</w>] buy|<w>examine</w> items' : ''
    return { tag: 'shop', flags: 0x0004, title: { text: 'Welcome' }, more: `<yellow>You have 100 gold pieces.</yellow>\n[<w>Esc</w>] exit          ${modeText}`, alt_more: '', total_items: rows.length, items: rows, last_hovered: hovered }
  }
  const shopCtx = (mode: 'buy' | 'examine' | 'none', rows: ReturnType<typeof row>[], hovered = 0): Context => {
    const menu = shopMenu(mode, rows, hovered) as unknown as MenuState
    return ctx({ mode: 'menu', menu: { menu, hoverable: rows.map((_, i) => i), arrowsSelect: false, multiselect: true, wrap: false, shop: shopContext(menu) } })
  }
  it('reads the mode and each row\'s mark from what the server printed', () => {
    const s = shopContext(shopMenu('buy', [row('a', '-', 'a potion'), row('b', '+', 'a scroll'), row('c', '$', 'a wand')], 1) as unknown as MenuState)
    expect(s).toEqual({ canBuy: true, mode: 'buy', hoveredMarked: true, hoveredListed: false, anyMarked: true, anyListed: true })
    const e = shopContext(shopMenu('examine', [row('a', '-', 'a potion')]) as unknown as MenuState)
    expect(e.mode).toBe('examine')
    expect(e.canBuy).toBe(true)
    const v = shopContext(shopMenu('none', [row('a', '$', 'a potion')]) as unknown as MenuState)
    expect(v).toMatchObject({ canBuy: false, mode: 'examine', hoveredListed: true })
  })
  it('A marks or unmarks the row, Y lists it, Start buys, X flips buy/examine, R3 sorts, B leaves', () => {
    const c = shopCtx('buy', [row('a', '-', 'a potion'), row('b', '+', 'a scroll')])
    const t = bindingTable(c)
    expect(t.A).toEqual({ kind: 'menu', op: 'select' })
    expect(actionLabel(t.A!, c)).toBe('Mark')
    expect(t.Y).toEqual({ kind: 'menu', op: 'altSelect' })
    expect(actionLabel(t.Y!, c)).toBe('Add to list')
    expect(actionLabel(t.B!, c)).toBe('Leave')
    expect(t.X).toMatchObject({ kind: 'keys', seq: [{ text: '!' }], label: 'Buy|examine' })
    expect(t.START).toMatchObject({ kind: 'keys', seq: [{ key: Keys.ENTER }], label: 'Buy marked' })
    expect(t.LT).toMatchObject({ kind: 'keys', seq: [{ text: '$' }], label: 'List marked' })
    expect(t.R3).toMatchObject({ kind: 'keys', seq: [{ text: '/' }] })
    // the hovered row is marked: A unmarks it
    const c2 = shopCtx('buy', [row('a', '-', 'a potion'), row('b', '+', 'a scroll')], 1)
    expect(actionLabel(bindingTable(c2).A!, c2)).toBe('Unmark')
    // the d-pad still hovers rows
    expect(resolve({ type: 'dir', source: 'dpad', dir: 4 }, c)).toEqual({ kind: 'menu', op: 'next' })
  })
  it('with nothing marked, Enter buys the shopping list, or nothing at all', () => {
    const listed = shopCtx('buy', [row('a', '$', 'a potion')])
    expect(bindingTable(listed).START).toMatchObject({ label: 'Buy list' })
    expect(bindingTable(listed).LT).toMatchObject({ label: 'Mark listed' })
    expect(actionLabel(bindingTable(listed).Y!, listed)).toBe('Drop from list')
    const bare = shopCtx('buy', [row('a', '-', 'a potion')])
    expect(bindingTable(bare).START).toMatchObject({ seq: [{ key: Keys.ENTER }] })
    expect(bindingTable(bare).LT).toBeUndefined()
  })
  it('in examine mode A describes; a view-only shop offers no buy or mode switch', () => {
    const ex = shopCtx('examine', [row('a', '-', 'a potion')])
    expect(actionLabel(bindingTable(ex).A!, ex)).toBe('Examine')
    expect(bindingTable(ex).X).toMatchObject({ label: 'Buy|examine' })
    expect(bindingTable(ex).START).toMatchObject({ label: 'Describe' })
    const view = shopCtx('none', [row('a', '-', 'a potion')])
    expect(bindingTable(view).X).toBeUndefined()
    expect(actionLabel(bindingTable(view).A!, view)).toBe('Examine')
  })
})

describe('the action bar shows only what the situation created', () => {
  const goblin = { kind: 'monster', monster: { name: 'goblin' } as never, hostile: true, label: 'goblin' } as const
  const stairsDown = { kind: 'feature', feature: { type: 'stairs', dir: 'down' } as never, label: 'stairs' } as const
  const show = (c: Context) => promptLabels(c).map((l) => l.button + ' ' + l.label + (l.hold ? ' / ' + l.hold : ''))

  it('an empty corridor prompts nothing: no Wait, Inventory, Explore, Move or Look', () => {
    expect(show(ctx({}))).toEqual([])
    expect(barLabels(ctx({})).length).toBeGreaterThan(5)
  })
  it('a hostile ahead shows a forward attack separately from RT autofight', () => {
    const c = ctx({ ahead: goblin, hostilesInView: 1 })
    expect(show(c)).toEqual(['RT Autofight', 'LSTICK_UP Attack goblin'])
    const attack = promptLabels(c).find((l) => l.button === 'LSTICK_UP')!
    expect(attack.action).toMatchObject({ kind: 'step', dir: 0 })
    expect(resolve({ type: 'dir', source: 'lstick', dir: 0 }, c)).toMatchObject(attack.action)
  })
  it('never offers the forward attack for friendlies or outside command mode', () => {
    expect(show(ctx({ ahead: { ...goblin, hostile: false } }))).toEqual([])
    for (const mode of ['targeting', 'levelmap', 'menu', 'prompt', 'more', 'spectating'] as const) {
      expect(promptLabels(ctx({ mode, ahead: goblin, hostilesInView: 1 })).some((l) => l.button === 'LSTICK_UP')).toBe(false)
    }
  })
  it('a hostile in view but not ahead is what autofight is for', () => {
    expect(show(ctx({ hostilesInView: 2 }))).toEqual(['RT Autofight'])
  })
  it('the D:1 exit prompts Leave dungeon, never Enter or Ascend: `<` there asks to give up the game (main.cc _prompt_stairs)', () => {
    const exit = { kind: 'feature' as const, feature: { type: 'stairs' as const, dir: 'up' as const, exit: true }, label: 'exit from the dungeon' }
    expect(show(ctx({ under: exit }))).toEqual(['A Leave dungeon'])
  })
  it('stairs underfoot prompt Descend on A, or Interact when items also lie there', () => {
    expect(show(ctx({ under: stairsDown }))).toEqual(['A Descend'])
    expect(show(ctx({ under: { ...stairsDown, items: 'a +0 mace' } }))).toEqual(['A Interact'])
  })
  it('a shop is named by its wares, as the map labels it (scene-webtiles shopLabel)', () => {
    const shop = { kind: 'feature' as const, feature: { type: 'shop' as const }, label: 'weapon shop' }
    expect(show(ctx({ under: shop }))).toEqual(['A Weapon shop'])
  })
  it('items underfoot prompt A; items ahead do not', () => {
    expect(show(ctx({ ahead: { kind: 'item', label: 'scroll of identify' } }))).toEqual([])
    // underfoot the server named the pile (item_check's line); the label carries the name
    expect(show(ctx({ under: { kind: 'item', label: 'a +0 halberd' } }))).toEqual(['A a +0 halberd'])
  })
  it('old layer values do not reveal modifier controls', () => {
    expect(show(ctx({ layer: 'macro' }))).toEqual([])
    expect(show(ctx({ layer: 'info', hostilesInView: 1 }))).toEqual(['RT Autofight'])
  })
  it('a menu shows Start to confirm; a shop shows its marks and what Enter buys', () => {
    const menu = { menu: { tag: 'inv', type: 'menu', items: [], flags: 0 } as never, hoverable: [], arrowsSelect: false, multiselect: false, wrap: false }
    expect(show(ctx({ mode: 'menu', menu }))).toEqual(['START Confirm'])
    const shop = { canBuy: true, mode: 'buy', hoveredMarked: true, hoveredListed: false, anyMarked: true, anyListed: false } as const
    expect(show(ctx({ mode: 'menu', menu: { ...menu, shop } }))).toEqual(['A Unmark', 'X Buy|examine', 'Y Add to list', 'LT List marked', 'START Buy marked'])
    // nothing marked: the flip still shows, since the footer's `[!] buy|examine items` is the only way to it on a pad
    const bare = { ...shop, hoveredMarked: false, anyMarked: false } as const
    expect(show(ctx({ mode: 'menu', menu: { ...menu, shop: bare } }))).toEqual(['A Mark', 'X Buy|examine', 'Y Add to list'])
    expect(show(ctx({ mode: 'menu', menu: { ...menu, shop: { ...bare, mode: 'examine' } } }))).toEqual(['A Examine', 'X Buy|examine', 'Y Add to list'])
    // a view-only shop has no mode to flip
    expect(show(ctx({ mode: 'menu', menu: { ...menu, shop: { ...bare, canBuy: false, mode: 'examine' } } }))).toEqual(['A Examine', 'Y Add to list'])
  })
  it('a prompt shows its answers without a Start confirmation hint', () => {
    expect(show(ctx({ mode: 'yesno', focus: { label: 'Yes', cancelLabel: 'No', index: 0, count: 2 } }))).toEqual(['A Yes', 'B No'])
    expect(show(ctx({ mode: 'popup' }))).toEqual([])
    expect(show(ctx({ mode: 'popup', focus: { label: 'Wield', cancelLabel: null, index: 0, count: 3 } }))).toEqual(['A Wield'])
  })
  it('a popup puts its first action on X: the examine screen cycles Description | Status | Quote', () => {
    const c = ctx({ mode: 'popup', popupActions: [{ key: '!', label: 'Status' }, { key: 'x', label: 'Xamine' }] })
    expect(show(c)).toEqual(['X Status'])
    expect(bindingTable(c).X).toEqual({ kind: 'ui', op: 'popupAction', arg: 0 })
    expect(bindingTable(ctx({ mode: 'popup', popupActions: [] })).X).toBeUndefined()
    expect(bindingTable(ctx({ mode: 'dialog' })).X).toBeUndefined()
  })
  it('a --more-- shows Continue on A, with the other prompts', () => {
    expect(show(ctx({ mode: 'more' }))).toEqual(['A Continue'])
  })
})
