import { describe, it, expect } from 'vitest'
import type { Pixels } from '@orbrun/render-term'
import { cellKey, REST_PITCH, type Camera, type Scene, type SceneCell, type TileRect, type TileSource } from '@orbrun/scene'
import { coverage, INVERSE, OCTANTS, SEXTANTS, SHAPE_OF, SHAPES } from '../glyph/shapes'
import { encoders, q, unpack } from '../glyph/encode'
import { SpriteTex } from '../glyph/sprite'
import { drawSprite, gridFor } from '../glyph/sampling'
import { ansiInto, GlyphView, toAnsi, type Cell, type Raster } from '../glyph/render'

/** linear light of an encoded value */
const lin = (v: number) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** a raster of one cell of `SX` x `SY` pixels, each red where `on` says, else dark blue */
const cellOf = (SX: number, SY: number, on: (x: number, y: number) => boolean, thing = 1): Raster => {
  const pix = new Float32Array(SX * SY * 3)
  for (let y = 0; y < SY; y++)
    for (let x = 0; x < SX; x++) pix.set(on(x, y) ? [lin(200), lin(30), lin(30)] : [lin(10), lin(10), lin(60)], (y * SX + x) * 3)
  return { W: SX, H: SY, SX, SY, pix, weight: new Float32Array(SX * SY).fill(1), thing: new Float32Array(SX * SY).fill(thing), zbuf: new Float32Array(SX), glyphs: [] }
}

describe('shapes', () => {
  it('has each sextant and octant once, by its dots', () => {
    expect(new Set(SEXTANTS).size).toBe(64)
    expect(new Set(OCTANTS).size).toBe(256)
    expect(new Set(SHAPES.map((s) => s.ch)).size).toBe(SHAPES.length)
    // the upper-left sextant inks the upper-left sixth
    const m = coverage(SHAPE_OF.get(SEXTANTS[1])!, 2, 3)
    expect([...m]).toEqual([1, 0, 0, 0, 0, 0])
    // the lower half block, the lower half
    expect([...coverage(SHAPE_OF.get('▄')!, 1, 2)]).toEqual([0, 1])
  })

  it('knows each mosaic glyph\'s inverse, and none for a glyph that has none', () => {
    for (let b = 0; b < 256; b++) expect(INVERSE.get(OCTANTS[b].codePointAt(0)!)).toBe(OCTANTS[255 - b].codePointAt(0))
    for (let b = 0; b < 64; b++) expect(INVERSE.get(SEXTANTS[b].codePointAt(0)!)).toBe(SEXTANTS[63 - b].codePointAt(0))
    expect(INVERSE.get(' '.codePointAt(0)!)).toBe('█'.codePointAt(0))
    // the lower eighth's inverse, the upper seven, is no glyph
    expect(INVERSE.has('▁'.codePointAt(0)!)).toBe(false)
  })
})

describe('the fit encoder', () => {
  it('draws a cell that is exactly a glyph as that glyph, in its own two colours', () => {
    const enc = encoders.fit('sextant', { SX: 4, SY: 6, wedges: 'none', medoid: true, tries: 8 })
    // the left column and the bottom row of a sextant's dots: bits 0, 2, 4, 5
    const sx = SHAPE_OF.get(SEXTANTS[0b110101])!
    const [cell] = enc.encode(cellOf(4, 6, (x, y) => sx.inside((x + 0.5) / 4, (y + 0.5) / 6)), 1, 1)
    const inked = coverage(SHAPE_OF.get(cell.ch)!, 4, 6)
    const want = coverage(sx, 4, 6)
    // the glyph or its inverse, with the colours the other way round
    const same = [...inked].every((v, i) => v === want[i])
    expect(same || [...inked].every((v, i) => v === 1 - want[i])).toBe(true)
    expect(same ? cell.fg : cell.bg).toEqual([200, 30, 30])
    expect(same ? cell.bg : cell.fg).toEqual([10, 10, 60])
  })

  it('places an edge between the octants\' rows with an eighth block', () => {
    const enc = encoders.fit('octant', { SX: 4, SY: 8, wedges: 'none', medoid: true, tries: 8 })
    // the lower three eighths red
    const [cell] = enc.encode(cellOf(4, 8, (_, y) => y >= 5), 1, 1)
    expect(cell.ch).toBe('▃')
  })
})

