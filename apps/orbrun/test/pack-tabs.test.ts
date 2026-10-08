// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { Keys, initialState, reduce, type ClientMessage, type GameState, type MenuState } from '@orbrun/webtiles'
import { isPack, neighbour, openPackKeys, packRows, packStrip, turnKeys } from '../src/pack-tabs'
import { barLabels, bindingTable } from '../src/bindings'
import { deriveContext } from '../src/context'
import { Overlays } from '../src/overlays'

// the pack's flags and titles as crawl 0.34 sends them (invent.cc InvMenu::set_title), recorded from `i` and Right
const PACK_FLAGS = 0x242202
const DROP_FLAGS = 0x24034c
const TITLES = {
  gear: '<white>Gear: 3/52 gear slots    (Left/Right/Tab to switch category)',
  potions: '<white>Potions:     (Left/Right/Tab to switch category)',
  scrolls: '<white>Scrolls:     (Left/Right/Tab to switch category)',
}

const pack = (title: string, flags = PACK_FLAGS): MenuState => ({ tag: 'inventory', flags, title: { text: title }, items: [], last_hovered: -1, more: '', alt_more: '' }) as unknown as MenuState

/** a Fighter's pack: a rapier, scale mail and a buckler, potions, and whatever else is asked for */
function carrying(...extra: number[]): GameState {
  const st = initialState()
  // gear takes the slots below 52, consumables (potions, scrolls, wands) the ones after (items.cc `inv_count`)
  let gear = 0
  let consumable = 52
  for (const base_type of [0, 2, 2, 7, ...extra]) {
    const slot = [3, 5, 7].includes(base_type) ? consumable++ : gear++
    st.player.inv[slot] = { slot, base_type, quantity: 1 }
  }
  st.player.inv[100] = { slot: 100, base_type: 100, quantity: 0 }
  return st
}

describe("the pack's pages as tabs", () => {
  it('are Gear with its slots in use, Potions and Scrolls always, the empty ones marked, and Evocables while some are carried', () => {
    const labels = (st: GameState) => packStrip(pack(TITLES.gear), st)?.tabs.map((t) => t.label + (t.empty ? ' (empty)' : ''))
    expect(labels(carrying())).toEqual(['Gear (3/52)', 'Potions', 'Scrolls (empty)'])
    expect(labels(carrying(5))).toEqual(['Gear (3/52)', 'Potions', 'Scrolls'])
    // a wand: crawl's Evocable Items page
    expect(labels(carrying(5, 3))).toEqual(['Gear (3/52)', 'Potions', 'Scrolls', 'Evocables'])
  })

  it('light the page the title names', () => {
    const st = carrying(5)
    expect(packStrip(pack(TITLES.gear), st)!.current).toBe(0)
    expect(packStrip(pack(TITLES.potions), st)!.current).toBe(1)
    expect(packStrip(pack(TITLES.scrolls), st)!.current).toBe(2)
  })

  it('stand over the pack only, not drop', () => {
    expect(isPack(pack(TITLES.gear, DROP_FLAGS))).toBe(false)
    expect(packStrip(pack(TITLES.gear), carrying(5))).not.toBeNull()
  })

  it('pass the empty pages by, as crawl does, and have nowhere to turn with only Gear', () => {
    const strip = packStrip(pack(TITLES.gear), carrying())!
    // Gear and Potions, Scrolls empty: both ways round is Potions
    expect(neighbour(strip, 1)).toBe(1)
    expect(neighbour(strip, -1)).toBe(1)
    expect(turnKeys(strip, 2)).toBeNull()
    expect(openPackKeys(carrying(), 'scrolls')).toEqual([{ text: 'i' }])
    const bare = initialState()
    bare.player.inv[0] = { slot: 0, base_type: 0, quantity: 1 }
    const alone = packStrip(pack(TITLES.gear), bare)!
    expect(alone.tabs.map((t) => !!t.empty)).toEqual([false, true, true])
    expect(neighbour(alone, 1)).toBe(-1)
  })

  it("turn with crawl's Left and Right, the short way round", () => {
    const strip = packStrip(pack(TITLES.gear), carrying(5))!
    expect(turnKeys(strip, 1)).toEqual([{ key: Keys.CK_RIGHT }])
    expect(turnKeys(strip, 2)).toEqual([{ key: Keys.CK_LEFT }])
    expect(turnKeys(strip, 0)).toBeNull()
    expect(neighbour(strip, -1)).toBe(2)
    expect(neighbour(strip, 1)).toBe(1)
  })
})

describe('coming back to the pack', () => {
  it('opens on the page it was left on, the turns held until the pack is up', () => {
    const st = carrying(5)
    expect(openPackKeys(st, null)).toEqual([{ text: 'i' }])
    expect(openPackKeys(st, 'gear')).toEqual([{ text: 'i' }])
    expect(openPackKeys(st, 'potions')).toEqual([{ text: 'i' }, { key: Keys.CK_RIGHT, await: 'prompt' }])
    expect(openPackKeys(st, 'scrolls')).toEqual([{ text: 'i' }, { key: Keys.CK_LEFT, await: 'prompt' }])
    // the scrolls read: their page is gone, so the pack opens on its first
    expect(openPackKeys(carrying(), 'scrolls')).toEqual([{ text: 'i' }])
  })
})

