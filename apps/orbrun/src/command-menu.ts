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
   * take the tile of what they act on, from the main atlas -- a potion for
   * Quaff, a scroll for Read. A command that is neither (Shout, Equip, the
   * inventory letters) has none, and its row leaves the column empty rather
   * than wear an icon that means something else.
   */
  tile?: string
  action: Action
}

const command = (label: string, key: string, sub?: string, tile?: string): CommandEntry => ({ label, key, sub, tile, action: { kind: 'keys', label, seq: [{ text: key }] } })
const control = (label: string, key: string, code: number, sub?: string, tile?: string): CommandEntry => ({ label, key, sub, tile, action: { kind: 'keys', label, seq: [{ key: code }] } })
/** A command whose second key is only sent once the first has opened a prompt or menu (a `G>` style macro). */
const chord = (label: string, first: string, second: string, sub?: string, tile?: string): CommandEntry => ({
  label,
  key: `${first} ${second}`,
  sub,
  tile,
  action: { kind: 'keys', label, seq: [{ text: first }, { text: second, await: 'prompt' }] },
})

// Every list runs from the commands a game reaches for most to the ones it
// rarely needs, so the usual pick is near the top (and each tab reopens on the
// row it was left on, so the rest costs little).

/** Stable, action-first shortcuts. Crawl owns the filtered lists and their warnings. */
export const BATTLE_COMMANDS: CommandEntry[] = [
  command('Quaff potion', 'q', 'drink one of the potions in the pack', 'POTION_OFFSET'),
  command('Read scroll', 'r', 'read one of the scrolls in the pack', 'SCROLL'),
  // `z` only prints "(? or * to list)" and waits for a letter (spell_menu defaults off); `*` opens the list (crawl spl-cast.cc)
  chord('Cast spell', 'z', '*', 'the spells you have memorised', 'CMD_CAST_SPELL'),
  // `a` opens the ability menu itself: ability_menu defaults on (crawl ability.cc activate_ability)
  command('Use ability', 'a', 'what your god, your form and your mutations grant', 'CMD_USE_ABILITY'),
  command('Evoke item', 'V', 'wands, and the gear that has a use of its own', 'WAND_OFFSET'),
  command('Swap weapons', "'", 'to the weapon in slot b, and back again', 'WPN_DAGGER'),
  // `)` and `(` step the quiver without opening anything (cmd-keys.h CMD_CYCLE_QUIVER_*); they are
  // the command palette's, not the button's -- a menu opened mid-fight is for choosing, not nudging
  command('Quiver item / action', 'Q', 'choose what firing throws or casts', 'MI_BOOMERANG'),
  command('Primary attack', 'v', 'strike whatever stands next to you', 'CMD_AUTOFIGHT'),
  command('Shout / order allies', 't', 'a yell, or an order to what follows you', 'BATTLECRY'),
]

export const TRAVEL_COMMANDS: CommandEntry[] = [
  command('Level map', 'X', 'the floor as far as you have seen it', 'CMD_DISPLAY_MAP'),
  // crawl's `G>` / `G<` are interlevel travel to the next depth of this branch (travel.cc find_down_level):
  // the run walks to a stair and takes it, so the row says where you end up, not what it looks for
  chord('Go down a floor', 'G', '>', 'walk to a way down and take it', 'CMD_MAP_FIND_DOWNSTAIR'),
  chord('Go up a floor', 'G', '<', 'walk to a way up and take it', 'CMD_MAP_FIND_UPSTAIR'),
  command('Travel to branch / floor', 'G', 'name a branch and a depth, and walk there', 'CMD_INTERLEVEL_TRAVEL'),
  control('Dungeon overview', 'Ctrl-O', 15, 'the branches, altars and shops you have found', 'CMD_DISPLAY_OVERMAP'),
  control('Find items / shops', 'Ctrl-F', 6, 'search everything you have seen, by name', 'CMD_SEARCH_STASHES'),
]

export const EQUIPMENT_COMMANDS: CommandEntry[] = [
  // Y is the gear button, and the pack is the first thing it opens: crawl's own `i`, at the top of the list
  command('Inventory', 'i', 'everything you are carrying', 'CMD_DISPLAY_INVENTORY'),
  command('Wield weapon', 'w', 'take a weapon in hand', 'WPN_DAGGER'),
  command('Wear armour', 'W', 'put a piece of armour on', 'ARM_ROBE'),
  command('Put on jewellery', 'P', 'a ring or an amulet', 'RING_NORMAL_OFFSET'),
  command('Drop items', 'd', 'leave things here on the floor', 'CMD_DROP'),
  command('Equip', 'e', 'wield, wear or put on, whatever the item asks for', 'ARM_GLOVES'),
  command('Take off armour', 'T', 'out of a piece of armour', 'ARM_ROBE'),
  command('Remove jewellery', 'R', 'off with a ring or an amulet', 'AMU_NORMAL_OFFSET'),
]

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
