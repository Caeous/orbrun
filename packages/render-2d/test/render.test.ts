import { describe, it, expect } from 'vitest'
import { emptyScene, cellKey, makeCamera, type Scene, type SceneCell, type TileSource } from '@orbrun/scene'
import { Render2d } from '../src/index.js'

/** A canvas whose 2D context records every image draw, so draw order can be asserted. */
function fakeCanvas() {
  const draws: number[] = []
  const rects: string[] = []
  const fills: { x: number; y: number; w: number; h: number }[] = []
  const images: { sx: number; sy: number; sh: number; dx: number; dy: number; dh: number }[] = []
  const arcs: number[] = []
  const rotates: number[] = []
  const ctx = new Proxy(
    {
      clearRect: () => undefined,
      drawImage: (...args: unknown[]) => {
        // the source x of a tile rect identifies the tile (see tiles below)
        draws.push(Number(args[1]))
        images.push({ sx: Number(args[1]), sy: Number(args[2]), sh: Number(args[4]), dx: Number(args[5]), dy: Number(args[6]), dh: Number(args[8]) })
      },
      fillRect: (x: number, y: number, w: number, h: number) => {
        rects.push('fill')
        fills.push({ x, y, w, h })
      },
      fillText: () => rects.push('text'),
      strokeRect: () => rects.push('stroke'),
      save: () => undefined,
      restore: () => undefined,
      setTransform: () => undefined,
      translate: () => undefined,
      rotate: (a: number) => rotates.push(a),
      beginPath: () => undefined,
      moveTo: () => undefined,
      lineTo: () => undefined,
      stroke: () => undefined,
      arc: (_x: number, _y: number, radius: number) => arcs.push(radius),
      closePath: () => undefined,
      fill: () => undefined,
    },
    { set: (t, k, v) => ((t as Record<string | symbol, unknown>)[k] = v, true) },
  )
  const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement
  return { canvas, draws, rects, fills, images, arcs, rotates }
}

const tiles: TileSource = {
  tile: (id) => ({ atlas: 'a', sx: id, sy: 0, w: 32, h: 32, ox: 0, oy: 0, cell: 32 }),
  atlas: () => ({} as unknown as ImageBitmap),
}

function floor(x: number, y: number, extra: Partial<SceneCell> = {}): SceneCell {
  return {
    x,
    y,
    kind: 'floor',
    visibility: 'visible',
    occluder: false,
    floorTile: 100,
    flags: { water: false, lava: false, excluded: false, travelTrail: false, newStair: false, cursor: false, outOfRange: false, magicMapped: false },
    ...extra,
  }
}

function sceneWith(cells: SceneCell[]): Scene {
  const s = emptyScene()
  for (const c of cells) s.cells.set(cellKey(c.x, c.y), c)
  s.bounds = { left: 0, top: 0, right: 2, bottom: 2 }
  s.player = { x: 1, y: 1 }
  s.playerOnLevel = true
  return s
}

