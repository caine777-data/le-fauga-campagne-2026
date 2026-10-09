import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Samples, Tab, Totals, TurnRecord } from '../types'
import { forgetLoop, judgeRead, readKey, wantsFullRead } from './guard'
import type { GuardMemory } from './guard'
import {
  LIMIT_LABEL,
  advice,
  bar,
  cacheHit,
  fmt,
  forecastLines,
  levelColor,
  sparkline,
  spikeNote,
  sumTotals,
  turnTotal,
} from './model'

export { advice, spikeNote } from './model'

const PANE = 'token-meter'
const ZERO: Totals = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, turns: 0 }

const turns = atom({ plugin: 'token-meter', key: 'turns' } as const, [])
const main = atom({ plugin: 'token-meter', key: 'main' } as const, ZERO)
const sub = atom({ plugin: 'token-meter', key: 'sub' } as const, ZERO)
const gauge = atom({ plugin: 'token-meter', key: 'gauge' } as const, {
  window: 0,
  limits: [],
  categories: [],
})
const guard = atom({ plugin: 'token-meter', key: 'guard' } as const, {
  isOn: true,
  big: 0,
  reread: 0,
  overridden: 0,
  savedBytes: 0,
})
const samples = atom({ plugin: 'token-meter', key: 'samples' } as const, { context: [], limits: {} })
const widget = atom({ plugin: 'token-meter', key: 'widget' } as const, { isOpen: false, tab: 'apercu' })

const TABS: { tab: Tab; label: string; hotkey: string }[] = [
  { tab: 'apercu', label: 'Aperçu', hotkey: '1' },
  { tab: 'contexte', label: 'Contexte', hotkey: '2' },
  { tab: 'tours', label: 'Tours', hotkey: '3' },
  { tab: 'garde', label: 'Garde-fou', hotkey: '4' },
]

/** ○ ◔ ◑ ◕ ●: the launcher fills with the context. */
export const fillGlyph = (percent: number | undefined): string =>
  percent === undefined ? '◇' : (['○', '◔', '◑', '◕', '●'][Math.min(4, Math.round(percent / 25))] ?? '●')

async function toggleWidget($: EngineInterface): Promise<boolean> {
  const w = await read($, widget)
  if (w.isOpen) {
    await $.ui.close({ id: PANE })
    await update($, widget, x => ({ ...x, isOpen: false }))
    return false
  }
  await update($, widget, x => ({ ...x, isOpen: true }))
  await $.ui.open({ id: PANE, title: 'Tokens', focus: true, closeOnEscape: true })
  return true
}

