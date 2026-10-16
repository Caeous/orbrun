// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { Hud, footerPlaces, type HudHooks } from '../src/hud'
import { GridHost } from '../src/grid/host'
import { gameSplit } from '../src/grid/console'
import type { Context } from '../src/context'
import type { BindingLabel } from '../src/bindings'
import type { BindingLabel } from '../src/bindings'

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
  const render = (device = 'pad', hints = true) => inner.renderBar(context, 'xbox', false, device, hints)
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

  it('stands right below a panel, its right edge on the panel’s, and back in the corner once it closes', () => {
    const { hud, host, bar, grid, cells } = setup()
    const stack = document.createElement('div')
    stack.className = 'overlay-stack'
    const panel = document.createElement('div')
    panel.className = 'popup menu'
    stack.append(panel)
    host.append(stack)
    panel.getBoundingClientRect = () => new DOMRect(300, 50, 600, 400)
    const inner = hud as unknown as {
      renderBar(ctx: Context, kind: string, spectating: boolean, device: string, hints: boolean, padLabels: BindingLabel[]): void
      placeBar(under: boolean): void
    }
    inner.renderBar({ ...context, mode: 'menu' }, 'xbox', false, 'pad', true, [{ button: 'A', label: 'Select' }, { button: 'B', label: 'Back' }])
    expect(bar.hidden).toBe(false)
    inner.placeBar(true)
    expect(bar.classList.contains('under')).toBe(true)
    expect(bar.style.left).toBe('300px')
    expect(bar.style.width).toBe('600px')
    expect(bar.style.top).toBe(450 + 16 + 'px')
    expect(bar.style.transform).toBe('none')
    // a panel that reaches the view's foot: the prompts stop at it
    panel.getBoundingClientRect = () => new DOMRect(300, 50, 600, 2000)
    inner.placeBar(true)
    const free = grid.px(cells.clear)
    expect(bar.style.top).toBe(free.top + free.height + 'px')
    panel.classList.add('hidden')
    inner.placeBar(true)
    expect(bar.classList.contains('under')).toBe(false)
    expectInCorner(hud, bar, grid, cells)
  })

  it('reads in one order under a panel, A at the right end', () => {
    const { hud, bar } = setup()
    const inner = hud as unknown as {
      renderBar(ctx: Context, kind: string, spectating: boolean, device: string, hints: boolean, padLabels: BindingLabel[], under: boolean): void
    }
    const l = (button: BindingLabel['button'], label: string) => ({ button, label, action: { kind: 'menu', op: 'select' }, contextual: true }) as BindingLabel
    inner.renderBar({ ...context, mode: 'menu' }, 'xbox', false, 'pad', true, [l('A', 'select'), l('X', 'Examine'), l('Y', 'Swap weapons'), l('LT', 'Shout')], true)
    expect([...bar.querySelectorAll('.chip')].map((c) => c.textContent)).toEqual(['LTShout', 'YSwap weapons', 'XExamine', 'Aselect'])
  })
  it('packs the prompts as a list, holding no place for a button that is away, and wears a fresh one green', () => {
    const { hud, bar } = setup()
    const inner = hud as unknown as {
      renderBar(ctx: Context, kind: string, spectating: boolean, device: string, hints: boolean, padLabels: BindingLabel[], under: boolean): void
    }
    const l = (button: BindingLabel['button'], label: string, over: Partial<BindingLabel> = {}) => ({ button, label, action: { kind: 'menu', op: 'select' }, contextual: true, ...over }) as BindingLabel
    const order = () => [...bar.querySelectorAll('.chip')].map((c) => c.textContent + (c.classList.contains('fresh') ? '!' : ''))
    inner.renderBar({ ...context, mode: 'menu' }, 'xbox', false, 'pad', true, [l('X', 'Examine'), l('B', 'cancel')], true)
    expect(order()).toEqual(['XExamine', 'Bcancel'])
    inner.renderBar({ ...context, mode: 'menu' }, 'xbox', false, 'pad', true, [l('A', 'select'), l('X', 'Examine')], true)
    expect(order()).toEqual(['XExamine', 'Aselect'])
    inner.renderBar({ ...context, mode: 'menu' }, 'xbox', false, 'pad', true, [l('A', 'select'), l('START', 'accept', { fresh: true })], true)
    expect(order()).toEqual(['accept!', 'Aselect'])
    inner.renderBar(context, 'xbox', false, 'pad', true, [l('RB', 'Fire dart')], false)
    expect(order()).toEqual(['RBFire dart'])
  })

  // the shop's footer (shopping.cc ShopMenu::update_help) as CDI sent it, padded into columns
  const SHOP_MORE =
    '<yellow>You have 73 gold pieces.<lightgrey>                                                        \n' +
    '<lightgrey>[<white>Esc<lightgrey>] exit          [<white>!<lightgrey>] <white>buy<lightgrey>|examine items       [<white>a<lightgrey>-<white>j<lightgrey>] mark item for purchase   \n' +
    '[<white>/<lightgrey>] sort (type)                                 [<white>A<lightgrey>-<white>J<lightgrey>] put item on shopping list'
  const shopLabel = (button: BindingLabel['button'], label: string) => ({ button, label, action: { kind: 'menu', op: 'select' }, contextual: true }) as BindingLabel

  it('stands each prompt under a menu where its footer names it', () => {
    const a = shopLabel('A', 'mark item for purchase'), x = shopLabel('X', 'buy|examine items'), y = shopLabel('Y', 'put item on shopping list'), lt = shopLabel('LT', 'List marked')
    const places = footerPlaces(SHOP_MORE, [y, x, lt, a])!
    // mark top right, put item under it, buy|examine left of mark; the empty first column closed up
    expect(places.get(a)).toEqual({ row: 1, col: 2 })
    expect(places.get(y)).toEqual({ row: 2, col: 2 })
    expect(places.get(x)).toEqual({ row: 1, col: 1 })
    expect(places.has(lt)).toBe(false)
    expect(footerPlaces(SHOP_MORE, [shopLabel('A', 'select')])).toBeNull()
  })

  it('lays the prompts under a menu out as its footer, the ones it does not name in a line above', () => {
    const { hud, bar } = setup()
    const inner = hud as unknown as {
      renderBar(ctx: Context, kind: string, spectating: boolean, device: string, hints: boolean, padLabels: BindingLabel[], under: boolean): void
    }
    const shop = { ...context, mode: 'menu', menu: { menu: { tag: 'shop', more: SHOP_MORE, items: [], flags: 0 } } } as unknown as Context
    inner.renderBar(shop, 'xbox', false, 'pad', true, [shopLabel('A', 'mark item for purchase'), shopLabel('X', 'buy|examine items'), shopLabel('Y', 'put item on shopping list'), shopLabel('LT', 'List marked')], true)
    expect(bar.classList.contains('grid')).toBe(true)
    expect(bar.style.gridTemplateColumns).toBe('repeat(2, auto)')
    expect([...bar.querySelectorAll('.rest .chip')].map((c) => c.textContent)).toEqual(['LTList marked'])
    const at = (b: string) => (bar.querySelector(':scope > .chip.' + b) as HTMLElement).style.gridArea
    expect([at('A'), at('Y'), at('X')].map((a) => a.replace(/\s/g, ''))).toEqual(['2/2', '3/2', '2/1'])
    // a menu whose footer names none of them: the one line, as before
    inner.renderBar({ ...shop, menu: { menu: { tag: 'x', more: '[<w>Esc</w>] exit', items: [], flags: 0 } } } as unknown as Context, 'xbox', false, 'pad', true, [shopLabel('A', 'select')], true)
    expect(bar.classList.contains('grid')).toBe(false)
    expect(bar.style.gridTemplateColumns).toBe('')
  })
})
