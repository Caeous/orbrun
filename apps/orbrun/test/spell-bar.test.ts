import { describe, expect, it } from 'vitest'
import { MouseMode, type ClientMessage, type MenuItem, type ServerMessage } from '@orbrun/webtiles'
import { LOOK_HOLD_MS, LOOK_LATE_MS, AIM_WAIT_MS, SpellBar, SpellBook, parseSpellRow, spellAims, type Spell } from '../src/spell-bar'

/** a row of crawl's spell list as `I` sends it (recorded from the offline engine) */
const row = (letter: string, name: string, schools: string, fail: string, level: number, sign = '-'): MenuItem => ({
  text: ` ${letter} ${sign} <lightgrey>${name.padEnd(32)}${schools.padEnd(26)}<lightgrey>${fail}</lightgrey>${' '.repeat(9 - fail.length)}${level}      </lightgrey>`,
  q: 1,
  hotkeys: [letter.charCodeAt(0)],
  level: 2,
  tiles: [{ t: 8908, tex: 5 }],
})

const list = (title: string, items: MenuItem[]): ServerMessage => ({ msg: 'menu', tag: 'spell', title: { text: `<white>${title}` }, total_items: items.length, items }) as ServerMessage

describe('parseSpellRow', () => {
  it('reads the letter, the name, the art and the failure column', () => {
    expect(parseSpellRow(row('a', 'Magic Dart', 'Conjuration', '3%', 1))).toEqual({ letter: 'a', name: 'Magic Dart', tile: [{ t: 8908, tex: 5 }], fail: '3%' })
  })
  it('reads the last spell cast, marked + rather than -', () => {
    expect(parseSpellRow(row('b', 'Fireball', 'Conjuration/Fire', '40%', 5, '+'))?.name).toBe('Fireball')
  })
  it('keeps the columns where a long school list leaves one space before the failure', () => {
    const r = parseSpellRow(row('c', "Iskenderun's Mystic Blast", 'Conjuration/Translocation', '12%', 4))
    expect([r?.name, r?.fail]).toEqual(["Iskenderun's Mystic Blast", '12%'])
  })
  it('passes over a row with no letter or no art', () => {
    expect(parseSpellRow({ text: 'Your spells' })).toBeNull()
    expect(parseSpellRow({ ...row('a', 'Magic Dart', 'Conjuration', '3%', 1), tiles: [] })).toBeNull()
  })
})

describe('spellAims', () => {
  it("says which spells open an aim, from crawl's flags", () => {
    expect(spellAims('Magic Dart')).toBe(true)
    expect(spellAims('Fireball')).toBe(true)
    expect(spellAims('Haste')).toBe(false)
    expect(spellAims('Blink')).toBe(false)
    expect(spellAims("Ozocubu's Refrigeration")).toBe(false)
  })
  it('finds a name its column cut short, and knows nothing of one never heard of', () => {
    expect(spellAims("Lee's Rapid Decon")).toBe(true)
    expect(spellAims('Summon Nonsense')).toBeUndefined()
  })
})

function book() {
  let t = 0
  const sent: ClientMessage[] = []
  let changes = 0
  const b = new SpellBook({ send: (m) => sent.push(m), changed: () => changes++, now: () => t })
  return { b, sent, changes: () => changes, at: (ms: number) => (t = ms) }
}