describe('palette sampling', () => {
  // a 32-texel sprite: a grey body with a dark ink round it and one yellow eye in its middle
  const W = 32
  const data = new Uint8Array(W * W * 4)
  for (let y = 4; y < 28; y++)
    for (let x = 4; x < 28; x++) {
      const edge = x === 4 || y === 4 || x === 27 || y === 27
      const eye = x === 15 && y === 12
      data.set(edge ? [10, 10, 10, 255] : eye ? [250, 230, 40, 255] : [120, 120, 120, 255], (y * W + x) * 4)
    }
  const px: Pixels = { width: W, height: W, data }
  const tex = new SpriteTex({ px, rect: { atlas: 'a', sx: 0, sy: 0, w: W, h: W, ox: 0, oy: 0, cell: 32 } })

  /** the sprite drawn into a picture `n` pixels a side: each pixel's colour, encoded, or null where it is not drawn */
  const draw = (n: number, opts: { feature?: number }) => {
    const got: ([number, number, number] | null)[] = new Array(n * n).fill(null)
    drawSprite([tex], 'palette', 0.4, 'oklab', opts.feature ?? 0.25, 0.5, 'footprint', 0, 0, n, n, 0, n - 1, 0, n - 1, 1, new Float32Array(n).fill(99), n, (i, r, g, b) => {
      got[i] = [q(r), q(g), q(b)]
    })
    return got
  }

  it('keeps an eye a texel wide where the sprite is drawn in half its texels, and the body its own grey', () => {
    const got = draw(16, {})
    expect(got.filter((c) => c && c[0] > 200 && c[1] > 180 && c[2] < 100).length).toBe(1)
    expect(got.filter((c) => c && c[0] === 120).length).toBeGreaterThan(80)
  })

  it('leaves the eye out where it is too small a part of a pixel to stand for it', () => {
    const got = draw(4, { feature: 2 })
    expect(got.some((c) => c && c[0] > 200 && c[1] > 180)).toBe(false)
  })

  it('reads a near sprite on its grid: each block of it from the corner one texel, its edges the grid\'s', () => {
    // 32 texels on 100 pixels across and 200 down: 3.1 and 6.25 pixels a texel, read on blocks of 2 across and 4 down
    const W = 100, H = 200
    const got = new Int32Array(W * H).fill(-1)
    drawSprite([tex], 'palette', 0.4, 'oklab', 0.25, 0.5, 'footprint', 0, 0, W, H, 0, W - 1, 0, H - 1, 1, new Float32Array(W).fill(99), W, (i, r, g, b) => {
      got[i] = (q(r) << 16) | (q(g) << 8) | q(b)
    }, {}, [gridFor(W / 32, 4), gridFor(H / 32, 8)])
    for (let y = 0; y < H; y += 4)
      for (let x = 0; x < W; x += 2) {
        const block = [got[y * W + x], got[y * W + x + 1], got[(y + 3) * W + x], got[(y + 3) * W + x + 1]]
        expect(new Set(block).size).toBe(1)
      }
    // and the eye is still there, whole blocks of it
    expect([...got].filter((v) => v === ((250 << 16) | (230 << 8) | 40)).length % 8).toBe(0)
    expect([...got].some((v) => v === ((250 << 16) | (230 << 8) | 40))).toBe(true)
  })

  it('draws no more than the art covers: the ink at the edge is not swollen into the body', () => {
    const got = draw(8, {})
    // the art covers 24 of 32 texels each way: 6 of 8 pixels, with the corners of the ink at most besides
    expect(got.filter((c) => c).length).toBeLessThanOrEqual(7 * 7)
    expect(got[0]).toBeNull()
  })
})

