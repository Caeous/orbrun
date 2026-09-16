// @vitest-environment happy-dom
import { afterEach, describe, it, expect } from 'vitest'
import { initialState, reduce, type GameState } from '@orbrun/webtiles'
import { paneRows } from '../src/grid/messages'
import { paintRow } from '../src/grid/paint'
import { Hud } from '../src/hud'
import { GridHost } from '../src/grid/host'
import { gameSplit } from '../src/grid/console'
import fixture from './fixtures/explore-more.json'

/**
 * A pending `--more--` on the message pane: the pane keeps its cells along
 * the bottom (no card in the middle of the view), carries the whole log as
 * it always does, and ends on the server's more row, WebTiles' bare `#more`
 * line, until the player acknowledges it. Pinned to a recorded --more-- (explore-more.json: a walk
 * stopped by "You encounter Josephine", with "You encounter a wraith."
 * already read at the prompt before it).
 */

/** the session up to the frame that stops the walk: `msgs` with `more: true`, then `input_mode 5` */
function stoppedState(): GameState {
  const st = initialState()
  for (const f of fixture.frames.slice(0, 3)) for (const m of f.msgs) reduce(st, m as never)
  return st
}

describe('--more-- on the message pane', () => {
  it('keeps the whole log on the pane and ends on the server more row', () => {
    const st = stoppedState()
    expect(st.messages.more).toBe(true)
    // the pane holds the whole log: the five lines read at the command prompt and the two of the stopped walk (the last wraps to two rows)
    const pane = paneRows(st.messages, 20, 80)
    expect(pane.lines.filter((r) => r.length > 0).length).toBe(8)
    const text = pane.lines.map((r) => r.map((s) => s.text).join('')).join('\n')
    expect(text).toContain('You encounter a wraith.')
    expect(text).toContain('You encounter Josephine')
    // the more row is the server's text (messages.js: more_text, else --more--)
    expect(pane.more.map((s) => s.text).join('')).toBe(st.messages.moreText)
    const el = document.createElement('div')
    el.append(...pane.lines.map((r) => paintRow(r)), paintRow(pane.more, 'line more'))
    expect(el.querySelectorAll('.line').length).toBe(21)
    expect(el.querySelector('.line.more')).toBe(el.lastElementChild)
    // the way out is on the action bar, not on the pane
    expect(el.querySelector('.chip')).toBeNull()
  })

  it('shows no more row once the more is gone', () => {
    const st = initialState()
    for (const f of fixture.frames.slice(0, 4)) for (const m of f.msgs) reduce(st, m as never)
    // input_mode 0 leaves MORE (the space was read), then "Josephine shouts!" arrives
    expect(st.messages.more).toBe(false)
    expect(paneRows(st.messages, 20, 80).more).toEqual([])
    expect(st.messages.lines[st.messages.readTo].text).toContain('Josephine shouts!')
  })
})

/**
 * On the HUD the pane stays as WebTiles prints it: the bare more row, no
 * button on it and nothing framed. A ring around the pane read as a focused
 * panel, the thing A would open. What says "stopped" is the scrim over the
 * world under the pane.
 */
describe('the more row on the HUD', () => {
  const grids: GridHost[] = []
  afterEach(() => {
    for (const grid of grids.splice(0)) grid.destroy()
    document.body.replaceChildren()
  })
  function render(spectating = false, st = stoppedState()) {
    const host = document.createElement('div')
    Object.defineProperties(host, { clientWidth: { value: 1280 }, clientHeight: { value: 800 } })
    document.body.append(host)
    const hud = new Hud(host, { onSelectMonster() {}, onBarAction() {}, onMinimapClick() {}, onPanelItem() {}, onPanelShow() {} } as never)
    const grid = new GridHost(host, 16)
    grids.push(grid)
    const cells = gameSplit(grid.grid, 7)
    hud.layout(grid, cells, cells.clear, { stats: false, sidebar: false, messages: false })
    const inner = hud as unknown as { renderMessages(st: GameState, spectating: boolean): void; messages: HTMLElement; scrim: HTMLElement }
    inner.renderMessages(st, spectating)
    return inner
  }

  it('prints the bare more row and puts the pause vignette under the pane', () => {
    for (const { messages, scrim } of [render(), render(true)]) {
      expect(messages.classList.contains('more')).toBe(true)
      const row = messages.querySelector('.line.more')!
      expect(row.textContent).toBe('--more--')
      expect(row.querySelector('svg, kbd, .chip')).toBeNull()
      expect(scrim.classList.contains('on')).toBe(true)
      expect(scrim.nextElementSibling).toBe(messages)
    }
    expect(render().messages.classList.contains('dismissable')).toBe(true)
    expect(render(true).messages.classList.contains('dismissable')).toBe(false)
  })

  it('lifts the scrim and empties the row once the more is gone', () => {
    const st = initialState()
    for (const f of fixture.frames.slice(0, 4)) for (const m of f.msgs) reduce(st, m as never)
    const { messages, scrim } = render(false, st)
    expect(messages.classList.contains('more')).toBe(false)
    expect(messages.querySelector('.line.more')?.childElementCount).toBe(0)
    expect(scrim.classList.contains('on')).toBe(false)
  })
})
