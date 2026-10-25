// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { morgueHtml } from '../src/morgue-text'

/**
 * A morgue with every kind of part in it, as crawl lays them out: the head and overview of a game played on this
 * device's engine in wizard mode (stats, gear beside the resistances, an artefact, both spell tables, the branches,
 * the shops), and a message history, a map, notes, a vault list and the skill and action tables as any game has them.
 */
const MORGUE = ` Seeded DCSS version 0.34.1-4-g0e95e087e2 (webtiles) character file.

Game seed: 27 (custom seed)

170687 orbrun the True Ascetic (level 18, 146/146 HPs) *WIZ*
             Began as a Human Conjurer on Oct 25, 2026.
             Was an Initiate of Okawaru.
             Quit the game on level 1 of the Vaults.
             The game lasted 00:00:51 (15 turns).

orbrun the True Ascetic (Human Conjurer)              Turns: 15, Time: 00:00:51

Health: 146/146    AC:  3    Str:  7    XL:     18   Next: 0%
Magic:  36/36      EV: 21    Int: 18    God:    Okawaru 15 (0)
Gold:   0          SH:  0    Dex: 20    Spells: 33/45 levels left

rFire   . . .  (100%)     - Nothing wielded
rCold   . . .  (100%)   (no offhand)
rNeg    . . .  (100%)   a - +0 robe
rPois   .      (100%)   (no helmet)
rElec   .      (100%)   (no cloak)
rCorr   .      (100%)   (no gloves)
SInv    .               (no boots)
Will    ++...           c - amulet of regeneration
Stlth   +++++           b - ring "Elial" {Will+ Dex+9 Stlth-}
HPRegen 1.24/turn       (no ring)
MPRegen 0.25/turn

%: no passive effects
@: no status effects
A: explore regen
a: Renounce Religion (0%), Build terrain (0%), Set terrain to build (0%), Clear
terrain to floor (0%)


Inventory:

Armour
 a - a +0 robe (worn)
Jewellery
 b - the ring "Elial" (worn) {Will+ Dex+9 Stlth-}
   (You found it on level 1 of the Dungeon)

   [ring of dexterity]

   Will+:     It increases your willpower.
   Dex+9:     It affects your dexterity (+9).
   Stlth-:    It makes you less stealthy.
 c - an amulet of regeneration (worn)

You knew the following spells:

 Your Spells              Type           Power      Damage    Failure   Level
a - Magic Dart            Conj           25 (25)    1d8       0%          1
b - Fireball              Conj/Fire      58 (200)   3d13      1%          5
c - Blink                 Tloc           50 (50)    N/A       1%          2
d - Iskenderun's Mystic   Conj/Tloc      58 (100)   2d12 (+2d61%          4

Your spell library contained the following spells:

 Spells                   Type           Power      Damage    Failure   Level
 Foxfire                  Conj/Fire      25 (25)    2x1d9     0%          1
 Searing Ray              Conj           50 (50)    2d8       1%          2
 Fulminant Prism          Conj/Alch      58 (200)   3d14      1%          4
 Plasma Beam              Fire/Air       58 (200)   2x1d41    2%          6

Dungeon Overview and Level Annotations

Branches:
Dungeon (8/15)             Spider (0/4) Lair:3
Temple: D:4-7         Lair: D:8-11       Swamp: Lair:2-3    Shoals: Lair:2-3
   Elf: Orc:2

Shops:
D:2 :   Orc:2 ([=*:=   Elf:1 !!:   Vaults:1 ::

Message History

There is an entrance to the Necropolis on this level. Hurry and find it before
the portal closes!
You die...

   #.# #........##...#...#....##
   #.# #)........'............÷#
   #.# #.........'............##
   #.# #.........'...#...#....##
####.###.......####÷###÷###÷###
...............# #############
#####..........###

Notes
Turn   | Place    | Note
-------+----------+-------------------------------------------
     0 | D:1      | orbrun the Human Conjurer began the quest for the
                  | Orb.
     0 | D:1      | Reached XP level 1. HP: 19/19 MP: 0/0
   211 | D:1      | Reached XP level 2. HP: 27/27 MP: 1/1

Levels and vault maps discovered:
D:1:      zelgadis_glass_arrival_small, layout_basic, hex_intersection,
          kennysheep_crisscross, chequers_big_river,
          chequers_serial_rivers_micro_a, minivault_26, st_stairs_6,
          minmay_tromino_v4_c, chequers_serial_rivers_room_b
D:2:      layout_basic, serial_bayou_lagoon_b, uniq_sigmund

Skill      XL: |  1  2  3  4  5  6  7  8 |
---------------+-------------------------+-----
Fighting       |     4              5  6 |  6.4
Armour         |     4        5  6  7  8 |  8.4
Shields        |     4                 5 |  5.3
Maces & Flails |        4     5  6  7  8 |  8.1
Dodging        |        1           2  3 |  3.2
Stealth        |                         |  0.7

Action                     |  1- 3 |  4- 6 |  7- 9 || total
---------------------------+-------+-------+-------++-------
 Attack: Normal            |    69 |    86 |   170 ||   325
  Melee: Flail             |    69 |    86 |   170 ||   325
         Headbutt          |    15 |    30 |    54 ||    99
`

