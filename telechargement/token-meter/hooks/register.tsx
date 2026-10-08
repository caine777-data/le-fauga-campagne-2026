import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Gauge, GuardStats, Samples, Totals, TurnRecord } from '../types'
import { duration, limitEta, turnsUntil } from './forecast'
import { forgetLoop, judgeRead, readKey, wantsFullRead } from './guard'
import type { GuardMemory } from './guard'

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
const bandHidden = atom({ plugin: 'token-meter', key: 'bandHidden' } as const, 0)

const COMPACT_HINT =
  'Garde : les décisions prises, les fichiers et chapitres en cours avec leur état, les consignes de style ' +
  "données par l'utilisateur, la prochaine étape. Jette : le contenu brut des fichiers lus et des sorties " +
  "d'outils déjà exploitées (garde seulement leurs conclusions)."

/** The forecast lines the figures support: context and each rate-limit window. */
export const forecastLines = (g: Gauge, smp: Samples, now: number): string[] => {
  const out: string[] = []
  const p = g.percent ?? 0
  const target = p < 70 ? 70 : 85
  const n = turnsUntil(smp.context, target)
  if (n !== undefined) out.push(`${target} % de contexte dans ~${n} tour${n > 1 ? 's' : ''}`)
  for (const l of g.limits) {
    const eta = limitEta(smp.limits[l.kind] ?? [], now, l.resetsAt)
    if (eta !== undefined) out.push(`limite ${LIMIT_LABEL[l.kind] ?? l.kind} atteinte dans ~${duration(eta)}`)
  }
  return out
}

const SPARK = '▁▂▃▄▅▆▇█'

/** 1234 → "1.2k", 1234567 → "1.23M". */
export const fmt = (n: number): string =>
  n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${n}`

export const bar = (percent: number, width: number): string => {
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)))
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

export const sparkline = (values: number[]): string => {
  const max = Math.max(1, ...values)
  return values
    .map(v => SPARK[Math.min(SPARK.length - 1, Math.floor((v / max) * (SPARK.length - 1)))])
    .join('')
}

export const turnTotal = (t: TurnRecord): number =>
  t.input + t.cacheRead + t.cacheWrite + t.output

const sumTotals = (t: Totals): number => t.input + t.cacheRead + t.cacheWrite + t.output

/** Share of input tokens served by the prompt cache. */
const cacheHit = (t: Totals): number => {
  const inSide = t.input + t.cacheRead + t.cacheWrite
  return inSide === 0 ? 0 : Math.round((t.cacheRead / inSide) * 100)
}

const levelColor = (percent: number): string =>
  percent >= 85 ? 'error' : percent >= 60 ? 'warning' : 'success'

const LIMIT_LABEL: Record<string, string> = { five_hour: '5h', seven_day: '7j', spend_limit: 'budget' }

const statusLine = (g: Gauge, last: TurnRecord | undefined): string => {
  const parts: string[] = []
  if (g.percent !== undefined) {
    parts.push(`ctx ${bar(g.percent, 10)} ${g.percent}% (${fmt(g.tokens ?? 0)}/${fmt(g.window)})`)
  }
  if (last) parts.push(`dernier tour ${fmt(turnTotal(last))} (↑${fmt(last.output)})`)
  if (g.usd !== undefined) parts.push(`$${g.usd.toFixed(2)}`)
  for (const l of g.limits) parts.push(`${LIMIT_LABEL[l.kind] ?? l.kind} ${l.percentUsed}%`)
  return parts.join(' · ')
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

/** Why a main-loop turn stands out against the ones before it, if it does. */
export const spikeNote = (rec: TurnRecord, before: TurnRecord[]): string | undefined => {
  if (before.length < 5) return undefined
  const typical = median(before.slice(-20).map(turnTotal))
  const total = turnTotal(rec)
  if (typical === 0 || total < 3 * typical || total < 20_000) return undefined
  const why =
    rec.cacheWrite > rec.cacheRead
      ? 'surtout du cache réécrit (pause trop longue ou contexte modifié ?)'
      : rec.output > total / 3
        ? 'surtout de la sortie (réponse ou réécriture longue)'
        : 'surtout de la lecture (gros fichier ou résultat d\'outil)'
  return `Pic : ${fmt(total)} tokens sur ce tour (×${Math.round(total / typical)} l'habituel), ${why}.`
}

