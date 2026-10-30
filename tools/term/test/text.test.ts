import { describe, it, expect } from 'vitest'
import { Window } from 'happy-dom'
import { layout, type Line } from '../game/text'

const doc = new Window().document as unknown as Document
const el = (html: string) => {
  const d = doc.createElement('div')
  d.innerHTML = html
  return d
}
const text = (lines: Line[]) => lines.map((l) => l.map((s) => s.text).join(''))

describe('overlay text', () => {
  it("lays a console table's cells out at crawl's widths, the last column wrapping under its own start", () => {
    const table = el(
      '<span class="ctable" style="--cols:11ch 6ch;--n:2">' +
        '<span class="ccell" style="grid-area:1/1"><span>Health:</span> <span>18</span></span>' +
        '<span class="ccell" style="grid-area:1/2"><span>AC:</span></span>' +
        '<span class="ccell" style="grid-area:1/3"><span>a long piece of gear</span></span>' +
        '<span class="ccell" style="grid-area:2/2"><span>EV:</span></span>' +
        '</span>',
    )
    expect(text(layout(table, 30).lines)).toEqual(['Health: 18 AC:   a long piece', '                 of gear', '           EV:'])
  })

  it('hangs what wraps of a line under its words', () => {
    const lines = layout(el('<span class="hang" style="--hang:4ch">a - a very long rapier of slaying</span>'), 16).lines
    expect(text(lines)).toEqual(['a - a very long', '    rapier of', '    slaying'])
  })

  it('lights the row under the cursor and the current tab, and nothing else', () => {
    const menu = el('<div><button class="current">Gear</button><button>Potions</button></div><ol><li class="selectable">a - a rapier</li><li class="selectable hovered">b - a buckler</li></ol>')
    const { lines, lit } = layout(menu, 40)
    expect(lit).toEqual([0, 2])
    expect(lines[0].filter((s) => s.lit).map((s) => s.text)).toEqual(['Gear'])
    expect(lines[2].every((s) => s.lit || !s.text.trim())).toBe(true)
  })

  it("names a prompt's keys as crawl's console does, and keeps its chips apart", () => {
    const card = el('<div class="chips"><span class="chip"><kbd>Y</kbd><span class="label">Yes</span></span><span class="chip"><kbd>N</kbd><span class="label">No</span></span></div>')
    expect(text(layout(card, 40).lines)[0].trimEnd()).toBe('[Y] Yes  [N] No')
  })
})
