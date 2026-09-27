// @vitest-environment happy-dom
/**
 * What the player asked for, against crawl itself: each is a press on a
 * screen and what crawl must have done with it. The matrix checks that every
 * input is consistent; these check that the consistent thing is the right one.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { formattedStringToText } from '@orbrun/webtiles'
import { builtChannels } from './engine'
import { atSurface } from './matrix'
import { screen } from './screen'
import { SCENARIOS } from './scenarios'
import type { E2e } from './client'

const open: E2e[] = []
afterEach(() => {
  for (const g of open.splice(0)) g.close()
})
async function at(id: string, device: 'pad' | 'keyboard' = 'keyboard'): Promise<E2e> {
  const g = await atSurface(SCENARIOS.find((s) => s.id === id)!)
  open.push(g)
  void device
  return g
}
const log = (g: E2e) => g.state().messages.lines.slice(-6).map((l) => formattedStringToText(l.text)).join(' / ')

describe.skipIf(!builtChannels.length)('what the buttons do, on crawl', () => {
  it('the inventory: A opens the item the cursor is on, and so does Enter', async () => {
    let g = await at('inventory')
    await g.press('A')
    expect(screen(g).surface).toBe('popup:describe-item')
    g = await at('inventory')
    await g.key('Enter')
    expect(screen(g).surface).toBe('popup:describe-item')
  })

  it("an item's description: A and Enter do the lit verb, the first on its actions line", async () => {
    const g = await at('describe-item')
    expect(screen(g).lit).toBe('(u)nwield')
    await g.key('Enter')
    expect(screen(g).mode).not.toBe('popup')
    expect(log(g)).toMatch(/You are empty-handed|unwield/i)
  })

  it('leaving the Dungeon: A answers Yes and the game ends; B stays', async () => {
    let g = await at('leave-dungeon')
    await g.press('B')
    expect(screen(g).mode).toBe('command')
    expect(log(g)).not.toMatch(/You have escaped/)
    g = await at('leave-dungeon')
    await g.press('A')
    expect(log(g)).toMatch(/You have escaped!/)
  })

  it("leaving the Dungeon on the keyboard: Enter is crawl's default, No, and Y is Yes", async () => {
    let g = await at('leave-dungeon')
    expect(g.root.querySelector('.prompt-card .chip.default')?.textContent).toContain('No')
    await g.key('Enter')
    expect(screen(g).mode).toBe('command')
    expect(log(g)).not.toMatch(/You have escaped/)
    g = await at('leave-dungeon')
    await g.key('Y')
    expect(log(g)).toMatch(/You have escaped!/)
  })

  it('at an altar: joining is lit, and A joins', async () => {
    const g = await at('altar')
    expect(screen(g).lit).toBe('Join religion')
    await g.press('A')
    expect(log(g)).toMatch(/welcomes you|You are now a follower|Okawaru/)
  })

  it('the stat gain: nothing lit, A does nothing; the d-pad lights a stat and A takes it', async () => {
    const g = await at('stat-gain')
    expect(screen(g).lit).toBeNull()
    await g.press('A')
    expect(screen(g).mode).toBe('prompt')
    // the first press lights the first answer; the next moves on
    await g.dpad(2)
    expect(screen(g).lit).toBe('(S)trength')
    await g.dpad(2)
    expect(screen(g).lit).toBe('(I)ntelligence')
    await g.press('A')
    expect(screen(g).mode).not.toBe('prompt')
    expect(log(g)).toMatch(/clever|Intelligence/i)
  })

  it('character creation: B steps back from the background to the species', async () => {
    const g = await at('new-game-background')
    expect(screen(g).title).toMatch(/background/)
    await g.press('B')
    expect(screen(g).title).toMatch(/species/)
  })

  it('character creation: B on the species leaves character creation, and so does Escape', async () => {
    for (const input of ['B', 'Escape'] as const) {
      const g = await at('new-game-species')
      if (input === 'B') await g.press('B')
      else await g.key('Escape')
      expect(g.state().phase === 'playing' && screen(g).mode !== 'lobby', input).toBe(false)
    }
  })

  it('a menu of marks (pickup): A and Space mark the lit row, Enter and Start take what is marked', async () => {
    let g = await at('pickup')
    const club = () => Object.values(g.state().player.inv).some((it) => /club/.test(it?.name ?? ''))
    expect(club()).toBe(false)
    await g.key(' ')
    await g.key('Enter')
    expect(screen(g).mode).toBe('command')
    expect(club()).toBe(true)
    g = await at('pickup')
    await g.press('A')
    await g.press('START')
    expect(screen(g).mode).toBe('command')
    expect(club()).toBe(true)
  })

  it("the shop's footer is walked as it is drawn: up and down between its lines, left and right along one", async () => {
    const g = await at('shop')
    const lit = () => g.root.querySelector('.more .more-hot.hovered')?.textContent ?? null
    const rows = g.state().menus.at(-1)!.items.filter((it) => it?.hotkeys?.length).length
    // down the rows and off the last onto the footer's top line
    for (let i = 0; i < rows; i++) await g.dpad(4)
    expect(lit()).toMatch(/^\[Esc\] exit/)
    await g.dpad(2)
    expect(lit()).toMatch(/^\[!\] buy\|examine/)
    // down to the line under it, and along it to the left
    await g.dpad(4)
    expect(lit()).not.toMatch(/^\[!\]|^\[Esc\]/)
    await g.dpad(6)
    expect(lit()).toMatch(/^\[\/\] sort/)
    // up over it, back to [Esc] exit; up again leaves the footer for the last row
    await g.dpad(0)
    expect(lit()).toMatch(/^\[Esc\] exit/)
    await g.dpad(0)
    expect(lit()).toBeNull()
    // and A on a switch sends its key: [/] sort changes the order the footer names
    await g.dpad(0)
    await g.dpad(4)
    await g.dpad(4)
    await g.dpad(4)
    expect(lit()).toMatch(/^\[\/\] sort \(type\)/)
    await g.press('A')
    expect(g.root.querySelector('.more')?.textContent).not.toMatch(/sort \(type\)/)
  })

  it('look mode: A and Enter describe what the cursor is on', async () => {
    let g = await at('look')
    await g.press('A')
    expect(screen(g).surface).toMatch(/^popup:describe-/)
    g = await at('look')
    await g.key('Enter')
    expect(screen(g).surface).toMatch(/^popup:describe-/)
  })
})
