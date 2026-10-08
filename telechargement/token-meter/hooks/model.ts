import type { Gauge, Samples, Totals, TurnRecord } from '../types'
import { duration, limitEta, turnsUntil } from './forecast'

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

export const sumTotals = (t: Totals): number => t.input + t.cacheRead + t.cacheWrite + t.output

/** Share of input tokens served by the prompt cache. */
export const cacheHit = (t: Totals): number => {
  const inSide = t.input + t.cacheRead + t.cacheWrite
  return inSide === 0 ? 0 : Math.round((t.cacheRead / inSide) * 100)
}

export const levelColor = (percent: number): string =>
  percent >= 85 ? 'error' : percent >= 60 ? 'warning' : 'success'

export const LIMIT_LABEL: Record<string, string> = { five_hour: '5h', seven_day: '7j', spend_limit: 'budget' }


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

