/**
 * WebTiles protocol: message shapes and typed client message constructors.
 * Parsing is tolerant; every server message is `{ msg: string, ...fields }`.
 */

export interface ServerMessage {
  msg: string
  [key: string]: unknown
}

export type ClientMessage = { msg: string } & Record<string, unknown>

// ---------------------------------------------------------------------------
// Key codes (cio.h via key_conversion.js)

export const Keys = (() => {
  let val = -255
  const CK_DELETE = val++
  const CK_UP = val++
  const CK_DOWN = val++
  const CK_LEFT = val++
  const CK_RIGHT = val++
  const CK_INSERT = val++
  const CK_HOME = val++
  const CK_END = val++
  const CK_CLEAR = val++
  const CK_PGUP = val++
  const CK_PGDN = val++
  val++ // tab placeholder
  const CK_SHIFT_UP = val++
  const CK_SHIFT_DOWN = val++
  const CK_SHIFT_LEFT = val++
  const CK_SHIFT_RIGHT = val++
  const CK_SHIFT_INSERT = val++
  const CK_SHIFT_HOME = val++
  const CK_SHIFT_END = val++
  const CK_SHIFT_CLEAR = val++
  const CK_SHIFT_PGUP = val++
  const CK_SHIFT_PGDN = val++
  const CK_SHIFT_TAB = val++
  const CK_CTRL_UP = val++
  const CK_CTRL_DOWN = val++
  const CK_CTRL_LEFT = val++
  const CK_CTRL_RIGHT = val++
  const CK_CTRL_INSERT = val++
  const CK_CTRL_HOME = val++
  const CK_CTRL_END = val++
  const CK_CTRL_CLEAR = val++
  const CK_CTRL_PGUP = val++
  const CK_CTRL_PGDN = val++
  const CK_CTRL_TAB = val++
  const CK_CTRL_SHIFT_UP = val++
  const CK_CTRL_SHIFT_DOWN = val++
  const CK_CTRL_SHIFT_LEFT = val++
  const CK_CTRL_SHIFT_RIGHT = val++
  const CK_CTRL_SHIFT_INSERT = val++
  const CK_CTRL_SHIFT_HOME = val++
  const CK_CTRL_SHIFT_END = val++
  const CK_CTRL_SHIFT_CLEAR = val++
  const CK_CTRL_SHIFT_PGUP = val++
  const CK_CTRL_SHIFT_PGDN = val++
  const CK_CTRL_SHIFT_TAB = val++
  // placeholders (cio.h): ENTER, BKSP, ESCAPE, DELETE, SPACE; only used as offsets
  val += 5
  const CK_SHIFT_ENTER = val++
  const CK_SHIFT_BKSP = val++
  const CK_SHIFT_ESCAPE = val++
  const CK_SHIFT_DELETE = val++
  const CK_SHIFT_SPACE = val++
  const CK_CTRL_ENTER = val++
  const CK_CTRL_BKSP = val++
  const CK_CTRL_ESCAPE = val++
  const CK_CTRL_DELETE = val++
  const CK_CTRL_SPACE = val++
  const CK_CTRL_SHIFT_ENTER = val++
  const CK_CTRL_SHIFT_BKSP = val++
  const CK_CTRL_SHIFT_ESCAPE = val++
  const CK_CTRL_SHIFT_DELETE = val++
  const CK_CTRL_SHIFT_SPACE = val++
  return {
    ESC: 27,
    ENTER: 13,
    TAB: 9,
    BACKSPACE: 8,
    SPACE: 32,
    CK_DELETE,
    CK_UP,
    CK_DOWN,
    CK_LEFT,
    CK_RIGHT,
    CK_INSERT,
    CK_HOME,
    CK_END,
    CK_CLEAR,
    CK_PGUP,
    CK_PGDN,
    CK_SHIFT_UP,
    CK_SHIFT_DOWN,
    CK_SHIFT_LEFT,
    CK_SHIFT_RIGHT,
    CK_SHIFT_INSERT,
    CK_SHIFT_HOME,
    CK_SHIFT_END,
    CK_SHIFT_CLEAR,
    CK_SHIFT_PGUP,
    CK_SHIFT_PGDN,
    CK_SHIFT_TAB,
    CK_CTRL_UP,
    CK_CTRL_DOWN,
    CK_CTRL_LEFT,
    CK_CTRL_RIGHT,
    CK_CTRL_INSERT,
    CK_CTRL_HOME,
    CK_CTRL_END,
    CK_CTRL_CLEAR,
    CK_CTRL_PGUP,
    CK_CTRL_PGDN,
    CK_CTRL_TAB,
    CK_CTRL_SHIFT_UP,
    CK_CTRL_SHIFT_DOWN,
    CK_CTRL_SHIFT_LEFT,
    CK_CTRL_SHIFT_RIGHT,
    CK_CTRL_SHIFT_INSERT,
    CK_CTRL_SHIFT_HOME,
    CK_CTRL_SHIFT_END,
    CK_CTRL_SHIFT_CLEAR,
    CK_CTRL_SHIFT_PGUP,
    CK_CTRL_SHIFT_PGDN,
    CK_CTRL_SHIFT_TAB,
    CK_SHIFT_ENTER,
    CK_SHIFT_BKSP,
    CK_SHIFT_ESCAPE,
    CK_SHIFT_DELETE,
    CK_SHIFT_SPACE,
    CK_CTRL_ENTER,
    CK_CTRL_BKSP,
    CK_CTRL_ESCAPE,
    CK_CTRL_DELETE,
    CK_CTRL_SPACE,
    CK_CTRL_SHIFT_ENTER,
    CK_CTRL_SHIFT_BKSP,
    CK_CTRL_SHIFT_ESCAPE,
    CK_CTRL_SHIFT_DELETE,
    CK_CTRL_SHIFT_SPACE,
    NUMPAD: (n: number) => -1000 - n,
    /** F1..F19 as key_conversion.js sends them (-265..-283); F11/F12 are left to the browser. */
    F: (n: number) => -264 - n,
  } as const
})()