describe('SpellBook: the quiet look', () => {
  it('asks with I, keeps the list, closes it with Escape, and none of it gets through', () => {
    const h = book()
    expect(h.b.look()).toBe(true)
    expect(h.sent).toEqual([{ msg: 'input', text: 'I' }])
    expect(h.b.intercept({ msg: 'input_mode', mode: MouseMode.NORMAL } as ServerMessage)).toBe(true)
    expect(h.b.intercept(list('Your spells (describe)', [row('a', 'Magic Dart', 'Conjuration', '3%', 1)]))).toBe(true)
    expect(h.sent.at(-1)).toEqual({ msg: 'key', keycode: 27 })
    expect(h.b.spells.map((s) => s.name)).toEqual(['Magic Dart'])
    for (const m of ['close_menu', 'close_all_menus', 'close_all_menus']) expect(h.b.intercept({ msg: m } as ServerMessage)).toBe(true)
    expect(h.b.intercept({ msg: 'input_mode', mode: MouseMode.COMMAND } as ServerMessage)).toBe(true)
    // the redraw after the menu is the game's own
    expect(h.b.intercept({ msg: 'map', cells: [] } as ServerMessage)).toBe(false)
    expect(h.b.busy).toBe(false)
    expect(h.b.look()).toBe(false)
  })

  it("holds the player's keys while it looks, and sends them after", () => {
    const h = book()
    h.b.look()
    expect(h.b.hold({ msg: 'input', text: 'o' })).toBe(true)
    expect(h.b.hold({ msg: 'pong' } as ClientMessage)).toBe(false)
    h.b.intercept(list('Your spells (describe)', [row('a', 'Magic Dart', 'Conjuration', '3%', 1)]))
    expect(h.sent.map((m) => m.msg)).toEqual(['input', 'key'])
    h.b.intercept({ msg: 'input_mode', mode: MouseMode.COMMAND } as ServerMessage)
    expect(h.sent.at(-1)).toEqual({ msg: 'input', text: 'o' })
  })

  it("takes crawl's line for no spells as the answer, and keeps it from the log", () => {
    const h = book()
    h.b.look()
    expect(h.b.intercept({ msg: 'msgs', messages: [{ text: "<lightgrey>You don't know any spells.", channel: 0 }] } as ServerMessage)).toBe(true)
    expect([h.b.known, h.b.spells, h.b.busy]).toEqual([true, [], false])
  })

  it('lets the keys go when the answer is slow, and still takes a late list quietly', () => {
    const h = book()
    h.b.look()
    h.b.hold({ msg: 'input', text: 'o' })
    h.at(LOOK_HOLD_MS + 1)
    h.b.tick()
    expect(h.sent.at(-1)).toEqual({ msg: 'input', text: 'o' })
    expect(h.b.busy).toBe(false)
    expect(h.b.intercept(list('Your spells (describe)', [row('a', 'Magic Dart', 'Conjuration', '3%', 1)]))).toBe(true)
    expect(h.b.spells).toHaveLength(1)
    // a list the player opens after the late window is theirs
    const g = book()
    g.b.look()
    g.at(LOOK_HOLD_MS + LOOK_LATE_MS + 2)
    g.b.tick()
    g.b.tick()
    expect(g.b.intercept(list('Your spells (describe)', [row('a', 'Magic Dart', 'Conjuration', '3%', 1)]))).toBe(false)
  })

  it('gives way to anything else crawl opens instead', () => {
    const h = book()
    h.b.look()
    expect(h.b.intercept({ msg: 'menu', tag: 'inventory', title: { text: 'Inventory' }, items: [] } as unknown as ServerMessage)).toBe(false)
    expect(h.b.busy).toBe(false)
  })

  it('reads a list the player opens, and looks again when the letters change', () => {
    const h = book()
    expect(h.b.intercept(list('Your spells (cast)', [row('a', 'Magic Dart', 'Conjuration', '3%', 1), row('b', 'Blink', 'Translocation', '10%', 2)]))).toBe(false)
    expect(h.b.spells.map((s) => s.letter)).toEqual(['a', 'b'])
    expect(h.b.known).toBe(true)
    h.b.intercept({ msg: 'msgs', messages: [{ text: "You finish memorising. Spell assigned to 'c'." }] } as ServerMessage)
    expect(h.b.known).toBe(false)
    h.b.intercept(list('Your spells (cast)', []))
    h.b.intercept(list('Your spells (adjust)', []))
    expect(h.b.known).toBe(false)
  })

  it('forgets everything for a new game', () => {
    const h = book()
    h.b.intercept(list('Your spells (cast)', [row('a', 'Magic Dart', 'Conjuration', '3%', 1)]))
    h.b.intercept({ msg: 'go_lobby' } as ServerMessage)
    expect([h.b.known, h.b.spells]).toEqual([false, []])
  })
})

const DART: Spell = { letter: 'a', name: 'Magic Dart', tile: [] }
const HASTE: Spell = { letter: 'b', name: 'Haste', tile: [] }

