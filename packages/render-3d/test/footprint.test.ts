import { describe, it, expect } from 'vitest'
import { asciiClassAt, inPoly, insetFootprint, insetOracle, type ClassAt, type FootprintOptions } from '../src/index.js'

/**
 * Fixtures. `#` wall, `.` floor, space void. Cells outside the rows are void,
 * so every fixture has a void rim as well.
 */
const FIXTURES: Record<string, string[]> = {
  // a one-wide corridor beside a room, separated by a one-thick wall
  corridor: [
    '#########',
    '#.......#',
    '#.#######',
    '#.#.....#',
    '#.#.....#',
    '#.......#',
    '#########',
  ],
  // pillar, and a wall touched only diagonally by floor
  pillar: [
    '#######',
    '#.....#',
    '#.#...#',
    '#...#.#',
    '#.....#',
    '#######',
  ],
  // T-junction and a corridor mouth
  junction: [
    '###########',
    '#.........#',
    '#####.#####',
    '    #.#',
    '    #.#',
    '  ###.###',
    '  #.....#',
    '  #######',
  ],
  // diagonal-only contact: checkerboard
  checker: [
    '#.#.#',
    '.#.#.',
    '#.#.#',
    '.#.#.',
    '#.#.#',
  ],
  // ragged cave with void inside the known area
  cave: [
    '   ####    ',
    '  ##..##   ',
    ' ##....###',
    ' #..#....# ',
    ' #.....#.# ',
    ' ###.....# ',
    '   ###..## ',
    '     ####  ',
  ],
}

const RES = 32
const OPTS: FootprintOptions = { inset: 13 / 32 }

/** Every cell in the fixture plus a one-cell rim. */
function cellsOf(rows: string[]): [number, number][] {
  const out: [number, number][] = []
  const w = Math.max(...rows.map((r) => r.length))
  for (let z = -1; z <= rows.length; z++) for (let x = -1; x <= w; x++) out.push([x, z])
  return out
}

/** Body coverage of one cell at RES×RES sample points: from the footprint polygon, and from the definition. */
function sample(at: ClassAt, x: number, z: number, o: FootprintOptions) {
  const fp = insetFootprint(at, x, z, o)
  const local: boolean[] = [], oracle: boolean[] = []
  for (let j = 0; j < RES; j++) {
    for (let i = 0; i < RES; i++) {
      const fx = (i + 0.5) / RES, fz = (j + 0.5) / RES
      local.push(fp.poly.length > 0 && inPoly(fp.poly, fx, fz))
      oracle.push(insetOracle(at, x, z, fx, fz, o))
    }
  }
  return { fp, local, oracle }
}

