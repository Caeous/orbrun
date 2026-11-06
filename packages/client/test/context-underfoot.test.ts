import { describe, it, expect } from 'vitest'
import { initialState, reduce, MouseMode, MSGCH, type GameState } from '@orbrun/webtiles'
import { cellKey, emptyScene, type Feature, type Scene } from '@orbrun/scene'
import { deriveContext } from '../src/context'
import { contextualLabel, NO_ACTION, promptLabels } from '../src/bindings'

/**
 * The pick-up prompt on the action bar. The server never marks the player's
 * own cell with an item (tilepick-p.cc `tileidx_player` sets no S_UNDER), so
 * standing on a pile is read from `item_check`'s floor-items line (items.cc),
 * scoped to the turn the player arrived; see `itemsUnderfoot` in
 * @orbrun/webtiles and the recorded session pinned in its tests.
 */

function sceneWith(feature?: Feature): Scene {
  const scene = emptyScene()
  scene.player = { x: 4, y: 4 }
  scene.playerOnLevel = true
  scene.cells.set(cellKey(4, 4), { x: 4, y: 4, kind: 'floor', visibility: 'visible', occluder: false, floorTile: 1, feature, label: feature ? 'stairs down' : 'floor' } as never)
  scene.cells.set(cellKey(4, 3), { x: 4, y: 3, kind: 'floor', visibility: 'visible', occluder: false, floorTile: 1, label: 'floor' } as never)
  return scene
}

function playing(): GameState {
  const st = initialState()
  st.phase = 'playing' as GameState['phase']
  st.inputMode = MouseMode.COMMAND
  reduce(st, { msg: 'player', pos: { x: 4, y: 4 }, turn: 100 })
  return st
}

const cam = { facing: 0 } as never