describe('the size of the pack', () => {
  it('is the fullest page: its items and a header over each class of them', () => {
    // a weapon, two armours and a potion: Gear has three items under two headers
    expect(packRows(carrying())).toBe(5)
    // eight potions of one kind and another: the Potions page is the fullest
    expect(packRows(carrying(7, 7, 7, 7, 7, 7, 7))).toBe(9)
  })
})

describe('the bumpers in the pack', () => {
  function packCtx(title: string, st = carrying(5)) {
    st.phase = 'playing' as GameState['phase']
    reduce(st, { msg: 'menu', tag: 'inventory', flags: PACK_FLAGS, title: { text: title }, items: [], total_items: 0, more: '', alt_more: '' } as never)
    return deriveContext(st, { player: { x: 0, y: 0 }, cells: new Map(), billboards: [], playerOnLevel: false } as never, { facing: 0 } as never, 'micro')
  }

  it('turn its pages, named for the page they turn to', () => {
    const c = packCtx(TITLES.potions)
    const t = bindingTable(c)
    expect(t.LB).toEqual({ kind: 'menu', op: 'left' })
    expect(t.RB).toEqual({ kind: 'menu', op: 'right' })
    const bar = Object.fromEntries(barLabels(c).map((l) => [l.button, l.label]))
    expect(bar.LB).toBe('Gear (3/52)')
    expect(bar.RB).toBe('Scrolls')
  })

  it('keep the sections on a pack with only Gear to it', () => {
    const bare = initialState()
    bare.player.inv[0] = { slot: 0, base_type: 0, quantity: 1 }
    const c = packCtx(TITLES.gear, bare)
    c.menu!.sections = true
    const t = bindingTable(c)
    expect(t.LB).toEqual({ kind: 'menu', op: 'sectionPrev' })
    expect(t.RT).toBeUndefined()
  })

  it('leave Y to swap weapons: the pack goes, then crawl\'s key', () => {
    const c = packCtx(TITLES.potions)
    expect(bindingTable(c).Y).toMatchObject({ kind: 'keys', seq: [{ key: 27 }, { text: "'" }] })
    expect(Object.fromEntries(barLabels(c).map((l) => [l.button, l.label])).Y).toBe('Swap weapons')
  })

  it('leave the sections to the triggers', () => {
    const c = packCtx(TITLES.gear)
    c.menu!.sections = true
    const t = bindingTable(c)
    expect(t.LT).toEqual({ kind: 'menu', op: 'sectionPrev' })
    expect(t.RT).toEqual({ kind: 'menu', op: 'sectionNext' })
  })
})

describe('the strip on the screen', () => {
  it('lights the tab of the page crawl turned to, and a click turns crawl to another', () => {
    const sent: ClientMessage[] = []
    const host = document.createElement('div')
    document.body.append(host)
    const ov = new Overlays(host, { send: (m) => sent.push(m), gamedata: () => null, watching: () => false, onClientOverlayChange: () => {}, onSystemAction: () => {}, settingsPanel: () => ({ el: document.createElement('div'), rows: [] }) })
    const st = carrying(5)
    st.phase = 'playing' as GameState['phase']
    const show = (title: string) => {
      reduce(st, { msg: 'menu', tag: 'inventory', flags: PACK_FLAGS, title: { text: title }, items: [], total_items: 0, more: '', alt_more: '' } as never)
      ov.update(st)
      return [...host.querySelectorAll('.pack-tabs button')].map((b) => (b.classList.contains('current') ? `[${b.textContent}]` : b.textContent))
    }
    expect(show(TITLES.gear)).toEqual(['[Gear (3/52)]', 'Potions', 'Scrolls'])
    // the tabs stand in for crawl's title, its word on the keys at their far end
    expect(host.querySelector('.menu .title')).toBeNull()
    expect(host.querySelector('.pack-tabs .pack-hint')?.textContent).toBe('(Left/Right/Tab to switch category)')
    // Right in crawl: the title says Potions, and so does the strip
    expect(show(TITLES.potions)).toEqual(['Gear (3/52)', '[Potions]', 'Scrolls'])
    ;(host.querySelectorAll('.pack-tabs button')[2] as HTMLElement).click()
    expect(sent).toEqual([{ msg: 'key', keycode: Keys.CK_RIGHT }])
    // the scrolls read: their tab stands, dimmed, and cannot be pressed
    for (const it of Object.values(st.player.inv)) if (it?.base_type === 5) it.quantity = 0
    show(TITLES.gear)
    const scrolls = host.querySelectorAll<HTMLButtonElement>('.pack-tabs button')[2]
    expect(scrolls.textContent).toBe('Scrolls')
    expect(scrolls.classList.contains('empty')).toBe(true)
    expect(scrolls.disabled).toBe(true)
    host.remove()
  })
})
