// @vitest-environment happy-dom
/**
 * What the player asked for, against crawl itself: each is a press on a
 * screen and what crawl must have done with it. The matrix checks that every
 * input is consistent; these check that the consistent thing is the right one.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { formattedStringToText } from '@orbrun/webtiles'
import { builtChannels } from './engine'
import { startLive } from './client'
import { atSurface } from './matrix'
import { screen } from './screen'
import { keysOf } from './rules'
import { FIGHTER, SCENARIOS } from './scenarios'
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

  it('Y brings the pack back on the page and the item it was left on, for reading the same scroll again', async () => {
    const g = await at('gear-scrolls-two')
    expect(screen(g).title).toMatch(/^Scrolls/)
    const first = screen(g).lit
    await g.dpad(4)
    const second = screen(g).lit
    expect(second).not.toBe(first)
    await g.press('B')
    expect(screen(g).mode).toBe('command')
    await g.press('Y')
    expect(screen(g).title).toMatch(/^Scrolls/)
    expect(screen(g).lit).toBe(second)
  })

  it('turning the pack never leaves the cursor on a section header', async () => {
    const give = async (g: E2e, name: string) => {
      await g.raw('&%')
      await g.raw(name + '\r')
      await g.raw(',')
      for (let i = 0; i < 8 && g.ctx().mode === 'more'; i++) await g.key(' ')
    }
    const g = await atSurface({
      id: 'gear-header',
      about: 'the pack with three kinds of potion and two weapons, so the Gear page has a header third',
      surface: 'menu:inventory',
      setup: async (g) => {
        await g.raw('&')
        await g.raw('wiz\r')
        await g.raw('\x1b')
        for (const name of ['potion of curing', 'potion of might', 'potion of heal wounds', 'dagger']) await give(g, name)
        await g.press('Y')
      },
    })
    open.push(g)
    await g.press('RB')
    expect(screen(g).title).toMatch(/^Potions/)
    await g.dpad(4)
    await g.dpad(4)
    // the third potion's index is the Armour header on the Gear page: crawl keeps the index across the turn
    await g.press('LB')
    expect(screen(g).title).toMatch(/^Gear/)
    expect(screen(g).lit).toMatch(/scale mail/)
    expect(g.state().menus.at(-1)!.last_hovered).toBe(4)
  })

  it("X's actions: the bumpers turn crawl's spell, ability, evoke and quiver menus, an empty one saying so, and X comes back to the last", async () => {
    const g = await at('actions-spells')
    const frame = () => g.root.querySelector('.action-tabs')
    const tab = () => frame()?.querySelector('.pack-tabs .current')?.textContent
    const empty = () => frame()?.querySelector('.action-empty')?.textContent
    expect(screen(g).title).toMatch(/^Your spells \(cast\)/)
    expect(tab()).toBe('Spells')
    expect(screen(g).bar).toMatchObject({ LB: 'Quiver', RB: 'Abilities' })
    // a Conjurer has no abilities and no wands: crawl's own line stands where its menu would
    await g.press('RB')
    expect(tab()).toBe('Abilities')
    expect(empty()).toBe("Sorry, you're not good enough to have a special ability.")
    await g.press('RB')
    expect(tab()).toBe('Evocables')
    expect(empty()).toBe("You aren't carrying any items that you can evoke.")
    await g.press('RB')
    expect(screen(g).surface).toBe('menu:actions')
    expect(tab()).toBe('Quiver')
    await g.press('RB')
    expect(screen(g).surface).toBe('menu:spell')
    // back to Quiver and away: X opens the actions on it again
    await g.press('LB')
    expect(screen(g).surface).toBe('menu:actions')
    await g.press('B')
    expect(screen(g).mode).toBe('command')
    expect(frame()).toBeNull()
    await g.press('X')
    expect(screen(g).surface).toBe('menu:actions')
  })

  it("the actions never leave the screen bare: the empty frame stays until crawl's menu stands in its place", async () => {
    // a Berserker's LB turns back to an empty Spells; RB turns to the abilities crawl lists
    const g = await at('actions-abilities')
    await g.press('LB')
    expect(g.root.querySelector('.action-tabs .action-empty')?.textContent).toBe("You don't know any spells.")
    let bare = false
    const mo = new (g.root.ownerDocument.defaultView as unknown as typeof globalThis).MutationObserver(() => {
      if (!g.root.querySelector('.popup')) bare = true
    })
    mo.observe(g.root, { subtree: true, childList: true })
    await g.press('RB')
    mo.disconnect()
    expect(screen(g).surface).toBe('menu:ability')
    expect(bare).toBe(false)
  })

  it("the pack's Y swaps weapons, and the Start menu's Character tab shouts", async () => {
    const g = await at('gear')
    g.clearSent()
    await g.press('Y')
    expect(keysOf(g.sent)).toBe(JSON.stringify([27, 39]))
    expect(screen(g).mode).toBe('command')
    await g.press('START')
    const focused = () => g.root.querySelector('.sysmenu .focused .label')?.textContent
    for (let i = 0; i < 20 && focused() !== 'Shout / order allies'; i++) await g.dpad(4)
    expect(focused()).toBe('Shout / order allies')
    await g.press('A')
    expect(screen(g).title).toBe('What are your orders?')
  })

  it("the actions keep up with a quick player: presses ahead of crawl move the tab, and no key lands in a menu still opening", async () => {
    const g = await at('actions-spells')
    const tab = () => g.root.querySelector('.action-tabs .pack-tabs .current')?.textContent
    g.clearSent()
    await g.burst(['RB', 'RB'])
    expect(tab()).toBe('Evocables')
    // one Escape for the cast list, then Evocables' key alone: Abilities was passed by
    expect(keysOf(g.sent)).toBe(JSON.stringify([27, 'V'.charCodeAt(0)]))
    g.clearSent()
    await g.burst(['RB', 'RB', 'RB'])
    expect(tab()).toBe('Abilities')
    // Quiver's key was out before the next presses came: its menu, then the Escape, then Abilities'
    expect(keysOf(g.sent)).toBe(JSON.stringify(['Q', 27, 'a'].map((k) => (typeof k === 'string' ? k.charCodeAt(0) : k))))
  })

  it("the arrows and the d-pad's left and right turn the actions, crawl's menus and the empty tabs alike", async () => {
    const g = await at('actions-spells')
    const tab = () => g.root.querySelector('.action-tabs .pack-tabs .current')?.textContent
    await g.key('ArrowRight')
    expect(tab()).toBe('Abilities')
    await g.key('ArrowRight')
    expect(tab()).toBe('Evocables')
    await g.dpad(2)
    expect(screen(g).surface).toBe('menu:actions')
    await g.key('ArrowLeft')
    expect(tab()).toBe('Evocables')
    await g.dpad(6)
    expect(tab()).toBe('Abilities')
  })

  it('the actions on the keyboard: F3 opens them, the arrows turn an empty tab, Escape puts them away', async () => {
    const g = await at('actions-empty')
    await g.key('Escape')
    expect(g.root.querySelector('.action-tabs')).toBeNull()
    await g.key('F3')
    expect(g.root.querySelector('.action-tabs .pack-tabs .current')?.textContent).toBe('Spells')
    await g.key('ArrowRight')
    expect(g.root.querySelector('.action-tabs .pack-tabs .current')?.textContent).toBe('Abilities')
    await g.key('F3')
    expect(g.root.querySelector('.action-tabs')).toBeNull()
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

  it('Select closes the level map, and Select opens it again', async () => {
    const g = await at('level-map')
    await g.press('SELECT')
    expect(screen(g).mode).toBe('command')
    await g.press('SELECT')
    expect(screen(g).surface).toBe('levelmap')
  })

  it('the level map: Y, L3 and R3 leave it for the travel prompt, the stash search and the overview', async () => {
    let g = await at('level-map')
    await g.press('Y')
    expect(screen(g).surface).toBe('menu:travel')
    g = await at('level-map')
    await g.press('L3')
    expect(screen(g).surface).toMatch(/^text:/)
    // the map stays drawn under the search, the minimap still put away as the map puts it, until the search is put away
    const minimapHidden = () => g.root.querySelector('canvas.minimap')!.classList.contains('hidden')
    expect(minimapHidden()).toBe(true)
    await g.press('B')
    expect(screen(g).mode).toBe('command')
    expect(minimapHidden()).toBe(false)
    g = await at('level-map')
    await g.press('R3')
    expect(screen(g).surface).toBe('popup:formatted-scroller')
  })

  it('a finger on the level map: Descend goes down a level and Ascend back up (G > and G <), In view on the map lists what is in view', async () => {
    const g = await startLive({ args: FIGHTER, device: 'touch' })
    open.push(g)
    for (let i = 0; i < 5 && g.ctx().mode !== 'command'; i++) await g.raw('a')
    // the level mapped, so its way down is known: wizard mode's magic mapping
    await g.raw('&')
    await g.raw('wiz\r')
    await g.raw('\x1b')
    await g.raw('&{')
    for (let i = 0; i < 5 && g.ctx().mode === 'more'; i++) await g.raw(' ')
    const tap = async (id: string) => {
      const el = g.root.querySelector(`[data-b="do:${id}"]`)
      expect(el, id).not.toBeNull()
      el!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }))
      el!.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }))
      await g.settle()
      for (let i = 0; i < 40 && g.ctx().mode !== 'command'; i++) await g.settle()
    }
    expect(g.state().player.depth).toBe(1)
    await g.raw('X')
    expect(screen(g).surface).toBe('levelmap')
    await tap('descend')
    expect(g.state().player.depth).toBe(2)
    // crawl travels with nothing hostile in view: D:2's welcome is a ball python, sent away
    await g.raw('&G')
    await g.raw('\r')
    await g.raw('X')
    await tap('ascend')
    expect(g.state().player.depth).toBe(1)
    await tap('inview')
    expect(screen(g).surface).toMatch(/^menu:/)
  })

  it('stairs with a pile on them: A asks which, and A again takes the stairs, or picks up from the row below', async () => {
    const onPile = async () => {
      const g = await startLive({ args: FIGHTER })
      open.push(g)
      for (let i = 0; i < 5 && g.ctx().mode !== 'command'; i++) await g.raw('a')
      await g.raw('&')
      await g.raw('wiz\r')
      await g.raw('\x1b')
      // off D:1's way out, onto a staircase down of wizard mode's making, with a dagger on it
      for (let n = 0; n < 12 && g.ctx().under.kind !== 'none'; n++) {
        for (const k of ['l', 'j', 'h', 'k', 'u', 'n', 'b', 'y']) {
          const before = g.state().player.pos
          await g.raw(k)
          const after = g.state().player.pos
          if (after && before && (after.x !== before.x || after.y !== before.y)) break
        }
      }
      await g.raw('&(')
      await g.raw('stone_stairs_down_i\r')
      await g.raw('&%')
      await g.raw('dagger\r')
      // off and back on, so crawl tells of the pile underfoot as a player arriving there would hear it
      await g.raw('l')
      await g.raw('h')
      await g.press('A')
      expect(g.root.querySelector('[data-client] .title')?.textContent).toBe('Interact')
      g.clearSent()
      return g
    }
    let g = await onPile()
    await g.press('A')
    expect(g.sent).toContainEqual({ msg: 'input', text: '>' })
    g = await onPile()
    await g.dpad(4)
    await g.press('A')
    expect(g.sent).toContainEqual({ msg: 'input', text: ',' })
  })

  it("Android's back is B on a screen, and over the map asks to save and exit, which a second back declines", async () => {
    const g = await at('inventory')
    await g.back()
    expect(screen(g).surface).toBe('command')
    g.clearSent()
    await g.back()
    expect(g.sent).toContainEqual({ msg: 'input', text: 'S' })
    expect(screen(g).surface).toBe('yesno')
    expect(screen(g).title).toBe('Save game and exit?')
    await g.back()
    expect(screen(g).surface).toBe('command')
    expect(log(g)).toMatch(/Okay, then\.$/)
  })
})
