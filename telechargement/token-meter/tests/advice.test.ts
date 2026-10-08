import { expect, test } from 'claude-code/testing'

import { advice, spikeNote } from '../hooks/register'
import type { TurnRecord } from '../types'

const turn = (input: number, cacheRead: number, cacheWrite: number, output: number): TurnRecord => ({
  id: 'x', model: 'm', durationMs: 1000, input, cacheRead, cacheWrite, output,
})
const ZERO = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, turns: 0 }

test('advice: compaction urgent, heavy messages, cold cache', () => {
  const tips = advice(
    {
      window: 200_000, tokens: 180_000, percent: 90, limits: [],
      categories: [{ name: 'Messages', tokens: 120_000, color: 'x' }, { name: 'System prompt', tokens: 20_000, color: 'y' }],
    },
    { input: 60_000, cacheRead: 10_000, cacheWrite: 30_000, output: 5_000, turns: 5 },
    ZERO,
  )
  expect(tips[0]).toContain('/compact maintenant')
  expect(tips.some(t => t.includes('/clear entre tâches'))).toBe(true)
  expect(tips.some(t => t.startsWith('Cache à 10%'))).toBe(true)
})

test('advice: nothing to say on a healthy session', () => {
  expect(advice({ window: 200_000, tokens: 20_000, percent: 10, limits: [], categories: [] }, ZERO, ZERO)).toEqual([])
})

test('spikeNote flags a cache rewrite after a pause', () => {
  const before = Array.from({ length: 6 }, () => turn(500, 9_000, 200, 800))
  expect(spikeNote(turn(500, 1_000, 60_000, 800), before)).toContain('cache réécrit')
  expect(spikeNote(turn(500, 9_500, 300, 900), before)).toBeUndefined()
})
