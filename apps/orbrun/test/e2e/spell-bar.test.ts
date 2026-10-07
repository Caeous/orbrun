// @vitest-environment happy-dom
// The touch spell bar on crawl itself (spell-bar.ts): the list looked up without a menu ever showing, and a spell
// tapped twice: the first tap aims, the second fires.
import { describe, expect, it } from 'vitest'
import { startLive, type E2e } from './client'

const CONJURER = ['-seed', '1', '-species', 'human', '-background', 'conjurer', '-wizard']
const FIGHTER = ['-seed', '1', '-species', 'minotaur', '-background', 'fighter', '-wizard']

/** Past the look's wait for a still moment (game.ts SPELL_LOOK_STILL_MS), and a frame for it to go out in. */
async function still(g: E2e) {
  await new Promise((r) => setTimeout(r, 550))
  await g.settle()
  await g.settle()
}

async function start(args: string[]): Promise<E2e> {
  const g = await startLive({ args, device: 'touch' })
  for (let i = 0; i < 5 && g.ctx().mode !== 'command'; i++) await g.raw('a')
  return g
}

const spellButtons = (g: E2e) => Array.from(g.root.querySelectorAll<HTMLElement>('.spellbar .tb'))
const sentText = (g: E2e) => g.sent.map((m) => ('text' in m ? m.text : 'keycode' in m ? m.keycode : m.msg))

describe('the spell bar', () => {
  it('looks the spells up without a menu ever reaching the state, and shows them', { timeout: 60000 }, async () => {
    const g = await start(CONJURER)
    try {
      const menus: string[] = []
      const watch = setInterval(() => {
        if (g.state().menus.length) menus.push(g.state().menus.at(-1)!.tag)
      }, 1)
      await still(g)
      clearInterval(watch)
      expect(sentText(g)).toContain('I')
      expect(sentText(g)).toContain(27)
      expect(menus).toEqual([])
      expect(g.state().menus).toEqual([])
      expect(g.ctx().mode).toBe('command')
      expect(spellButtons(g).map((b) => b.getAttribute('aria-label'))).toEqual([expect.stringMatching(/^Magic Dart, \d+% fail$/)])
    } finally {
      g.close()
    }
  })

  it('goes away when the keyboard speaks', { timeout: 60000 }, async () => {
    const g = await start(CONJURER)
    try {
      await still(g)
      const bar = g.root.querySelector<HTMLElement>('.spellbar')!
      expect(bar.hidden).toBe(false)
      await g.key('Escape')
      await g.settle()
      expect(bar.hidden).toBe(true)
    } finally {
      g.close()
    }
  })

  it('a character with no spells: crawl says so, the line never shows, and there is no bar', { timeout: 60000 }, async () => {
    const g = await start(FIGHTER)
    try {
      await still(g)
      expect(sentText(g)).toContain('I')
      expect(g.log().some((l) => /don't know any spells/.test(l))).toBe(false)
      expect(spellButtons(g)).toEqual([])
    } finally {
      g.close()
    }
  })

  it('Magic Dart tapped twice: the first tap aims, the second fires at the goblin', { timeout: 60000 }, async () => {
    const g = await start(CONJURER)
    try {
      await g.raw('&')
      await g.raw('wiz\r')
      await g.raw('\x1b')
      await g.raw('&m')
      await g.raw('goblin\r')
      await still(g)
      const mp = g.state().player.mp
      await g.click(spellButtons(g)[0])
      expect(g.ctx().mode).toBe('targeting')
      expect(spellButtons(g)[0].classList.contains('lit')).toBe(true)
      await g.click(spellButtons(g)[0])
      expect(g.ctx().mode).toBe('command')
      expect(g.state().player.mp).toBeLessThan(mp)
    } finally {
      g.close()
    }
  })
})