/** The few actionable hints the figures support right now, most urgent first. */
export const advice = (g: Gauge, m: Totals, s: Totals): string[] => {
  const out: string[] = []
  const p = g.percent ?? 0
  if (p >= 85) out.push(`Contexte à ${p}% : /compact maintenant (en disant quoi garder), ou /clear si la tâche est finie.`)
  else if (p >= 70) out.push(`Contexte à ${p}% : prévois un /compact avec consigne avant la prochaine grosse étape.`)

  const top = g.categories[0]
  const used = g.categories.reduce((n, c) => n + c.tokens, 0)
  if (top && used > 0 && top.tokens / used >= 0.4) {
    const name = top.name.toLowerCase()
    const hint = name.includes('message')
      ? '/clear entre tâches sans lien, après avoir noté l\'acquis dans un fichier.'
      : name.includes('mcp')
        ? 'désactive les connecteurs MCP inutiles pour ce projet.'
        : name.includes('skill')
          ? 'retire les skills que tu n\'utilises pas : leurs descriptions sont relues à chaque tour.'
          : name.includes('memory')
            ? 'raccourcis CLAUDE.md ; garde le détail dans des fichiers lus à la demande.'
            : name.includes('tool')
              ? 'outillage permanent lourd : allège connecteurs et plugins.'
              : undefined
    if (hint) out.push(`${top.name} = ${Math.round((top.tokens / used) * 100)}% du contexte : ${hint}`)
  }

  if (m.turns >= 3 && m.input + m.cacheRead + m.cacheWrite > 50_000 && cacheHit(m) < 50) {
    out.push(`Cache à ${cacheHit(m)}% : évite de modifier CLAUDE.md/skills en cours de session et les longues pauses sur un gros contexte.`)
  }
  const sTotal = sumTotals(s)
  if (sTotal > 0 && sTotal > sumTotals(m)) {
    out.push('Les sous-agents consomment plus que le fil principal : délègue seulement les balayages larges.')
  }
  for (const l of g.limits) {
    if (l.percentUsed >= 80) out.push(`Limite ${LIMIT_LABEL[l.kind] ?? l.kind} à ${l.percentUsed}% : modèle plus léger pour les tâches mécaniques.`)
  }
  return out.slice(0, 4)
}

async function refreshStatus($: EngineInterface): Promise<void> {
  const g = await read($, gauge)
  const list = await read($, turns)
  const last = [...list].reverse().find(t => t.agentId === undefined)
  const text = statusLine(g, last)
  $.ui.status(text === '' ? undefined : text)
}

