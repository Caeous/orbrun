// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { Chat } from '../src/chat'

/**
 * The pad opens the chat to read it first (history in view, no keyboard),
 * because the keyboard leaves the history no room. A brings the keyboard
 * up, B from the keyboard goes back to reading, B from reading closes.
 */
describe('chat on a pad', () => {
  const press = (b: string) => ({ type: 'press' as const, button: b as never, t: 0 })

  function open() {
    const host = document.createElement('div')
    const chat = new Chat(host, { send: () => {} })
    chat.padFocus()
    return { host, chat }
  }

  it('opens the box reading, without the keyboard, and captures the pad', () => {
    const { host, chat } = open()
    expect(chat.capturing).toBe(true)
    expect(host.querySelector('.osk')).toBeNull()
    expect(host.querySelector('.chat_body')?.getAttribute('style') ?? '').not.toContain('none')
    expect(host.querySelector('.chat_read_hints')?.textContent).toContain('Write')
  })

  it('A brings the keyboard up; B from it goes back to reading; B again closes', () => {
    const { host, chat } = open()
    expect(chat.pad(press('A'))).toBe(true)
    expect(host.querySelector('.osk')).not.toBeNull()
    expect(host.querySelector('.chat_read_hints')).toBeNull()
    chat.pad(press('B'))
    expect(host.querySelector('.osk')).toBeNull()
    expect(host.querySelector('.chat_read_hints')).not.toBeNull()
    expect(chat.capturing).toBe(true)
    chat.pad(press('B'))
    expect(chat.capturing).toBe(false)
    expect(host.querySelector('.chat_read_hints')).toBeNull()
    expect(host.querySelector('.chat_body')?.getAttribute('style')).toContain('none')
  })

  it('up and down scroll the history while reading', () => {
    const { host, chat } = open()
    const box = host.querySelector('.chat_history_container') as HTMLElement
    box.scrollTop = 100
    chat.pad({ type: 'dir', source: 'dpad', dir: 0 })
    expect(box.scrollTop).toBeLessThan(100)
  })
})
