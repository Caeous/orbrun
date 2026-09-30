import { getSettings, saveSettings, VIEW_OPTIONS, type LeftRight, type Settings } from './servers'

/**
 * Orbrun's own settings, one row each: what it is called, which key it sets,
 * the values it cycles through (in the order left and right walk them) and
 * how a value reads. The same list draws the settings scroll on the front
 * end's map (lobby.ts) and the settings menu in a game (main.ts), so the two
 * never disagree.
 *
 * A row may depend on the other settings: its hint can read differently
 * under them and it can be off under them (Nearby means nothing in 2D).
 * `rowHint` and `rowOff` resolve those; consumers redraw every row after any
 * change, since one row's change can move another's.
 */
/**
 * The groups the settings screen is laid out in, in order (the plan's "one
 * settings destination"), each with the line it prints under its tab: the
 * settings panel draws one group at a time, the way a game's options screen
 * has a tab per kind of setting, so no group is ever a scroll long.
 */
const SETTING_GROUPS = [
  ['Camera', 'Where the view stands, how wide it opens and what it draws.'],
  ['Controls', 'What the keys, the d-pad and the sticks do.'],
  ['Interface', 'What the HUD shows around the view, and how big it is.'],
] as const
export type SettingGroup = (typeof SETTING_GROUPS)[number][0]

export interface SettingRow<K extends keyof Settings = keyof Settings> {
  label: string
  group: SettingGroup
  /** the key this row sets */
  key: K
  values: readonly Settings[K][]
  fmt(v: Settings[K]): string
  /** what the scroll says when the player stands on it (the front end's message line), or what it says under the current settings */
  hint: string | ((s: Settings) => string)
  /**
   * When the row does nothing under the current settings. Left and right
   * leave it alone and it is drawn dim, the way the game's menus draw an
   * item that cannot be taken; its value still reads, so the player sees
   * what it will be once it applies.
   */
  off?(s: Settings): boolean
}

function row<K extends keyof Settings>(group: SettingGroup, label: string, key: SettingRow<K>['key'], values: readonly Settings[K][], hint: SettingRow<K>['hint'], fmt: (v: Settings[K]) => string = String, off?: (s: Settings) => boolean): SettingRow<K> {
  return { group, label, key, values, fmt, hint, off }
}

/** What the scroll says on `r` under `s`. */
export function rowHint(r: SettingRow, s: Settings = getSettings()): string {
  return typeof r.hint === 'function' ? r.hint(s) : r.hint
}

/** Whether `r` does nothing under `s`. */
export function rowOff(r: SettingRow, s: Settings = getSettings()): boolean {
  return r.off?.(s) ?? false
}

/**
 * Eye height, in cells, lowest first (rendering-3d.md II.11): 0 is the
 * floor and 1 the lid, and the stops keep clear of both. It is the eye, 0.65
 * by default; the low end is a kobold's view of the corridor and the high end
 * brushes the lid. The stops are a twentieth of a cell apart: the height sets
 * the pitch of the whole view, so it is worth aiming finely.
 */
export const EYE_HEIGHTS = [0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9] as const

/**
 * Camera angle (rendering-3d.md II.11), in degrees off the horizon, most
 * down first: where the view points at rest, before any glance with the
 * stick or the mouse. The default -5 tips the floor a few cells ahead
 * into frame without losing the wall tops; the range runs from -30, a look
 * down at the ground the @ stands on, to +10, a glance up at the lid. The
 * stops are five degrees apart, fine enough that no step jars.
 */
export const CAM_ANGLES: readonly number[] = [-30, -25, -20, -15, -10, -5, 0, 5, 10]

/**
 * Minimap size (hud.md "Minimap"), in tiles across: how much of the level
 * the map shows. Every odd count from MINIMAP_TILES_MIN to MINIMAP_TILES_MAX,
 * two tiles a step, so the player always stands on the centre tile; the
 * default is 21, the sidebar column's width on the reference layout, as
 * minimap.js `fit_to` makes it. The map follows the player at the cell the
 * "Minimap tile size" row sets, so more tiles show more of the level rather
 * than smaller cells.
 */