describe('inset footprint', () => {
  for (const [name, rows] of Object.entries(FIXTURES)) {
    describe(name, () => {
      const at = asciiClassAt(rows)
      const cells = cellsOf(rows)
      it('matches the definition (solid minus floor grown by the inset) in every cell', () => {
        for (const [x, z] of cells) {
          const { local, oracle } = sample(at, x, z, OPTS)
          expect(local, `cell ${x},${z}`).toEqual(oracle)
        }
      })
      it('draws exactly the boundary of the union body, so no seam, step or hidden face', () => {
        // rasterise the union body over the fixture at texel resolution
        const w = Math.max(...rows.map((r) => r.length)) + 2, h = rows.length + 2
        const body = new Uint8Array(w * RES * h * RES)
        const idx = (tx: number, tz: number) => (tz * w * RES + tx)
        for (const [x, z] of cells) {
          const { oracle } = sample(at, x, z, OPTS)
          for (let j = 0; j < RES; j++) for (let i = 0; i < RES; i++) if (oracle[j * RES + i]) body[idx((x + 1) * RES + i, (z + 1) * RES + j)] = 1
        }
        // perimeter in texels: body texels against non-body; past the raster the void continues, so it counts as body
        let perimeter = 0
        const solidAt = (tx: number, tz: number) => tx < 0 || tz < 0 || tx >= w * RES || tz >= h * RES || body[idx(tx, tz)] === 1
        for (let tz = 0; tz < h * RES; tz++) {
          for (let tx = 0; tx < w * RES; tx++) {
            if (!solidAt(tx, tz)) continue
            for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!solidAt(tx + dx, tz + dz)) perimeter++
          }
        }
        let drawn = 0
        for (const [x, z] of cells) {
          const fp = insetFootprint(at, x, z, OPTS)
          for (const f of fp.faces) {
            if (f.covered) continue
            const len = Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1])
            drawn += len * RES
            // the face's outside is not body, its inside is
            const mx = x + (f.a[0] + f.b[0]) / 2, mz = z + (f.a[1] + f.b[1]) / 2
            const probe = (s: number) => {
              const px = mx + f.nx * s, pz = mz + f.nz * s
              const cx = Math.floor(px), cz = Math.floor(pz)
              return insetOracle(at, cx, cz, px - cx, pz - cz, OPTS)
            }
            expect(probe(1 / (2 * RES)), `face at ${mx},${mz} faces body`).toBe(false)
            expect(probe(-1 / (2 * RES)), `face at ${mx},${mz} backs onto air`).toBe(true)
          }
        }
        expect(drawn).toBeCloseTo(perimeter, 6)
      })
    })
  }

  it('reproduces full cubes at inset 0, with faces only toward floor', () => {
    const at = asciiClassAt(['###', '#.#', '###'])
    const fp = insetFootprint(at, 1, 0, { inset: 0 })
    expect(fp.poly).toEqual([[0, 0], [1, 0], [1, 1], [0, 1]])
    const open = fp.faces.filter((f) => !f.covered)
    expect(open).toHaveLength(1)
    expect(open[0]).toMatchObject({ a: [1, 1], b: [0, 1], nx: 0, nz: 1 })
  })

  it('reports the boundary segments a neighbour covers, for faces over a plinth', () => {
    const at = asciiClassAt(['##', '..'])
    const fp = insetFootprint(at, 0, 0, { inset: 0.4 })
    // the west and north edges are covered by void, the east edge by the other wall up to its inset
    const covered = fp.faces.filter((f) => f.covered)
    expect(covered).toHaveLength(3)
    expect(covered.find((f) => f.nx === 1)).toMatchObject({ a: [1, 0], b: [1, 0.6] })
    expect(fp.faces.filter((f) => !f.covered)).toHaveLength(1)
  })

  it('keeps a core of 1 - 2·inset in a one-thick wall and vanishes at 0.5', () => {
    const at = asciiClassAt(['...', '###', '...'])
    const fp = insetFootprint(at, 1, 1, { inset: 0.4 })
    expect(fp.poly).toEqual([[0, 0.4], [1, 0.4], [1, 0.6], [0, 0.6]])
    expect(insetFootprint(at, 1, 1, { inset: 0.5 }).poly).toEqual([])
  })

  it('cuts the diagonal cell at a concave corner so the three faces meet flush', () => {
    // floor at (0,1); walls north (0,0), east (1,1) and diagonal (1,0)
    const at = asciiClassAt(['##', '.#'])
    const t = 0.3
    const c = insetFootprint(at, 1, 0, { inset: t })
    expect(c.poly).toEqual([[0, 0], [1, 0], [1, 1], [t, 1], [t, 1 - t], [0, 1 - t]])
    const a = insetFootprint(at, 0, 0, { inset: t })
    const b = insetFootprint(at, 1, 1, { inset: t })
    // the north wall's south face, the corner cut's faces and the east wall's west face lie on two planes
    const planesZ = new Set([...a.faces, ...c.faces].filter((f) => !f.covered && f.nz === 1).map((f) => f.a[1]))
    const planesX = new Set([...b.faces, ...c.faces].filter((f) => !f.covered && f.nx === -1).map((f) => f.a[0]))
    expect(planesZ).toEqual(new Set([1 - t]))
    expect(planesX).toEqual(new Set([t]))
  })

})
