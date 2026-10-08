import { Keys, MenuFlag, formattedStringToText, type GameState, type MenuState } from '@orbrun/webtiles'
import type { Action, KeyOrText } from './bindings'

/**
 * The pack's pages as tabs: Gear (3/52) | Potions | Scrolls (| Evocables).
 *
 * Crawl's pack (`i`, and drop) is paged by category already: Left and Right
 * turn the page (invent.cc `InvMenu::cycle_page`), skipping the empty ones,
 * and the title names the page it is on (`InvMenu::set_title`: "Gear: ...",
 * "Potions: ", "Scrolls: ", "Evocable Items: "). What crawl lacks is a
 * picture of the pages: the strip draws them across the top in place of the
 * title, lights the one the title names, and the bumpers turn them as Left
 * and Right do. The title is folded into the strip: its slot count ("Gear:
 * 3/52 gear slots") onto the Gear tab, where it stands on every page, and
 * its word on the keys at the strip's other end.
 */

/**
 * Y in the pack, where it stood in for the pack's help (`_`): swapping
 * weapons is no row of the pack, so it is a button beside its pages. The
 * pack goes first, then crawl's key.
 */
export const SWAP_WEAPONS_KEY = "'"
export const SWAP_WEAPONS: Action = { kind: 'keys', label: 'Swap weapons', seq: [{ key: 27 }, { text: SWAP_WEAPONS_KEY }], contextual: true }

export interface PackTab {
  /** the page, whatever its label says (the Gear tab's count changes) */
  id: string
  label: string
  /** the start of crawl's title on this page */
  title: string
  /** its icon, a tile name as the command lists name theirs (overlays.ts `commandTileId`) */
  tile: string
  /** nothing of its carried: the tab stands, dimmed, and crawl's turns pass it by (invent.cc `cycle_page`) */
  empty?: boolean
}

export interface PackStrip {
  tabs: PackTab[]
  /** what the title says past the page's name: crawl's word on the keys that turn it ("(Left/Right/Tab to switch category)") */
  hint: string
  /** the tab of the page up, or -1 when the title names none of them */
  current: number
}

/** the pack's gear slots, a-z and A-Z (invent.h MAX_GEAR); consumables take the slots after them */
const MAX_GEAR = 52
/** crawl's `object_class_type` (TAG_MAJOR_VERSION 34, so OBJ_FOOD and OBJ_RODS still hold their places) */
const OBJ_WANDS = 3
const OBJ_SCROLLS = 5
const OBJ_POTIONS = 7
const OBJ_MISCELLANY = 11
const OBJ_BAUBLES = 19

/** crawl's pages, in its order (invent.cc `modes`), and the item classes each holds; the first holds the rest */
/** `rare`: a page shown only while something of it is carried; the others stand empty so the player knows they are there */
export const PAGES: (PackTab & { holds?: number[]; rare?: boolean })[] = [
  { id: 'gear', label: 'Gear', title: 'Gear:', tile: 'CMD_DISPLAY_INVENTORY' },
  { id: 'potions', label: 'Potions', title: 'Potions:', tile: 'POTION_OFFSET', holds: [OBJ_POTIONS] },
  { id: 'scrolls', label: 'Scrolls', title: 'Scrolls:', tile: 'SCROLL', holds: [OBJ_SCROLLS] },
  { id: 'evocables', label: 'Evocables', title: 'Evocable Items:', tile: 'WAND_OFFSET', holds: [OBJ_WANDS, OBJ_MISCELLANY, OBJ_BAUBLES], rare: true },
]

/** Crawl's paged pack, the one that is browsed: `i`, not drop (which marks rows) nor known items (which has no pages). */
export function isPack(menu: Pick<MenuState, 'tag' | 'flags'>): boolean {
  return menu.tag === 'inventory' && !!(menu.flags & MenuFlag.PAGED_INVENTORY) && !(menu.flags & MenuFlag.MULTISELECT)
}

