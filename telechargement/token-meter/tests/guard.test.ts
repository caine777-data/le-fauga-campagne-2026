import { expect, test } from 'claude-code/testing'

import { forgetLoop, judgeRead, wantsFullRead } from '../hooks/guard'
import type { GuardMemory } from '../hooks/guard'

const fresh = (): GuardMemory => ({ seen: new Map(), held: new Set() })
const BIG = { size: 400_000, mtimeMs: 1 }
const MS = '/r/manuscrit.md'

test('a big whole-file read is held once, then goes through when repeated', () => {
  const mem = fresh()
  const first = judgeRead(mem, { file_path: MS }, BIG, false)
  expect(first.kind).toBe('deny')
  if (first.kind === 'deny') expect(first.reason).toContain('relance exactement ce même Read')
  expect(judgeRead(mem, { file_path: MS }, BIG, false)).toEqual({ kind: 'allow', overridden: true })
})

test('a full-read request lets the whole manuscript through at once', () => {
  expect(judgeRead(fresh(), { file_path: MS }, BIG, true).kind).toBe('allow')
})

test('reading by chunks is never held', () => {
  const mem = fresh()
  for (let offset = 1; offset < 8000; offset += 2000) {
    expect(judgeRead(mem, { file_path: MS, offset, limit: 2000 }, BIG, false).kind).toBe('allow')
  }
})

test('an unchanged re-read is held once; an edited file or a compaction lets it through', () => {
  const mem = fresh()
  mem.seen.set('main|/r/ch12.md|||', 5)
  expect(judgeRead(mem, { file_path: '/r/ch12.md' }, { size: 9000, mtimeMs: 5 }, false).kind).toBe('deny')
  mem.held.clear()
  expect(judgeRead(mem, { file_path: '/r/ch12.md' }, { size: 9000, mtimeMs: 6 }, false).kind).toBe('allow')
  forgetLoop(mem, undefined)
  expect(judgeRead(mem, { file_path: '/r/ch12.md' }, { size: 9000, mtimeMs: 5 }, false).kind).toBe('allow')
})

test('a subagent has its own context: no re-read across loops', () => {
  const mem = fresh()
  mem.seen.set('main|/r/ch12.md|||', 5)
  expect(judgeRead(mem, { file_path: '/r/ch12.md', agentId: 'a1' }, { size: 9000, mtimeMs: 5 }, false).kind).toBe('allow')
})

test('full-read wording', () => {
  for (const t of ['Lis tout le manuscrit et vérifie les noms', 'relecture totale du roman', 'lis-le en entier', 'lecture intégrale stp']) {
    expect(wantsFullRead(t)).toBe(true)
  }
  for (const t of ['corrige le ch.12', 'chasse mes tics sur le Ch.3']) expect(wantsFullRead(t)).toBe(false)
})
