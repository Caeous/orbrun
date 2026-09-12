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

const EQUIPMENT_COMMANDS: CommandEntry[] = [
  command('Wield weapon', 'w'),
  command('Wear armour', 'W'),
  command('Put on jewellery', 'P'),
  command('Drop items', 'd'),
  command('Equip', 'e'),
  command('Take off armour', 'T'),
  command('Remove jewellery', 'R'),
]

/** Info includes management screens (skills, memorisation, letter assignments), not just read-only views. */
const INFO_COMMANDS: CommandEntry[] = [
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

/** Game options live on the Start menu (Overlays.showSystem), not on a Select tab. */
export const REPEAT_COMMAND: CommandEntry = command('Repeat previous command', '`')
export const HELP_COMMAND: CommandEntry = command('Help', '?')

export type CommandGroup = 'travel' | 'equipment' | 'info'
/** Select owns non-battle commands; RB is a separate, flat battle menu; the Start menu has the game options. */
export const COMMAND_GROUPS: { id: CommandGroup; label: string; hint: string; entries: CommandEntry[] }[] = [
  { id: 'travel', label: 'Travel', hint: 'Explore the dungeon · maps, destinations and items', entries: TRAVEL_COMMANDS },
  { id: 'equipment', label: 'Equipment', hint: 'Manage your gear · weapons, armour and jewellery', entries: EQUIPMENT_COMMANDS },
  { id: 'info', label: 'Character', hint: 'Review and manage · character, skills and spells', entries: INFO_COMMANDS },
]

/** Direct pad controls (including contextual A), with Crawl's alternate keys. */
export const GAMEPAD_COMMAND_KEYS = new Set(['o', '5', '.', 's', 'i', 'x', 'f', '\t', ',', 'g', '<', '>', 'O', 'C'])