/** a room of a small atlas's tiles, a monster standing in it, and an eye looking at it */
function room() {
  // tiles 1..3 across the atlas: a floor of checks, a wall of stripes, a monster with an eye on the dark
  const data = new Uint8Array(96 * 32 * 4)
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 96; x++) {
      const t = x >> 5, u = x & 31
      const px =
        t === 0 ? (((u >> 2) + (y >> 2)) & 1 ? [120, 90, 60, 255] : [70, 60, 50, 255]) :
        t === 1 ? ((y >> 3) & 1 ? [150, 150, 160, 255] : [90, 90, 110, 255]) :
        u < 6 || u > 25 || y < 4 ? [0, 0, 0, 0] : u === 12 && y === 10 ? [250, 230, 40, 255] : u === 6 || u === 25 ? [10, 10, 10, 255] : [180, 40 + y * 4, 40, 255]
      data.set(px, (y * 96 + x) * 4)
    }
  const px = { width: 96, height: 32, data }
  const rect = (id: number): TileRect => ({ atlas: 'a', sx: (id - 1) * 32, sy: 0, w: 32, h: 32, ox: 0, oy: 0, cell: 32 })
  const tiles: TileSource = { tile: (id) => (id >= 1 && id <= 3 ? rect(id) : undefined), atlas: () => undefined, atlasNames: () => ['a'] }
  const cells = new Map<number, SceneCell>()
  for (let y = -7; y <= 2; y++)
    for (let x = -4; x <= 4; x++) {
      const wall = Math.abs(x) === 4 || y === -7 || y === 2
      cells.set(cellKey(x, y), { x, y, kind: wall ? 'wall' : 'floor', visibility: y < -5 ? 'remembered' : 'visible', occluder: wall, floorTile: 1, wallTile: wall ? 2 : undefined } as SceneCell)
    }
  const scene = { cells, level: { ceilingTile: 2, sky: 'none', tint: { r: 1, g: 0.95, b: 0.9 } } } as unknown as Scene
  const view = new GlyphView(tiles, () => px)
  view.setScene(scene)
  view.things = [
    { x: 0, y: -2, art: [{ px, rect: rect(3) }], glyph: 'g', colour: [200, 200, 200], size: 0.95, name: 'goblin', alive: true },
    { x: 2, y: -6, art: [{ px, rect: rect(3) }], glyph: 'o', colour: [255, 90, 90], size: 0.95, name: 'orc', alive: true },
  ]
  const cam = (yaw: number): Camera => ({ x: 0, y: 1, eyeX: 0, eyeY: 1, yaw, pitch: REST_PITCH, facing: 0 })
  return { view, cam }
}

describe('the view in bands', () => {
  it('draws each band of rows as the whole view has them', () => {
    const { view, cam } = room()
    const cols = 40, rows = 15
    const whole = view.render(cam(0.2), cols, rows)
    const p = view.prepare(cam(0.2), cols, rows)
    const bands = [0, 4, 5, 11, 15]
    const joined = bands.slice(1).flatMap((rb, i) => view.band(p, bands[i], rb))
    expect(joined).toEqual(whole)
    // something stands in it, fitted finer than the dots, and the far monster is named by its letter
    expect(whole.some((o) => OCTANTS.indexOf(o.ch) < 0 && o.ch !== ' ' && o.ch !== 'o')).toBe(true)
    expect(whole.some((o) => o.ch === 'o')).toBe(true)
  })
})