describe('standing on items', () => {
  it('shows nothing until the server says items are here', () => {
    const st = playing()
    const scene = sceneWith()
    expect(deriveContext(st, scene, cam, 'micro').under.kind).toBe('none')
  })

  it('offers the pile by name on A and on g once the floor-items line arrives, until the next step', () => {
    const st = playing()
    const scene = sceneWith()
    reduce(st, { msg: 'msgs', messages: [{ text: '<lightgrey>You see here a +0 halberd.', turn: 100, channel: MSGCH.FLOOR_ITEMS }] })
    const ctx = deriveContext(st, scene, cam, 'micro')
    // the log's own words and colours: the prompt beside `g` reads as the line in the message pane does
    expect(ctx.under).toEqual({ kind: 'item', label: '<lightgrey>a +0 halberd' })
    expect(contextualLabel(ctx)).toBe('<lightgrey>a +0 halberd')
    expect(promptLabels(ctx).find((l) => l.button === 'A')?.label).toBe('<lightgrey>a +0 halberd')
    // a step away: the scene moves the player and the server's turn moves on
    reduce(st, { msg: 'player', pos: { x: 4, y: 3 }, turn: 101 })
    scene.player = { x: 4, y: 3 }
    expect(deriveContext(st, scene, cam, 'micro').under.kind).toBe('none')
  })

  it('withdraws the prompt once the item is taken: the inventory grows, no floor line comes (items.cc `pickup`)', () => {
    const st = playing()
    const scene = sceneWith()
    reduce(st, { msg: 'msgs', messages: [{ text: '<lightgrey>You see here a +0 halberd.', turn: 100, channel: MSGCH.FLOOR_ITEMS }] })
    expect(contextualLabel(deriveContext(st, scene, cam, 'micro'))).toBe('<lightgrey>a +0 halberd')
    reduce(st, { msg: 'player', turn: 101, inv: { 3: { base_type: 0, quantity: 1, name: '+0 halberd' } } })
    reduce(st, { msg: 'msgs', messages: [{ text: '<lightgrey>d - a +0 halberd', turn: 100, channel: 0 }] })
    const ctx = deriveContext(st, scene, cam, 'micro')
    expect(ctx.under.kind).toBe('none')
    // a pile taken one item at a time counts down; the names are the server's, the remainder is not
    reduce(st, { msg: 'msgs', messages: [{ text: 'Items here: <darkgrey>) [ ?<lightgrey>.', turn: 101, channel: MSGCH.FLOOR_ITEMS }] })
    expect(contextualLabel(deriveContext(st, scene, cam, 'micro'))).toBe('<darkgrey>) [ ?')
    reduce(st, { msg: 'player', turn: 102, inv: { 4: { base_type: 2, quantity: 1 } } })
    // part of it taken: the server did not say which, so what is left is counted, not named
    expect(contextualLabel(deriveContext(st, scene, cam, 'micro'))).toBe('2 items')
  })

  it('on stairs A offers a chooser while keyboard stairs and pickup stay separate', () => {
    const st = playing()
    const scene = sceneWith({ type: 'stairs', dir: 'down' } as Feature)
    reduce(st, { msg: 'msgs', messages: [{ text: 'Items here: <darkgrey>) [ ?<lightgrey>.', turn: 100, channel: MSGCH.FLOOR_ITEMS }] })
    const ctx = deriveContext(st, scene, cam, 'micro')
    expect(ctx.under).toMatchObject({ kind: 'feature', items: '<darkgrey>) [ ?' })
    expect(contextualLabel(ctx)).toBe('Descend')
    expect(contextualLabel(ctx, true)).toBe('<darkgrey>) [ ?')
    const a = promptLabels(ctx).find((l) => l.button === 'A')
    expect(a).toMatchObject({ label: 'Interact' })
    expect(a?.hold).toBeUndefined()
  })

  it('names a listed pile as the server did, and takes items ahead without a name', () => {
    const st = playing()
    const scene = sceneWith()
    reduce(st, { msg: 'msgs', messages: [{ text: '<lightgrey>Things that are here:', turn: 100, channel: MSGCH.FLOOR_ITEMS }, { text: '<lightgrey>a +0 mace; <green>a +2 robe of positive energy<lightgrey>', turn: 100, channel: 0 }] })
    expect(contextualLabel(deriveContext(st, scene, cam, 'micro'))).toBe('<lightgrey>a +0 mace; <green>a +2 robe of positive energy<lightgrey>')
    reduce(st, { msg: 'msgs', messages: [{ text: 'There are many items here.', turn: 100, channel: MSGCH.FLOOR_ITEMS }] })
    expect(contextualLabel(deriveContext(st, scene, cam, 'micro'))).toBe('many items')
    // the cell ahead: an item there is no prompt; crawl picks up from the cell you stand on
    scene.billboards.push({ x: 4, y: 3, tile: 1, kind: 'item', height: 0.4, name: 'dagger' })
    reduce(st, { msg: 'player', pos: { x: 4, y: 4 }, turn: 101 })
    reduce(st, { msg: 'msgs', messages: [{ text: 'There are no items here.', turn: 101, channel: 0 }] })
    const ctx = deriveContext(st, scene, cam, 'micro')
    expect(ctx.under.kind).toBe('none')
    expect(ctx.ahead.kind).toBe('item')
    expect(contextualLabel(ctx)).toBe(NO_ACTION)
  })

  it('offers nothing for a corpse, underfoot or ahead (items.cc pickup_single_item: "You can\'t pick that up.")', () => {
    const st = playing()
    const scene = sceneWith()
    reduce(st, { msg: 'msgs', messages: [{ text: '<lightgrey>You see here <darkgrey>a bat corpse</darkgrey>.', turn: 100, channel: MSGCH.FLOOR_ITEMS }] })
    let ctx = deriveContext(st, scene, cam, 'micro')
    expect(ctx.under.kind).toBe('none')
    // the tile ahead is the top of its pile, and corpses sink below anything else (items.cc move_item_to_grid)
    scene.billboards.push({ x: 4, y: 3, tile: 1, kind: 'item', height: 0.4, name: 'bat corpse' })
    ctx = deriveContext(st, scene, cam, 'micro')
    expect(ctx.ahead.kind).toBe('none')
    expect(contextualLabel(ctx)).not.toMatch(/^Take/)
    // a corpse beside a weapon underfoot: only the weapon is offered
    reduce(st, { msg: 'msgs', messages: [{ text: '<lightgrey>Things that are here:', turn: 100, channel: MSGCH.FLOOR_ITEMS }, { text: '<lightgrey>a +0 mace; <darkgrey>a bat corpse</darkgrey>', turn: 100, channel: 0 }] })
    expect(contextualLabel(deriveContext(st, scene, cam, 'micro'))).toBe('<lightgrey>a +0 mace')
  })

  it('is silent for a spectator-style stale line and outside command mode', () => {
    const st = playing()
    const scene = sceneWith()
    reduce(st, { msg: 'msgs', messages: [{ text: 'You see here a dagger.', turn: 90, channel: MSGCH.FLOOR_ITEMS }] })
    expect(deriveContext(st, scene, cam, 'micro').under.kind).toBe('none')
    reduce(st, { msg: 'msgs', messages: [{ text: 'You see here a dagger.', turn: 100, channel: MSGCH.FLOOR_ITEMS }] })
    st.inputMode = MouseMode.MORE
    // under a --more-- the bar carries only the way out, never the pick-up
  })
})
