import { expect, test } from 'claude-code/testing'

const usage = (input: number, read: number, write: number, output: number) => ({
  model: 'claude-test',
  input_tokens: input,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write,
  output_tokens: output,
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`pane shows context, totals and turns (${surface})`, async ($, on) => {
    on('turn.complete', (_$, e) => ({ text: e.answer }))
    on('session.measure', (_$, e) => ({ changed: e.changed }))
    on('session.usage', () => ({
      value: {
        startedAt: 0,
        context: { window: 200_000, tokens: 124_000, percent: 62 },
        rateLimits: [],
      },
    }))
    on('ui.status', () => ({ value: undefined }))
    on('clock.now', () => ({ value: 1_000_000 }))

    await $.turn.complete({
      answer: 'ok', durationMs: 4000, isAborted: false, turnId: 't1',
      reason: 'answer', usage: usage(1000, 9000, 500, 1500),
    })
    await $.turn.complete({
      answer: 'ok', durationMs: 2000, isAborted: false, turnId: 't2', agentId: 'a1',
      reason: 'answer', usage: usage(200, 0, 0, 300),
    })
    await $.session.measure({
      context: { window: 200_000, tokens: 124_000, percent: 62 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 23 }],
      cost: { usd: 1.234 },
      changed: ['context', 'rateLimits', 'cost'],
    })

    const ui = await $.ui.mount({
      plugin: 'token-meter',
      surface,
      component: 'Pane',
      requestId: 'token-meter',
      props: {
        title: 'Tokens', isFocused: false, bodyColumns: 80, placement: 'dock',
        scroll: { offset: 0, bodyRows: 40 }, view: {},
      },
      viewport: { columns: 80, rows: 40 },
    })

    expect(await ui.find({ text: /62%/ })).toBeDefined()
    expect(await ui.find({ text: /Principal \(1 tours\)/ })).toBeDefined()
    expect(await ui.find({ text: /12\.0k/ })).toBeDefined()
    expect(await ui.find({ text: /Sous-agents \(1 tours\)/ })).toBeDefined()
    expect(await ui.find({ text: /\$1\.234/ })).toBeDefined()
  })
}

test('Read guard: holds a big whole-file read once, lets the repeat through', async ($, on) => {
  on('fs.stat', () => ({ value: { kind: 'file', size: 400_000, mtimeMs: 1, isLink: false } }))
  on('ui.status', () => ({ value: undefined }))
  on('tool.call', () => ({ result: { type: 'text', file: { filePath: '/r/ms.md', content: 'x', numLines: 1, startLine: 1, totalLines: 1 } } }) as never)

  const first = await $.tool.call({ tool: 'Read', file_path: '/r/ms.md' })
  expect(first.deny ?? first.text ?? '').toContain('relance exactement ce même Read')
  const second = await $.tool.call({ tool: 'Read', file_path: '/r/ms.md' })
  expect(second.isError === true || second.deny !== undefined).toBe(false)
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`band shows above 70 % with its buttons (${surface})`, async ($, on) => {
    on('session.measure', (_$, e) => ({ changed: e.changed }))
    on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
    on('ui.status', () => ({ value: undefined }))
    on('clock.now', () => ({ value: 1_000_000 }))
    on('ui.render', () => h('Box', {}) as never)
    on('ui.toast', () => ({ value: undefined }))

    await $.session.measure({
      context: { window: 200_000, tokens: 150_000, percent: 75 },
      rateLimits: [],
      changed: ['context'],
    })
    const ui = await $.ui.mount({
      plugin: 'token-meter',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 100 } as never,
      viewport: { columns: 100, rows: 40 },
    })
    expect(await ui.find({ text: /Contexte 75%/ })).toBeDefined()
    expect(await ui.find({ key: 'compact' })).toBeDefined()
    await ui.press({ key: 'hide' })
    expect(await ui.find({ key: 'compact' })).toBeUndefined()
  })
}
