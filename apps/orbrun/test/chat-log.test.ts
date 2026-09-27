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

describe('serverHtml', () => {
  it('keeps text and span classes, and nothing that runs', () => {
    expect(serverHtml('<span class="chat_sender">a</span>: <span class="chat_msg">hi &lt;b&gt;</span>')).toBe(
      '<span class="chat_sender">a</span>: <span class="chat_msg">hi &lt;b&gt;</span>',
    )
    expect(serverHtml('<img src=x onerror="alert(1)">x<script>alert(2)</script>')).toBe('xalert(2)')
    expect(serverHtml('<span class="fg5" onmouseover="alert(1)"><a href="javascript:alert(1)">bob</a></span>')).toBe('<span class="fg5">bob</span>')
  })
})
