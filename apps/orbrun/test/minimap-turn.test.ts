// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest'
import { Hud } from '../src/hud'
import { GridHost } from '../src/grid/host'
import { gameSplit } from '../src/grid/console'

/**
 * A turn of the view draws nothing on the minimap (hud.ts renderMinimap): the
 * map stands north up, and the facing cone is an element of its own, turned
 * by css. The map is drawn again when what it shows moves.
 */
function minimap() {
  const host = document.createElement('div')
  Object.defineProperty(host, 'clientWidth', { value: 1280 })
  Object.defineProperty(host, 'clientHeight', { value: 720 })
  document.body.append(host)
  const hud = new Hud(host, { onSelectMonster() {}, onBarAction() {}, onMinimapClick() {}, onPanelItem() {}, onPanelShow() {} } as never)
  const grid = new GridHost(host, 16)
  const cells = gameSplit(grid.grid, 5)
  hud.layout(grid, cells, cells.clear, { stats: false, sidebar: false, messages: false })
  const inner = hud as unknown as {
    renderMinimap(scene: unknown, cam: unknown, state: unknown, gd: null): void
    drawMinimap(): void
    minimapCone: HTMLCanvasElement
  }
  const draw = vi.spyOn(inner, 'drawMinimap').mockImplementation(() => {})
  const scene = { revision: 1, cells: new Map([['5,5', {}]]), playerOnLevel: true, player: { x: 5, y: 5 }, billboards: [] }
  const state = { options: {}, rev: { player: 1 } }
  const frame = (cam: { x: number; y: number; yaw: number }) => {
    inner.renderMinimap(scene, { facing: 0, ...cam }, state, null)
  }
  return { hud, inner, draw, frame }
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('the minimap through a turn of the view', () => {
  it('north up: the map is drawn once and the cone turns with the view', () => {
    const m = minimap()
    m.hud.minimapFov = 1.2
    for (let i = 0; i <= 20; i++) m.frame({ x: 5, y: 5, yaw: i * 0.05 })
    expect(m.draw).toHaveBeenCalledTimes(1)
    expect(m.inner.minimapCone.hidden).toBe(false)
    expect(m.inner.minimapCone.style.rotate).toBe('1.0000rad')
  })

  it('a step draws the map again', () => {
    const m = minimap()
    m.hud.minimapFov = 1.2
    m.frame({ x: 5, y: 5, yaw: 0 })
    m.frame({ x: 5, y: 6, yaw: 0 })
    expect(m.draw).toHaveBeenCalledTimes(2)
  })
})
