// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { latestLine, newer, newsDoc } from '../src/news'

const MD = ['# What’s new', '', 'Notable changes to Orbrun, newest first.', '', '## 0.2.10 — 2026-10-02', '', '- Ten.', '', '## 0.2.9 — 2026-10-01', '', '- Nine.', '', '## 0.2.8 — 2026-09-30', '', '- Eight.'].join('\n')

describe('What’s new', () => {
  it('orders releases by number, not by spelling', () => {
    expect(newer('0.2.10', '0.2.9')).toBe(true)
    expect(newer('0.3', '0.2.9')).toBe(true)
    expect(newer('0.2.9', '0.2.9')).toBe(false)
    expect(newer('0.2.8', '0.2.9')).toBe(false)
  })

  it('names the newest release as the site’s page does', () => {
    expect(latestLine(MD)).toBe('Version 0.2.10 · 2026-10-02')
    expect(latestLine('# Nothing yet')).toBe('Newest first')
  })

  it('draws a card a release, the newest Latest and the ones since the last read New', () => {
    const doc = newsDoc(MD, '0.2.8')
    const parts = Array.from(doc.querySelectorAll('.release'))
    expect(parts.map((p) => p.querySelector('.ver')?.textContent)).toEqual(['0.2.10', '0.2.9', '0.2.8'])
    expect(parts.map((p) => p.querySelector('.when')?.textContent)).toEqual(['2026-10-02', '2026-10-01', '2026-09-30'])
    expect(parts.map((p) => p.querySelector('.tag')?.textContent ?? null)).toEqual(['Latest', 'New', null])
    expect(parts.map((p) => p.classList.contains('fresh'))).toEqual([true, true, false])
    expect(parts[1].querySelector('li')?.textContent).toBe('Nine.')
    expect(doc.querySelector(':scope > p')).toBeNull()
  })

  it('marks nothing New on a device that never read it: all of it is new', () => {
    const doc = newsDoc(MD, null)
    expect(doc.querySelectorAll('.tag.new')).toHaveLength(0)
    expect(doc.querySelector('.release.latest .tag')?.textContent).toBe('Latest')
  })
})
