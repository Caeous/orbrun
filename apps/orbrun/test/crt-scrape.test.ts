import { describe, it, expect } from 'vitest'
import { initialState, reduce } from '@orbrun/webtiles'
import { crtPlainText, scrapeCrt, scrapeSkills, knownCrtScreen } from '../src/crt-scrape'
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
