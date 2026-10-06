// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { formattedStringToText, initialState, reduce, type GameState } from '@orbrun/webtiles'
import { menuColumns } from '../src/menu-columns'
import { Overlays } from '../src/overlays'

// recorded from CDI (0.34): `z` and `a`
const SPELLS = {
  title: '<lightgrey> <white>Your spells (cast)                  Type                      Failure  Level  ',
  rows: [
    ' a - <lightgrey>Summon Small Mammal             Summoning                 <lightgrey>1%</lightgrey>       1      </lightgrey>',
    " d - <lightgrey>Eringya's Surprising Crocodile  Summoning                 <white>1%</white>       4      </lightgrey>",
    ' b + <lightgrey>Summon Mana Viper               Hexes/Summoning           <yellow>8%</yellow>       5      </lightgrey>',
  ],
}
const ABILITIES = {
  title: '<lightgrey> <white>Ability - do what?                  Cost                            Failure',
  rows: [' f - Mud Breath                      2/3 uses available              1%', ' Invocations -    ', ' a - Wall of Briars                  3 MP, Piety-                    0%'],
}
const plain = (t: { title: string; rows: string[] }) => menuColumns(formattedStringToText(t.title), t.rows.map(formattedStringToText))

describe('a console table menu', () => {
  it('finds its columns at the heads, as wide as the widest cell', () => {
    expect(plain(SPELLS)).toEqual({ starts: [37, 63, 72], widths: [15, 7, 5] })
    expect(plain(ABILITIES)).toEqual({ starts: [37, 69], widths: [18, 7] })
  })

  it('finds none in a menu whose title heads none', () => {
    expect(menuColumns('Quiver which action? ([-] to clear)', [' a - Cast: Kinetic Grapnel'])).toBeNull()
    expect(menuColumns('Wear or take off which item?', [' b - a +0 robe (worn)'])).toBeNull()
    // recorded from CDI: a pack page, whose key hint is no column even where a row has a space under it
    expect(menuColumns('Potions:     (Left/Right/Tab to switch category)', [' j - a smoky clear potion'])).toBeNull()
  })

  it('puts each column in a span of its own, the text and colours as crawl sent them; a section header stays whole', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const ov = new Overlays(host, { send: () => {}, gamedata: () => null, watching: () => false, onClientOverlayChange: () => {}, onSystemAction: () => {}, settingsPanel: () => ({ el: document.createElement('div'), rows: [] }) })
    const st: GameState = initialState()
    st.phase = 'playing' as GameState['phase']
    const items = ABILITIES.rows.map((text, i) => ({ text, level: i === 1 ? 1 : 2, hotkeys: i === 1 ? [] : [text.charCodeAt(1)] }))
    reduce(st, { msg: 'menu', tag: 'ability', flags: 0, title: { text: ABILITIES.title }, items, total_items: items.length, more: '', alt_more: '' } as never)
    ov.update(st)
    const menu = host.querySelector<HTMLElement>('.popup.menu')!
    expect(menu.style.getPropertyValue('--menu-cols')).toBe('18ch 7ch')
    const cells = (el: Element | null) => [...(el?.querySelectorAll(':scope > .col') ?? [])].map((c) => c.textContent)
    expect(cells(menu.querySelector('.title .cols'))).toEqual([' Ability - do what?                  ', 'Cost                            ', 'Failure'])
    const [mud, header] = menu.querySelectorAll('li')
    expect(cells(mud.querySelector('.cols'))).toEqual([' f - Mud Breath                      ', '2/3 uses available              ', '1%'])
    expect(header.querySelector('.cols')).toBeNull()
    expect(header.textContent).toBe(ABILITIES.rows[1])

    reduce(st, { msg: 'menu', tag: 'spell', flags: 0, title: { text: SPELLS.title }, items: SPELLS.rows.map((text) => ({ text, level: 2, hotkeys: [text.charCodeAt(1)] })), total_items: 3, more: '', alt_more: '' } as never)
    ov.update(st)
    const spells = [...host.querySelectorAll('.popup.menu')].at(-1)!
    const viper = spells.querySelectorAll('li')[2]
    expect(viper.textContent).toBe(formattedStringToText(SPELLS.rows[2]))
    // the failure keeps crawl's yellow, its cell cut out of the row's lightgrey
    expect(viper.querySelector('.col:nth-child(3) .fg14')?.textContent).toBe('8%')
    // and a cell wholly inside one colour keeps it
    expect(viper.querySelector('.col:nth-child(2) .fg7')?.textContent?.trim()).toBe('Hexes/Summoning')
    expect(spells.querySelector('.title .col:nth-child(2) .fg15')?.textContent?.trim()).toBe('Type')
  })
})