describe('walls as render-3d stands them', () => {
  it('stands a wall back from the floor by the inset, and a ray past its cut corner goes on', () => {
    const { view, cam } = room()
    view.things = []
    const cols = 40, rows = 15
    const depthAhead = () => {
      const look = view.prepare(cam(0), cols, rows).look
      return look.zbuf[look.W >> 1]
    }
    // the north wall's face at y = -6, the eye's middle at 1.5: 7.5 ahead, and the inset further
    expect(depthAhead()).toBeCloseTo(7.5, 1)
    view.opts.wallInset = 0.375
    expect(depthAhead()).toBeCloseTo(7.875, 1)
  })

  it("floors a wall's strip with the floor beside it, and stands a wall back from a door in its doorway, the door stretched to it", () => {
    const { view, cam } = room()
    view.opts.wallInset = 0.375
    // a closed door in the north wall's run
    const scene = (view as unknown as { scene: Scene }).scene
    const door = scene.cells.get(cellKey(0, -7))!
    Object.assign(door, { kind: 'door', feature: { type: 'door', state: 'closed' }, featureTile: 2 })
    view.setScene(scene)
    view.prepare(cam(0), 40, 15)
    type Rect = { x0: number; x1: number; z0: number; z1: number }
    const v = view as unknown as { bodies: (Rect | null)[]; strip: (g: number, lx: number, lz: number) => number; index: (x: number, y: number) => number; doorIn: (dg: number, d: unknown, x: number, y: number) => Rect | null; doors: Map<number, unknown> }
    // the wall beside the door stands back from it as from the room south of it (world cells.ts `cellClass`)
    const beside = v.bodies[v.index(1, -7)]!
    expect(beside.x0).toBeCloseTo(0.375)
    expect(beside.z1).toBeCloseTo(0.625)
    // the door a block the run's thickness, reaching into the walls either side as far as they stand back
    const dg = v.index(0, -7)
    expect(v.bodies[dg]).toBeNull()
    const d = v.doors.get(dg)!
    const own = v.doorIn(dg, d, 0, -7)!
    expect([own.x0, own.x1, own.z0, own.z1]).toEqual([0, 1, 0.375, 0.625])
    const east = v.doorIn(dg, d, 1, -7)!
    expect([east.x0, east.x1]).toEqual([0, 0.375])
    expect(v.doorIn(dg, d, 2, -7)).toBeNull()
    // a point of the wall's cell south of its body is the floor of the cell south of it, and one west of it the door's
    expect(v.strip(v.index(1, -7), 0.5, 0.9)).toBe(v.index(1, -6))
    expect(v.strip(v.index(1, -7), 0.1, 0.5)).toBe(dg)
    expect(v.strip(v.index(1, -7), 0.5, 0.3)).toBe(-1)
  })

  it('draws a hand over all, in its own lens, its art filling its square as render-3d sizes it', () => {
    const { view, cam } = room()
    const goblin = view.things[0]
    view.things = [{ ...goblin, x: 0, y: 0, name: undefined, alive: false, hand: { x: 0, y: -1, size: 0.8, fit: true } }]
    const cols = 40, rows = 15
    const p = view.prepare(cam(0), cols, rows)
    const hand = p.look.sprites[p.look.sprites.length - 1]
    expect(hand.depth).toBe(0)
    // the art is 20 texels wide and 28 tall: 28 / 0.9 texels the square's 0.8 of the view's height, on the foot
    const H = rows * 8
    expect(hand.side).toBeCloseTo(((0.8 * H) / 2) * (32 / (28 / 0.9)), 0)
    expect(Math.round(hand.y0 + hand.side)).toBeGreaterThanOrEqual(H - 2)
  })
})

