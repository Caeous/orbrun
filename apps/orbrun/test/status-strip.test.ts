// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { initialState, reduce, type GameState } from '@orbrun/webtiles'
import { Render2d } from '@orbrun/render-2d'
import { Hud, STATUS_BADGE_ROWS, TRAPPED_FRACTION } from '../src/hud'
import { GridHost } from '../src/grid/host'
import { gameSplit } from '../src/grid/console'
import type { Gamedata } from '@orbrun/gamedata'
import type { Billboard, Camera, Scene } from '@orbrun/scene'

/** every badge blown up onto the strip, in the order it drew them (the monster list and portrait draw the same billboard at cell size) */
const drawn: number[] = []
vi.spyOn(Render2d.prototype, 'drawTileFit').mockImplementation(function (this: Render2d, id: number) {
  drawn.push(id)
})

/** a gamedata that answers for any id: a 12x12 badge authored in the top-left corner of its cell, as the poison icon is */
const gd = {
  version: 'test',
  tile: () => ({ atlas: 'icons', sx: 0, sy: 0, w: 12, h: 12, ox: 0, oy: 0, cell: 32 }),
  atlas: () => ({}) as unknown as CanvasImageSource,
} as unknown as Gamedata

const POISON = 4001
const NET = 4002
const HP_BAR = 4003
const STACK = 4004
const CONSTR = 4005
const WEB = 4006

function stateWith(status: { light?: string; text?: string; desc?: string; col?: number }[] = [], options: Record<string, unknown> = {}): GameState {
  const st = initialState()
  reduce(st, { msg: 'player', status })
  Object.assign(st.options, options)
  return st
}

/** what the trapped mark in the middle of the view drew and where */
interface Trapped {
  drawn: number[]
  hidden: boolean
  size: number
  left: number
  top: number
  /** the free view in css px */
  free: { left: number; top: number; width: number; height: number }
}

interface Drew {
  drawn: number[]
  hidden: boolean
  title: string
  width: number
  height: number
  left: number
  top: number
  ch: number
  cw: number
  /** the minimap's left edge and the sidebar's top in css px */
  mapLeft: number
  mapTop: number
  /** the stats pane's right edge in css px */
  statsRight: number
  trapped: Trapped
}

function draw(st: GameState, badges: NonNullable<Billboard['statusIcons']> | undefined, { onLevel = true, gamedata = gd as Gamedata | null } = {}): Drew {
  drawn.length = 0
  const host = document.createElement('div')
  Object.defineProperty(host, 'clientWidth', { value: 1600 })
  Object.defineProperty(host, 'clientHeight', { value: 900 })
  document.body.append(host)
  // happy-dom has no 2d context: a stub that swallows the calls, since what is asked of gamedata is what is drawn. The
  // renderer takes the context as it mounts, so the stub goes on before the HUD makes its canvases
  const proto = HTMLCanvasElement.prototype
  proto.getContext = (() => new Proxy({}, { get: () => () => undefined })) as unknown as typeof proto.getContext
  const hud = new Hud(host, {
    onSelectMonster() {},
    onBarAction() {},
    onMinimapClick() {},
    onPanelItem() {},
    onPanelShow() {},
    onPanelHide() {},
    onGameMenu() {},
    onPanelSettings() {},
  })
  const grid = new GridHost(host, 16)
  const cells = gameSplit(grid.grid, 7)
  hud.layout(grid, cells, cells.clear, { stats: false, sidebar: false, messages: false })
  const canvas = (hud as unknown as { statusCanvas: HTMLCanvasElement }).statusCanvas
  const me: Billboard = { x: 5, y: 5, tile: 1, kind: 'player', height: 0.7, statusIcons: badges }
  const scene = { revision: 0, playerOnLevel: onLevel, player: { x: 5, y: 5 }, cells: new Map(), billboards: [me] } as unknown as Scene
  const cam = { x: 0, y: 0, yaw: 0 } as unknown as Camera
  const ctx = { mode: 'command', layer: 'macro', hostilesInView: 0 } as never
  const before = drawn.length
  hud.update(st, scene, cam, ctx, 'xbox', gamedata, false, 'keyboard', 'list', false)
  const strip = (hud as unknown as { statuses: HTMLElement }).statuses
  const map = (hud as unknown as { minimapCanvas: HTMLCanvasElement }).minimapCanvas
  const side = grid.px(cells.sidebar)
  const stats = grid.px(cells.stats)
  const mapLeft = side.left + side.width - parseFloat(map.style.width)
  // the strip draws before the mark (hud.update), so what the mark drew is whatever came after the strip's badges
  const stripCount = badges ? badges.filter((b) => !b.at && !b.square && !b.full).length : 0
  const stripDrawn = strip.hidden ? [] : drawn.slice(before, before + stripCount)
  const mark = (hud as unknown as { trapped: HTMLElement }).trapped
  const markCanvas = (hud as unknown as { trappedCanvas: HTMLCanvasElement }).trappedCanvas
  const free = grid.px(cells.clear)
  return {
    drawn: stripDrawn,
    hidden: strip.hidden,
    title: strip.title,
    width: parseFloat(canvas.style.width),
    height: parseFloat(canvas.style.height),
    left: parseFloat(strip.style.left),
    top: parseFloat(strip.style.top),
    ch: grid.grid.ch,
    cw: grid.grid.cw,
    mapLeft,
    mapTop: side.top,
    statsRight: stats.left + stats.width,
    trapped: {
      drawn: mark.hidden ? [] : drawn.slice(before + stripDrawn.length),
      hidden: mark.hidden,
      size: parseFloat(markCanvas.style.width),
      left: parseFloat(mark.style.left),
      top: parseFloat(mark.style.top),
      free: { left: free.left, top: free.top, width: free.width, height: free.height },
    },
  }
}

