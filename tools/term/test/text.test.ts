import { describe, it, expect } from 'vitest'
import { initialState, type MenuState, type Popup } from '@orbrun/webtiles'
import { PALETTE, formatted, htmlLines, wrapAll, type Line } from '../game/text'
import { Screens } from '../game/screens'
import type { KeyLike } from '../../../apps/orbrun/src/keys'

const text = (lines: Line[]) => lines.map((l) => l.map((s) => s.text).join(''))
const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key: k, code: '', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods })

describe('terminal text', () => {
  it("reads crawl's formatted strings as coloured lines", () => {
    const lines = formatted('<lightred>Hot</lightred> and\n<cyan>cold</cyan>')
    expect(text(lines)).toEqual(['Hot and', 'cold'])
    expect(lines[0][0].fg).toEqual(PALETTE[12])
    expect(lines[0][1].fg).toBeUndefined()
    expect(lines[1][0].fg).toEqual(PALETTE[3])
  })

  it("reads a CRT screen's console HTML, its colours and its entities", () => {
    const [line] = htmlLines("<span class='fg14'>Skills</span> &amp; <span class='fg2 bg0'>a</span>")
    expect(text([line])).toEqual(['Skills & a'])
    expect(line[0].fg).toEqual(PALETTE[14])
    // the console's black ground is the box's own
    expect(line[2].bg).toBeUndefined()
  })

  it("hangs what wraps of a menu's row under its words", () => {
    expect(text(wrapAll(formatted('a - a very long rapier of slaying'), 16))).toEqual(['a - a very long', '    rapier of', '    slaying'])
  })
})

/** a menu of `rows` as crawl sends one */
function menu(rows: string[], more = ''): MenuState {
  return {
    tag: 'inventory', flags: 0, title: { text: 'Inventory' }, more, alt_more: more, total_items: rows.length,
    items: rows.map((t, i) => ({ text: t, level: 2, hotkeys: [97 + i] })), last_hovered: -1,
  }
}

describe("crawl's screens", () => {
  it('lays a menu out as console crawl does, its title, its rows and its more line', () => {
    const st = initialState()
    st.menus.push(menu(['a - a dagger', 'b - a buckler'], '<cyan>[Esc]</cyan> exit'))
    const box = new Screens().box(st, 40, 20)!
    expect(text(box.head)).toEqual(['Inventory'])
    expect(text(box.body)).toEqual(['a - a dagger', 'b - a buckler'])
    expect(text(box.foot)).toEqual(['[Esc] exit'])
  })

  it("moves a menu's cursor itself and tells the server, as menu.js does; a hotkey goes to crawl", () => {
    const st = initialState()
    const m = menu(['a - a dagger', 'b - a buckler', 'c - a potion'])
    st.menus.push(m)
    const screens = new Screens()
    screens.box(st, 40, 20)
    const sent: unknown[] = []
    expect(screens.key(st, key('ArrowDown'), (x) => sent.push(x))).toBe(true)
    expect(screens.key(st, key('ArrowDown'), (x) => sent.push(x))).toBe(true)
    expect(m.last_hovered).toBe(1)
    expect(sent).toContainEqual({ hover: 1, mouse: false, msg: 'menu_hover' })
    expect(screens.box(st, 40, 20)!.lit).toEqual([1])
    expect(screens.key(st, key('b'), () => {})).toBe(false)
  })

  it('pages a long menu, keeping the cursor in view, and says where it is in its more line', () => {
    const st = initialState()
    const m = menu(Array.from({ length: 30 }, (_, i) => `${String.fromCharCode(97 + (i % 26))} - item ${i}`), 'XXX')
    st.menus.push(m)
    const screens = new Screens()
    // a box of 12 lines: the title and the more line leave 10 for the rows
    expect(text(screens.box(st, 40, 12)!.foot)).toEqual(['top'])
    screens.key(st, key('PageDown'), () => {})
    const box = screens.box(st, 40, 12)!
    expect(box.scroll).toBe(10)
    expect(text(box.foot)).toEqual([' 50%'])
  })

  it('types a line at a prompt here and sends it whole, as textinput.js does', () => {
    const st = initialState()
    st.textInput = { type: 'generic', tag: 'inscribe', prompt: 'Inscribe with what? ', text: '' }
    const screens = new Screens()
    const sent: unknown[] = []
    for (const k of ['h', 'i', 'x', 'Backspace']) screens.key(st, key(k), (x) => sent.push(x))
    expect(text(screens.box(st, 40, 10)!.body)).toEqual(['Inscribe with what? hi_'])
    screens.key(st, key('Enter'), (x) => sent.push(x))
    expect(sent).toEqual([{ msg: 'key', keycode: 21 }, { msg: 'key', keycode: 11 }, { text: 'hi\r', msg: 'text_input' }])
  })

  it('walks the new-game grid itself, telling the server, and takes the button on Enter', () => {
    const st = initialState()
    const button = (x: number, y: number, hotkey: number, label: string) => ({ x, y, hotkey, label, labels: [label], description: label + ' desc' })
    st.ui.push({
      type: 'newgame-choice', state: {}, data: {
        msg: 'ui-push', type: 'newgame-choice', title: 'Choose a species',
        'main-items': { menu_id: 'species-main', buttons: [button(0, 0, 97, 'a - Human'), button(0, 1, 98, 'b - Elf'), button(1, 0, 99, 'c - Ogre')] },
      },
    } as Popup)
    const screens = new Screens()
    expect(text(screens.box(st, 40, 20)!.body)).toEqual(['a - Human  c - Ogre', 'b - Elf'])
    const sent: unknown[] = []
    screens.key(st, key('ArrowRight'), (x) => sent.push(x))
    const box = screens.box(st, 40, 20)!
    // the button under the cursor lit, not its row
    expect(box.body[0].filter((s) => s.lit).map((s) => s.text)).toEqual(['c - Ogre'])
    expect(text(box.foot)).toEqual(['', 'c - Ogre desc'])
    screens.key(st, key('Enter'), (x) => sent.push(x))
    expect(sent).toEqual([
      { hotkey: 99, menu_id: 'species-main', msg: 'outer_menu_focus' },
      { hotkey: 99, menu_id: 'species-main', msg: 'outer_menu_focus' },
      { msg: 'key', keycode: 99 },
    ])
  })
})