/** Ctrl-A .. Ctrl-Z */
export function ctrl(letter: string): number {
  return letter.toUpperCase().charCodeAt(0) - 64
}

// ---------------------------------------------------------------------------
// Client messages

export const cm = {
  login: (username: string, password: string): ClientMessage => ({ msg: 'login', username, password }),
  tokenLogin: (cookie: string): ClientMessage => ({ msg: 'token_login', cookie }),
  setLoginCookie: (): ClientMessage => ({ msg: 'set_login_cookie' }),
  forgetLoginCookie: (cookie: string): ClientMessage => ({ msg: 'forget_login_cookie', cookie }),
  register: (username: string, password: string, email: string): ClientMessage => ({
    msg: 'register',
    username,
    password,
    email,
  }),
  play: (gameId: string): ClientMessage => ({ msg: 'play', game_id: gameId }),
  watch: (username: string): ClientMessage => ({ msg: 'watch', username }),
  goLobby: (): ClientMessage => ({ msg: 'go_lobby' }),
  forceTerminate: (answer: boolean): ClientMessage => ({ msg: 'force_terminate', answer }),
  chat: (text: string): ClientMessage => ({ msg: 'chat_msg', text }),
  pong: (): ClientMessage => ({ msg: 'pong' }),
  /** Lobby: ask for the rc file of a game (answered by `rcfile_contents`), and save it back. */
  getRc: (gameId: string): ClientMessage => ({ msg: 'get_rc', game_id: gameId }),
  setRc: (gameId: string, contents: string): ClientMessage => ({ msg: 'set_rc', game_id: gameId, contents }),
  /** Any key while the `stale_processes` notice shows: keep the stale games alive. */
  stopStaleProcessPurge: (): ClientMessage => ({ msg: 'stop_stale_process_purge' }),
  /** Admin panel: a server-wide announcement. */
  adminAnnounce: (text: string): ClientMessage => ({ msg: 'admin_announce', text }),
  /** Consumables action panel (action_panel.js): use or describe the item in `slot`, or open the game menu. */
  invItemAction: (slot: number): ClientMessage => ({ msg: 'inv_item_action', slot }),
  invItemDescribe: (slot: number): ClientMessage => ({ msg: 'inv_item_describe', slot }),
  mainMenuAction: (): ClientMessage => ({ msg: 'main_menu_action' }),
  /** options.js send_option: an rc line the client changed (the action panel's own settings). */
  setOption: (name: string, value: unknown): ClientMessage => ({ msg: 'set_option', line: `${name} = ${value}` }),
  /** Printable text, written to the input buffer atomically. */
  input: (text: string): ClientMessage => ({ msg: 'input', text }),
  /** Raw bytes into the input buffer (used for `{` and alt sequences). */
  inputBytes: (data: number[]): ClientMessage => ({ msg: 'input', data }),
  /** Control characters and CK_* codes. */
  key: (keycode: number): ClientMessage => ({ msg: 'key', keycode }),
  /** Text-with-terminator used by line readers and menu filters. */
  textInput: (text: string): ClientMessage => ({ msg: 'text_input', text }),
  clickCell: (x: number, y: number, button: number): ClientMessage => ({ msg: 'click_cell', x, y, button }),
  /** Pointer over a cell while targeting: the server moves the targeting cursor there. */
  targetCursor: (x: number, y: number): ClientMessage => ({ msg: 'target_cursor', x, y }),
  menuHover: (hover: number, mouse = false): ClientMessage => ({ msg: 'menu_hover', hover, mouse }),
  menuScroll: (first: number, last: number, hover: number): ClientMessage => ({
    msg: 'menu_scroll',
    first,
    last,
    hover,
  }),
  formattedScrollerScroll: (scroll: number): ClientMessage => ({ msg: 'formatted_scroller_scroll', scroll }),
  uiStateSync: (state: Record<string, unknown>): ClientMessage => ({ msg: 'ui_state_sync', ...state }),
  outerMenuFocus: (hotkey: number, menuId: string): ClientMessage => ({
    msg: 'outer_menu_focus',
    hotkey,
    menu_id: menuId,
  }),
}