export const register: Register = on => {
  const mem: GuardMemory = { seen: new Map(), held: new Set() }
  const heldBig = new Map<string, number>()
  let isFullReadTurn = false

  on('prompt.submit', ($, e, next) => {
    isFullReadTurn = wantsFullRead(e.text)
    if (isFullReadTurn) $.ui.toast('token-meter : lecture intégrale demandée, garde-fou de taille suspendu pour ce tour.')

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
    if (e.agentId === undefined && e.trigger !== 'precompute') await update($, bandHidden, () => 0)

    return result
  }).catch(($, e, next) => next(e))

  on('session.end', ($, e, next) => {
    if (e.reason === 'clear') forgetLoop(mem, undefined)

    return next(e)
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tokens',
      description: 'Ouvre le panneau de consommation de tokens',
    })
    await $.command.register({
      name: 'tokens-reset',
      description: "Remet à zéro l'historique de tokens du panneau",
    })
    await $.command.register({
      name: 'tokens-garde',
      description: 'Active ou coupe le garde-fou de lecture (grosses lectures, relectures)',
    })
    await $.command.register({
      name: 'tokens-conseils',
      description: 'Diagnostic rapide : quoi faire pour économiser des tokens maintenant',
    })
    await refreshStatus($)

    return next(e)
  })

  on('command.run', { command: 'tokens-conseils' }, async $ => {
    const tips = advice(await read($, gauge), await read($, main), await read($, sub))
    const body = tips.length === 0 ? 'Rien à signaler : la consommation est saine.' : tips.map(t => `• ${t}`).join('\n')

    return { text: `${body}\nPour un diagnostic détaillé, demande à Claude d'utiliser la skill economie-tokens.` }
  })

  on('command.run', { command: 'tokens-garde' }, async $ => {
    const g = await update($, guard, s => ({ ...s, isOn: !s.isOn }))

    return {
      text: g.isOn
        ? 'Garde-fou de lecture activé.'
        : 'Garde-fou de lecture coupé : Claude peut tout lire librement. /tokens-garde pour le réactiver.',
    }
  })

  on('command.run', { command: 'tokens' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Tokens' })

    return { text: 'Panneau Tokens ouvert.' }
  })

  on('command.run', { command: 'tokens-reset' }, async $ => {
    await update($, turns, () => [])
    await update($, main, () => ZERO)
    await update($, sub, () => ZERO)
    await refreshStatus($)

    return { text: 'Historique de tokens remis à zéro.' }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const usage = e.usage ?? result.usage
    if (usage) {
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
        const note = spikeNote(rec, before)
        if (note) $.ui.toast(note)
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
      await refreshStatus($)
    }

    return result
  })

  let alerted = 0

  on('session.measure', async ($, e, next) => {
    const p = e.context.percent
    if (p !== undefined) {
      const level = p >= 85 ? 85 : p >= 70 ? 70 : 0
      if (level > alerted) {
        $.ui.toast(
          level === 85
            ? `Contexte à ${p}% : /compact maintenant (dis quoi garder) ou /clear.`
            : `Contexte à ${p}% : pense à /compact avec consigne. /tokens-conseils pour le détail.`,
        )
      }
      alerted = level
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
    await refreshStatus($)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const g = await read($, gauge)
    const p = g.percent ?? 0
    const level = p >= 85 ? 85 : p >= 70 ? 70 : 0
    if (e.props.hasSurvey || level === 0 || (await read($, bandHidden)) >= level) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const ahead = forecastLines(g, await read($, samples), await $.clock.now())

    return (
      <Box flexDirection="column">
        <Text>
          <Text color={levelColor(p)} bold>
            ⚠ Contexte {p}%
          </Text>{' '}
          <Text color={levelColor(p)}>{bar(p, 12)}</Text>
          {ahead.length > 0 && <Text dimColor> · {ahead.join(' · ')}</Text>}
        </Text>
        <Box>
          {!e.props.isWorking && (
            <Button
              key="compact"
              label="Compacter"
              onPress={async () => {
                $.ui.toast('Compaction en cours…')
                await $.session.compact({ instructions: COMPACT_HINT })
              }}
            />
          )}
          <Text> </Text>
          <Button key="details" label="Détails" onPress={() => $.ui.open({ id: PANE, title: 'Tokens' })} />
          <Text> </Text>
          <Button key="hide" label="Masquer" onPress={() => update($, bandHidden, () => level)} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const g = await read($, gauge)
    const list = await read($, turns)
    const m = await read($, main)
    const s = await read($, sub)
    const cols = Math.max(30, (e.viewport?.columns ?? 60) - 4)
    const rows = Math.max(6, (e.viewport?.rows ?? 30) - 4)
    const barWidth = Math.max(10, Math.min(40, cols - 22))
    const mainTurns = list.filter(t => t.agentId === undefined)
    const recent = list.slice(-Math.max(3, rows - 24)).reverse()
    const tips = advice(g, m, s)
    const ahead = forecastLines(g, await read($, samples), await $.clock.now())
    const gs: GuardStats = await read($, guard)
    const catTotal = g.categories.reduce((n, c) => n + c.tokens, 0)

    return (
      <Box flexDirection="column">
        <Text bold>Fenêtre de contexte</Text>
        {g.percent === undefined ? (
          <Text dimColor>Pas encore de réponse mesurée.</Text>
        ) : (
          <Text>
            <Text color={levelColor(g.percent)}>{bar(g.percent, barWidth)}</Text> {g.percent}%{' '}
            <Text dimColor>
              {fmt(g.tokens ?? 0)} / {fmt(g.window)}
            </Text>
          </Text>
        )}
        {g.categories.slice(0, 6).map(c => (
          <Text>
            {'  '}
            <Text color={c.color}>■</Text> {c.name.padEnd(18).slice(0, 18)}{' '}
            {fmt(c.tokens).padStart(7)}{' '}
            <Text dimColor>{catTotal ? Math.round((c.tokens / catTotal) * 100) : 0}%</Text>
          </Text>
        ))}

        <Text> </Text>
        <Text bold>Session</Text>
        {g.usd !== undefined && <Text>Coût : ${g.usd.toFixed(3)}</Text>}
        {g.limits.map(l => (
          <Text>
            Limite {LIMIT_LABEL[l.kind] ?? l.kind} :{' '}
            <Text color={levelColor(l.percentUsed)}>{bar(l.percentUsed, 10)}</Text> {l.percentUsed}%
            {l.resetsAt && <Text dimColor> (reset {l.resetsAt.slice(11, 16)})</Text>}
          </Text>
        ))}
        <Text>
          Principal ({m.turns} tours) : <Text bold>{fmt(sumTotals(m))}</Text>
        </Text>
        <Text dimColor>
          {'  '}entrée {fmt(m.input)} · cache lu {fmt(m.cacheRead)} · cache écrit {fmt(m.cacheWrite)} · sortie{' '}
          {fmt(m.output)}
        </Text>
        <Text dimColor>{'  '}taux de cache : {cacheHit(m)}%</Text>
        {s.turns > 0 && (
          <Text>
            Sous-agents ({s.turns} tours) : <Text bold>{fmt(sumTotals(s))}</Text>{' '}
            <Text dimColor>(sortie {fmt(s.output)})</Text>
          </Text>
        )}

        {ahead.length > 0 && (
          <Box flexDirection="column">
            <Text> </Text>
            <Text bold>Prévisions</Text>
            {ahead.map(t => (
              <Text>
                ⏱ <Text color="warning">{t}</Text>
              </Text>
            ))}
          </Box>
        )}

        <Text> </Text>
        <Text bold>
          Garde-fou de lecture{' '}
          <Text color={gs.isOn ? 'success' : 'inactive'}>{gs.isOn ? 'actif' : 'coupé'}</Text>
        </Text>
        <Text dimColor>
          {'  '}{gs.big} grosse(s) lecture(s) retenue(s) · {gs.reread} relecture(s) évitée(s) · {gs.overridden}{' '}
          forcée(s) · ≈ {fmt(Math.round(gs.savedBytes / 4))} tokens épargnés
        </Text>

        {tips.length > 0 && (
          <Box flexDirection="column">
            <Text> </Text>
            <Text bold color="warning">Conseils</Text>
            {tips.map(t => (
              <Text>• {t}</Text>
            ))}
          </Box>
        )}

        {mainTurns.length > 0 && (
          <Box flexDirection="column">
            <Text> </Text>
            <Text bold>Tokens par tour</Text>
            <Text color="claude">{sparkline(mainTurns.slice(-cols).map(turnTotal))}</Text>
          </Box>
        )}

        <Text> </Text>
        <Text bold>Derniers tours</Text>
        {recent.length === 0 && <Text dimColor>Aucun tour terminé.</Text>}
        {recent.map(t => (
          <Text dimColor={t.agentId !== undefined}>
            {t.agentId !== undefined ? '↳ ' : '• '}
            {fmt(turnTotal(t)).padStart(7)} <Text dimColor>↓{fmt(t.input + t.cacheWrite).padStart(6)}</Text>{' '}
            <Text dimColor>⚡{fmt(t.cacheRead).padStart(6)}</Text> ↑{fmt(t.output).padStart(6)}{' '}
            <Text dimColor>{(t.durationMs / 1000).toFixed(0)}s</Text>
          </Text>
        ))}
        <Text dimColor>↓ entrée+cache écrit · ⚡ cache lu · ↑ sortie · ↳ sous-agent</Text>
      </Box>
    )
  })
}
