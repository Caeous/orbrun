// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { initialState, reduce, MouseMode, type ClientMessage, type GameState } from '@orbrun/webtiles'
import { Overlays, monsterTiles } from '../src/overlays'

/**
 * What a describe popup draws, against the official ui-layouts.js: the spell
 * list lands where the server's SPELLSET_PLACEHOLDER stands (inside the
 * scrolling body), each spell wears its icon and the server's own colours, the
 * monster panes sit behind the `[!]:` label, and a spell's `Level:` line holds
 * its columns together.
 */

function setup(gamedata: unknown = null) {
  const sent: ClientMessage[] = []
  const host = document.createElement('div')
  document.body.append(host)
  const ov = new Overlays(host, {
    send: (m) => sent.push(m),
    gamedata: () => gamedata as never,
    watching: () => false,
    onClientOverlayChange: () => {},
    onSystemAction: () => {},
    settingsPanel: () => document.createElement('div'),
  })
  const st = initialState()
  st.phase = 'playing' as GameState['phase']
  st.inputMode = MouseMode.COMMAND
  return { ov, st, sent, host }
}

/**
 * Enough of a Gamedata for the header and icon canvases: a GUI texture index,
 * the range boundaries a monster's tile id is read against, and tiles that
 * resolve but carry no atlas image to draw from.
 */
