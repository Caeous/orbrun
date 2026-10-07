// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { initialState, reduce } from '@orbrun/webtiles'
import { Chat, serverHtml } from '../src/chat'

const say = (n: number) => ({ msg: 'chat', sender: 'a', content: `<span class="chat_sender">a</span>: <span class="chat_msg">line ${n}</span>` })

describe('chat log', () => {
  it('keeps drawing new lines once the log is full', () => {
    const host = document.createElement('div')
    const chat = new Chat(host, { send: () => {} })
    const state = initialState()
    for (let i = 0; i < 500; i++) reduce(state, say(i))
    chat.update(state, true, true)
    reduce(state, say(500))
    reduce(state, say(501))
    chat.update(state, true, true)
    const text = host.querySelector('.chat_history')!.textContent!
    expect(text).toContain('line 500')
    expect(text).toContain('line 501')
    expect(text.match(/line 499(?!\d)/g)).toHaveLength(1)
  })

  it('starts over for a fresh game', () => {
    const host = document.createElement('div')
    const chat = new Chat(host, { send: () => {} })
    const state = initialState()
    reduce(state, say(1))
    chat.update(state, true, true)
    reduce(state, { msg: 'go_lobby' })
    reduce(state, say(2))
    chat.update(state, true, true)
    expect(host.querySelector('.chat_history')!.textContent).not.toContain('line 1')
  })
})

describe('chat on a phone', () => {
  const log = { left: 0, top: 500, width: 400, height: 80 }
  const shown = (el: Element | null) => !!el && (el as HTMLElement).style.display !== 'none'

  it('has no standing box, and a badge only while there is something to say', () => {
    const host = document.createElement('div')
    const chat = new Chat(host, { send: () => {} })
    chat.place(log, 800, 400, true, log)
    const state = initialState()
    chat.update(state, true, true)
    expect(shown(host.querySelector('.chat'))).toBe(false)
    expect(shown(host.querySelector('.chat_badge'))).toBe(false)
    reduce(state, { msg: 'update_spectators', count: 2, names: 'a, b' })
    chat.update(state, true, true)
    expect(shown(host.querySelector('.chat'))).toBe(false)
    expect(shown(host.querySelector('.chat_badge'))).toBe(true)
    expect(host.querySelector('.chat_badge')!.textContent).toBe('2')
    reduce(state, say(1))
    chat.update(state, true, true)
    expect(host.querySelector('.chat_badge')!.textContent).toBe('2 · 1 new')
    // just over the log's right end
    const badge = host.querySelector('.chat_badge') as HTMLElement
    expect(badge.style.bottom).toBe('300px')
    expect(badge.style.right).toBe('0px')
  })

  it('opens over the log from the badge, and shuts from its caption', () => {
    const host = document.createElement('div')
    const chat = new Chat(host, { send: () => {} })
    chat.place(log, 800, 400, true, log)
    const state = initialState()
    reduce(state, say(1))
    chat.update(state, true, true)
    ;(host.querySelector('.chat_badge') as HTMLElement).click()
    chat.update(state, true, true)
    expect(shown(host.querySelector('.chat'))).toBe(true)
    expect(shown(host.querySelector('.chat_badge'))).toBe(false)
    expect((host.querySelector('.chat') as HTMLElement).style.bottom).toBe('220px')
    ;(host.querySelector('.chat_caption') as HTMLElement).click()
    chat.update(state, true, true)
    expect(shown(host.querySelector('.chat'))).toBe(false)
    // read: nothing left to say, no one watching
    expect(shown(host.querySelector('.chat_badge'))).toBe(false)
  })
})

describe('serverHtml', () => {
  it('keeps text and span classes, and nothing that runs', () => {
    expect(serverHtml('<span class="chat_sender">a</span>: <span class="chat_msg">hi &lt;b&gt;</span>')).toBe(
      '<span class="chat_sender">a</span>: <span class="chat_msg">hi &lt;b&gt;</span>',
    )
    expect(serverHtml('<img src=x onerror="alert(1)">x<script>alert(2)</script>')).toBe('xalert(2)')
    expect(serverHtml('<span class="fg5" onmouseover="alert(1)"><a href="javascript:alert(1)">bob</a></span>')).toBe('<span class="fg5">bob</span>')
  })
})
