// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { formattedStringToText, initialState, reduce, type GameState } from '@orbrun/webtiles'
import { consoleHtml, consoleTable } from '../src/console-text'
import { Overlays } from '../src/overlays'

// the character overview, `%`, from the offline engine (0.34, a Minotaur Gladiator on D:1), coloured as output.cc colours it
const OVERVIEW = [
  '<yellow>Player the Ducker (Minotaur Gladiator)                 Turns: 0, Time: 00:00:09</yellow>',
  '<brown>Health: </brown>18/18      <brown>AC: </brown> 3    <brown>Str: </brown>18    <brown>XL:     </brown>1   <brown>Next: </brown>0%',
  '<brown>Magic:  </brown>0/0        <brown>EV: </brown>11    <brown>Int: </brown> 5    <brown>God:    </brown>',
  '<brown>Gold:   </brown>0          <brown>SH: </brown> 0    <brown>Dex: </brown>11    <brown>Spells: </brown>0/0 levels left',
  '',
  'rFire   . . .  (100%)   <w>a</w> - <lightgreen>+0 rapier</lightgreen>',
  'rCold   . . .  (100%)   <darkgrey>(no offhand)</darkgrey>',
  'rNeg    . . .  (100%)   <w>b</w> - <lightgreen>+0 leather armour</lightgreen>',
  'rPois   .      (100%)   <w>c</w> - <lightgreen>+0 hat</lightgreen>',
  'rElec   .      (100%)   <darkgrey>(no cloak)</darkgrey>',
  'rCorr   .      (100%)   <darkgrey>(no gloves)</darkgrey>',
  'SInv    .               <darkgrey>(no boots)</darkgrey>',
  'Will    .....           <darkgrey>(no amulet)</darkgrey>',
  'Stlth   +               <darkgrey>(no ring)</darkgrey>',
  'HPRegen 0.23/turn       <darkgrey>(no ring)</darkgrey>',
  'MPRegen 0.07/turn',
  '',
  '<w>%:</w> no passive effects',
  '<w>@:</w> no status effects',
  // _status_mut_rune_list breaks the list at eighty columns
  '<w>A:</w> horns 2, retaliatory headbutt, fast metabolism 2, poison resistance, deformed',
  'body, see invisible',
].join('\n')

// recorded from CDI (0.34): a describe-item body, the ego line broken by _format_prop_desc
const MACE =
  "<lightgrey>\n\nThe opposite of a morningstar. A balanced mace with a long shaft and a metal head covered in lethal spikes. \n\nBase accuracy: -1  Base damage: 15  Base attack delay: 1.5\nThis weapon's minimum attack delay (0.7) is reached at skill level 16.\n    Your skill: 0.2; use <white>(s)<lightgrey> to set 16.0 as a target for Maces & Flails.\n    At 100% training you would reach 16.0 in about 2.3 XLs.\n    Current attack delay: 1.4.\nDamage rating: 18 (Base 15 x 107% (Str) x 110% (Skill) + 1 (Ench)).\n\nFlame:     It burns victims, dealing an additional one-quarter of any damage\n           that pierces defenders' armour.\n\nThis weapon falls into the 'Maces & Flails' category. It is a one-handed weapon."

/** a monster's stats as describe.cc's TablePrinter prints them: 16 columns a cell, each column's labels right-aligned to its longest */
const MONSTER = [
  ['Max HP: ~5', ' Will: none', '  AC: +', ' EV: ++', ''],
  ['Threat: Low', 'Class: Natural', 'Size: Medium', 'Int: Human'],
]
  .map((r) => r.map((c) => c.padEnd(16)).join(''))
  .join('\n')

const rowsOf = (text: string) => text.split('\n').map((l) => formattedStringToText(l).trimEnd())

/** a table's cells, column by column, each column top to bottom (grid-area: row / column) */
function columnsOf(table: HTMLElement): string[][] {
  const cols: string[][] = []
  for (const c of table.querySelectorAll('.ccell') as NodeListOf<HTMLElement>) {
    const [row, col] = c.style.gridArea.split('/').map((x) => parseInt(x))
    ;(cols[col - 1] ??= [])[row - 1] = c.textContent ?? ''
  }
  return cols.map((c) => c.filter((x) => x !== undefined))
}