function bar() {
  let mode = { mode: 'command', examining: false }
  let turn = 1
  let t = 0
  const did: string[] = []
  const b = new SpellBar({
    mode: () => mode,
    turn: () => turn,
    now: () => t,
    cast: (s) => did.push('cast ' + s.letter),
    fire: () => did.push('fire'),
    cancel: () => did.push('cancel'),
  })
  return { b, did, set: (m: string, examining = false) => (mode = { mode, examining }) && (mode = { mode: m, examining }), pass: () => turn++, at: (ms: number) => (t = ms) }
}

describe('SpellBar: tap twice', () => {
  it('a spell that aims: the first tap aims, the second fires', () => {
    const h = bar()
    h.b.tap(DART)
    expect(h.did).toEqual(['cast a'])
    h.set('targeting')
    h.b.frame()
    expect(h.b.lit()).toBe('a')
    h.b.tap(DART)
    expect(h.did).toEqual(['cast a', 'fire'])
    h.set('command')
    h.b.frame()
    expect(h.b.lit()).toBeNull()
  })

  it('says a cast is under way from the tap until its aim opens, so the buttons can hold through the cast prompt', () => {
    const h = bar()
    expect(h.b.casting()).toBe(false)
    h.b.tap(DART)
    h.set('prompt')
    h.b.frame()
    expect(h.b.casting()).toBe(true)
    h.set('targeting')
    h.b.frame()
    expect(h.b.casting()).toBe(false)
    // nor forever, when the aim never comes
    const g = bar()
    g.b.tap(DART)
    g.at(AIM_WAIT_MS + 1)
    expect(g.b.casting()).toBe(false)
  })

  it('a spell that does not aim: the first tap only lights it, the second casts', () => {
    const h = bar()
    h.b.tap(HASTE)
    expect(h.did).toEqual([])
    expect(h.b.lit()).toBe('b')
    h.b.tap(HASTE)
    expect(h.did).toEqual(['cast b'])
  })

  it('a lit spell goes out when time passes, a screen opens, or another input comes', () => {
    for (const out of [(h: ReturnType<typeof bar>) => h.pass(), (h: ReturnType<typeof bar>) => h.set('menu'), (h: ReturnType<typeof bar>) => h.b.disarm()]) {
      const h = bar()
      h.b.tap(HASTE)
      out(h)
      h.b.frame()
      expect(h.b.lit()).toBeNull()
      h.set('command')
      h.b.tap(HASTE)
      expect(h.did).toEqual([])
    }
  })

  it('another spell tapped while one is lit lights that one instead', () => {
    const h = bar()
    h.b.tap(HASTE)
    h.b.tap({ ...HASTE, letter: 'c', name: 'Blink' })
    expect(h.b.lit()).toBe('c')
    expect(h.did).toEqual([])
  })

  it('a spell tapped during another aim leaves it, and starts once crawl is back at its prompt', () => {
    const h = bar()
    h.set('targeting')
    h.b.tap(DART)
    expect(h.did).toEqual(['cancel'])
    h.b.frame()
    expect(h.did).toEqual(['cancel'])
    h.set('command')
    h.b.frame()
    expect(h.did).toEqual(['cancel', 'cast a'])
  })

  it('a look (x) is not an aim of the spell: a tap leaves it', () => {
    const h = bar()
    h.b.tap(DART)
    h.set('targeting', true)
    h.b.frame()
    h.b.tap(DART)
    expect(h.did).toEqual(['cast a', 'cancel'])
  })

  it('a cast whose aim never opens (no magic left) stops being waited for', () => {
    const h = bar()
    h.b.tap(DART)
    h.at(AIM_WAIT_MS + 1)
    h.b.frame()
    h.set('targeting')
    expect(h.b.lit()).toBeNull()
  })

  it("a spell that does not aim but opens crawl's static targeter anyway fires on its next tap", () => {
    const h = bar()
    h.b.tap(HASTE)
    h.b.tap(HASTE)
    h.set('targeting')
    h.b.frame()
    h.b.tap(HASTE)
    expect(h.did).toEqual(['cast b', 'fire'])
  })
})
