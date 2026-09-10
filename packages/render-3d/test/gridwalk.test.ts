import { describe, it, expect } from 'vitest'
import { gridWalk } from '../src/index.js'

describe('gridWalk', () => {
  it('visits the cells a segment touches, start to end', () => {
    const seen: [number, number][] = []
    gridWalk(0.5, 0.5, 2.5, 0.5, (x, z) => void seen.push([x, z]))
    expect(seen).toEqual([[0, 0], [1, 0], [2, 0]])
  })
  it('stays in one cell for a segment that ends where it starts', () => {
    const seen: [number, number][] = []
    gridWalk(0.5, 0.5, 0.7, 0.6, (x, z) => void seen.push([x, z]))
    expect(seen).toEqual([[0, 0]])
  })
})
