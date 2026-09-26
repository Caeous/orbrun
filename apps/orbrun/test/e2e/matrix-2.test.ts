// @vitest-environment happy-dom
// Shard 2 of the every-surface, every-input run (matrix.ts).
import { appendFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { builtChannels } from './engine'
import { formatViolations, runMatrix, shardScenarios } from './matrix'

describe.skipIf(!builtChannels.length)('every surface, every input (2)', () => {
  it('keeps the rules', { timeout: 600000 }, async () => {
    const v = await runMatrix(shardScenarios(2))
    if (process.env.E2E_REPORT && v.length) appendFileSync(process.env.E2E_REPORT, formatViolations(v) + '\n')
    expect(formatViolations(v)).toBe('')
  })
})
