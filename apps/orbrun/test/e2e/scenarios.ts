/**
 * Every surface crawl can put in front of the player, as a scenario: a
 * character, and the steps from the map to the surface. The steps go through
 * the client's own keyboard where the client keeps state of its own (look
 * mode, which the runner pairs with its `x`), and straight to crawl for the
 * set-up only wizard mode can do (an altar underfoot, a level gained).
 *
 * `surface` is what must be up at the end (screen.ts `Screen.surface`); a
 * scenario that lands anywhere else fails before any rule is checked, so a
 * crawl update that moves a screen shows up as that, not as a rule broken.
 */
import type { E2e } from './client'

export interface Scenario {
  id: string
  /** crawl's arguments after the server's own; the default is a seeded Minotaur Fighter in wizard-capable mode */
  args?: string[]
  /** leave the new-game screens alone: the scenario is about them */
  newGame?: boolean
  setup(g: E2e): Promise<void>
  surface: string | RegExp
  /** what the scenario is for, in a line */
  about: string
  /**
   * Buttons the bar may label that do nothing from this very screen, and
   * why: the label is true in general and this state is the exception (the
   * up stairs from the up staircase). Reviewed, never a way to hush a rule.
   */
  idle?: Record<string, string>
  /** B, pressed again and again, never gets back to the map from here, and why (the stat gain wants its answer) */
  noWayOut?: string
}

const char = (species: string, background: string) => ['-seed', '1', '-species', species, '-background', background, '-wizard']
export const FIGHTER = char('minotaur', 'fighter')
const BERSERKER = char('minotaur', 'berserker')
const CONJURER = char('human', 'conjurer')

/** Into wizard mode, once: `&`, the typed "wiz", and out of the command prompt it opens with. */
async function wiz(g: E2e) {
  await g.raw('&')
  await g.raw('wiz\r')
  await g.raw('\x1b')
}

/** A wizard command and its answers: `&(` then `altar_okawaru\r`. */
async function wizard(g: E2e, cmd: string, ...answers: string[]) {
  await g.raw('&' + cmd)
  for (const a of answers) await g.raw(a)
}

/** Off the stairs the game starts on, onto plain floor (a shop or an altar needs one): step until nothing is underfoot. */
async function toFloor(g: E2e) {
  for (let n = 0; n < 12 && g.ctx().under.kind !== 'none'; n++) {
    for (const k of ['l', 'j', 'h', 'k', 'u', 'n', 'b', 'y']) {
      const before = g.state().player.pos
      await g.raw(k)
      const after = g.state().player.pos
      if (after && before && (after.x !== before.x || after.y !== before.y)) break
    }
  }
}

/** Dismiss every --more-- that stands. */
async function mores(g: E2e) {
  for (let i = 0; i < 8 && g.ctx().mode === 'more'; i++) await g.key(' ')
}

/** A thing in the pack, from nothing: `&%` by name drops it underfoot, and `,` picks it up. */
async function give(g: E2e, name: string) {
  await wizard(g, '%', name + '\r')
  await g.raw(',')
  await mores(g)
}

/** The inventory letter of the first item whose name has `part` in it (a-z are slots 0-25, A-Z 26-51). */
function letterOf(g: E2e, part: string): string {
  const inv = g.state().player.inv as Record<number, { name?: string } | undefined>
  for (const [slot, it] of Object.entries(inv)) {
    if (it?.name?.includes(part)) return 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'[Number(slot)]
  }
  throw new Error(`nothing called ${part} in the pack`)
}

/** Darts in the pack, which crawl quivers as they are picked up, for `f`. */
const quiverDarts = (g: E2e) => give(g, 'dart')

/** Character creation: B steps back to the species and no further; leaving is the Orbrun menu's (Start), as a decision, not a lack */
const NEW_GAME_OUT = "B steps back to the species and stops there: abandoning the character is the Orbrun menu's (Start)"