describe('the status strip beside the minimap', () => {
  it("draws the player's own corner badges in a row leftward from the map's left edge, one square each, STATUS_BADGE_ROWS of the grid tall", () => {
    const d = draw(stateWith(), [{ tile: POISON, ox: 0, oy: 0 }, { tile: CONSTR, ox: -5, oy: 0 }])
    expect(d.hidden).toBe(false)
    expect(d.drawn).toEqual([POISON, CONSTR])
    const side = d.ch * STATUS_BADGE_ROWS
    expect(d.width).toBe(2 * side)
    expect(d.height).toBe(side)
    // a cell's gutter left of the map, level with its top
    expect(d.left + d.width).toBe(d.mapLeft - d.cw)
    expect(d.top).toBe(d.mapTop)
  })

  it('wraps onto another row once the row between the stats pane and the map is full', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ tile: 5000 + i, ox: 0, oy: 0 }))
    const d = draw(stateWith(), many)
    const side = d.ch * STATUS_BADGE_ROWS
    const across = Math.floor((d.mapLeft - d.cw - (d.statsRight + d.cw)) / side)
    expect(across).toBeGreaterThan(1)
    expect(across).toBeLessThan(many.length)
    expect(d.width).toBe(across * side)
    expect(d.height).toBe(Math.ceil(many.length / across) * side)
    expect(d.left + d.width).toBe(d.mapLeft - d.cw)
  })

  it('leaves out the damage bar, the "something under here" marks and the whole-cell net and web', () => {
    const d = draw(stateWith(), [{ tile: STACK, ox: 0, oy: 0, square: true }, { tile: NET, ox: 0, oy: 0, full: true }, { tile: POISON, ox: -5, oy: 0 }, { tile: HP_BAR, ox: 0, oy: 0, at: 'top' }])
    expect(d.drawn).toEqual([POISON])
  })

  it('is hidden with nothing to show: no badges, the player off the level, no gamedata, glyph mode', () => {
    expect(draw(stateWith(), undefined).hidden).toBe(true)
    expect(draw(stateWith(), []).hidden).toBe(true)
    expect(draw(stateWith(), [{ tile: POISON, ox: 0, oy: 0 }], { onLevel: false }).hidden).toBe(true)
    expect(draw(stateWith(), [{ tile: POISON, ox: 0, oy: 0 }], { gamedata: null }).hidden).toBe(true)
    expect(draw(stateWith([], { tile_display_mode: 'glyphs' }), [{ tile: POISON, ox: 0, oy: 0 }]).hidden).toBe(true)
  })

  it("carries the status lights' descriptions as its tooltip", () => {
    const st = stateWith([
      { light: 'Pois', text: 'poisoned', desc: 'You are poisoned.', col: 2 },
      { text: 'no light here' },
      { light: 'Hasty', text: 'hasted' },
    ])
    expect(draw(st, [{ tile: POISON, ox: 0, oy: 0 }]).title).toBe('You are poisoned.\nhasted')
  })
})

describe('the trapped mark in the middle of the view', () => {
  it('blows the net and the web up on one square, TRAPPED_FRACTION of the free view, centred on it', () => {
    const d = draw(stateWith(), [{ tile: POISON, ox: 0, oy: 0 }, { tile: NET, ox: 0, oy: 0, full: true }, { tile: WEB, ox: 0, oy: 0, full: true }])
    const t = d.trapped
    expect(t.hidden).toBe(false)
    expect(t.drawn).toEqual([NET, WEB])
    const px = Math.round(Math.min(t.free.width, t.free.height) * TRAPPED_FRACTION)
    expect(t.size).toBe(px)
    expect(t.left).toBe(Math.round(t.free.left + (t.free.width - px) / 2))
    expect(t.top).toBe(Math.round(t.free.top + (t.free.height - px) / 2))
    // the corner strip still shows the corner badges beside the map
    expect(d.drawn).toEqual([POISON])
  })

  it('is hidden with no whole-cell badge, in glyph mode, and under a menu, a popup or the level map', () => {
    const net = [{ tile: NET, ox: 0, oy: 0, full: true as const }]
    expect(draw(stateWith(), [{ tile: POISON, ox: 0, oy: 0 }]).trapped.hidden).toBe(true)
    expect(draw(stateWith([], { tile_display_mode: 'glyphs' }), net).trapped.hidden).toBe(true)
    const menu = stateWith()
    menu.menus.push({} as never)
    expect(draw(menu, net).trapped.hidden).toBe(true)
    const popup = stateWith()
    popup.ui.push({} as never)
    expect(draw(popup, net).trapped.hidden).toBe(true)
    const map = stateWith()
    map.uiState = 2
    expect(draw(map, net).trapped.hidden).toBe(true)
  })
})
