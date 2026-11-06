import { describe, it, expect } from 'vitest'
import { cellKey, emptyScene, type Billboard, type Scene, type SceneCell } from '@orbrun/scene'
import { MSGCH, initialState, type GameMessage, type GameState } from '@orbrun/webtiles'
import { ExploreDone, linesSince, namedInWarnings, namedMonster } from '../src/warnings'

const warn = (text: string, turn = 100): GameMessage => ({ text, turn, channel: MSGCH.WARN })
const seen = (text: string, turn = 100): GameMessage => ({ text, turn, channel: MSGCH.MONSTER_WARNING })
const plain = (text: string, turn = 100): GameMessage => ({ text, turn, channel: MSGCH.PLAIN })

describe('monster names in the server’s warnings', () => {
  it('reads the encounter line as the fixture records it, tags and trailing sentence included', () => {
    // packages/webtiles/test/fixtures/cdi-0.34-watch.ndjson, turn 12238, channel 31
    const line = seen('<lightgrey>You encounter a salamander. It is wielding a +0 halberd.<lightgrey>', 12238)
    expect(namedInWarnings([line])).toEqual(['a salamander'])
  })

  it('splits an encounter list the way comma_separated_fn joined it', () => {
    // player-notices.cc _describe_monsters_from_species: "a hydra and 2 liches"
    expect(namedInWarnings([seen('You encounter a hydra, an ogre and 2 liches.')])).toEqual(['a hydra', 'an ogre', '2 liches'])
  })

  it('reads the interrupt lines delay.cc prints for a monster already seen', () => {
    expect(namedInWarnings([seen('A goblin comes into view.')])).toEqual(['A goblin'])
    expect(namedInWarnings([seen('The goblin is now too close for your liking.')])).toEqual(['The goblin'])
  })

  it('reads every sentence of a line crawl joined', () => {
    expect(namedInWarnings([seen('A goblin comes into view. A kobold comes into view.')])).toEqual(['A goblin', 'A kobold'])
  })

  it('reads the refusal when it names one monster, and nothing when it does not', () => {
    // nearby-danger.cc i_feel_safe
    expect(namedInWarnings([warn('A gnoll is nearby!')])).toEqual(['A gnoll'])
    expect(namedInWarnings([warn('There are monsters nearby!')])).toEqual([])
    expect(namedInWarnings([warn('An unseen horror is probably nearby! (Press *t to temporarily disregard this.)')])).toEqual([])
    expect(namedInWarnings([warn('There are probably monsters nearby! (Press *t to temporarily disregard this.)')])).toEqual([])
  })

  it('ignores the same words on another channel', () => {
    expect(namedInWarnings([plain('A gnoll is nearby!'), plain('You encounter a hydra.')])).toEqual([])
  })
})

function cell(x: number, y: number): SceneCell {
  return {
    x,
    y,
    kind: 'floor',
    visibility: 'visible',
    occluder: false,
    floorTile: 1,
    flags: { water: false, lava: false, excluded: false, travelTrail: false, newStair: false, cursor: false },
  }
}

function scene(): Scene {
  const s = emptyScene()
  s.playerOnLevel = true
  s.player = { x: 5, y: 5 }
  for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) s.cells.set(cellKey(x, y), cell(x, y))
  return s
}

function mon(s: Scene, x: number, y: number, ref: { id: number; name: string; plural?: string }, attitude: Billboard['attitude'] = 'hostile', scenery = false): Billboard {
  const b = { kind: 'monster', x, y, attitude, scenery: scenery || undefined, ref } as unknown as Billboard
  s.billboards.push(b)
  return b
}

