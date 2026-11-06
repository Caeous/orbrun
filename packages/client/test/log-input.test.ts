import { describe, it, expect } from 'vitest'
import { initialState } from '@orbrun/webtiles'
import { paneRows } from '../src/grid/messages'
import { typedInLog } from '../src/bindings'

/**
 * A line crawl reads in the message pane (Find…'s "Search for what?"): a
 * finger types it in the log, after the prompt printed there, not in a popup.
 */
describe('typing in the log', () => {
  const log = () => {
    const st = initialState()
    st.messages.lines.push({ text: 'Search for what [? for help]?', channel: 0 } as never)
    return st.messages
  }
  const text = (row: { text: string }[]) => row.map((r) => r.text).join('')

  it('stands what is typed after the prompt, with the cursor after it', () => {
    const pane = paneRows(log(), 3, 60, 0, 'potion')
    expect(text(pane.lines[2])).toMatch(/Search for what \[\? for help\]\?potion_$/)
  })

  it('wraps what is typed with the prompt, as a message of its own length would', () => {
    const pane = paneRows(log(), 3, 34, 0, 'potion of heal wounds')
    const joined = pane.lines.map(text).join('')
    expect(joined).toContain('potion')
    expect(joined).toContain('wounds_')
    for (const row of pane.lines) expect(text(row).length).toBeLessThanOrEqual(34)
  })

  it('shows the cursor before anything is typed, even before the server lights it', () => {
    const pane = paneRows(log(), 3, 60, 0, '')
    expect(text(pane.lines[2]).endsWith('?_')).toBe(true)
  })

  it('is the message-pane line, except a number, which keeps its number pad, and a question the log does not hold', () => {
    expect(typedInLog({ type: 'messages', tag: 'stash_search' })).toBe(true)
    expect(typedInLog({ type: 'generic', tag: 'stash_search' })).toBe(false)
    expect(typedInLog({ type: 'messages', tag: 'travel_depth' })).toBe(false)
    expect(typedInLog({ type: 'messages', prompt: 'Name this level:' })).toBe(false)
    expect(typedInLog(null)).toBe(false)
  })
})
