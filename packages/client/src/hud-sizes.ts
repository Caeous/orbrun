/**
 * The HUD's sizes every front end lays it out by: the minimap's tiles and
 * cells for the screen it is on (`minimapFit`), and the status strip's
 * badges. The browser's hud.ts draws by them, and the terminal lays its
 * panes out as the browser does.
 */

/**
 * The "Minimap tile size" setting's default, in css px on a
 * MINIMAP_REF_SHORT screen: the cell the map follows the player at. The UI
 * scale leaves it alone, so the "Minimap size" setting can be a count of
 * tiles and mean exactly that; other screens draw it in proportion
 * (`minimapFit`).
 */
export const MINIMAP_CELL_DEFAULT = 20
/**
 * The screen's short side, in css px, the "Minimap tile size" setting is
 * drawn at its own size on: 1080, the reference a game's HUD is laid out
 * for. A taller screen draws the tiles larger in proportion, so the map
 * keeps the share of a 1440p or a 4K monitor it has of a 1080p one (380px of
 * 1080, about a third); a shorter one would draw them smaller, but never
 * under MINIMAP_CELL_LEAST, so a Deck or a phone keeps the tiles readable and
 * shows fewer of them where the room runs out.
 */
export const MINIMAP_REF_SHORT = 1080
/**
 * The least a tile comes down to, in css px, before the map gives up tiles
 * instead: below it a sprite no longer reads at a glance. A setting already
 * under it stays as it is.
 */
export const MINIMAP_CELL_LEAST = 20
/**
 * MINIMAP_CELL_LEAST on a phone (host.ts `isPhone`): a phone is held at
 * half the distance of a monitor, so its css pixel looks bigger, and 15 of
 * them read like 20 on a Deck or a laptop.
 */
export const MINIMAP_CELL_LEAST_PHONE = 15
/** the most a tile grows to on a big screen, in css px: a 4K monitor at the 32px setting stops here */
export const MINIMAP_CELL_MOST = 48

/**
 * The "Minimap size" setting's default, in tiles across, and the most Auto
 * shows: at MINIMAP_CELL_DEFAULT a map 380px wide — a little past the
 * sidebar column of the reference layout (42 cells of 8px, game.js
 * `stat_width`, 336px), so it hangs over the view. Crawl's line of sight is
 * a square (MINIMAP_TILES_LEAST), and a disc 19 tiles across holds all of it
 * but its four corner cells; a bigger screen draws the same 19 larger
 * rather than showing more of the level.
 */
export const MINIMAP_TILES_DEFAULT = 19
/**
 * The fewest tiles across the map ever shows: crawl's line of sight, 7 cells
 * every way (defines.h `LOS_DEFAULT_RANGE`; coord-circle.cc `circle_def()` is
 * `C_SQUARE`, so a 15 by 15 square). The disc cut from it reaches the line of
 * sight's edges straight out but not its corners, which is why it is the last
 * resort, not the aim: out of room, the tiles go under MINIMAP_CELL_LEAST
 * before the count goes under this.
 */
export const MINIMAP_TILES_LEAST = 15
/**
 * With both minimap settings on Auto, the most of the screen's short side the
 * map takes, where showing MINIMAP_TILES_DEFAULT tiles at the cell would take
 * more: it shows fewer tiles first, down to MINIMAP_TILES_LEAST, and only past
 * that goes over. A big screen never meets it, the map there being about a
 * third of the short side.
 */
export const MINIMAP_SHARE = 0.45
/** MINIMAP_SHARE on a phone, where the map is a small thing on a small screen and the tiles are the least that read */
export const MINIMAP_SHARE_PHONE = 0.6
/** the status strip's badges are squares this many rows of the grid tall (renderStatuses) */
export const STATUS_BADGE_ROWS = 4

/** the odd count within one of `n` (odd counts keep the player on the centre tile), never under 1 */
export const oddUp = (n: number) => 2 * Math.floor(Math.max(0, n) / 2) + 1
/** the biggest odd count not over `n`, never under 1 */
export const oddDown = (n: number) => Math.max(1, 2 * Math.ceil(Math.max(1, n) / 2) - 1)

/**
 * The minimap's box in css px, in `room` (the most the layout lets it take
 * across and down: `layout`) on a screen whose short
 * side is `short` css px, at the "Minimap size" setting `tiles` and the
 * "Minimap tile size" setting `cell` (0 for Auto), and the cell it is drawn
 * at: a square of that many tiles on a side, taken to an odd count so the
 * player stands on the centre tile. The map is clipped to the disc inscribed
 * in it (styles.css `canvas.minimap`), so the setting reads as the diameter:
 * the map turns under the player (renderer `upYaw`), and a disc is the only
 * shape that shows the same reach on every heading — a rectangle swings its
 * corners in and out of the level as the player turns.
 *
 * The cell is the setting scaled by the screen's short side against
 * MINIMAP_REF_SHORT, so the map is the same share of every screen; a phone
 * draws it as it stands, its pixels being big already. With both settings
 * on Auto it keeps to MINIMAP_SHARE of the short side (MINIMAP_SHARE_PHONE
 * on a phone). Where the map would not fit, it gives way in turn: the tiles
 * are drawn smaller, keeping the count, down to the least that reads
 * (MINIMAP_CELL_LEAST, MINIMAP_CELL_LEAST_PHONE); then the count gives up
 * tiles, two at a time, down to MINIMAP_TILES_LEAST; then the share is
 * exceeded rather than either; and only a `room` too small for that many
 * tiles at the least draws them smaller still.
 */
export function minimapFit(room: { w: number; h: number }, short: number, tiles = 0, cell = 0, phone = false): { w: number; h: number; cell: number; tiles: number } {
  const auto = !(tiles >= 1) && !(cell >= 1)
  const most = Math.max(MINIMAP_TILES_LEAST, oddUp(tiles >= 1 ? Math.floor(tiles) : MINIMAP_TILES_DEFAULT))
  const px = cell >= 1 ? Math.floor(cell) : MINIMAP_CELL_DEFAULT
  const least = Math.min(px, phone ? MINIMAP_CELL_LEAST_PHONE : MINIMAP_CELL_LEAST)
  const want = phone || !(short > 0) ? px : Math.min(Math.max(Math.round((px * short) / MINIMAP_REF_SHORT), least), Math.max(px, MINIMAP_CELL_MOST))
  // a hair over, so 0.7 of 720 is 504 and not 503.99…
  const hard = Math.floor(Math.min(room.w, room.h) + 1e-6)
  if (!(hard > 0)) return { w: 0, h: 0, cell: want, tiles: most }
  const soft = auto && short > 0 ? Math.min(hard, Math.floor((phone ? MINIMAP_SHARE_PHONE : MINIMAP_SHARE) * short)) : hard
  let drawn = Math.max(least, Math.min(want, Math.floor(soft / most)))
  const side = Math.min(most, Math.max(MINIMAP_TILES_LEAST, oddDown(Math.floor(soft / drawn))))
  // the fewer tiles take what they left, up to the cell asked for
  drawn = Math.max(drawn, Math.min(want, Math.floor(soft / side)))
  // under the least only as far as the line of sight needs
  if (side * drawn > hard) drawn = Math.max(1, Math.floor(hard / side))
  return { w: side * drawn, h: side * drawn, cell: drawn, tiles: side }
}
