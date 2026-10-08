import { expect, test } from 'claude-code/testing'

import { duration, limitEta, turnsUntil } from '../hooks/forecast'

test('context forecast from the recent climb, ignoring the drop of a compaction', () => {
  const h = [80, 20, 30, 40, 50].map((percent, i) => ({ at: i, percent }))
  expect(turnsUntil(h, 70)).toBe(2)
  expect(turnsUntil([{ at: 0, percent: 10 }], 70)).toBeUndefined()
})

test('rate-limit ETA at the last hour\'s pace, none past the reset', () => {
  const now = 60 * 60_000
  const s = [{ at: 0, percent: 40 }, { at: now, percent: 60 }]
  expect(limitEta(s, now)).toBe(2 * 60 * 60_000)
  expect(limitEta(s, now, new Date(now + 30 * 60_000).toISOString())).toBeUndefined()
  expect(duration(80 * 60_000)).toBe('1 h 20')
})
