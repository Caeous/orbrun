import { describe, expect, it } from 'vitest'
import { cm } from '../src/protocol.js'

/**
 * The bytes the official client puts on the wire. `comm.js send_message`
 * assigns `data["msg"] = msg` after the caller's fields, so `msg` is last
 * everywhere it is used; `client.js` hand-builds `key` and byte `input` as
 * strings with `msg` first. No parser cares, but the server is sent this
 * exact text, so a builder that drifts should fail here rather than on a
 * capture nobody reads.
 */
describe('client messages serialize as the official client writes them', () => {
  it('puts msg last on everything comm.js send_message builds', () => {
    expect(JSON.stringify(cm.input('x'))).toBe('{"text":"x","msg":"input"}')
    expect(JSON.stringify(cm.textInput('ab\r'))).toBe('{"text":"ab\\r","msg":"text_input"}')
    expect(JSON.stringify(cm.play('dcss-web-trunk'))).toBe('{"game_id":"dcss-web-trunk","msg":"play"}')
    expect(JSON.stringify(cm.watch('orbrun'))).toBe('{"username":"orbrun","msg":"watch"}')
    expect(JSON.stringify(cm.chat('hi'))).toBe('{"text":"hi","msg":"chat_msg"}')
    expect(JSON.stringify(cm.clickCell(3, 4, 1))).toBe('{"x":3,"y":4,"button":1,"msg":"click_cell"}')
    expect(JSON.stringify(cm.targetCursor(-2, 7))).toBe('{"x":-2,"y":7,"msg":"target_cursor"}')
    expect(JSON.stringify(cm.menuHover(2, true))).toBe('{"hover":2,"mouse":true,"msg":"menu_hover"}')
    expect(JSON.stringify(cm.menuScroll(0, 9, 3))).toBe('{"first":0,"last":9,"hover":3,"msg":"menu_scroll"}')
    expect(JSON.stringify(cm.formattedScrollerScroll(5))).toBe('{"scroll":5,"msg":"formatted_scroller_scroll"}')
    expect(JSON.stringify(cm.outerMenuFocus(97, 'main'))).toBe('{"hotkey":97,"menu_id":"main","msg":"outer_menu_focus"}')
    expect(JSON.stringify(cm.setOption('action_panel_show', true))).toBe('{"line":"action_panel_show = true","msg":"set_option"}')
    expect(JSON.stringify(cm.invItemAction(4))).toBe('{"slot":4,"msg":"inv_item_action"}')
    expect(JSON.stringify(cm.uiStateSync({ generation_id: 2 }))).toBe('{"generation_id":2,"msg":"ui_state_sync"}')
  })

  it('leads with msg on the two client.js hand-builds', () => {
    // client.js send_keycode: '{"msg":"key","keycode":' + code + '}'
    expect(JSON.stringify(cm.key(27))).toBe('{"msg":"key","keycode":27}')
    // client.js send_bytes: '{"msg":"input","data":[' + codes + ']}'
    expect(JSON.stringify(cm.inputBytes([123]))).toBe('{"msg":"input","data":[123]}')
  })

  it('writes a bare object for the messages that carry no fields', () => {
    expect(JSON.stringify(cm.goLobby())).toBe('{"msg":"go_lobby"}')
    expect(JSON.stringify(cm.pong())).toBe('{"msg":"pong"}')
    expect(JSON.stringify(cm.mainMenuAction())).toBe('{"msg":"main_menu_action"}')
  })
})