/** The strip over the pack, lit on the page the title names; null for any other menu. */
export function packStrip(menu: MenuState, st: Pick<GameState, 'player'>): PackStrip | null {
  if (!isPack(menu)) return null
  const tabs = packPages(st)
  const title = formattedStringToText(menu.title?.text || '')
  const hint = /\([^()]*\)\s*$/.exec(title)?.[0].trim() ?? ''
  return { tabs, hint, current: tabs.findIndex((t) => title.startsWith(t.title)) }
}

/**
 * The pack's pages: Gear, Potions and Scrolls always, the ones with nothing
 * carried marked empty, and Evocables only while some are carried. Gear
 * wears the title's slot count, "Gear (3/52)": the gear slots in use
 * (invent.cc `slot_description`).
 */
function packPages(st: Pick<GameState, 'player'>): PackTab[] {
  const carried = new Set<number>()
  let gear = 0
  for (const it of Object.values(st.player.inv)) {
    if (!it || !((it.quantity ?? 0) > 0) || it.base_type === undefined) continue
    carried.add(it.base_type)
    if (it.slot < MAX_GEAR) gear++
  }
  const out: PackTab[] = []
  for (const { holds, rare, ...tab } of PAGES) {
    if (!holds) out.push({ ...tab, label: `${tab.label} (${gear}/${MAX_GEAR})` })
    else if (holds.some((b) => carried.has(b))) out.push(tab)
    else if (!rare) out.push({ ...tab, empty: true })
  }
  return out
}

/**
 * The keys that open the pack on the page left open last (its tab's `id`),
 * or on its first page when that page is gone or none was. crawl
 * always opens on the first page; the turns wait for the menu to be up, so
 * a pack crawl will not open ("You aren't carrying anything") leaves them
 * unsent.
 */
export function openPackKeys(st: Pick<GameState, 'player'>, page: string | null): KeyOrText[] {
  const tabs = packPages(st)
  const at = page ? tabs.findIndex((t) => t.id === page && !t.empty) : -1
  const turns = at > 0 ? turnKeys({ tabs, hint: '', current: 0 }, at) ?? [] : []
  return [{ text: 'i' }, ...turns.map((k, i) => (i === 0 ? { ...k, await: 'prompt' as const } : k))]
}

/**
 * The rows of the pack's fullest page: its items, and a header over each
 * class of them (crawl heads the pack's sections by item class). The pack is
 * sized for it, so turning the page never resizes it.
 */
export function packRows(st: Pick<GameState, 'player'>): number {
  const pages = PAGES.map(() => ({ items: 0, classes: new Set<number>() }))
  for (const it of Object.values(st.player.inv)) {
    if (!it || !((it.quantity ?? 0) > 0) || it.base_type === undefined) continue
    const at = Math.max(0, PAGES.findIndex((p) => p.holds?.includes(it.base_type!)))
    pages[at].items++
    pages[at].classes.add(it.base_type)
  }
  return Math.max(...pages.map((p) => p.items + p.classes.size))
}

/** The tabs crawl turns to, as places in the strip: the ones with something on them. */
function turnable(strip: PackStrip): number[] {
  return strip.tabs.flatMap((t, i) => (t.empty ? [] : [i]))
}

/** The tab `step` turns on from the current one, wrapping round and passing the empty ones as crawl does; -1 with nowhere else to turn. */
export function neighbour(strip: PackStrip, step: number): number {
  const live = turnable(strip)
  const n = live.length
  if (n < 2) return -1
  const from = Math.max(0, live.indexOf(strip.current))
  const to = live[(((from + step) % n) + n) % n]
  return to === strip.current ? -1 : to
}

/** The keys that turn the pack to tab `to`: crawl's Left or Right, once per page between (the empty ones are not). Null where it is already, or for an empty tab. */
export function turnKeys(strip: PackStrip, to: number): KeyOrText[] | null {
  const live = turnable(strip)
  const target = live.indexOf(to)
  if (to === strip.current || target < 0) return null
  const n = live.length
  const from = Math.max(0, live.indexOf(strip.current))
  // the short way round
  const right = (((target - from) % n) + n) % n
  const key = right <= n - right ? Keys.CK_RIGHT : Keys.CK_LEFT
  return Array.from({ length: Math.min(right, n - right) }, () => ({ key }))
}