describe('Render2d draw order', () => {
  it('paints underlays, feature, overlays, sprites, badges, then cell icons', () => {
    const { canvas, draws } = fakeCanvas()
    const r = new Render2d({ cellSize: 32, follow: false })
    r.mount(canvas)
    r.setTiles(tiles)
    r.resize(96, 96, 1)
    const cell = floor(1, 1, { featureTile: 300, underlays: [200], overlays: [400, 401], icons: [900, 901, 950] })
    const scene = sceneWith([cell])
    scene.billboards.push({ x: 1, y: 1, tile: 500, kind: 'item', height: 0.4, statusIcons: [{ tile: 700, ox: 0, oy: 0 }] })
    r.setScene(scene)
    r.render()
    // the travel-trail arrows are among the cell's icons
    expect(draws).toEqual([100, 200, 300, 400, 401, 500, 700, 900, 901, 950])
  })

  it('draws wall decals on the wall and skips unknown cells', () => {
    const { canvas, draws } = fakeCanvas()
    const r = new Render2d({ cellSize: 32, follow: false })
    r.mount(canvas)
    r.setTiles(tiles)
    r.resize(96, 96, 1)
    const wall = floor(0, 0, { kind: 'wall', occluder: true, wallTile: 150, wallOverlays: [160] })
    const unknown = floor(2, 2, { kind: 'unknown', visibility: 'unseen', icons: [999] })
    r.setScene(sceneWith([wall, unknown]))
    r.render()
    expect(draws).toEqual([150, 160, 999])
  })

  it('glyph mode draws text instead of tiles', () => {
    const { canvas, draws, rects } = fakeCanvas()
    const r = new Render2d({ cellSize: 32, follow: false, mode: 'glyphs' })
    r.mount(canvas)
    r.setTiles(tiles)
    r.resize(96, 96, 1)
    const scene = sceneWith([floor(1, 1, { glyph: '.', colour: 7, icons: [900] })])
    scene.billboards.push({ x: 1, y: 1, tile: 500, kind: 'item', height: 0.4 })
    r.setScene(scene)
    r.render()
    expect(draws).toEqual([])
    expect(rects).toContain('text')
  })

  it('shows minibars only when a bar is not full', () => {
    const full = fakeCanvas()
    const r = new Render2d({ cellSize: 32, follow: false, minibars: { hp: 10, hpMax: 10, mp: 5, mpMax: 5, showHp: true, showMp: true } })
    r.mount(full.canvas)
    r.setTiles(tiles)
    r.resize(96, 96, 1)
    r.setScene(sceneWith([floor(1, 1)]))
    r.render()
    const fullFills = full.rects.filter((x) => x === 'fill').length
    const hurt = fakeCanvas()
    r.mount(hurt.canvas)
    r.setOptions({ minibars: { hp: 4, hpMax: 10, mp: 5, mpMax: 5, showHp: true, showMp: true } })
    r.render()
    const hurtFills = hurt.rects.filter((x) => x === 'fill').length
    expect(hurtFills).toBeGreaterThan(fullFills)
  })

  it('stacks the minibars on the top edge of the player cell, HP over MP, in the damage-bar style', () => {
    const { canvas, fills } = fakeCanvas()
    // player at (1, 1), 32px cells, no follow: the cell spans y 32..64
    const r = new Render2d({ cellSize: 32, follow: false, minibars: { hp: 4, hpMax: 10, mp: 2, mpMax: 5, showHp: true, showMp: true } })
    r.mount(canvas)
    r.setTiles(tiles)
    r.resize(96, 96, 1)
    r.setScene(sceneWith([floor(1, 1)]))
    r.render()
    const bars = fills.filter((f) => f.x >= 32 && f.x < 64 && f.h === 1 && f.y >= 32 && f.y < 36)
    // two rows per bar: the HP track and fill on rows 0-1, the MP track and fill on rows 2-3; the fill runs to 13px on each row
    const tracks = bars.filter((f) => f.w === 32)
    expect(tracks.map((f) => f.y)).toEqual([32, 33, 34, 35])
    const reach = (y: number) => Math.max(...bars.filter((f) => f.y === y && f.w < 32).map((f) => f.x + f.w))
    expect([32, 33, 34, 35].map(reach)).toEqual([45, 45, 45, 45])
  })

  it('scales the texel rows to the cell size, at least a pixel each', () => {
    const { canvas, fills } = fakeCanvas()
    const r = new Render2d({ cellSize: 64, follow: false, minibars: { hp: 4, hpMax: 10, mp: 5, mpMax: 5, showHp: true, showMp: true } })
    r.mount(canvas)
    r.setTiles(tiles)
    r.resize(192, 192, 1)
    r.setScene(sceneWith([floor(1, 1)]))
    r.render()
    const bars = fills.filter((f) => f.x >= 64 && f.x < 128 && f.h === 2 && f.y >= 64 && f.y < 72)
    // 64px cell: a texel row is two pixels. The full magic bar is still drawn under the health bar (draw_minibars)
    // full-width rects: the four track rows, and the full magic bar's one plain fill on each of its rows
    expect(bars.filter((f) => f.w === 64).map((f) => f.y)).toEqual([64, 66, 68, 70, 68, 70])
    const reach = (y: number) => Math.max(...bars.filter((f) => f.y === y && f.w < 64).map((f) => f.x + f.w))
    expect(reach(64) - 64).toBe(26)
    expect(bars.filter((f) => f.y === 68)).toHaveLength(2)
  })

  it('pins a badge marked `at: top` to the top edge of the frame, where its texels are not', () => {
    const { canvas, images } = fakeCanvas()
    // a damage bar: rows 30-31 of its icon (rltiles/misc/mdam_*.png)
    const bar: TileSource = {
      tile: (id) => (id === 700 ? { atlas: 'a', sx: id, sy: 0, w: 32, h: 2, ox: 0, oy: 30, cell: 32 } : tiles.tile(id)),
      atlas: () => ({} as unknown as ImageBitmap),
    }
    const r = new Render2d({ cellSize: 32, follow: false })
    r.mount(canvas)
    r.setTiles(bar)
    r.resize(96, 96, 1)
    const s = sceneWith([floor(1, 1), floor(2, 1), floor(2, 2)])
    s.billboards.push(
      { x: 2, y: 1, tile: 500, kind: 'monster', height: 0.5, statusIcons: [{ tile: 700, ox: 0, oy: 0, at: 'top' }] },
      { x: 2, y: 2, tile: 500, kind: 'monster', height: 0.5, statusIcons: [{ tile: 700, ox: 0, oy: 0 }] },
    )
    r.setScene(s)
    r.render()
    const badges = images.filter((i) => i.sx === 700)
    expect(badges).toHaveLength(2)
    // lifted: the two texel rows land on the top edge of the cell at (2, 1), y 32; unlifted, at the foot of (2, 2), y 94
    expect(badges[0]).toMatchObject({ dx: 64, dy: 32, dh: 2 })
    expect(badges[1]).toMatchObject({ dx: 64, dy: 64 + 30, dh: 2 })
  })

  it('draws the WebTiles cursor icon last, and outlines every known cell while targeting', () => {
    const { canvas, draws, rects } = fakeCanvas()
    const r = new Render2d({ cellSize: 32, follow: false })
    r.mount(canvas)
    r.setTiles(tiles)
    r.resize(96, 96, 1)
    r.setScene(sceneWith([floor(0, 0), floor(1, 1), floor(2, 2, { kind: 'unknown' })]))
    r.setCursor({ x: 1, y: 1, mode: 'target', tile: 950, grid: true })
    r.render()
    expect(draws[draws.length - 1]).toBe(950)
    // two known cells outlined, the unknown one not
    expect(rects.filter((k) => k === 'stroke')).toHaveLength(2)
  })

  it('draws the facing wedge as far as wedgeReach cells, and leaves the grid out when the cursor says so', () => {
    const { canvas, rects, arcs } = fakeCanvas()
    const r = new Render2d({ cellSize: 16, follow: true, wedgeReach: 2.5, wedgeAlpha: 0.4 })
    r.mount(canvas)
    r.setTiles(tiles)
    r.resize(96, 96, 1)
    r.setScene(sceneWith([floor(0, 0), floor(1, 1)]))
    r.setCamera(makeCamera(1, 1, 0))
    r.setCursor({ x: 1, y: 1, mode: 'target', grid: false })
    r.render()
    expect(arcs).toEqual([40])
    // only the cursor's own outline, no grid over the known cells
    expect(rects.filter((k) => k === 'stroke')).toHaveLength(1)
  })
  it('turns the map so `up` is at the top, about the player, and keeps sprites, glyphs and the cursor upright', () => {
    const { canvas, rotates, images, draws } = fakeCanvas()
    // facing east: the map turns a quarter turn anticlockwise
    const r = new Render2d({ cellSize: 10, follow: true, up: 2 })
    r.mount(canvas)
    r.setTiles(tiles)
    r.resize(30, 30, 1)
    const scene = sceneWith([floor(1, 1), floor(2, 1)])
    scene.billboards.push({ x: 2, y: 1, tile: 500, kind: 'monster', height: 0.8 })
    r.setScene(scene)
    r.setCamera(makeCamera(1, 1, Math.PI / 2))
    r.setCursor({ x: 2, y: 1, mode: 'target', tile: 950, grid: false })
    r.render()
    // the map's turn, then the sprite and the cursor icon each turned back
    expect(rotates).toEqual([-Math.PI / 2, Math.PI / 2, Math.PI / 2])
    // the cell east of the player is still drawn at its map position; the turn is the canvas's
    expect(draws).toEqual([100, 100, 500, 950])
    expect(images[1]).toMatchObject({ dx: 20, dy: 10 })
    // north up: nothing turns
    rotates.length = 0
    r.setOptions({ up: 0 })
    r.render()
    expect(rotates).toEqual([])
    // a wide canvas turned a quarter turn shows cells above and below the player that lie
    // past its rows but within its columns
    const wide = fakeCanvas()
    const w = new Render2d({ cellSize: 10, follow: true, up: 2 })
    w.mount(wide.canvas)
    w.setTiles(tiles)
    w.resize(70, 30, 1)
    const tall = sceneWith([floor(1, 1)])
    tall.cells.set(cellKey(1, 4), floor(1, 4))
    tall.cells.set(cellKey(4, 1), floor(4, 1))
    w.setScene(tall)
    w.setCamera(makeCamera(1, 1, Math.PI / 2))
    w.render()
    // the player stands in the middle column; (1,4) is three cells south: turned, it lands
    // three cells right of the player, in view; (4,1) is three cells east: turned, three
    // cells up, off a 3-row canvas
    expect(wide.images.map((i) => `${i.dx},${i.dy}`)).toEqual(['30,10', '30,40'])
  })
  it('renderCell bare drops the terrain and the cell marks, keeping the sprite and its badges', () => {
    const { canvas, draws, rects } = fakeCanvas()
    const r = new Render2d({ cellSize: 32, follow: false })
    r.mount(canvas)
    r.setTiles(tiles)
    r.resize(32, 32, 1)
    const cell = floor(1, 1, { featureTile: 300, underlays: [200], overlays: [400], icons: [900] })
    const scene = sceneWith([cell])
    scene.billboards.push({ x: 1, y: 1, tile: 500, kind: 'monster', height: 0.8, statusIcons: [{ tile: 700, ox: 0, oy: 0 }] })
    r.setScene(scene)
    r.renderCell(1, 1, 0, 0, 32)
    expect(draws).toEqual([100, 200, 300, 400, 500, 700, 900])
    draws.length = 0
    r.renderCell(1, 1, 0, 0, 32, { bare: true })
    expect(draws).toEqual([500, 700])
    // and in glyph mode the black square goes with the terrain
    const g = new Render2d({ cellSize: 32, follow: false, mode: 'glyphs' })
    g.mount(canvas)
    g.setTiles(tiles)
    g.resize(32, 32, 1)
    g.setScene(sceneWith([floor(1, 1, { glyph: 'r', colour: 3 })]))
    rects.length = 0
    g.renderCell(1, 1, 0, 0, 32, { bare: true })
    expect(rects).toEqual(['text'])
  })
})