const gd = {
  enums: { texture: { GUI: 5 } },
  ranges: { mainMax: 1000, mcacheStart: 2000, playerMax: 3000 },
  // player-range parts stand 40 tall, so a doll hangs 8 px below the top of its cell
  tile: (t: number) => ({ atlas: 'main', sx: 0, sy: 0, w: 32, h: t >= 1000 ? 40 : 32, ox: 0, oy: 0 }),
  atlas: () => undefined,
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('describe popup', () => {
  it('puts the spell list where SPELLSET_PLACEHOLDER stands, not after the text', () => {
    const { ov, st, host } = setup(gd)
    reduce(st, {
      msg: 'ui-push',
      type: 'describe-monster',
      title: 'An endoplasm.',
      body: 'A glob of grey sludge.\n\nIt possesses the following natural abilities:\n\nSPELLSET_PLACEHOLDER\n\nTo read a description, press the key listed above.',
      spellset: [{ label: '', spells: [{ letter: 'a', title: 'Freeze', effect: '(1d5)', range_string: '(1)', tile: 42 }] }],
    })
    ov.update(st)
    const body = host.querySelector('.popup .body') as HTMLElement
    expect(body.textContent).not.toContain('SPELLSET_PLACEHOLDER')
    // the list is the body's own child, so it scrolls with the text around it
    const list = body.querySelector('.spellset') as HTMLElement
    expect(list).toBeTruthy()
    expect(list.previousElementSibling?.textContent).toContain('natural abilities')
    expect(list.nextElementSibling?.textContent).toContain('To read a description')
    // the entry: its icon, then letter and title, then the effect and range the server sent
    const li = list.querySelector('li') as HTMLElement
    expect(li.querySelector('canvas')).toBeTruthy()
    expect(li.querySelector('.title')?.textContent).toBe('a - Freeze')
    expect(li.querySelector('.effect')?.textContent).toBe('(1d5)')
    expect(li.querySelector('.range')?.textContent).toBe('(1)')
  })

  it('keeps the colours the server gave a spell, and colours the row only for an item', () => {
    const { ov, st, host } = setup(gd)
    const spells = [{ letter: 'a', title: 'Bolt of Fire', range_string: '<lightred>(5)</lightred>', colour: 12 }]
    reduce(st, { msg: 'ui-push', type: 'describe-item', title: 'a book', body: 'SPELLSET_PLACEHOLDER', spellset: [{ label: '', spells }] })
    ov.update(st)
    // an in-range spell comes through red, as _fmt_spells_list leaves it
    expect(host.querySelector('.spellset .range')?.innerHTML).toContain('fg12')
    expect((host.querySelector('.spellset li') as HTMLElement).className).toContain('fg12')
    // a monster's abilities are not coloured (_fmt_spells_list colour = false)
    reduce(st, { msg: 'ui-pop' })
    reduce(st, { msg: 'ui-push', type: 'describe-monster', title: 'a dragon', body: 'SPELLSET_PLACEHOLDER', spellset: [{ label: '', spells }] })
    ov.update(st)
    expect((host.querySelector('.spellset li') as HTMLElement).className).not.toContain('fg12')
  })

  it('labels the monster panes with the key that cycles them', () => {
    const { ov, st, host } = setup()
    reduce(st, { msg: 'ui-push', type: 'describe-monster', title: 'a rat', body: 'A rat.', quote: 'Squeak.' })
    ov.update(st)
    const foot = host.querySelector('.popup .footer') as HTMLElement
    expect(foot.textContent?.replace(/ /g, ' ')).toContain('[!]: Description | Quote')
  })

  it("holds the spell description's Level line together, as format_spell_html does", () => {
    const { ov, st, host } = setup()
    reduce(st, { msg: 'ui-push', type: 'describe-spell', title: 'Fireball', desc: 'A ball of fire.\n\nLevel: 5        School: Conjurations\n\nIt burns.' })
    ov.update(st)
    const html = (host.querySelector('.popup .body') as HTMLElement).innerHTML
    expect(html).toContain('Level:&nbsp;5')
    expect(html).not.toContain('Level: 5 ')
  })

  it("draws a monster's own tile in the header: the plain sprite, or the doll it is built from", () => {
    const { ov, st, host } = setup(gd)
    // no `tile` field on a monster: the header is drawn from the foreground tile id
    reduce(st, { msg: 'ui-push', type: 'describe-monster', title: 'An endoplasm.', body: 'A glob.', fg_idx: 640 })
    ov.update(st)
    expect(host.querySelector('.popup .header canvas')).toBeTruthy()
    expect(monsterTiles(gd as never, { fg_idx: 640 })).toEqual([{ t: 640 }])
    // a monster drawn from a player doll stacks its parts, each at its mcache offset
    // (the parts here are 40 tall, so they hang 8 below the top of the cell)
    expect(monsterTiles(gd as never, { fg_idx: 2500, doll: [[1200, 32], [1300, 28]], mcache: [[1300, 4, 6]] })).toEqual([
      { t: 1200, ymax: 32, ox: 0, oy: 8 },
      { t: 1300, ymax: 28, ox: 4, oy: 14 },
    ])
    // an mcache monster (a hydra, a monster wearing gear) is its cached parts
    expect(monsterTiles(gd as never, { fg_idx: 2500, mcache: [[1200, 2, 3]] })).toEqual([{ t: 1200, ox: 2, oy: 11 }])
    // nothing to draw: no canvas rather than an empty one
    expect(monsterTiles(gd as never, {})).toEqual([])
  })

  it('builds a god overview out of its own fields, since a god sends no body', () => {
    const { ov, st, host } = setup(gd)
    reduce(st, {
      msg: 'ui-push',
      type: 'describe-god',
      name: 'Okawaru',
      colour: 14,
      description: 'Okawaru is a dangerous god.',
      title: 'the Fighter',
      favour: 'is most pleased with you.',
      powers_list: 'a\nb\nc\n<darkgrey>Heroism. (1 piety)\nFinesse. (5 piety)\n',
      powers: '',
      wrath: 'Okawaru is angry.',
      extra: '',
    })
    ov.update(st)
    const popup = host.querySelector('.popup') as HTMLElement
    expect(popup.querySelector('.header span')?.textContent).toBe('Okawaru')
    expect(popup.querySelector('.header span')?.className).toBe('fg14')
    expect(popup.querySelector('.desc')?.textContent).toContain('dangerous god')
    expect(popup.querySelector('.god-favour')?.textContent).toContain('the Fighter')
    const powers = Array.from(popup.querySelectorAll('.god-powers .power')).map((e) => e.textContent)
    expect(powers[0]).toContain('Granted powers')
    // the list drops its own heading; a darkgrey power is dimmed, the rest take the god's colour
    expect(powers[1]).toContain('Heroism.')
    expect((popup.querySelectorAll('.god-powers .power')[1] as HTMLElement).className).toContain('fg8')
    expect((popup.querySelectorAll('.god-powers .power')[2] as HTMLElement).className).toContain('fg14')
    expect(popup.querySelector('.footer')?.textContent).toContain('Overview | Powers | Wrath')
  })
})
