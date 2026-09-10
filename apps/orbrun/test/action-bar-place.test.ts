// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { Hud, type HudHooks } from '../src/hud'
import { GridHost } from '../src/grid/host'
import { gameSplit } from '../src/grid/console'
import type { Context } from '../src/context'

const context: Context = {
  mode: 'command', layer: 'micro',
  ahead: { kind: 'door-closed', label: 'closed door' },
  under: { kind: 'none', label: '' }, hostilesInView: 0,
}
const hooks: HudHooks = {
  onSelectMonster() {}, onBarAction() {}, onMinimapClick() {}, onPanelItem() {},
  onPanelShow() {}, onPanelHide() {}, onGameMenu() {}, onPanelSettings() {},
}
const grids: GridHost[] = []
afterEach(() => {
  for (const grid of grids.splice(0)) grid.destroy()
  document.body.replaceChildren()
})

function setup(width = 1280, height = 800) {
  const host = document.createElement('div')
  Object.defineProperties(host, { clientWidth: { value: width }, clientHeight: { value: height } })
  document.body.append(host)
  const hud = new Hud(host, hooks)
  const grid = new GridHost(host, 16)
  grids.push(grid)
  const cells = gameSplit(grid.grid, 7)
  const layout = (hidden = false) => hud.layout(grid, cells, cells.clear, { stats: false, sidebar: hidden, messages: false })
  const inner = hud as unknown as {
    renderBar(ctx: Context, kind: string, spectating: boolean, device: string, hints: boolean): void
    actionbar: HTMLElement
  }
  const render = (device = 'pad', hints = true) => inner.renderBar(context, 'steamdeck', false, device, hints)
  layout()
  return { hud, host, grid, cells, layout, render, bar: inner.actionbar }
}

/** The prompt stack stands at the foot of the free view, its right edge on the view's, growing upward. */
function expectInCorner(hud: Hud, bar: HTMLElement, grid: GridHost, cells: ReturnType<typeof gameSplit>) {
  const free = grid.px(cells.clear)
  expect(bar.parentElement).toBe(hud.root)
  expect(bar.style.left).toBe(free.left + 'px')
  expect(bar.style.width).toBe(free.width + 'px')
  expect(bar.style.top).toBe(free.top + free.height + 'px')
  expect(bar.style.transform).toBe('translateY(-100%)')
}

describe('the prompt stack in the corner of the view', () => {
  it.each([[1280, 800], [1920, 1080]])('stands at the foot of the free view for the pad at %i×%i, never on the sidebar', (width, height) => {
    const { hud, host, render, bar, grid, cells } = setup(width, height)
    render()
    expect(bar.hidden).toBe(false)
    expectInCorner(hud, bar, grid, cells)
    expect(host.querySelector('.sidebar')!.contains(bar)).toBe(false)
    expect(host.querySelector('.minimap')!.nextElementSibling).toBe(host.querySelector('.monsters'))
  })

  it('is the same place for the keyboard, and stays put when the device changes', () => {
    const { hud, render, bar, grid, cells } = setup()
    render('keyboard')
    expectInCorner(hud, bar, grid, cells)
    render()
    expectInCorner(hud, bar, grid, cells)
  })

  it('keeps a chip and its place across a minimap resize', () => {
    const { hud, render, layout, bar, grid, cells } = setup()
    render()
    const chip = bar.querySelector('.chip')
    hud.setMinimapTiles(11)
    layout()
    render()
    expectInCorner(hud, bar, grid, cells)
    expect(bar.querySelector('.chip')).toBe(chip)
  })

  it('does not move when the sidebar hides or returns', () => {
    const { hud, render, layout, bar, grid, cells } = setup()
    render()
    layout(true)
    render()
    expect(bar.hidden).toBe(false)
    expectInCorner(hud, bar, grid, cells)
    layout()
    render()
    expectInCorner(hud, bar, grid, cells)
  })

  it('still hides hints for mouse input or when hints are off', () => {
    const { render, bar } = setup()
    render()
    render('mouse')
    expect(bar.hidden).toBe(true)
    render('pad', false)
    expect(bar.hidden).toBe(true)
  })
})