describe('Render2d view centre', () => {
  /** A scene with one cell out where the level map's cursor might wander. */
  function farScene() {
    const s = sceneWith([floor(1, 1)])
    const far = floor(15, 25)
    s.cells.set(cellKey(15, 25), far)
    return s
  }

  it('centres on the camera with no centre set', () => {
    const { canvas } = fakeCanvas()
    const r = new Render2d({ cellSize: 10, follow: true })
    r.mount(canvas)
    r.setTiles(tiles)
    r.resize(100, 100, 1)
    r.setScene(farScene())
    r.setCamera(makeCamera(1, 1, 0))
    r.render()
    // 10 x 10 cells around the player: the top left is (1 - 5, 1 - 5)
    expect(r.pick(55, 55)).toBe(cellKey(1, 1))
    expect(r.pick(5, 5)).toBe(null)
  })

  it('centres on the view centre the server sent, wherever the player is', () => {
    const { canvas } = fakeCanvas()
    const r = new Render2d({ cellSize: 10, follow: true })
    r.mount(canvas)
    r.setTiles(tiles)
    r.resize(100, 100, 1)
    r.setScene(farScene())
    r.setCamera(makeCamera(1, 1, 0))
    // the level map's cursor has walked off to (20, 30); the view goes with it
    r.setOptions({ center: { x: 20, y: 30 } })
    r.render()
    expect(r.pick(5, 5)).toBe(cellKey(15, 25))
    expect(r.pick(55, 55)).toBe(null)
    // and it is dropped again when the map closes
    r.setOptions({ center: null })
    r.render()
    expect(r.pick(55, 55)).toBe(cellKey(1, 1))
  })
})
