// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { initialState, reduce, MouseMode, type GameState } from '@orbrun/webtiles'
import { Hud } from '../src/hud'
import { GridHost } from '../src/grid/host'
import { gameSplit } from '../src/grid/console'
import type { Gamedata } from '@orbrun/gamedata'
import type { Camera, Scene } from '@orbrun/scene'

/** ids for the named tiles the panel asks for, so a draw can be told apart by what it drew */
const NAMED: Record<string, number> = { PROMPT_NO: 9001, CMD_GAME_MENU: 9002, CURSOR3: 9003, OOR_MESH: 9004, ELLIPSIS: 9005 }

/** every tile the panel drew, in the order it drew them */
const drawn: number[] = []

/** a gamedata that answers for any id, so what the panel asked for is what it drew */
const gd = {
  version: 'test',
  main: { id: (n: string) => NAMED[n] },
  gui: { id: (n: string) => NAMED[n] },
  icons: { id: (n: string) => NAMED[n] },
  tile(id: number) {
    drawn.push(id)
    return { atlas: 'main', sx: 0, sy: 0, w: 32, h: 32, ox: 0, oy: 0, cell: 32 }
  },
  atlas: () => ({}) as unknown as CanvasImageSource,
} as unknown as Gamedata

/** the state after the server sent `items` on the panel, the inventory having arrived */
function stateWith(...items: { slot: number; tile?: unknown; name?: string }[]): GameState {
  const st = initialState()
  const inv: Record<number, unknown> = { 0: { slot: 0, name: 'empty', quantity: 0 } }
  for (const it of items) inv[it.slot] = { quantity: 2, action_panel_order: 0, sub_type: 2, action_verb: 'Quaff', name: 'potion of curing', ...it }
  reduce(st, { msg: 'player', inv })
  st.inputMode = MouseMode.COMMAND
  return st
}

interface Fired {
  panelItem: [number, boolean][]
  hide: number
  menu: number
  settings: number
}

function draw(st: GameState) {
  drawn.length = 0
  const fired: Fired = { panelItem: [], hide: 0, menu: 0, settings: 0 }
  const host = document.createElement('div')
  Object.defineProperty(host, 'clientWidth', { value: 1600 })
  Object.defineProperty(host, 'clientHeight', { value: 900 })
  document.body.append(host)
  const hud = new Hud(host, {
    onSelectMonster() {},
    onBarAction() {},
    onMinimapClick() {},
    onPanelItem: (slot, describe) => fired.panelItem.push([slot, describe]),
    onPanelShow() {},
    onPanelHide: () => fired.hide++,
    onGameMenu: () => fired.menu++,
    onPanelSettings: () => fired.settings++,
  })
  const grid = new GridHost(host, 16)
  const cells = gameSplit(grid.grid, 7)
  hud.layout(grid, cells, cells.clear, { stats: false, sidebar: false, messages: false })
  const canvas = (hud as unknown as { panelCanvas: HTMLCanvasElement }).panelCanvas
  // happy-dom has no 2d context: a stub that swallows the calls, since what is asked of gamedata is what is drawn
  canvas.getContext = () => new Proxy({}, { get: () => () => undefined }) as unknown as CanvasRenderingContext2D
  const scene = { revision: 0, playerOnLevel: false, player: { x: 0, y: 0 }, cells: new Map(), billboards: [] } as unknown as Scene
  const cam = { x: 0, y: 0, yaw: 0 } as unknown as Camera
  const ctx = { mode: 'command', layer: 'macro', hostilesInView: 0 } as never
  // hints are off: this is about the panel, and the prompts want a scene of their own
  hud.update(st, scene, cam, ctx, 'xbox', gd, false, 'keyboard', 'list', false)
  const cell = (hud as unknown as { panelCell: number }).panelCell
  /** a click in the middle of panel cell `i`, the panel being one line across */
  const click = (i: number, button = 0) => canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: i * cell + cell / 2, clientY: cell / 2, button }))
  const tip = (i: number) => (hud as unknown as { panelTip(i: number): string }).panelTip(i)
  return { drawn: [...drawn], hidden: (hud as unknown as { actionPanel: HTMLElement }).actionPanel.classList.contains('hidden'), fired, click, tip }
}

describe('the action panel draws the tiles the server actually sends', () => {
  it('draws plain ids, as tileweb.cc _send_item sends them (base item under the item)', () => {
    // the shape the official client gets: an array of main-texture ids
    expect(draw(stateWith({ slot: 3, tile: [1234, 1237] })).drawn).toEqual([NAMED.PROMPT_NO, NAMED.CMD_GAME_MENU, 1234, 1237])
  })
  it('draws a bare id too, which action_panel.js draw_action wraps in an array', () => {
    expect(draw(stateWith({ slot: 3, tile: 1234 })).drawn).toContain(1234)
  })
  it('still draws a { t, tex } layer', () => {
    expect(draw(stateWith({ slot: 3, tile: [{ t: 1234, tex: 4 }] })).drawn).toContain(1234)
  })
})

describe("the panel carries WebTiles' two reserved buttons", () => {
  it('draws the X and the game menu before the first item', () => {
    const d = draw(stateWith({ slot: 3, tile: [1234] })).drawn
    expect(d.slice(0, 2)).toEqual([NAMED.PROMPT_NO, NAMED.CMD_GAME_MENU])
  })
  it('stands the buttons even with nothing on the panel, as action_panel.js does', () => {
    const p = draw(stateWith())
    expect(p.hidden).toBe(false)
    expect(p.drawn).toEqual([NAMED.PROMPT_NO, NAMED.CMD_GAME_MENU])
  })
  it('folds the panel away on the X, opens the game menu on the second, uses the item after them', () => {
    const p = draw(stateWith({ slot: 3, tile: [1234] }))
    p.click(0)
    p.click(1)
    p.click(2)
    expect([p.fired.hide, p.fired.menu]).toEqual([1, 1])
    expect(p.fired.panelItem).toEqual([[3, false]])
  })
  it('opens the settings on a right click on the X, and describes an item', () => {
    const p = draw(stateWith({ slot: 3, tile: [1234] }))
    p.click(0, 2)
    p.click(2, 2)
    expect(p.fired.settings).toBe(1)
    expect(p.fired.panelItem).toEqual([[3, true]])
  })
  it('says what each click does, as action_panel.js show_tooltip has it', () => {
    const p = draw(stateWith({ slot: 3, tile: [1234] }))
    expect(p.tip(0)).toBe('Left click: minimize<br>Right click: open settings')
    expect(p.tip(1)).toBe('Left click: show main menu')
    expect(p.tip(2)).toBe('d - potion of curing<br>Left click: quaff<br>Right click: describe')
  })
})