const MINIMAP_TILES_MIN = 9
export const MINIMAP_TILES_MAX = 61
export const MINIMAP_TILES: readonly number[] = Array.from({ length: (MINIMAP_TILES_MAX - MINIMAP_TILES_MIN) / 2 + 1 }, (_, i) => MINIMAP_TILES_MIN + 2 * i)

/**
 * Minimap tile size, in css px: how big each of those tiles is drawn. The
 * default is 16, the cell the map has always followed the player at; the
 * stops go down to 8, near the 4px cell WebTiles' own auto-sized minimap
 * comes out at on the reference column (minimap.js `fit_to` fits all `gxm`
 * columns in, since it shows the whole level rather than following), and up
 * to 32, `tile_cell_pixels`, a full dungeon tile. The count of tiles stays what the "Minimap size"
 * row says, so a bigger cell is the same map drawn larger, until the map
 * meets the caps in `minimapBox` and loses tiles off the count.
 */
export const MINIMAP_CELLS: readonly number[] = [8, 10, 12, 14, 16, 20, 24, 28, 32]

/**
 * The rows that only make sense while 2D is offered (`VIEW_OPTIONS` in
 * servers.ts): the one that chooses it. It stays written here so bringing the
 * mode back is one flag.
 */
const VIEW_MODE_ROWS = ['View']


/**
 * What left and right do, one row per hand: the keyboard (arrows, h/l and the
 * numpad alike) and the pad (d-pad and left stick alike). Both turn by
 * default, which is what Orbrun has always done. Forward, back and the
 * diagonals are untouched: they step, and only forward turns the view onto
 * the way it went.
 */
const LEFT_RIGHT_VALUES: readonly LeftRight[] = ['turn', 'strafe']
const leftRightRows: SettingRow[] = ([
  // a key always steps under Shift (a run) or Ctrl (an attack), whatever it does plain; the pad has no such modifier
  ['Keyboard left/right', 'leftRightKeys', 'Left and right on the arrow keys, h and l, and 4 and 6 on the numpad', true],
  ['Gamepad left/right', 'leftRightPad', 'Left and right on the d-pad and the left stick', false],
] as const).map(([label, key, what, keys]) =>
  row<typeof key>('Controls', label, key, LEFT_RIGHT_VALUES, `${what}: turn the camera on the spot, or strafe one step sideways keeping the heading.${keys ? ' Shift (run) and Ctrl (attack) always step.' : ''}`, (v) => (v === 'turn' ? 'Turn' : 'Strafe')),
)

/** Every row, whatever is offered; `SETTING_ROWS` is what the player sees. */
export const ALL_SETTING_ROWS: readonly SettingRow[] = [
  // Camera
  row('Camera', 'View', 'renderer', ['3d', '2d'], 'In the dungeon in 3D, or from above as the console shows it.', (v) => (v === '3d' ? '3D' : 'Top down (2D)')),
  row('Camera', 'Camera height', 'eyeHeight', EYE_HEIGHTS, 'How high your eyes stand, from the floor to the ceiling.', (v) => (v as number).toFixed(2) + ' cells'),
  row('Camera', 'Camera angle', 'restPitch', CAM_ANGLES, 'Where the view points at rest: level with the horizon, or tipped down toward the floor ahead.', (v) => ((v as number) === 0 ? 'Level' : Math.abs(v as number) + '° ' + ((v as number) < 0 ? 'down' : 'up'))),
  row('Camera', 'Field of view', 'fov', [60, 70, 75, 85, 95], 'How wide the first-person view opens.', (v) => v + '°'),
  row('Camera', 'Hands', 'viewmodel', [true, false], 'The wielded weapon and off-hand item, drawn in view.', (v) => (v ? 'Weapon and shield shown' : 'Hidden')),
  // Controls
  ...leftRightRows,
  row('Controls', 'Look sensitivity', 'lookSensitivity', [1, 1.3, 1.6, 0.7], 'How far the right stick turns you.', (v) => Math.round(v * 100) + '%'),
  row('Controls', 'Invert look', 'invertLook', [false, true], 'Push the right stick up to look down.', (v) => (v ? 'On' : 'Off')),
  row('Controls', 'Hints', 'hints', ['adaptive', 'contextual', 'off'], 'Gamepad prompts in the corner of the view for what is in front of you. Adaptive also teaches the controls until used, across all runs. Contextual only skips the teaching. Off hides gameplay hints; menu and targeting controls remain.', (v) => ({ adaptive: 'Adaptive', contextual: 'Contextual only', off: 'Off' })[v]),
  // Interface
  row('Interface', 'UI scale', 'uiScale', [1, 1.15, 1.3, 1.5, 0.85], 'The size of the HUD, menus and messages.', (v) => Math.round(v * 100) + '%'),
  row(
    'Interface',
    'Nearby',
    'nearby',
    ['list', 'pips'],
    (s) => (s.renderer === '3d' ? 'What says what is around you: the monster list on the sidebar, or markers on the edge of the view for what is out of frame.' : '3D only: in 2D the monster list always shows, as in WebTiles.'),
    (v) => (v === 'list' ? 'Monster list' : 'Edge pips'),
    (s) => s.renderer !== '3d',
  ),
  row('Interface', 'Minimap size', 'minimapTiles', MINIMAP_TILES, 'How many tiles across the minimap shows: it grows out of its corner over the view, at the same cell size.', (v) => v + ' tiles'),
  row('Interface', 'Minimap tile size', 'minimapCell', MINIMAP_CELLS, 'How big each minimap tile is drawn: the same tiles, larger, until the map runs out of room over the view.', (v) => v + 'px'),
]