describe('terminal output', () => {
  /** a screen the output is played on: each cell's glyph and colours, as a terminal keeps them */
  const play = (screen: { ch: string; fg: string; bg: string }[][], out: string) => {
    let r = 0, c = 0, fg = '', bg = ''
    const re = /\x1b\[(\d+);(\d+)H|\x1b\[([\d;]+)m|([^\x1b])/gu
    for (const m of out.matchAll(re)) {
      if (m[1]) (r = Number(m[1]) - 1), (c = Number(m[2]) - 1)
      else if (m[3]) {
        // SGR: 0, or 48;2;r;g;b and 38;2;r;g;b, one or both
        const v = m[3].split(';')
        for (let k = 0; k < v.length; ) {
          if (v[k] === '48') (bg = v.slice(k + 2, k + 5).join(';')), (k += 5)
          else if (v[k] === '38') (fg = v.slice(k + 2, k + 5).join(';')), (k += 5)
          else k++
        }
      } else if (m[4]) screen[r][c++] = { ch: m[4], fg: m[4] === ' ' ? '' : fg, bg }
    }
  }
  const look = (cells: Cell[], cols: number) =>
    Array.from({ length: cells.length / cols }, (_, r) => cells.slice(r * cols, (r + 1) * cols).map((o) => ({ ch: o.ch, fg: o.ch === ' ' ? '' : o.fg.join(';'), bg: o.bg.join(';') })))

  it('writes only what changed, and leaves the screen as the new frame', () => {
    const cols = 7, rows = 4
    const rnd = (k: number) => (k * 2654435761) >>> 0
    const a: Cell[] = Array.from({ length: cols * rows }, (_, i) => {
      const v = rnd(i + 97)
      return { ch: v % 3 ? '▀' : ' ', fg: [v % 5, 7, 9], bg: [(v >>> 3) % 2, 3, 4] }
    })
    // b: a with a few cells changed, some side by side, one at a row's end
    const b: Cell[] = a.map((o, i) => ([3, 4, 10, 13, 22].includes(i) ? { ch: '▖', fg: [200, 1, 1], bg: [1, 2, 3] } : { ...o }))
    const screen = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ ch: '', fg: '', bg: '' })))
    play(screen, toAnsi(a, cols, rows))
    expect(screen).toEqual(look(a, cols))
    const delta = toAnsi(b, cols, rows, 1, a)
    play(screen, delta)
    expect(screen).toEqual(look(b, cols))
    expect(delta.length).toBeLessThan(toAnsi(b, cols, rows).length / 2)
    // and nothing at all for a frame as it was
    expect(toAnsi(b, cols, rows, 1, b)).toBe('')
  })

  /** how a cell looks: a space and a full block as their one colour, a glyph and its inverse alike */
  const looks = (o: { ch: string; fg: string; bg: string }) => {
    const cp = o.ch.codePointAt(0)!
    if (o.ch === ' ') return `solid ${o.bg}`
    if (o.ch === '█') return `solid ${o.fg}`
    const inv = INVERSE.get(cp)
    return inv !== undefined && inv < cp ? `${inv} ${o.fg} ${o.bg}` : `${cp} ${o.bg} ${o.fg}`
  }

  it('writes packed cells so the screen looks as they do, and then only what changed', () => {
    const { view, cam } = room()
    const cols = 40, rows = 15
    const packed = (yaw: number) => {
      const p = view.prepare(cam(yaw), cols, rows)
      const out = new Int32Array(cols * rows * 3)
      view.bandInto(p, 0, rows, out)
      return out
    }
    const a = packed(0.2), b = packed(0.25)
    const buf = new Uint8Array(cols * rows * 64)
    const screen = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ ch: '', fg: '', bg: '' })))
    const text = (end: number) => Buffer.from(buf.subarray(0, end)).toString('utf8')
    play(screen, text(ansiInto(a, 0, cols, rows, 1, null, buf, 0)))
    expect(screen.flat().map(looks)).toEqual(look(unpack(a), cols).flat().map(looks))
    const delta = text(ansiInto(b, 0, cols, rows, 1, a, buf, 0))
    play(screen, delta)
    expect(screen.flat().map(looks)).toEqual(look(unpack(b), cols).flat().map(looks))
    expect(delta.length).toBeLessThan(text(ansiInto(b, 0, cols, rows, 1, null, buf, 0)).length)
    expect(ansiInto(b, 0, cols, rows, 1, b, buf, 0)).toBe(0)
  })

  it('moves the cursor after a glyph a terminal may draw two cells wide, rather than trusting where it is', () => {
    const cells = new Int32Array(3 * 3)
    ;['你', 'a', 'b'].forEach((c, i) => (cells[i * 3] = c.codePointAt(0)!))
    const buf = new Uint8Array(512)
    const out = Buffer.from(buf.subarray(0, ansiInto(cells, 0, 3, 1, 1, null, buf, 0))).toString('utf8')
    expect(out).toMatch(/你\x1b\[1;2Ha/)
    // and none after one that is narrow
    expect(out).toMatch(/ab/)
  })
})
