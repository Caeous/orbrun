import { describe, it, expect } from 'vitest'
import { initialState, reduce } from '@orbrun/webtiles'
import { crtPlainText, scrapeCrt, scrapeSkills, knownCrtScreen, sliceCrtHtml, stackSkills } from '../src/crt-scrape'
import fixture from './fixtures/skills-crt.json'

/**
 * The fixture is the skills screen as CDI (0.34) sent it to a spectator:
 * the `menu` push, the full `txt` of the screen, then partial `txt`
 * updates as the player toggled a skill and switched to the target view.
 */
type Msg = Record<string, unknown> & { msg: string }
const msgs = fixture as Msg[]

function linesAfter(n: number): string[] {
  const st = initialState()
  for (const m of msgs.slice(0, n)) reduce(st, m as never)
  const area = st.crt.areas.get('menu_txt')!
  const max = Math.max(-1, ...area.keys())
  const out: string[] = []
  for (let i = 0; i <= max; i++) out.push(area.get(i) || '')
  return out
}

describe('crt plain text', () => {
  it('drops the server spans and restores the entities it escapes', () => {
    expect(crtPlainText('  <span class="fg8 bg0">b - Maces &amp; Flails   0.0   </span><span class="fg3 bg0">0.8   </span>')).toBe('  b - Maces & Flails   0.0   0.8   ')
    expect(crtPlainText('&lt;w&gt;x&lt;/w&gt;')).toBe('<w>x</w>')
  })
})

describe('skills screen', () => {
  it('the fixture is the skills crt menu and its text arrives in the menu_txt area', () => {
    expect(msgs[0]).toMatchObject({ msg: 'menu', type: 'crt', tag: 'skills' })
    expect(msgs[1]).toMatchObject({ msg: 'txt', id: 'menu_txt' })
    expect(knownCrtScreen('skills')).toBe(true)
    expect(knownCrtScreen('crt')).toBe(false)
  })

  it('finds one focusable per skill row, in reading order, with the printed letter', () => {
    const hot = scrapeCrt('skills', linesAfter(2))
    const rows = hot.filter((h) => h.kind === 'row')
    expect(rows.map((r) => r.key + ':' + r.label)).toEqual([
      'a:Fighting',
      'i:Spellcasting',
      'b:Maces & Flails',
      'j:Conjurations',
      'c:Unarmed Combat',
      'k:Translocations',
      'd:Throwing',
      'l:Evocations',
      'e:Ranged Weapons',
      'f:Armour',
      'g:Dodging',
      'h:Stealth',
    ])
    // two columns: left rows are group col0, right rows col1, even where the left column is empty
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]))
    expect(byKey.a.group).toBe('col0')
    expect(byKey.i.group).toBe('col1')
    expect(byKey.i.line).toBe(byKey.a.line)
    expect(byKey.l.group).toBe('col1') // alone on its line, but printed in the right column
    expect(byKey.l.line).toBe(6)
    expect(byKey.a.col).toBe(2)
    expect(byKey.i.col).toBe(41)
    // the region spans to the next column so the cursor covers the whole row
    expect(byKey.a.len).toBe(39)
  })

  it('does not mistake the level, cost and aptitude digits for hotkeys', () => {
    const hot = scrapeCrt('skills', linesAfter(2))
    for (const h of hot.filter((x) => x.kind === 'row')) expect(h.key).toMatch(/^[a-l]$/)
  })

  it('scrapes the bracketed footer switches, skipping ranges like [a-z]', () => {
    const foot = scrapeCrt('skills', linesAfter(2)).filter((h) => h.kind === 'footer')
    expect(foot.map((f) => f.key + ':' + f.label)).toEqual(['?:Help', '=:set a skill target', '/:auto|manual mode', '*:useful|all skills', '!:training|cost|targets'])
    // the target view prints [a-z] set skill target: a range, not a key
    const later = scrapeCrt('skills', linesAfter(4)).filter((h) => h.kind === 'footer')
    expect(later.map((f) => f.key)).toEqual(['?', '-', '/', '*', '!'])
  })

  it('survives partial updates: a toggled row keeps its letter, the target view keeps every row', () => {
    const before = scrapeCrt('skills', linesAfter(2)).filter((h) => h.kind === 'row')
    const toggled = scrapeCrt('skills', linesAfter(3)).filter((h) => h.kind === 'row')
    expect(toggled.map((r) => r.key)).toEqual(before.map((r) => r.key))
    const targets = scrapeCrt('skills', linesAfter(4)).filter((h) => h.kind === 'row')
    expect(targets.map((r) => r.key)).toEqual(before.map((r) => r.key))
  })

  it('a screen with no scraper of its own still yields the switches it prints; its rows stay raw', () => {
    // no row scraper means no rows (they have no shape in common), but a switch is a
    // switch on every screen, so the cursor always has somewhere to stand
    expect(scrapeCrt('crt', linesAfter(2)).filter((h) => h.kind === 'row')).toEqual([])
    expect(scrapeCrt('macro', ['<span>[?] help</span>'])).toEqual([{ key: '?', label: 'help', line: 0, col: 0, len: 8, group: 'foot0', kind: 'footer' }])
  })

  it('a species with distributed training (no hotkeys) yields no rows', () => {
    expect(scrapeSkills(['      Skill           Level Cost   Apt', '    + Fighting         2.6   3.0    0'])).toEqual([])
  })
})