const cellAt = (table: HTMLElement, row: number, col: number) =>
  ([...table.querySelectorAll('.ccell')] as HTMLElement[]).find((c) => c.style.gridArea.replace(/ /g, '').startsWith(`${row}/${col}`))!

function render(text: string): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = consoleHtml(text)
  return el
}

describe('console text', () => {
  it("finds the overview's tables: the stats in four columns, the resistances beside the gear", () => {
    const rows = rowsOf(OVERVIEW)
    // the title's turn count stands far right of where any stats column starts: no table with the stats
    expect(consoleTable(rows)).toBeNull()
    expect(consoleTable(rows.slice(1))).toEqual({ rows: 3, starts: [19, 29, 40] })
    expect(consoleTable(rows.slice(5))).toEqual({ rows: 11, starts: [24] })
    // the keyed lines line up by chance and no further
    expect(consoleTable(rows.slice(17))).toBeNull()
  })

  it("finds a monster's stat columns where TablePrinter right-aligns their labels", () => {
    expect(consoleTable(rowsOf(MONSTER))).toEqual({ rows: 2, starts: [16, 32, 48] })
  })

  it('leaves labels and what they mean as lines, not a column of labels and a column of words', () => {
    const props = 'rF+:       It protects you from fire.\nrC+:       It protects you from cold.\nInt+3:     It affects your intelligence (+3).'
    expect(consoleTable(rowsOf(props))).toBeNull()
    const el = render(props)
    expect([...el.querySelectorAll('.hang')].map((h) => (h as HTMLElement).style.getPropertyValue('--hang'))).toEqual(['11ch', '11ch', '11ch'])
  })

  it('finds no table in prose, nor in lines indented under a line', () => {
    const rows = rowsOf(MACE)
    for (let i = 0; i < rows.length; i++) if (rows[i].trim()) expect(consoleTable(rows.slice(i))).toBeNull()
  })

  it('lays a table out as its cells, each on the row and column it came from, in its colours', () => {
    const el = render(OVERVIEW)
    const [stats, gear] = el.querySelectorAll('.ctable') as NodeListOf<HTMLElement>
    expect(stats.style.getPropertyValue('--cols')).toBe('19ch 10ch 11ch')
    expect(stats.style.getPropertyValue('--n')).toBe('3')
    expect(columnsOf(stats)).toEqual([
      ['Health: 18/18', 'Magic:  0/0', 'Gold:   0'],
      ['AC:  3', 'EV: 11', 'SH:  0'],
      ['Str: 18', 'Int:  5', 'Dex: 11'],
      ['XL:     1   Next: 0%', 'God:', 'Spells: 0/0 levels left'],
    ])
    // row by row, so the text reads (and copies) as crawl's lines
    const cells = [...stats.querySelectorAll('.ccell')] as HTMLElement[]
    expect(cells.slice(0, 5).map((c) => c.textContent)).toEqual(['Health: 18/18', 'AC:  3', 'Str: 18', 'XL:     1   Next: 0%', 'Magic:  0/0'])
    expect(cells[11].querySelector('.fg6')?.textContent).toBe('Spells: ')
    // the regeneration lines are the resistances' alone: the gear has no cell beside them
    expect(gear.style.getPropertyValue('--cols')).toBe('24ch')
    const [res, worn] = columnsOf(gear)
    expect(res).toHaveLength(11)
    expect(worn).toHaveLength(10)
    expect(worn[0]).toBe('a - +0 rapier')
    // an item that wraps does so under its name; an empty slot has no name to hang under
    const rapier = cellAt(gear, 1, 2)
    expect(rapier.querySelector('.fg10')?.textContent).toBe('+0 rapier')
    expect(rapier.classList.contains('hang')).toBe(true)
    expect(rapier.style.getPropertyValue('--hang')).toBe('4ch')
    expect(cellAt(gear, 2, 2).classList.contains('hang')).toBe(false)
  })

  it("keeps an artefact's hyphenated property whole where its name wraps", () => {
    const worn = render("rFire   . . .  (100%)   e - +15 Maxwell's patent armour {-Tele *Silence rElec Wi\nrCold   . . .  (100%)   (no cloak)")
    expect([...worn.querySelectorAll('.ccell .keep')].map((k) => k.textContent)).toEqual(['{-Tele'])
  })

  it('keeps every line and blank line of the overview in order, the keyed lines hanging under their lists', () => {
    const el = render(OVERVIEW)
    const kinds = [...el.childNodes].map((n) => (n as HTMLElement).className || n.nodeName)
    expect(kinds).toEqual(['fg14', 'keep', 'ctable', 'BR', 'ctable', 'BR', 'hang', 'hang', 'hang'])
    // the title's turn count, set against the right edge, wraps whole
    expect(el.querySelector('.keep')?.textContent).toBe('Turns: 0, Time: 00:00:09')
    expect(el.querySelector('.keep > .fg14')).toBeTruthy()
    const keyed = [...el.querySelectorAll(':scope > .hang')] as HTMLElement[]
    expect(keyed.map((k) => k.style.getPropertyValue('--hang'))).toEqual(['3ch', '3ch', '3ch'])
    // the list crawl broke at eighty columns is one line again, so a narrow popup breaks it only once
    expect(keyed[2].textContent).toBe('A: horns 2, retaliatory headbutt, fast metabolism 2, poison resistance, deformed body, see invisible')
  })

  it('hangs an indented line under its first letter, and puts an ego line crawl broke back together under its words', () => {
    const paras = MACE.split('\n\n').map(render)
    const sub = [...paras[2].querySelectorAll('.hang')] as HTMLElement[]
    expect(sub.map((s) => s.style.getPropertyValue('--hang'))).toEqual(['4ch', '4ch', '4ch'])
    expect(sub[0].textContent).toBe('    Your skill: 0.2; use (s) to set 16.0 as a target for Maces & Flails.')
    expect(sub[0].querySelector('.fg15')?.textContent).toBe('(s)')
    const ego = paras[3].querySelectorAll('.hang')
    expect(ego).toHaveLength(1)
    expect((ego[0] as HTMLElement).style.getPropertyValue('--hang')).toBe('11ch')
    expect(ego[0].textContent).toBe("Flame:     It burns victims, dealing an additional one-quarter of any damage that pierces defenders' armour.")
  })

  it('prints any other line as formattedStringToHtml would, a <br> after it', () => {
    expect(consoleHtml('a\nb')).toBe('a<br>b')
    expect(consoleHtml('<red>x</red>\n\ny &lt;')).toBe('<span class="fg4">x</span><br><br>y &amp;lt;')
    expect(consoleHtml("This weapon's minimum attack delay (0.7) is reached at skill level 16.\nDamage rating: 18.")).not.toContain('class')
    // a short line after a long one is no continuation, labelled or not
    expect(render('Flame:     It burns victims.\n           Short.').querySelectorAll('.hang')).toHaveLength(2)
  })
})

describe('the character overview popup', () => {
  it('lays out its text as console text; other scrollers print theirs as it came', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const ov = new Overlays(host, { send: () => {}, gamedata: () => null, watching: () => false, onClientOverlayChange: () => {}, onSystemAction: () => {}, settingsPanel: () => ({ el: document.createElement('div'), rows: [] }) })
    const st: GameState = initialState()
    st.phase = 'playing' as GameState['phase']
    reduce(st, { msg: 'ui-push', type: 'formatted-scroller', tag: 'resists', text: OVERVIEW })
    ov.update(st)
    expect(host.querySelectorAll('.popup .body .ctable')).toHaveLength(2)
    reduce(st, { msg: 'ui-pop' })
    reduce(st, { msg: 'ui-push', type: 'formatted-scroller', title: 'Help', text: MONSTER })
    ov.update(st)
    expect(host.querySelector('.popup .body .ctable')).toBeNull()
  })
})
