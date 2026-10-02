import type { Action } from './bindings'

export interface CommandEntry {
  label: string
  key: string
  /**
   * The line under the label: what the command does, in the words the game
   * would use, for a player who knows the dungeon but not the key. Short --
   * the menus are opened mid-fight, so a subline is read at a glance or not
   * at all -- and never a restatement of the label.
   */
  sub?: string
  /**
   * The row's icon, as a tile name (overlays.ts `commandTileId` looks it up).
   * Crawl draws its own icon for the commands its touch command bar offers
   * (the GUI atlas's `CMD_*`, tilereg-cmd.cc), and those come first; the rest
   * take the tile of what they act on, from the main atlas -- a wand for
   * Evoke, a book for the spell list. A command that is neither has none, and its row leaves the column empty rather
   * than wear an icon that means something else.
   */
  tile?: string
  action: Action
}

const command = (label: string, key: string, sub?: string, tile?: string): CommandEntry => ({ label, key, sub, tile, action: { kind: 'keys', label, seq: [{ text: key }] } })
const control = (label: string, key: string, code: number, sub?: string, tile?: string): CommandEntry => ({ label, key, sub, tile, action: { kind: 'keys', label, seq: [{ key: code }] } })

// Every list runs from the commands a game reaches for most to the ones it
// rarely needs, so the usual pick is near the top.

/** Character includes management screens (skills, memorisation, letter assignments), not just read-only views. */
export const CHARACTER_COMMANDS: CommandEntry[] = [
  command('Skills', 'm', 'what you are training, and how fast', 'CMD_DISPLAY_SKILLS'),
  command('Character status', '@', 'what is on you right now', 'CMD_DISPLAY_CHARACTER_STATUS'),
  command('Resistances / equipment', '%', 'what you resist, and what you are wearing', 'CMD_RESISTS_SCREEN'),
  command('Memorise spell', 'M', 'learn a spell out of a book you carry', 'CMD_MEMORISE_SPELL'),
  command('Spell list', 'I', 'the spells you know, and what they cost', 'BOOK'),
  command('Religion', '^', 'your god, and what they ask of you', 'CMD_DISPLAY_RELIGION'),
  command('Mutations', 'A', 'what the dungeon has made of you', 'CMD_DISPLAY_MUTATIONS'),
  control('Message history', 'Ctrl-P', 16, 'everything the game has told you', 'CMD_REPLAY_MESSAGES'),
  command('Adjust inventory letters', '=', 'move an item to a letter you will remember', 'CMD_DISPLAY_INVENTORY'),
  command('Known items / autopickup', '\\', 'what you have identified, and what to pick up', 'CMD_KNOWN_ITEMS'),
  command('Runes collected', '}', 'the runes you are carrying out', 'MISC_RUNE_OF_ZOT'),
  command('Show gold', '$', 'what you have found, and what you have spent', 'GOLD01'),
]

/** Repeat and Help live on the Start menu's System tab (Overlays.showSystem), with the game options. */
export const REPEAT_COMMAND: CommandEntry = command('Repeat previous command', '`')
export const HELP_COMMAND: CommandEntry = command('Help', '?')

/**
 * X's actions: crawl's own spell, ability, evoke and quiver menus as tabs
 * (action-tabs.ts). Select opens the level map instead, where the ways
 * across the dungeon are (bindings.ts levelmapTable); the character and the
 * game's own options are tabs of the Start menu (Overlays.showSystem), and
 * Y's gear is crawl's own pack, its pages as tabs (pack-tabs.ts).
 */
export type CommandMenu = 'battle'

/** Direct pad controls (including contextual A), with Crawl's alternate keys. */
export const GAMEPAD_COMMAND_KEYS = new Set(['o', '5', '.', 's', 'x', 'f', '\t', ',', 'g', '<', '>', 'O', 'C'])