function render(text: string): HTMLElement {
  const el = document.createElement('div')
  el.className = 'morgue'
  el.innerHTML = morgueHtml(text)
  return el
}

const kinds = (el: HTMLElement, sel: string) => Array.from(el.querySelectorAll(sel)).map((b) => b.className)
const cells = (el: Element | null) => Array.from(el?.querySelectorAll('.c') ?? []).map((c) => c.textContent)

describe('a morgue, read here', () => {
  it('sets each part of the file its own way', () => {
    const el = render(MORGUE)
    // the overview's stats and the gear beside the resistances; the spells under their headings
    expect(kinds(el, '.mtable')).toEqual(['mblock mtable panel', 'mblock mtable panel', 'mblock mtable rec', 'mblock mtable rec'])
    // the tables drawn with lines: the skills by level, the actions
    expect(el.querySelectorAll('.ptable')).toHaveLength(2)
    for (const sel of ['.map', '.notes', '.list', '.egrid', '.entries']) expect(el.querySelectorAll(sel), sel).toHaveLength(1)
  })

  it('loses nothing of it but the lines tables are drawn with', () => {
    // its letters and digits, every one: a cell crawl ran into the next (`2d61%`) is two cells here, so not its words
    const chars = (t: string) => (t.match(/[A-Za-z0-9]/g) ?? []).sort().join('')
    expect(chars(render(MORGUE).textContent ?? '')).toBe(chars(MORGUE))
  })

  it('keeps the stats side by side at crawl’s widths, in the groups a phone stacks them in', () => {
    const stats = render(MORGUE).querySelector('.panel')!
    const groups = Array.from(stats.querySelectorAll('.grp')).map(cells)
    expect(groups[0]).toEqual(['Health: 146/146', 'AC:  3', 'Str:  7', 'Magic:  36/36', 'EV: 21', 'Int: 18', 'Gold:   0', 'SH:  0', 'Dex: 20'])
    expect(groups[1]).toEqual(['XL:     18   Next: 0%', 'God:    Okawaru 15 (0)', 'Spells: 33/45 levels left'])
    // each cell knows its place in crawl's table and in its group's
    const spells = stats.querySelectorAll<HTMLElement>('.grp')[1].querySelectorAll<HTMLElement>('.c')[2]
    expect([spells.style.getPropertyValue('--r'), spells.style.getPropertyValue('--k'), spells.style.getPropertyValue('--gk')]).toEqual(['3', '4', '1'])
  })

  it('stacks the gear under the resistances, an item hung under its name', () => {
    const gear = render(MORGUE).querySelectorAll('.panel')[1]
    const [resists, items] = Array.from(gear.querySelectorAll('.grp'))
    expect(cells(resists)[0]).toBe('rFire   . . .  (100%)')
    const ring = Array.from(items.querySelectorAll('.c')).find((c) => c.textContent!.startsWith('b - '))!
    expect(ring.textContent).toBe('b - ring "Elial" {Will+ Dex+9 Stlth-}')
    expect(ring.classList.contains('mitem')).toBe(true)
  })

  it('wraps a spell’s row over lines that fit a phone, its columns under their headings', () => {
    const [known, library] = Array.from(render(MORGUE).querySelectorAll('.rec'))
    const row = (t: Element, i: number) => Array.from(t.querySelectorAll('.mrow')[i].querySelectorAll('.ln')).map(cells)
    expect(row(known, 0)).toEqual([['Your Spells', 'Type'], ['Power', 'Damage', 'Failure', 'Level']])
    expect(row(known, 2)).toEqual([['b - Fireball', 'Conj/Fire'], ['58 (200)', '3d13', '1%', '5']])
    // a damage that fills its column runs into the failure with no space at all, and is still its own
    expect(row(known, 4)).toEqual([["d - Iskenderun's Mystic", 'Conj/Tloc'], ['58 (100)', '2d12 (+2d6', '1%', '4']])
    expect(row(library, 1)).toEqual([['Foxfire', 'Conj/Fire', '25 (25)'], ['2x1d9', '0%', '1']])
  })

  it('reads the branches entry by entry, as many across as crawl set them', () => {
    const grid = render(MORGUE).querySelector<HTMLElement>('.egrid')!
    expect(grid.style.getPropertyValue('--n')).toBe('4')
    expect(Array.from(grid.children).map((c) => c.textContent)).toEqual(['Dungeon (8/15)', 'Spider (0/4) Lair:3', 'Temple: D:4-7', 'Lair: D:8-11', 'Swamp: Lair:2-3', 'Shoals: Lair:2-3', 'Elf: Orc:2'])
  })

  it('wraps the shops between their entries, never inside one', () => {
    expect(Array.from(render(MORGUE).querySelector('.entries')!.children).map((c) => c.textContent)).toEqual(['D:2 :', 'Orc:2 ([=*:=', 'Elf:1 !!:', 'Vaults:1 ::'])
  })

  it('sets a table drawn with lines as a table: its labels as crawl spaced them, its numbers to the right, its total apart', () => {
    const tables = Array.from(render(MORGUE).querySelectorAll('.ptable table'))
    const action = tables.find((t) => t.textContent!.includes('Headbutt'))!
    const row = (i: number) => Array.from(action.querySelectorAll('tbody tr')[i].children).map((c) => [c.className, c.textContent])
    expect(Array.from(action.querySelectorAll('thead th')).map((c) => c.textContent?.trim())).toEqual(['Action', '1- 3', '4- 6', '7- 9', 'total'])
    expect(row(1)).toEqual([['pre', ' Melee: Flail'], ['n', '69'], ['n', '86'], ['n', '170'], ['n dbl', '325']])
    // an action under its kind keeps its place under it
    expect(row(2)[0]).toEqual(['pre', '        Headbutt'])
    // the skills by level keep their levels spaced under the heading's
    const skills = tables.find((t) => t.textContent!.startsWith('Skill'))!
    expect(skills.querySelector('tbody td.pre:nth-child(2)')?.textContent).toBe('    4              5  6')
  })

  it('keeps each note whole, where crawl broke it, beside its turn and place', () => {
    const notes = Array.from(render(MORGUE).querySelectorAll('.notes > span')).map((c) => c.textContent)
    expect(notes.slice(0, 6)).toEqual(['Turn', 'Place', 'Note', '0', 'D:1', 'orbrun the Human Conjurer began the quest for the Orb.'])
  })

  it('hangs each level’s vaults under where they start, a wizard’s tags and all', () => {
    expect(Array.from(render(MORGUE).querySelectorAll('.list .hang')).map((h) => h.textContent)[1]).toBe('D:2:      layout_basic, serial_bayou_lagoon_b, uniq_sigmund')
    const wizard = Array.from(render('Levels and vault maps discovered:\n[+gen,+vis] D:1:      shiori_arrival_maze, layout_loops_ring,\n                      minmay_misc_feat_tower\n[+gen,-vis] Bailey\n').querySelectorAll('.list .hang')).map((h) => h.textContent)
    expect(wizard).toEqual(['[+gen,+vis] D:1:      shiori_arrival_maze, layout_loops_ring, minmay_misc_feat_tower', '[+gen,-vis] Bailey'])
  })

  it('puts back the lines crawl broke at eighty columns, and only those', () => {
    const lines = Array.from(render(MORGUE).querySelectorAll('.mline, .hang')).map((l) => l.textContent)
    expect(lines).toContain('There is an entrance to the Necropolis on this level. Hurry and find it before the portal closes!')
    expect(lines).toContain('a: Renounce Religion (0%), Build terrain (0%), Set terrain to build (0%), Clear terrain to floor (0%)')
    // the overview's keys are lines of their own
    expect(lines).toContain('@: no status effects')
  })

  it('hangs an artefact’s properties each under its words, set in under the item', () => {
    expect(Array.from(render(MORGUE).querySelectorAll('.mind .hang')).map((h) => h.textContent)).toEqual(expect.arrayContaining(['Will+:     It increases your willpower.', 'Dex+9:     It affects your dexterity (+9).']))
  })

  it('keeps a heading over its items a line of its own', () => {
    expect(Array.from(render(MORGUE).querySelectorAll('.mline')).map((l) => l.textContent)).toContain('Jewellery')
  })

  it('reads a plain file’s angle brackets as text, never as a colour', () => {
    expect(render('You see a <red> sign here.\n\nThe stairs < go up.\n').textContent).toBe('You see a <red> sign here.The stairs < go up.')
  })
})