export const SCENARIOS: Scenario[] = [
  // ---- menus
  { id: 'inventory', about: 'the pack, `i`: single-select, arrows, no initial hover', setup: (g) => g.key('i'), surface: 'menu:inventory' },
  { id: 'drop', about: 'drop, `d`: multiselect with quantities and categories', setup: (g) => g.key('d'), surface: 'menu:inventory' },
  { id: 'wear', about: 'wear or take off, `W`: the use-item menu', setup: (g) => g.key('W'), surface: 'menu:use_item' },
  { id: 'quaff', about: 'quaff, `q`', setup: (g) => g.key('q'), surface: 'menu:use_item' },
  { id: 'inscribe-menu', about: 'inscribe, `{`: pick an item, then a line prompt', setup: (g) => g.key('{'), surface: 'menu:inventory' },
  { id: 'travel', about: 'travel, `G`: a prompt menu with a hover, Tab for the default', setup: (g) => g.key('G'), surface: 'menu:travel' },
  { id: 'game-menu', about: 'the game menu, `~`', setup: (g) => g.key('~'), surface: 'menu:game_menu' },
  { id: 'abilities', about: 'abilities, `a`: a toggleable menu (use / describe)', args: BERSERKER, setup: (g) => g.key('a'), surface: 'menu:ability' },
  { id: 'memorise', about: 'memorise, `M`: the spell library', args: CONJURER, setup: (g) => g.key('M'), surface: 'menu:spell' },
  { id: 'spell-list', about: 'the spell list, `I`', args: CONJURER, setup: (g) => g.key('I'), surface: 'menu:spell' },
  { id: 'mutations', about: 'mutations, `A`', setup: (g) => g.key('A'), surface: /^menu:/ },
  { id: 'known-items', about: 'known items, `\\`', setup: (g) => g.key('\\'), surface: 'menu:inventory' },
  { id: 'leave-dungeon', about: "leaving the Dungeon from D:1: crawl's yes/no menu, its default No, as the yes/no card", setup: (g) => g.key('<'), surface: 'yesno' },
  {
    id: 'shop',
    about: 'a shop: multiselect, letters mark, Enter buys',
    async setup(g) {
      await wiz(g)
      await toFloor(g)
      // a WizardMenu of shop kinds: the first
      await wizard(g, '\\', 'a')
      await mores(g)
      await g.key('>')
    },
    surface: 'menu:shop',
  },
  // ---- the skills screen
  { id: 'skills', about: 'skills, `m`: a CRT screen, two columns', setup: (g) => g.key('m'), surface: 'menu:skills' },
  // ---- popups
  {
    id: 'describe-item',
    about: 'an item described: its verbs on the actions line',
    async setup(g) {
      await g.key('i')
      await g.key('a')
    },
    surface: 'popup:describe-item',
  },
  { id: 'help', about: 'help, `?`: a scroller whose section keys are its rows', setup: (g) => g.key('?'), surface: 'popup:formatted-scroller' },
  { id: 'dungeon-overview', about: 'the dungeon overview, Ctrl-O: its keys travel', setup: (g) => g.key('o', { ctrl: true }), surface: 'popup:formatted-scroller' },
  { id: 'character', about: 'the character overview, `%`', setup: (g) => g.key('%'), surface: 'popup:formatted-scroller' },
  { id: 'message-log', about: 'the message log, Ctrl-P', setup: (g) => g.key('p', { ctrl: true }), surface: 'popup:formatted-scroller' },
  {
    id: 'altar',
    about: 'a god offered at an altar: Enter joins',
    async setup(g) {
      await wiz(g)
      await toFloor(g)
      await wizard(g, '(', 'altar_okawaru\r')
      await g.key('>')
      // "You kneel at the altar of Okawaru." is a --more-- first
      await mores(g)
    },
    surface: 'popup:describe-god',
  },
  {
    id: 'describe-monster',
    about: 'a monster described from look mode',
    async setup(g) {
      await wiz(g)
      await wizard(g, 'm', 'goblin\r')
      await g.key('x')
      await g.key('+')
      await g.key('v')
    },
    surface: 'popup:describe-monster',
  },
  // ---- prompts
  { id: 'adjust', about: 'adjust, `=`: a choice prompt in the message line', setup: (g) => g.key('='), surface: 'prompt' },
  { id: 'cast', about: 'cast, `z`: a raw prompt, Enter recasts', args: CONJURER, setup: (g) => g.key('z'), surface: 'prompt' },
  {
    id: 'stat-gain',
    about: 'the level-up stat choice: uppercase only, Escape ignored',
    async setup(g) {
      await wiz(g)
      await wizard(g, 'x')
      await mores(g)
      await wizard(g, 'x')
      await mores(g)
    },
    surface: 'prompt',
    noWayOut: 'crawl will not let the point go unspent (player-stats.cc attribute_increase ignores Escape)',
  },
  {
    id: 'level-up-more',
    about: 'the forced --more-- after a level gained',
    async setup(g) {
      await wiz(g)
      await wizard(g, 'x')
    },
    surface: 'more',
  },
  // ---- text
  {
    id: 'inscribe',
    about: 'inscribe: a line prompt',
    async setup(g) {
      await g.key('{')
      await g.key('a')
    },
    surface: /^text:/,
  },
  {
    id: 'travel-depth',
    about: 'travel to a depth: a line prompt with keys of its own',
    async setup(g) {
      await g.key('G')
      await g.key('D')
    },
    surface: 'text:travel_depth',
  },
  // ---- the map
  { id: 'look', about: 'look, `x`: targeting as examining', setup: (g) => g.key('x'), surface: 'targeting' },
  { id: 'level-map', about: 'the level map, `X`', setup: (g) => g.key('X'), surface: 'levelmap', idle: { LB: 'the player stands on the only up staircase: the cursor is already there' } },
  // ---- a new game
  { id: 'new-game-species', about: 'the new-game species grid', args: ['-seed', '1', '-wizard'], newGame: true, setup: async () => {}, surface: 'popup:newgame-choice', noWayOut: NEW_GAME_OUT },
  {
    id: 'new-game-background',
    about: 'the new-game background grid, after a species',
    args: ['-seed', '1', '-wizard'],
    newGame: true,
    setup: (g) => g.raw('a'),
    surface: 'popup:newgame-choice',
    noWayOut: NEW_GAME_OUT,
  },
  {
    id: 'new-game-random',
    about: 'a random character offered: Y plays it, n rolls again, Esc quits',
    args: ['-seed', '1', '-wizard'],
    newGame: true,
    setup: (g) => g.raw('!'),
    surface: 'popup:newgame-random-combo',
  },
  // ---- more menus
  {
    id: 'pickup',
    about: 'pick up from a pile: multiselect, arrows',
    async setup(g) {
      await wiz(g)
      await toFloor(g)
      // two things underfoot: `,` asks which
      await wizard(g, '%', 'dagger\r')
      await wizard(g, '%', 'club\r')
      await g.key(',')
    },
    surface: 'menu:pickup',
  },
  {
    id: 'stash-search',
    about: 'find, Ctrl-F: a line prompt, then its results',
    async setup(g) {
      await g.key('f', { ctrl: true })
    },
    surface: /^text:/,
  },
  { id: 'lookup', about: 'describe what, `?/`: a menu of kinds', setup: async (g) => { await g.key('?'); await g.key('/') }, surface: /^menu:/ },
  {
    id: 'actions',
    about: 'the quiver, `Q`: every action there is',
    async setup(g) {
      await wiz(g)
      await give(g, 'dart')
      await g.key('Q')
    },
    surface: /^menu:/,
  },
  {
    id: 'acquirement',
    about: 'acquirement: pick a gift, then a yes/no in the footer',
    async setup(g) {
      await wiz(g)
      await wizard(g, 'a')
    },
    surface: 'menu:acquirement',
  },
  // ---- more popups
  { id: 'version', about: 'the version screen, `?v`: any key closes', setup: async (g) => { await g.key('?'); await g.key('v') }, surface: 'popup:version' },
  {
    id: 'describe-spell',
    about: 'a spell described from the spell list',
    args: CONJURER,
    async setup(g) {
      await g.key('I')
      await g.key('a')
    },
    surface: 'popup:describe-spell',
  },
  {
    id: 'describe-feature',
    about: 'the stairs described from look mode',
    async setup(g) {
      await g.key('x')
      await g.key('v')
    },
    surface: /^popup:describe-/,
  },
  // ---- the end of a game
  { id: 'quit', about: 'quitting, Ctrl-Q: the typed word "quit"', setup: (g) => g.key('q', { ctrl: true }), surface: /^text:/ },
  {
    id: 'death-inventory',
    about: 'the inventory shown on death',
    async setup(g) {
      await g.key('q', { ctrl: true })
      await g.raw('quit\r')
      await mores(g)
    },
    surface: 'menu:inventory',
  },
  // ---- more prompts
  {
    id: 'item-swap',
    about: 'a third ring: which to take off, by letter or < >',
    async setup(g) {
      await wiz(g)
      await give(g, 'ring of protection from fire')
      await give(g, 'ring of protection from cold')
      await give(g, 'ring of strength')
      for (const name of ['from fire', 'from cold']) {
        await g.key('P')
        await g.key(letterOf(g, name))
        await mores(g)
      }
      await g.key('P')
      await g.key(letterOf(g, 'strength'))
    },
    surface: 'prompt',
  },
  {
    id: 'shop-purchase',
    about: "buying: the shop's footer asks yes/no, Enter is No",
    async setup(g) {
      await wiz(g)
      await wizard(g, '$', '5000\r')
      await toFloor(g)
      await wizard(g, '\\', 'a')
      await mores(g)
      await g.key('>')
      await g.key('a')
      await g.key('Enter')
    },
    surface: /^(yesno|menu:shop)$/,
  },
  {
    id: 'fire',
    about: 'fire, `f`: targeting with a path',
    async setup(g) {
      await wiz(g)
      await quiverDarts(g)
      await wizard(g, 'm', 'goblin\r')
      await g.key('f')
    },
    surface: /^(targeting|prompt|menu:.*)$/,
  },
  {
    id: 'cast-target',
    about: 'a spell aimed: targeting',
    args: CONJURER,
    async setup(g) {
      await wiz(g)
      await wizard(g, 'm', 'goblin\r')
      await g.key('z')
      await g.key('a')
    },
    surface: 'targeting',
  },
  {
    id: 'skill-target',
    about: 'a skill target: the skills screen, then a line prompt',
    async setup(g) {
      await g.key('m')
      await g.key('=')
      await g.key('a')
    },
    surface: /^text:/,
  },
]