export const register: Register = on => {
  const mem: GuardMemory = { seen: new Map(), held: new Set() }
  const heldBig = new Map<string, number>()
  let isFullReadTurn = false
  let hasWarned = false

  // ── Garde-fou de lecture ────────────────────────────────────────────────

  on('prompt.submit', ($, e, next) => {
    isFullReadTurn = wantsFullRead(e.text)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const g = await read($, guard)
    if (!g.isOn) return next(e)
    const file = await $.fs.stat(e.file_path).catch(() => undefined)
    const call = { file_path: e.file_path, offset: e.offset, limit: e.limit, pages: e.pages, agentId: e.agentId }
    const key = readKey(call)
    const verdict = judgeRead(mem, call, file?.kind === 'file' ? file : undefined, isFullReadTurn)

    if (verdict.kind === 'deny') {
      if (verdict.why === 'big') heldBig.set(key, file?.size ?? 0)
      await update($, guard, s => ({
        ...s,
        big: s.big + (verdict.why === 'big' ? 1 : 0),
        reread: s.reread + (verdict.why === 'reread' ? 1 : 0),
        savedBytes: s.savedBytes + (verdict.why === 'big' ? (file?.size ?? 0) : 0),
      }))
      return { deny: verdict.reason }
    }
    if (verdict.overridden) {
      const size = heldBig.get(key) ?? 0
      heldBig.delete(key)
      await update($, guard, s => ({ ...s, overridden: s.overridden + 1, savedBytes: Math.max(0, s.savedBytes - size) }))
    }

    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true && file?.kind === 'file') mem.seen.set(key, file.mtimeMs)

    return ran
  }).catch(($, e, next) => next(e))

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.trigger !== 'precompute' && 'messages' in result && result.messages) forgetLoop(mem, e.agentId)

    return result
  }).catch(($, e, next) => next(e))

  on('session.end', ($, e, next) => {
    if (e.reason === 'clear') forgetLoop(mem, undefined)

    return next(e)
  })

  // ── Commandes ───────────────────────────────────────────────────────────

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'tokens', description: 'Ouvre ou ferme le widget de consommation de tokens' })
    await $.command.register({
      name: 'tokens-garde',
      description: 'Active ou coupe le garde-fou de lecture (grosses lectures, relectures)',
    })
    await $.command.register({ name: 'tokens-reset', description: "Remet à zéro l'historique du widget" })
    $.ui.status(undefined)

    return next(e)
  })

  on('command.run', { command: 'tokens' }, async $ =>
    (await toggleWidget($))
      ? { text: 'Widget Tokens ouvert (1-4 pour les onglets, Échap pour fermer).' }
      : { text: 'Widget Tokens fermé.' },
  )

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await update($, widget, x => ({ ...x, isOpen: false }))

    return next(e)
  })

  on('command.run', { command: 'tokens-garde' }, async $ => {
    const g = await update($, guard, s => ({ ...s, isOn: !s.isOn }))

    return {
      text: g.isOn
        ? 'Garde-fou de lecture activé.'
        : 'Garde-fou de lecture coupé : Claude peut tout lire librement. /tokens-garde pour le réactiver.',
    }
  })

  on('command.run', { command: 'tokens-reset' }, async $ => {
    await update($, turns, () => [])
    await update($, main, () => ZERO)
    await update($, sub, () => ZERO)

    return { text: 'Historique de tokens remis à zéro.' }
  })

  // ── Mesures ─────────────────────────────────────────────────────────────

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const usage = e.usage ?? result.usage
    if (!usage) return result

    const rec: TurnRecord = {
      id: e.turnId,
      agentId: e.agentId,
      model: usage.model,
      durationMs: e.durationMs,
      input: usage.input_tokens,
      cacheRead: usage.cache_read_input_tokens,
      cacheWrite: usage.cache_creation_input_tokens,
      output: usage.output_tokens,
    }
    if (rec.agentId === undefined) {
      const before = (await read($, turns)).filter(t => t.agentId === undefined)
      if (spikeNote(rec, before) && !(await read($, widget)).isOpen) {
        $.ui.toast(`Tour coûteux : ${fmt(turnTotal(rec))} tokens. /tokens pour le détail.`)
      }
    }
    await update($, turns, list => [...list, rec].slice(-200))
    const add = (t: Totals): Totals => ({
      input: t.input + rec.input,
      cacheRead: t.cacheRead + rec.cacheRead,
      cacheWrite: t.cacheWrite + rec.cacheWrite,
      output: t.output + rec.output,
      turns: t.turns + 1,
    })
    if (rec.agentId === undefined) {
      await update($, main, add)
    } else {
      await update($, sub, add)
    }

    return result
  })

  on('session.measure', async ($, e, next) => {
    const p = e.context.percent
    if (p !== undefined) {
      if (p >= 85 && !hasWarned) $.ui.toast(`Contexte à ${p}% : /compact conseillé. /tokens pour le détail.`)
      hasWarned = p >= 85
    }
    const now = await $.clock.now()
    await update($, samples, smp => {
      const ctx = p === undefined ? smp.context : [...smp.context, { at: now, percent: p }].slice(-40)
      const limits: Samples['limits'] = {}
      for (const l of e.rateLimits) {
        const prev = (smp.limits[l.kind] ?? []).filter(x => now - x.at <= 2 * 60 * 60_000 && x.percent <= l.percentUsed)
        limits[l.kind] = [...prev, { at: now, percent: l.percentUsed }].slice(-60)
      }
      return { context: e.changed.includes('context') ? ctx : smp.context, limits }
    })
    let categories = (await read($, gauge)).categories
    if (e.changed.includes('context')) {
      try {
        const usage = await $.session.usage({ breakdown: 'summary' })
        categories = (usage.context.breakdown?.categories ?? [])
          .filter(c => c.kind === 'used' && c.tokens > 0)
          .sort((a, b) => b.tokens - a.tokens)
          .map(c => ({ name: c.name, tokens: c.tokens, color: c.color }))
      } catch {
        // Breakdown unavailable here: keep the last one.
      }
    }
    await update($, gauge, () => ({
      tokens: e.context.tokens,
      window: e.context.window,
      percent: e.context.percent,
      usd: e.cost?.usd,
      limits: e.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })),
      categories,
    }))

    return next(e)
  })

  // ── Icône ───────────────────────────────────────────────────────────────

  on('ui.render', { component: 'PromptHint' }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const g = await read($, gauge)
    const isOpen = (await read($, widget)).isOpen
    const p = g.percent

    // The engine's hint stays, the icon sits alone at the end of the line.
    return (
      <Box justifyContent="space-between">
        <Text dimColor wrap="truncate-end">
          {e.props.hint}
        </Text>
        <Button
          key="launcher"
          label={isOpen ? '✕' : p !== undefined && p >= 70 ? `${fillGlyph(p)} ${p}%` : fillGlyph(p)}
          plain
          dimColor={!isOpen && (p ?? 0) < 70}
          onPress={() => toggleWidget($)}
        />
      </Box>
    )
  })

  // ── Widget ──────────────────────────────────────────────────────────────

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const w = await read($, widget)
    const g = await read($, gauge)
    const list = await read($, turns)
    const m = await read($, main)
    const s = await read($, sub)
    const gs = await read($, guard)
    const smp = await read($, samples)
    const now = await $.clock.now()

    const width = Math.max(36, Math.min(72, (e.viewport?.columns ?? 60) - 2))
    const inner = width - 4
    const p = g.percent ?? 0
    const mainTurns = list.filter(t => t.agentId === undefined)
    const last = mainTurns[mainTurns.length - 1]

    const Label = (props: { children: string }) => <Text dimColor>{props.children}</Text>

    /** One figure in a small rounded box. */
    const Tile = (props: { title: string; value: string; note?: string; color?: string }) => (
      <Box borderStyle="round" borderDimColor flexDirection="column" paddingX={1} flexGrow={1}>
        <Text dimColor>{props.title}</Text>
        <Text bold color={props.color}>
          {props.value}
        </Text>
        {props.note !== undefined && <Text dimColor>{props.note}</Text>}
      </Box>
    )

    const tabs = (
      <Box gap={1}>
        {TABS.map(t => (
          <Button
            key={`tab-${t.tab}`}
            label={t.label}
            hotkey={t.hotkey}
            plain
            dimColor={w.tab !== t.tab}
            onPress={() => update($, widget, x => ({ ...x, tab: t.tab }))}
          />
        ))}
      </Box>
    )

    const gaugeRow =
      g.percent === undefined ? (
        <Label>En attente de la première réponse…</Label>
      ) : (
        <Box flexDirection="column">
          <Box justifyContent="space-between">
            <Text bold>Contexte</Text>
            <Text>
              <Text bold color={levelColor(p)}>
                {p}%
              </Text>
              <Text dimColor>
                {'  '}
                {fmt(g.tokens ?? 0)} / {fmt(g.window)}
              </Text>
            </Text>
          </Box>
          <Text color={levelColor(p)}>{bar(p, inner)}</Text>
        </Box>
      )

    const overview = (
      <Box flexDirection="column" gap={1}>
        {gaugeRow}
        <Box gap={1}>
          <Tile title="Session" value={g.usd !== undefined ? `$${g.usd.toFixed(2)}` : fmt(sumTotals(m))} note={`${m.turns} tours`} />
          <Tile title="Dernier tour" value={last ? fmt(turnTotal(last)) : '–'} note={last ? `↑ ${fmt(last.output)} sortie` : undefined} />
          <Tile
            title="Cache"
            value={m.turns ? `${cacheHit(m)}%` : '–'}
            color={m.turns ? (cacheHit(m) >= 70 ? 'success' : cacheHit(m) >= 40 ? 'warning' : 'error') : undefined}
            note="relu du cache"
          />
        </Box>
        {g.limits.length > 0 && (
          <Box flexDirection="column">
            {g.limits.map(l => (
              <Box justifyContent="space-between">
                <Label>{`Limite ${LIMIT_LABEL[l.kind] ?? l.kind}`}</Label>
                <Text>
                  <Text color={levelColor(l.percentUsed)}>{bar(l.percentUsed, 16)}</Text> {l.percentUsed}%
                </Text>
              </Box>
            ))}
          </Box>
        )}
        {forecastLines(g, smp, now).map(f => (
          <Text color="warning">◷ {f}</Text>
        ))}
        {advice(g, m, s).slice(0, 1).map(t => (
          <Text>
            <Text color="claude">➜ </Text>
            {t}
          </Text>
        ))}
      </Box>
    )

    const catTotal = g.categories.reduce((n, c) => n + c.tokens, 0)
    const context = (
      <Box flexDirection="column" gap={1}>
        {gaugeRow}
        {g.categories.length === 0 ? (
          <Label>Répartition disponible après la première réponse.</Label>
        ) : (
          <Box flexDirection="column">
            {g.categories.slice(0, 8).map(c => {
              const share = catTotal ? Math.round((c.tokens / catTotal) * 100) : 0
              return (
                <Box justifyContent="space-between">
                  <Text>
                    <Text color={c.color}>●</Text> {c.name.slice(0, 20)}
                  </Text>
                  <Text>
                    <Text color={c.color}>{bar(share, 12)}</Text>
                    <Text dimColor>
                      {' '}
                      {fmt(c.tokens).padStart(6)} {String(share).padStart(3)}%
                    </Text>
                  </Text>
                </Box>
              )
            })}
          </Box>
        )}
        {advice(g, m, s).map(t => (
          <Text>
            <Text color="claude">➜ </Text>
            {t}
          </Text>
        ))}
      </Box>
    )

    const recent = list.slice(-8).reverse()
    const tours = (
      <Box flexDirection="column" gap={1}>
        {mainTurns.length === 0 ? (
          <Label>Aucun tour terminé pour l'instant.</Label>
        ) : (
          <Box flexDirection="column">
            <Label>Tokens par tour</Label>
            <Text color="claude">{sparkline(mainTurns.slice(-inner).map(turnTotal))}</Text>
          </Box>
        )}
        {recent.length > 0 && (
          <Box flexDirection="column">
            <Box justifyContent="space-between">
              <Label>Tour</Label>
              <Label>total   entrée    cache   sortie</Label>
            </Box>
            {recent.map((t, i) => (
              <Box justifyContent="space-between">
                <Text dimColor={t.agentId !== undefined}>
                  {t.agentId !== undefined ? '↳ sous-agent' : i === 0 ? '● dernier' : '○'} <Text dimColor>{Math.round(t.durationMs / 1000)}s</Text>
                </Text>
                <Text dimColor={t.agentId !== undefined}>
                  <Text bold>{fmt(turnTotal(t)).padStart(6)}</Text>
                  {fmt(t.input + t.cacheWrite).padStart(8)}
                  <Text dimColor>{fmt(t.cacheRead).padStart(9)}</Text>
                  {fmt(t.output).padStart(9)}
                </Text>
              </Box>
            ))}
          </Box>
        )}
        <Box justifyContent="space-between">
          <Label>{`Principal ${fmt(sumTotals(m))}`}</Label>
          {s.turns > 0 && <Label>{`Sous-agents ${fmt(sumTotals(s))}`}</Label>}
        </Box>
      </Box>
    )

    const garde = (
      <Box flexDirection="column" gap={1}>
        <Box justifyContent="space-between">
          <Text>
            Garde-fou de lecture{' '}
            <Text bold color={gs.isOn ? 'success' : 'inactive'}>
              {gs.isOn ? '● actif' : '○ coupé'}
            </Text>
          </Text>
          <Button
            key="guard-toggle"
            label={gs.isOn ? 'Couper' : 'Activer'}
            hotkey="g"
            onPress={() => update($, guard, x => ({ ...x, isOn: !x.isOn }))}
          />
        </Box>
        <Box gap={1}>
          <Tile title="Lectures retenues" value={String(gs.big)} />
          <Tile title="Relectures évitées" value={String(gs.reread)} />
          <Tile title="Épargnés" value={`≈ ${fmt(Math.round(gs.savedBytes / 4))}`} color="success" />
        </Box>
        <Label>
          Lecture intégrale toujours possible : Claude relance la même lecture, lit par tranches, ou tu écris « en entier » /
          « relecture totale » dans ta demande.
        </Label>
      </Box>
    )

    const body = w.tab === 'contexte' ? context : w.tab === 'tours' ? tours : w.tab === 'garde' ? garde : overview

    return (
      <Box borderStyle="round" borderColor="claude" flexDirection="column" paddingX={1} width={width} gap={1}>
        <Box justifyContent="space-between">
          <Text bold color="claude">
            ◆ Tokens
          </Text>
          {tabs}
        </Box>
        {body}
        <Text dimColor>1-4 onglets · Échap ou /tokens pour fermer</Text>
      </Box>
    )
  })
}