/** The offered rows by group, in group order, each with its tab's line; groups with no row left out. */
export function settingGroups(rows: readonly SettingRow[] = SETTING_ROWS): { group: SettingGroup; hint: string; rows: SettingRow[] }[] {
  return SETTING_GROUPS.map(([group, hint]) => ({ group, hint, rows: rows.filter((r) => r.group === group) })).filter((g) => g.rows.length)
}

export const SETTING_ROWS: readonly SettingRow[] = VIEW_OPTIONS ? ALL_SETTING_ROWS : ALL_SETTING_ROWS.filter((r) => !VIEW_MODE_ROWS.includes(r.label))

/** How `r` reads right now. */
export function settingValue(r: SettingRow, s: Settings = getSettings()): string {
  return (r.fmt as (v: unknown) => string)(s[r.key])
}

/**
 * Move `r` on by `d` steps (right is next, left is previous, wrapping),
 * save, and apply what applies at once (the UI scale). Returns how the new
 * value reads; a running game applies the rest through `onchange`. A row
 * that is off under the current settings (`rowOff`) is left as it is. A
 * value that is not one of the stops (a default between two, an old saved
 * value) steps to the next stop in that direction (`offStop`).
 */
export function adjustSetting(r: SettingRow, d: number, onchange?: () => void): string {
  const s = getSettings()
  if (rowOff(r, s)) return settingValue(r, s)
  const key = r.key
  const values = r.values as readonly unknown[]
  const cur = s[key]
  const i = values.indexOf(cur)
  const n = i >= 0 || typeof cur !== 'number' ? values[((((i < 0 ? 0 : i) + d) % values.length) + values.length) % values.length] : offStop(values as readonly number[], cur, d)
  ;(s as unknown as Record<string, unknown>)[key] = n
  saveSettings(s)
  document.documentElement.style.setProperty('--ui-scale', String(s.uiScale))
  onchange?.()
  return settingValue(r, s)
}

/**
 * The stop `d` steps from `cur`, which is not itself a stop. On an ascending
 * scale (the camera heights) one step right is the first stop above and one
 * step left the first stop below, so 0.62 goes to 0.65 or 0.6 and no stop is
 * skipped; on any other scale it is the nearest stop, then the step.
 */
function offStop(values: readonly number[], cur: number, d: number): number {
  const ascending = values.every((v, k) => k === 0 || v > values[k - 1])
  if (ascending) {
    const above = values.findIndex((v) => v > cur)
    const i = d > 0 ? (above < 0 ? values.length : above) + d - 1 : (above < 0 ? values.length : above) + d
    return values[Math.max(0, Math.min(values.length - 1, i))]
  }
  let i = 0
  for (let k = 1; k < values.length; k++) if (Math.abs(values[k] - cur) < Math.abs(values[i] - cur)) i = k
  return values[((((i + d) % values.length) + values.length) % values.length)]
}
