import { expect, test } from 'claude-code/testing'

import { countLines, coverage, coverageLine, logRead, readInterval } from '../hooks/couverture'
import type { ReadLog } from '../hooks/couverture'
import { agentDefs } from '../hooks/media'

test('reading a novel by slices of 400 lines covers it whole', () => {
  const ivs = [1, 401, 801].map(o => readInterval(o, 400))
  expect(coverage(ivs, 1100)).toEqual({ total: 1100, read: 1100, missing: [] })
})

test('a skipped slice is named precisely', () => {
  const ivs = [readInterval(1, 400), readInterval(801, 400)]
  const c = coverage(ivs, 1100)
  expect(c.missing).toEqual([[401, 800]])
  expect(coverageLine('ch3.md', c)).toBe('✗ ch3.md : 700/1100 lignes lues ; NON LUES : 401–800')
})

test('a Read with no limit counts as its first 2000 lines', () => {
  expect(coverage([readInterval(undefined, undefined)], 2500).missing).toEqual([[2001, 2500]])
  expect(coverageLine('a.md', coverage([readInterval(undefined, undefined)], 300))).toBe('✓ a.md : 300/300 lignes lues')
})

test('each agent has its own log', () => {
  const log: ReadLog = new Map()
  logRead(log, 'relecteur', '/r/ch1.md', [1, 400])
  logRead(log, 'main', '/r/ch1.md', [1, 10])
  expect(log.get('relecteur')?.get('/r/ch1.md')).toEqual([[1, 400]])
  expect(log.get('main')?.get('/r/ch1.md')).toEqual([[1, 10]])
})

test('line count ignores a final newline', () => {
  expect(countLines('a\nb\n')).toBe(2)
  expect(countLines('a\nb')).toBe(2)
  expect(countLines('')).toBe(0)
})

test('the novel proof-reader reads everything, with the session model, and never rewrites', () => {
  const r = agentDefs('/p').find(d => d.name === 'relecteur-roman')
  expect(r?.model).toBe('inherit')
  expect(r?.tools).toContain('mcp__token-meter__couverture')
  expect(r?.prompt).toContain('CITATION EXACTE')
  expect(r?.prompt).toContain('carnet')
  expect(agentDefs('/p').find(d => d.name === 'lecteur')?.description).toContain('PAS pour un roman')
})