describe('crt html slices', () => {
  const line = '  <span class="fg8 bg0">b - Maces &amp; Flails   0.0   </span><span class="fg3 bg0">0.8   </span><span class="fg15 bg0">+1    k * Translocations'
  it('opens the span a cut falls inside again, and closes what the server left open', () => {
    expect(sliceCrtHtml(line, 41)).toBe('<span class="fg15 bg0">k * Translocations</span>')
  })
  it('counts an escaped character as one column and drops the trailing spaces', () => {
    expect(sliceCrtHtml(line, 0, 21)).toBe('  <span class="fg8 bg0">b - Maces &amp; Flails</span>')
    expect(sliceCrtHtml(line, 29, 41)).toBe('<span class="fg3 bg0">0.8   </span><span class="fg15 bg0">+1</span>')
    expect(sliceCrtHtml(line, 37, 41)).toBe('')
  })
})

describe('skills screen in one column', () => {
  const plain = (lines: string[]) => lines.map((l) => crtPlainText(l))

  it('stands the right column under the left, under one header, with the blank lines closed up', () => {
    expect(plain(stackSkills(linesAfter(2)))).toEqual([
      '      Skill           Level Cost   Apt',
      '  a - Fighting         2.6   3.0    0',
      '',
      '  b - Maces & Flails   0.0   0.8   +1',
      '  c - Unarmed Combat   0.0   0.8   +1',
      '  d - Throwing         0.0   1.0    0',
      '',
      '  e - Ranged Weapons   0.0   0.8   +1',
      '',
      '  f - Armour           0.0   0.8   +1',
      '  g - Dodging          3.0   3.4   +1',
      '  h - Stealth          2.0   2.5   +1',
      '',
      '  i - Spellcasting     3.0   4.8   -1',
      '',
      '  j - Conjurations     6.0   4.2   +3',
      '  k * Translocations   3.4   5.7   -2',
      '',
      '  l - Evocations       0.0   1.0    0',
      '',
      ' The relative cost of raising each skill is in cyan.',
      ' The species aptitude is in white.',
      '',
      ' [?] Help',
      ' [=] set a skill target',
      ' [/] auto|manual mode',
      ' [*] useful|all skills',
      ' [!] training|cost|targets',
    ])
  })

  it('keeps the colours the server printed', () => {
    const stacked = stackSkills(linesAfter(2))
    expect(stacked[16]).toBe('  <span class="fg15 bg0">k * Translocations   3.4   </span><span class="fg3 bg0">5.7   </span><span class="fg15 bg0">-2</span>')
    expect(stacked[23]).toBe(' <span class="fg7 bg0">[</span><span class="fg14 bg0">?</span><span class="fg7 bg0">] Help</span>')
  })

  it('the scraper reads one column of rows in letter order, and every switch', () => {
    const hot = scrapeCrt('skills', stackSkills(linesAfter(2)))
    const rows = hot.filter((h) => h.kind === 'row')
    expect(rows.map((r) => r.key).join('')).toBe('abcdefghijkl')
    expect(new Set(rows.map((r) => r.group + ':' + r.col))).toEqual(new Set(['col0:2']))
    expect(hot.filter((h) => h.kind === 'footer').map((f) => f.key + ':' + f.label)).toEqual(['?:Help', '=:set a skill target', '/:auto|manual mode', '*:useful|all skills', '!:training|cost|targets'])
  })

  it('splits a range switch off as well (the target view)', () => {
    const stacked = plain(stackSkills(linesAfter(4)))
    expect(stacked.slice(-6)).toEqual([' [?] Help', ' [a-z] set skill target', ' [-] clear selected target', ' [/] auto|manual mode', ' [*] useful|all skills', ' [!] training|cost|targets'])
  })

  it('leaves a screen with no rows as it is', () => {
    const lines = ['      Skill           Level Cost   Apt', '    + Fighting         2.6   3.0    0']
    expect(stackSkills(lines)).toBe(lines)
  })
})
