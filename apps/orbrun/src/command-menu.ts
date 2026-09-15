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
  action: Action
}

const command = (label: string, key: string, sub?: string): CommandEntry => ({ label, key, sub, action: { kind: 'keys', label, seq: [{ text: key }] } })
const control = (label: string, key: string, code: number, sub?: string): CommandEntry => ({ label, key, sub, action: { kind: 'keys', label, seq: [{ key: code }] } })
/** A command whose second key is only sent once the first has opened a prompt or menu (a `G>` style macro). */
const chord = (label: string, first: string, second: string, sub?: string): CommandEntry => ({
  label,
  key: `${first} ${second}`,
  sub,
  action: { kind: 'keys', label, seq: [{ text: first }, { text: second, await: 'prompt' }] },
})

// Every list runs from the commands a game reaches for most to the ones it
// rarely needs, so the usual pick is near the top (and each tab reopens on the
// row it was left on, so the rest costs little).

/** Stable, action-first shortcuts. Crawl owns the filtered lists and their warnings. */
export const BATTLE_COMMANDS: CommandEntry[] = [
  command('Quaff potion', 'q', 'drink one of the potions in the pack'),
  command('Read scroll', 'r', 'read one of the scrolls in the pack'),
  // `z` and `a` only print "(? or * to list)" and wait for a letter; `*` opens the list (crawl spl-cast.cc, ability.cc)
  chord('Cast spell', 'z', '*', 'the spells you have memorised'),
  chord('Use ability', 'a', '*', 'what your god, your form and your mutations grant'),
  command('Evoke item', 'V', 'wands, and the gear that has a use of its own'),
  command('Swap weapons', "'", 'to the weapon in slot b, and back again'),
  command('Quiver item / action', 'Q', 'choose what firing throws or casts'),
  // `)` and `(` step the quiver through the actions it finds suitable, without opening anything (cmd-keys.h CMD_CYCLE_QUIVER_*)
  command('Next quiver action', ')', 'step the quiver on, without opening it'),
  command('Previous quiver action', '(', 'step the quiver back, without opening it'),
  command('Primary attack', 'v', 'strike whatever stands next to you'),
  command('Shout / order allies', 't', 'a yell, or an order to what follows you'),
]

export const TRAVEL_COMMANDS: CommandEntry[] = [
  command('Level map', 'X', 'the floor as far as you have seen it'),
  chord('Find downstairs', 'G', '>', 'walk to the nearest way down'),
  chord('Find upstairs', 'G', '<', 'walk to the nearest way up'),
  command('Travel to branch / floor', 'G', 'name a branch and a depth, and walk there'),
  control('Dungeon overview', 'Ctrl-O', 15, 'the branches, altars and shops you have found'),
  control('Find items / shops', 'Ctrl-F', 6, 'search everything you have seen, by name'),
]

export const EQUIPMENT_COMMANDS: CommandEntry[] = [
  // Y is the gear button, and the pack is the first thing it opens: crawl's own `i`, at the top of the list
  command('Inventory', 'i', 'everything you are carrying'),
  command('Wield weapon', 'w', 'take a weapon in hand'),
  command('Wear armour', 'W', 'put a piece of armour on'),
  command('Put on jewellery', 'P', 'a ring or an amulet'),
  command('Drop items', 'd', 'leave things here on the floor'),
  command('Equip', 'e', 'wield, wear or put on, whatever the item asks for'),
  command('Take off armour', 'T', 'out of a piece of armour'),
  command('Remove jewellery', 'R', 'off with a ring or an amulet'),
]

/** Character includes management screens (skills, memorisation, letter assignments), not just read-only views. */
export const CHARACTER_COMMANDS: CommandEntry[] = [
  command('Skills', 'm', 'what you are training, and how fast'),
  command('Character status', '@', 'what is on you right now'),
  command('Resistances / equipment', '%', 'what you resist, and what you are wearing'),
  command('Memorise spell', 'M', 'learn a spell out of a book you carry'),
  command('Spell list', 'I', 'the spells you know, and what they cost'),
  command('Religion', '^', 'your god, and what they ask of you'),
  command('Mutations', 'A', 'what the dungeon has made of you'),
  control('Message history', 'Ctrl-P', 16, 'everything the game has told you'),
  command('Adjust inventory letters', '=', 'move an item to a letter you will remember'),
  command('Known items / autopickup', '\\', 'what you have identified, and what to pick up'),
  command('Runes collected', '}', 'the runes you are carrying out'),
  command('Show gold', '$', 'what you have found, and what you have spent'),
]

/** Repeat and Help live on the Start menu's System tab (Overlays.showSystem), with the game options. */
export const REPEAT_COMMAND: CommandEntry = command('Repeat previous command', '`')
export const HELP_COMMAND: CommandEntry = command('Help', '?')

export type CommandMenu = 'battle' | 'travel' | 'equipment'
/**
 * One button, one list: LB the actions of a fight, Select the ways across the
 * floor, Y the gear. The lists are flat -- what a button opens is what it
 * says on the bar -- and the character and the game's own options are tabs of
 * the Start menu (Overlays.showSystem) instead.
 */
export const COMMAND_MENUS: { id: CommandMenu; title: string; entries: CommandEntry[] }[] = [
  { id: 'battle', title: 'Actions', entries: BATTLE_COMMANDS },
  { id: 'travel', title: 'Travel', entries: TRAVEL_COMMANDS },
  { id: 'equipment', title: 'Equipment', entries: EQUIPMENT_COMMANDS },
]

/** Direct pad controls (including contextual A), with Crawl's alternate keys. */
export const GAMEPAD_COMMAND_KEYS = new Set(['o', '5', '.', 's', 'x', 'f', '\t', ',', 'g', '<', '>', 'O', 'C'])