/** The rule for turning a key press into the right message. */
export function keyMessage(keycode: number): ClientMessage {
  if (keycode >= 32 && keycode < 127 && keycode !== 123) return cm.input(String.fromCharCode(keycode))
  if (keycode === 123) return cm.inputBytes([123])
  if (keycode > 127 && keycode < 0x10000) return cm.input(String.fromCodePoint(keycode))
  return cm.key(keycode)
}

// ---------------------------------------------------------------------------
// Mouse modes (tileweb.h)

export const MouseMode = {
  NORMAL: 0,
  COMMAND: 1,
  TARGET: 2,
  TARGET_DIR: 3,
  TARGET_PATH: 4,
  MORE: 5,
  MACRO: 6,
  PROMPT: 7,
  YESNO: 8,
} as const

export const MenuFlag = {
  NOSELECT: 0x0001,
  SINGLESELECT: 0x0002,
  MULTISELECT: 0x0004,
  SELECT_QTY: 0x0008,
  ANYPRINTABLE: 0x0010,
  SELECT_BY_PAGE: 0x0020,
  INIT_HOVER: 0x0040,
  WRAP: 0x0080,
  ALLOW_FILTER: 0x0100,
  ALLOW_FORMATTING: 0x0200,
  SHOW_PAGENUMBERS: 0x0400,
  START_AT_END: 0x1000,
  PRESELECTED: 0x2000,
  ARROWS_SELECT: 0x40000,
} as const

export const UiState = { NORMAL: 0, CRT: 1, VIEW_MAP: 2 } as const

/** Minimap feature categories (map-feature.h), as published by enums.js. */
export const MapFeature = {
  UNSEEN: 0,
  FLOOR: 1,
  WALL: 2,
  MAP_FLOOR: 3,
  MAP_WALL: 4,
  DOOR: 5,
  ITEM: 6,
  MONS_FRIENDLY: 7,
  MONS_PEACEFUL: 8,
  MONS_NEUTRAL: 9,
  MONS_HOSTILE: 10,
  MONS_NO_EXP: 11,
  STAIR_UP: 12,
  STAIR_DOWN: 13,
  STAIR_BRANCH: 14,
  FEATURE: 15,
  WATER: 16,
  LAVA: 17,
  TRAP: 18,
  EXCL_ROOT: 19,
  EXCL: 20,
  PLAYER: 21,
  DEEP_WATER: 22,
  PORTAL: 23,
  TRANSPORTER: 24,
  TRANSPORTER_LANDING: 25,
  EXPLORE_HORIZON: 26,
} as const
