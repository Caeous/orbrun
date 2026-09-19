// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { initialState, reduce, UiState } from '@orbrun/webtiles'
import { emptyScene, type SceneCursor } from '@orbrun/scene'
import { GameScreen } from '../src/game'
import { RendererPark } from '../src/park'
import { deriveMode } from '../src/context'

/**
 * A level map opened from the ctrl-f results (stash.cc `on_single_selection`
 * → `show_map`) or by X puts its `ui_state` and its map cursor (tileweb.cc
 * `load_dungeon` → `place_cursor(CURSOR_MAP, cen)`) in the same frame. The
 * frame hands the cursor to the renderer it has, then swaps that renderer
 * for the map's: the one that draws the map must be told the cursor too.
 */
function harness(is3d: boolean) {
  const canvas = document.createElement('canvas')
  document.body.append(canvas)
  const old = { setCursor: vi.fn(), destroy: vi.fn() }
  const fresh = { setCursor: vi.fn(), destroy: vi.fn() }
  const revived = { setCursor: vi.fn(), destroy: vi.fn() }
  const park = new RendererPark()
  const screen = Object.assign(Object.create(GameScreen.prototype), {
    canvas, is3d, renderer: old, park, hud: undefined, lastCursor: null, lastOptKey: 'x', needsRender: false,
    session: { state: initialState(), scene: emptyScene(), gamedata: undefined },
    attachPointer: vi.fn(), wake: vi.fn(), makeRenderer: () => fresh, revive: () => revived,
  }) as { toggleRenderer(): unknown; lastCursor: SceneCursor | null; renderer: unknown }
  return { screen, old, fresh, revived, park }
}

describe('the renderer swap carries the cursor over', () => {
  it('the map view opened in the frame that placed the map cursor is shown that cursor', () => {
    const h = harness(true)
    const cursor: SceneCursor = { x: 12, y: 7, mode: 'map', tile: 3 }
    // the frame already gave the cursor to the 3D view it was about to put aside
    h.old.setCursor(cursor)
    h.screen.lastCursor = cursor
    h.screen.toggleRenderer()
    expect(h.screen.renderer).toBe(h.fresh)
    expect(h.fresh.setCursor).toHaveBeenCalledExactlyOnceWith(cursor)
  })

  it('the 3D view back from the park is told the cursor is gone', () => {
    const h = harness(false)
    h.park.keep({ canvas: document.createElement('canvas'), renderer: h.revived as never, tiles: null, optionsKey: '' })
    // the map's close cleared its cursor (viewmap.cc `place_cursor(CURSOR_MAP, NO_CURSOR)`) in the same frame
    h.screen.lastCursor = null
    h.screen.toggleRenderer()
    expect(h.screen.renderer).toBe(h.revived)
    expect(h.revived.setCursor).toHaveBeenCalledExactlyOnceWith(null)
    expect(h.old.destroy).toHaveBeenCalledOnce()
  })
})

describe('the level map opened from the ctrl-f results', () => {
  /** stash.cc `on_single_selection`: `show_map` runs with the results menu still on crawl's stack, hidden by its `ui::cutoff_point` */
  function openFromSearch() {
    const st = initialState()
    st.phase = 'playing'
    reduce(st, { msg: 'menu', tag: 'stash', flags: 0, title: { text: 'Search results' }, items: [{ text: 'a - a scroll', hotkeys: [97], level: 2 }] })
    reduce(st, { msg: 'ui_cutoff', cutoff: 0 })
    reduce(st, { msg: 'ui_state', state: UiState.VIEW_MAP })
    reduce(st, { msg: 'cursor', id: 2, loc: { x: 12, y: 7 } })
    return st
  }

  it('is the level map, not the hidden menu (menu.js takes no keys for a hidden popup)', () => {
    const st = openFromSearch()
    expect(st.menus[0]?.hidden).toBe(true)
    expect(deriveMode(st)).toBe('levelmap')
    expect(st.cursors[2]).toEqual({ x: 12, y: 7 })
  })

  it('gives the menu back when the map closes and the cutoff lifts', () => {
    const st = openFromSearch()
    reduce(st, { msg: 'cursor', id: 2 })
    reduce(st, { msg: 'ui_state', state: 0 })
    reduce(st, { msg: 'ui_cutoff', cutoff: -1 })
    expect(deriveMode(st)).toBe('menu')
    expect(st.cursors[2]).toBeNull()
  })
})