describe('resolving a named monster on the scene', () => {
  it('matches the server’s name with the article taken off, whatever the case', () => {
    const s = scene()
    const rat = mon(s, 5, 2, { id: 1, name: 'rat' })
    const gnoll = mon(s, 8, 5, { id: 2, name: 'gnoll' })
    expect(namedMonster(s, ['A gnoll'])).toBe(gnoll)
    expect(namedMonster(s, ['the rat'])).toBe(rat)
  })

  it('matches a counted group on the plural and picks the nearest of them', () => {
    const s = scene()
    const far = mon(s, 5, 0, { id: 1, name: 'lich', plural: 'liches' })
    const near = mon(s, 7, 5, { id: 2, name: 'lich', plural: 'liches' })
    expect(namedMonster(s, ['2 liches'])).toBe(near)
    expect(far).toBeDefined()
  })

  it('matches a unique by its bare name', () => {
    const s = scene()
    const sig = mon(s, 5, 8, { id: 7, name: 'Sigmund' })
    expect(namedMonster(s, ['Sigmund'])).toBe(sig)
  })

  it('returns null when no monster in view carries the name', () => {
    const s = scene()
    mon(s, 5, 2, { id: 1, name: 'rat' })
    expect(namedMonster(s, ['a hill giant'])).toBeNull()
    expect(namedMonster(s, [])).toBeNull()
  })

  it('does not see a monster on a cell that is not visible', () => {
    const s = scene()
    const rat = mon(s, 5, 2, { id: 1, name: 'rat' })
    s.cells.get(cellKey(5, 2))!.visibility = 'remembered'
    expect(rat).toBeDefined()
    expect(namedMonster(s, ['a rat'])).toBeNull()
  })
})

describe('lines since the last one read', () => {
  it('returns the lines appended after the anchor', () => {
    const a = plain('one', 1)
    const b = warn('A rat is nearby!', 2)
    const c = seen('You encounter a gnoll.', 2)
    expect(linesSince([a, b, c], a, 2)).toEqual([b, c])
    expect(linesSince([a, b, c], c, 2)).toEqual([])
  })

  it('falls back to the current turn when the anchor was rolled back or nothing was read yet', () => {
    const a = plain('one', 1)
    const b = warn('A rat is nearby!', 2)
    expect(linesSince([a, b], undefined, 2)).toEqual([b])
    expect(linesSince([a, b], plain('gone', 1), 2)).toEqual([b])
    expect(linesSince([a, b], undefined, 3)).toEqual([])
  })
})

describe('explore done, by crawl’s word', () => {
  const game = () => {
    const st = initialState()
    st.player.place = 'Dungeon'
    st.player.depth = 1
    st.player.turn = 100
    return st
  }
  const say = (st: GameState, l: GameMessage) => st.messages.lines.push(l)
  const item = (s: Scene, x: number, y: number) => s.billboards.push({ kind: 'item', x, y, tile: 1, height: 0.5 } as Billboard)

  it('holds from "Done exploring." or "Partly explored, …" while the player walks the level they know', () => {
    for (const word of ['Done exploring.', 'Partly explored, unopened door.', "Partly explored, can't reach some places, items."]) {
      const st = game()
      const s = scene()
      const e = new ExploreDone()
      expect(e.update(st, s)).toBe(false)
      say(st, plain(word))
      expect(e.update(st, s)).toBe(true)
      s.player = { x: 6, y: 5 }
      s.revision++
      expect(e.update(st, s)).toBe(true)
      say(st, plain('You see here a scroll of blinking.'))
      expect(e.update(st, s)).toBe(true)
    }
  })

  it('a word joined onto another line counts; one on another channel, or a refusal for monsters, does not', () => {
    const st = game()
    const s = scene()
    const e = new ExploreDone()
    say(st, warn('There are monsters nearby!'))
    say(st, { text: 'Done exploring.', turn: 100, channel: MSGCH.PROMPT })
    expect(e.update(st, s)).toBe(false)
    say(st, plain('You pick up 7 gold pieces. Done exploring.'))
    expect(e.update(st, s)).toBe(true)
  })

  it('lets go once the level could give explore somewhere: ground the map lacked, an item where none lay, another level', () => {
    const st = game()
    const s = scene()
    item(s, 2, 2)
    const e = new ExploreDone()
    say(st, plain('Done exploring.'))
    expect(e.update(st, s)).toBe(true)
    // a door opened onto new ground, or a magic map
    s.cells.set(cellKey(11, 5), cell(11, 5))
    s.revision++
    expect(e.update(st, s)).toBe(false)

    say(st, plain('Done exploring.'))
    expect(e.update(st, s)).toBe(true)
    // an item picked up gives nothing new; a monster's drop does
    s.billboards = []
    s.revision++
    expect(e.update(st, s)).toBe(true)
    item(s, 3, 3)
    s.revision++
    expect(e.update(st, s)).toBe(false)

    say(st, plain('Done exploring.'))
    expect(e.update(st, s)).toBe(true)
    // the level map looking at another level keeps it
    s.playerOnLevel = false
    s.cells.clear()
    s.revision++
    expect(e.update(st, s)).toBe(true)
    st.player.depth = 2
    s.playerOnLevel = true
    s.revision++
    expect(e.update(st, s)).toBe(false)
  })
})
