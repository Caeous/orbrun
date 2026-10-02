import { formattedStringToText, type MenuState } from '@orbrun/webtiles'
import type { Action } from './bindings'

/**
 * X's actions as tabs: Spells | Abilities | Evocables | Quiver.
 *
 * Unlike the pack's pages (pack-tabs.ts), these are four menus of crawl's,
 * not one: `z *` (spl-cast.cc `list_spells`), `a` (ability.cc), `V`
 * (`evoke_item`, a use-item menu) and `Q` (quiver.cc, tagged "actions").
 * Crawl has no key that turns from one to the next, so a turn is ours:
 * Escape the menu that is up, then the next one's key (game.ts
 * `openActionTab`). A tab with nothing on it stands like any other: crawl
 * refuses its key with a line ("You don't know any spells.") and the frame
 * shows that line where the menu would be (Overlays.showActionTabs).
 *
 * Swapping weapons and shouting are no lists, so they are buttons on every
 * tab instead of rows: Y and LT.
 */

export type ActionTabId = 'spells' | 'abilities' | 'evocables' | 'quiver'

export interface ActionTab {
  id: ActionTabId
  label: string
  /** its icon, a tile name as the command lists name theirs (overlays.ts `commandTileId`) */
  tile: string
  /** the key that opens it; Spells' `z` asks first, and `*` lists (game.ts `trackActions`) */
  key: string
  /** whether crawl's menu up is this tab's */
  is(menu: Pick<MenuState, 'tag' | 'title'>): boolean
}

const titled = (menu: Pick<MenuState, 'title'>, start: string) => formattedStringToText(menu.title?.text ?? '').trimStart().startsWith(start)

export const ACTION_TABS: ActionTab[] = [
  // the cast list only; `I` lists the same spells to describe them ("Your spells (describe)")
  { id: 'spells', label: 'Spells', tile: 'CMD_CAST_SPELL', key: 'z', is: (m) => m.tag === 'spell' && titled(m, 'Your spells (cast)') },
  { id: 'abilities', label: 'Abilities', tile: 'CMD_USE_ABILITY', key: 'a', is: (m) => m.tag === 'ability' },
  { id: 'evocables', label: 'Evocables', tile: 'WAND_OFFSET', key: 'V', is: (m) => m.tag === 'use_item' && titled(m, 'Evoke which item?') },
  { id: 'quiver', label: 'Quiver', tile: 'MI_BOOMERANG', key: 'Q', is: (m) => m.tag === 'actions' },
]

/** The tab crawl's menu is, or null for any other menu. */
export function actionTabOf(menu: Pick<MenuState, 'tag' | 'title'>): ActionTabId | null {
  return ACTION_TABS.find((t) => t.is(menu))?.id ?? null
}

/** The tab `step` turns to from `id`, wrapping round; none is ever skipped, an empty one says so when it is up. */
export function actionNeighbour(id: ActionTabId, step: number): ActionTabId {
  const n = ACTION_TABS.length
  const at = ACTION_TABS.findIndex((t) => t.id === id)
  return ACTION_TABS[(((at + step) % n) + n) % n].id
}

export function actionTab(id: ActionTabId): ActionTab {
  return ACTION_TABS.find((t) => t.id === id)!
}

/** What crawl says as it puts a menu away (MSG_OK): the Escape of a turn, never a tab's own answer. */
export const OKAY_THEN = 'Okay, then.'

/**
 * The buttons beside the tabs: Y swaps weapons, LT shouts. From one of
 * crawl's menus the Escape goes first; from an empty tab (no menu up) the
 * frame goes away and the key alone is sent (game.ts).
 */
export const SWAP_WEAPONS_KEY = "'"
export const SHOUT_KEY = 't'
// contextual: they stand under every tab, as the empty frame's do (Overlays.padPrompts)
export const SWAP_WEAPONS: Action = { kind: 'keys', label: 'Swap weapons', seq: [{ key: 27 }, { text: SWAP_WEAPONS_KEY }], contextual: true }
export const SHOUT: Action = { kind: 'keys', label: 'Shout', seq: [{ key: 27 }, { text: SHOUT_KEY }], contextual: true }
