import { describe, it, expect } from 'vitest'
import { PANEL_MAX_LINES, panelCellAt, panelCellIndex, panelGrid, panelSpan } from '../src/grid/panel'
import { actionPanelItems, type GameState } from '@orbrun/webtiles'

const FREE = { left: 0, top: 40, width: 1200, height: 700 }

describe('panelSpan: the strip between the stats pane and the minimap', () => {
  it('runs from the stats pane to the minimap, a gutter clear of both, along the top of the view', () => {
    const s = panelSpan(FREE, 340, 900, 10, 32)
    expect(s.left).toBe(350)
    expect(s.width).toBe(540)
    expect(s.top).toBe(40)
  })
  it('takes the free view own edges when a pane has stepped aside', () => {
    expect(panelSpan(FREE, null, 900, 10, 32).left).toBe(0)
    expect(panelSpan(FREE, 340, null, 10, 32).width).toBe(1200 - 350)
  })
  it('gives up when the panes leave less than two cells between them: nowhere to stand', () => {
    expect(panelSpan(FREE, 340, 400, 10, 32).width).toBe(0)
  })
  it('never reaches past the free view, whatever the panes say', () => {
    const s = panelSpan(FREE, -100, 5000, 10, 32)
    expect(s.left).toBe(0)
    expect(s.left + s.width).toBe(1200)
  })
})

describe('panelGrid: a ton of consumables in a narrow strip', () => {
  const span = { width: 320, height: 700 } // ten cells across at 32px
  it('keeps one line while the items fit it, as action_panel.js does', () => {
    const g = panelGrid(6, 32, span, true)
    expect([g.cols, g.rows, g.shown, g.overflow]).toEqual([6, 1, 6, false])
  })
  it('wraps onto another line rather than dropping what is past the first', () => {
    const g = panelGrid(24, 32, span, true)
    expect([g.cols, g.rows, g.shown, g.overflow]).toEqual([10, 3, 24, false])
  })
  it('stops at PANEL_MAX_LINES and leaves the rest behind the ellipsis', () => {
    const g = panelGrid(100, 32, span, true)
    expect(g.rows).toBe(PANEL_MAX_LINES)
    expect(g.shown).toBe(10 * PANEL_MAX_LINES)
    expect(g.overflow).toBe(true)
  })
  it('a short strip takes fewer lines still', () => {
    const g = panelGrid(100, 32, { width: 320, height: 70 }, true)
    expect(g.rows).toBe(2)
    expect(g.shown).toBe(20)
  })
  it('always keeps a line, even in a strip narrower than a cell', () => {
    const g = panelGrid(3, 32, { width: 10, height: 10 }, true)
    expect([g.cols, g.rows, g.shown, g.overflow]).toEqual([1, 1, 1, true])
  })
  it('vertical fills a column down and wraps into the next column', () => {
    const g = panelGrid(12, 32, { width: 320, height: 160 }, false)
    expect([g.cols, g.rows, g.shown]).toEqual([3, 5, 12])
  })
})

describe('panelCellAt / panelCellIndex: the cell under the pointer is the cell drawn there', () => {
  const grid = panelGrid(24, 32, { width: 320, height: 700 }, true)
  it('lays a horizontal panel out line by line', () => {
    expect(panelCellAt(0, grid, 32, true)).toEqual({ x: 0, y: 0 })
    expect(panelCellAt(9, grid, 32, true)).toEqual({ x: 288, y: 0 })
    expect(panelCellAt(10, grid, 32, true)).toEqual({ x: 0, y: 32 })
  })
  it('names the same cell back from a point in it', () => {
    for (const i of [0, 9, 10, 23]) {
      const p = panelCellAt(i, grid, 32, true)
      expect(panelCellIndex(p.x + 5, p.y + 5, grid, 32, true)).toBe(i)
    }
  })
  it('names nothing off the panel, or in a cell past the last item', () => {
    expect(panelCellIndex(-2, 5, grid, 32, true)).toBe(-1)
    expect(panelCellIndex(5, -2, grid, 32, true)).toBe(-1)
    expect(panelCellIndex(400, 5, grid, 32, true)).toBe(-1)
    const short = panelGrid(11, 32, { width: 320, height: 700 }, true)
    expect(panelCellIndex(5, 40, short, 32, true)).toBe(10)
    expect(panelCellIndex(40, 40, short, 32, true)).toBe(-1)
  })
  it('lays a vertical panel out column by column and reads it back', () => {
    const v = panelGrid(12, 32, { width: 320, height: 160 }, false)
    expect(panelCellAt(5, v, 32, false)).toEqual({ x: 32, y: 0 })
    expect(panelCellIndex(32 + 5, 5, v, 32, false)).toBe(5)
  })
})

describe('actionPanelItems: action_panel.js update()', () => {
  const state = (inv: Record<string, unknown>) => ({ player: { inv } }) as unknown as GameState
  it('takes items with a quantity and an order, in order, ties by sub_type', () => {
    const items = actionPanelItems(
      state({
        0: { slot: 0, name: 'scroll of fear', quantity: 1, action_panel_order: 1, sub_type: 9 },
        1: { slot: 1, name: 'potion of curing', quantity: 3, action_panel_order: 0, sub_type: 2 },
        2: { slot: 2, name: 'a rock', quantity: 1 },
        3: { slot: 3, name: 'wand of flame', quantity: 1, action_panel_order: -1 },
        4: { slot: 4, name: 'empty', quantity: 0, action_panel_order: 0 },
        5: { slot: 5, name: 'scroll of blinking', quantity: 2, action_panel_order: 1, sub_type: 3 },
      }),
    )
    expect(items.map((i) => [i.name, i.letter])).toEqual([
      ['potion of curing', 'b'],
      ['scroll of blinking', 'f'],
      ['scroll of fear', 'a'],
    ])
  })
})
