// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { Hud, MINIMAP_CELL_DEFAULT } from '../src/hud'
import { GridHost } from '../src/grid/host'
import { gameSplit } from '../src/grid/console'

/** the HUD on a 1600×900 screen, and where it put the action panel: its left edge is the strip's own left edge */
function place(opts: { minimapTiles?: number; hideStats?: boolean; hideSidebar?: boolean; mapView?: boolean } = {}) {
  const host = document.createElement('div')
  Object.defineProperty(host, 'clientWidth', { value: 1600 })
  Object.defineProperty(host, 'clientHeight', { value: 900 })
  document.body.append(host)
  const hud = new Hud(host, { onSelectMonster() {}, onBarAction() {}, onMinimapClick() {}, onPanelItem() {}, onPanelShow() {} })
  if (opts.minimapTiles) hud.setMinimapTiles(opts.minimapTiles)
  const grid = new GridHost(host, 16)
  const cells = gameSplit(grid.grid, 7)
  // game.ts gives the HUD the whole view as the free part while the level map is open, the panes stepping aside
  const free = opts.mapView ? cells.view : cells.clear
  hud.layout(grid, cells, free, { stats: !!opts.hideStats, sidebar: !!opts.hideSidebar, messages: false })
  const panel = (hud as unknown as { actionPanel: HTMLElement }).actionPanel
  const stats = grid.px(cells.stats)
  const side = grid.px(cells.sidebar)
  const minimapW = Number.parseFloat((hud as unknown as { minimapCanvas: HTMLCanvasElement }).minimapCanvas.style.width) || 0
  return {
    left: Number.parseFloat(panel.style.left),
    top: Number.parseFloat(panel.style.top),
    statsRight: stats.left + stats.width,
    minimapLeft: side.left + side.width - minimapW,
    freeRight: grid.px(free).left + grid.px(free).width,
    cell: grid.grid.cw,
    minimapW,
  }
}

describe('the action panel stands in the strip between the stats pane and the minimap', () => {
  it('is left aligned in the strip, along the top of the view, as action_panel.js stands it in the dungeon corner', () => {
    const p = place()
    expect(p.minimapW).toBe(19 * MINIMAP_CELL_DEFAULT)
    // a gutter clear of the stats pane, and well short of the minimap it must not reach
    expect(p.left).toBeGreaterThan(p.statsRight)
    expect(p.left).toBeCloseTo(p.statsRight + p.cell, -1)
    expect(p.left).toBeLessThan(p.minimapLeft)
    expect(p.top).toBeCloseTo(3, 0)
  })
  it('keeps its left edge when the minimap grows over the view: only the room to its right is lost', () => {
    const wide = place({ minimapTiles: 45 })
    expect(wide.minimapW).toBeGreaterThan(place().minimapW)
    expect(wide.left).toBe(place().left)
    expect(wide.left).toBeLessThan(wide.minimapLeft)
  })
  it('takes the room a pane that has stepped aside leaves', () => {
    // the new-game chooser hides the stats pane: the strip reaches the view's left edge
    const noStats = place({ hideStats: true })
    expect(noStats.left).toBeLessThan(place().left)
    // the level map hides both and gives the HUD the whole view: the strip starts at the screen's own edge
    const bare = place({ hideStats: true, hideSidebar: true, mapView: true })
    expect(bare.left).toBeCloseTo(noStats.left, -1)
  })
})
