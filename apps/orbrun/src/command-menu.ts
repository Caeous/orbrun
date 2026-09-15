import type { Action } from './bindings'

export interface CommandEntry {
  label: string
  key: string
  action: Action
}

const command = (label: string, key: string): CommandEntry => ({ label, key, action: { kind: 'keys', label, seq: [{ text: key }] } })
const control = (label: string, key: string, code: number): CommandEntry => ({ label, key, action: { kind: 'keys', label, seq: [{ key: code }] } })
/** A command whose second key is only sent once the first has opened a prompt or menu (a `G>` style macro). */
const chord = (label: string, first: string, second: string): CommandEntry => ({
  label,
  key: `${first} ${second}`,
  action: { kind: 'keys', label, seq: [{ text: first }, { text: second, await: 'prompt' }] },
})

// Every list runs from the commands a game reaches for most to the ones it
// rarely needs, so the usual pick is near the top (and each tab reopens on the
// row it was left on, so the rest costs little).

/** Stable, action-first shortcuts. Crawl owns the filtered lists and their warnings. */
export const BATTLE_COMMANDS: CommandEntry[] = [
  command('Quaff potion', 'q'),
  command('Read scroll', 'r'),
  // `z` and `a` only print "(? or * to list)" and wait for a letter; `*` opens the list (crawl spl-cast.cc, ability.cc)
  chord('Cast spell', 'z', '*'),
  chord('Use ability', 'a', '*'),
  command('Evoke item', 'V'),
  command('Swap weapons', "'"),
  command('Quiver item / action', 'Q'),
  // `)` and `(` step the quiver through the actions it finds suitable, without opening anything (cmd-keys.h CMD_CYCLE_QUIVER_*)
  command('Next quiver action', ')'),
  command('Previous quiver action', '('),
  command('Primary attack', 'v'),
  command('Shout / order allies', 't'),
]

export const TRAVEL_COMMANDS: CommandEntry[] = [
  command('Level map', 'X'),
  chord('Find downstairs', 'G', '>'),
  chord('Find upstairs', 'G', '<'),
  command('Travel to branch / floor', 'G'),
  control('Dungeon overview', 'Ctrl-O', 15),
  control('Find items / shops', 'Ctrl-F', 6),
]

export const EQUIPMENT_COMMANDS: CommandEntry[] = [
  // Y is the gear button, and the pack is the first thing it opens: crawl's own `i`, at the top of the list
  command('Inventory', 'i'),
  command('Wield weapon', 'w'),
  command('Wear armour', 'W'),
  command('Put on jewellery', 'P'),
  command('Drop items', 'd'),
  command('Equip', 'e'),
  command('Take off armour', 'T'),
  command('Remove jewellery', 'R'),
]

/** Character includes management screens (skills, memorisation, letter assignments), not just read-only views. */
export const CHARACTER_COMMANDS: CommandEntry[] = [
  command('Skills', 'm'),
  command('Character status', '@'),
  command('Resistances / equipment', '%'),
  command('Memorise spell', 'M'),
  command('Spell list', 'I'),
  command('Religion', '^'),
  command('Mutations', 'A'),
  control('Message history', 'Ctrl-P', 16),
  command('Adjust inventory letters', '='),
  command('Known items / autopickup', '\\'),
  command('Runes collected', '}'),
  command('Show gold', '$'),
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
