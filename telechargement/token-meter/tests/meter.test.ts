import { expect, test } from 'claude-code/testing'

const usage = (input: number, read: number, write: number, output: number) => ({
  model: 'claude-test',
  input_tokens: input,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write,
  output_tokens: output,
})

const PANE_PROPS = {
  title: 'Tokens', isFocused: true, bodyColumns: 70, placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 }, view: {},
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`widget: overview tiles, then tabs (${surface})`, async ($, on) => {
    on('turn.complete', (_$, e) => ({ text: e.answer }))
    on('session.measure', (_$, e) => ({ changed: e.changed }))
    on('session.usage', () => ({
      value: {
        startedAt: 0,
        context: {
          window: 200_000, tokens: 124_000, percent: 62,
          breakdown: { categories: [{ name: 'Messages', tokens: 90_000, color: 'claude', isDeferred: false, kind: 'used' }] },
        },
        rateLimits: [],
      },
    }) as never)
    on('ui.status', () => ({ value: undefined }))
    on('clock.now', () => ({ value: 1_000_000 }))

    await $.turn.complete({
      answer: 'ok', durationMs: 4000, isAborted: false, turnId: 't1',
      reason: 'answer', usage: usage(1000, 9000, 500, 1500),
    })
    await $.session.measure({
      context: { window: 200_000, tokens: 124_000, percent: 62 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 23 }],
      cost: { usd: 1.234 },
      changed: ['context', 'rateLimits', 'cost'],
    })

    const ui = await $.ui.mount({
      plugin: 'token-meter', surface, component: 'Pane', requestId: 'token-meter',
      props: PANE_PROPS, viewport: { columns: 70, rows: 40 },
    })
    expect(await ui.find({ text: /^62%$/ })).toBeDefined()
    expect(await ui.find({ text: '$1.23' })).toBeDefined()
    expect(await ui.find({ text: '12.0k' })).toBeDefined()

    await ui.press({ key: 'tab-contexte' })
    expect(await ui.find({ text: /Messages/ })).toBeDefined()
    await ui.press({ key: 'tab-garde' })
    expect(await ui.find({ key: 'guard-toggle' })).toBeDefined()
  })

  test(`launcher icon shows the fill and opens the widget (${surface})`, async ($, on) => {
    on('session.measure', (_$, e) => ({ changed: e.changed }))
    on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
    on('clock.now', () => ({ value: 1_000_000 }))
    on('ui.toast', () => ({ value: undefined }))
    let opened = 0
    on('ui.open', () => ((opened += 1), { value: { isPlaced: true } }) as never)

    await $.session.measure({ context: { window: 200_000, tokens: 100_000, percent: 50 }, rateLimits: [], changed: ['context'] })
    const ui = await $.ui.mount({
      plugin: 'token-meter', surface, component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 100 } as never,
      viewport: { columns: 100, rows: 40 },
    })
    expect(await ui.find({ key: 'launcher', text: '◑ 50%' })).toBeDefined()
    await ui.press({ key: 'launcher' })
    expect(opened).toBe(1)
    expect(await ui.find({ key: 'launcher', text: /✕/ })).toBeDefined()
  })
}

test('Read guard: holds a big whole-file read once, lets the repeat through', async ($, on) => {
  on('fs.stat', () => ({ value: { kind: 'file', size: 400_000, mtimeMs: 1, isLink: false } }))
  on('tool.call', () => ({ result: { type: 'text', file: { filePath: '/r/ms.md', content: 'x', numLines: 1, startLine: 1, totalLines: 1 } } }) as never)

  const first = await $.tool.call({ tool: 'Read', file_path: '/r/ms.md' })
  expect(first.deny ?? first.text ?? '').toContain('relance exactement ce même Read')
  const second = await $.tool.call({ tool: 'Read', file_path: '/r/ms.md' })
  expect(second.isError === true || second.deny !== undefined).toBe(false)
})
