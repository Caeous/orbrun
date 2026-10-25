// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { formattedStringToText, initialState, reduce, type GameState } from '@orbrun/webtiles'
import { consoleHtml, consoleTable } from '../src/console-text'
import { Overlays } from '../src/overlays'
import RECORDED from './fixtures/describes.json'

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

/** a recorded field as fmtBody lays it out, a <pre> to each paragraph (test/e2e/record-describes.test.ts recorded them) */
function recorded(id: string, field = 'body', channel = 'trunk'): HTMLElement {
  const r = (RECORDED as Recorded[]).find((r) => r.id === id && r.channel === channel)
  if (!r) throw new Error(`nothing recorded as ${channel} ${id}`)
  const el = document.createElement('div')
  el.innerHTML = r.fields[field]
    .split('\n\n')
    .filter(Boolean)
    .map((p) => '<pre>' + consoleHtml(p) + '</pre>')
    .join('')
  return el
}
interface Recorded {
  channel: string
  id: string
  fields: Record<string, string>
}
const hangs = (el: HTMLElement) => [...el.querySelectorAll('.hang')] as HTMLElement[]
const hangOf = (el: HTMLElement) => el.style.getPropertyValue('--hang')
/** the hanging line that starts with `start` */
const hangAt = (el: HTMLElement, start: string) => hangs(el).find((h) => h.textContent!.trimStart().startsWith(start))!

describe("crawl's own describes, from the offline engine", () => {
  it('puts a label and the words crawl broke at eighty columns under it back together, however little room the label left', () => {
    for (const channel of ['stable', 'trunk']) {
      // describe.cc _format_prop_desc: an ego's label in quotes and a single space; a brand's padded; an unrand's longer one
      const mesmerism = hangAt(recorded('ego-mesmerism', 'body', channel), "'Of mesmerism'")
      expect(hangOf(mesmerism)).toBe('16ch')
      expect(mesmerism.textContent).toBe(
        "'Of mesmerism': When you are struck in melee, it briefly dazes all nearby enemies, then must recharge by standing still for a while. Its duration, radius, and recharge speed are improved by your Evocations skill.",
      )
      const antimagic = hangAt(recorded('brand-antimagic', 'body', channel), 'Antimagic:')
      expect(hangOf(antimagic)).toBe('11ch')
      expect(antimagic.textContent).toContain('disrupts the spells and magical abilities of those it strikes. Natural abilities and divine invocations')
      const sonic = hangAt(recorded('unrand-dbrand', 'body', channel), 'Sonic Wave:')
      expect(hangOf(sonic)).toBe('12ch')
      expect(sonic.textContent).toContain('especially in combat involving dangerous')
    }
    // trunk's mesmerism has a second paragraph, under the first's words
    const dormant = hangAt(recorded('ego-mesmerism'), 'It goes briefly dormant')
    expect(hangOf(dormant)).toBe('16ch')
    // a gizmo's label fills crawl's eleven columns, with no space left after it (describe.cc _describe_gizmo)
    const gizmo = render(
      'SpellMotor:Your spells cost less MP as you Rev up. Whenever you cast a spell,\n           you make a melee attack against a random enemy in range.',
    )
    expect(hangs(gizmo).map(hangOf)).toEqual(['11ch'])
    // a single space after a label whose next line is not under its words is no label
    expect(consoleHtml('Mesmerism radius: 2 (max 4)\nYou took it off a kobold on level 1 of the Dungeon.')).not.toContain('class')
  })

  it("puts a monster's statuses back together under their names, crawl having broken them at seventy-seven columns three in", () => {
    const status = recorded('monster-corroded', 'status')
    expect(hangs(status).map(hangOf)).toEqual(['3ch', '3ch', '3ch'])
    expect(hangAt(status, 'This creature is unable').textContent).toContain('or dodge. Any hostile action will awaken it, though melee attacks')
  })

  it("puts a quote's prose back together under its mark, wrapped by hand short of eighty, and leaves verse as it was written", () => {
    // dat/descript/quotes.txt: the ogre's quote breaks at seventy-four, "have" still to come, short of where crawl would
    const ogre = recorded('monster-corroded', 'quote')
    const princess = hangAt(ogre, '“The little princess')
    expect(hangOf(princess)).toBe('1ch')
    expect(princess.textContent).toContain('When once they have tasted raw human flesh')
    expect(princess.textContent).toMatch(/half a fairy\.”$/)
    // the attribution stays a line of its own
    expect(hangs(ogre).map((h) => h.textContent!.trim().slice(0, 7))).toEqual(['“The li', '-Marie-', '“NO. La', '-Shrek.'])
    // verse goes on a line at a time: the goblin's short lines, Morris's that run to the edge, Eliot's that go on in lower case
    expect(hangs(recorded('monster-goblin', 'quote'))).toHaveLength(7)
    const morris = [
      ' And the song, and the tinkling of harp-strings to the roof-tree winded up;',
      ' And Sigmund was dreamy with wine and the wearing of many a year;',
      ' And the noise and the glee of the people as the sound of the wild woods were',
      ' And the blossoming boughs of the Branstock were the wild trees waving about;',
    ]
    expect(hangs(render(morris.join('\n')))).toHaveLength(4)
    expect(hangs(render('“I should have been a pair of ragged claws\n scuttling across the floors of silent seas.”'))).toHaveLength(2)
  })

  it('keeps a line under a table out of it: the speed under an ogre\'s stats', () => {
    const body = recorded('monster-corroded')
    const stats = body.querySelector('.ctable') as HTMLElement
    expect(stats.style.getPropertyValue('--n')).toBe('3')
    expect(stats.textContent).not.toContain('Speed')
    expect(body.textContent).toContain('Speed: 100% (attack: 66%)')
  })

  it("keeps a talisman's table as crawl drew it, its headings over their numbers, and cuts its rules to the popup", () => {
    for (const channel of ['stable', 'trunk']) {
      const body = recorded('talisman-maw', 'body', channel)
      const grid = body.querySelector('.grid')!.textContent!.split('\n')
      expect(grid.map((l) => l.trim().split(/\s+/)[0])).toEqual(['Skill', '-'.repeat(64), 'Min', 'Max', 'Cur'])
      expect(grid[0]).toBe('     Skill    HP    Body Armour AC   Bite Dmg   Devour Regen')
      expect(grid[2]).toBe('Min    12     +0%     -5.2 (-75%)       23          +2.20')
      expect([...body.querySelectorAll('.rule')].map((r) => r.textContent)).toEqual(['_'.repeat(60), '_'.repeat(60)])
    }
  })

  it("sets a mutation's category against the right edge, as crawl does with spaces", () => {
    const right = recorded('mutation-horns').querySelector('.right')!
    expect(right.textContent).toBe('Category: [Anatomy]')
  })

  it("hangs the changelog's points under their words, the points under them under theirs, put back together", () => {
    const changes = recorded('version', 'changes')
    const fimbulwinter = hangAt(changes, '* New unrand: "Fimbulwinter"')
    expect(hangOf(fimbulwinter)).toBe('2ch')
    expect(fimbulwinter.textContent).toBe('* New unrand: "Fimbulwinter", a +9 athame which inflicts Doom on monsters hurt by the wielder\'s cold damage.')
    const gulch = hangAt(changes, '- Entering the Gulch')
    expect(hangOf(gulch)).toBe('4ch')
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
