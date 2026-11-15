/**
 * Couverture de lecture : quelles lignes de quel fichier chaque agent a
 * réellement reçues par Read. Sert au relecteur de roman à prouver qu'il a
 * tout lu, et à retrouver ce qu'il a sauté.
 */

/** Read sans limit rend au plus 2 000 lignes. */
export const READ_DEFAULT_LIMIT = 2000

export type Interval = [number, number]

/** Lignes (1-based, inclusives) qu'un Read a rendues, avant plafonnement au total. */
export const readInterval = (offset: number | undefined, limit: number | undefined): Interval => {
  const start = Math.max(1, offset ?? 1)
  return [start, start + Math.max(1, limit ?? READ_DEFAULT_LIMIT) - 1]
}

export const merge = (intervals: readonly Interval[]): Interval[] => {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0])
  const out: Interval[] = []
  for (const [s, e] of sorted) {
    const last = out[out.length - 1]
    if (last && s <= last[1] + 1) last[1] = Math.max(last[1], e)
    else out.push([s, e])
  }
  return out
}

export type Coverage = { total: number; read: number; missing: Interval[] }

export const coverage = (intervals: readonly Interval[], total: number): Coverage => {
  const merged = merge(intervals.map(([s, e]): Interval => [s, Math.min(e, total)]).filter(([s, e]) => s <= e))
  const missing: Interval[] = []
  let next = 1
  for (const [s, e] of merged) {
    if (s > next) missing.push([next, s - 1])
    next = e + 1
  }
  if (next <= total) missing.push([next, total])
  const read = merged.reduce((n, [s, e]) => n + e - s + 1, 0)
  return { total, read, missing }
}

const span = ([s, e]: Interval): string => (s === e ? `${s}` : `${s}–${e}`)

export const coverageLine = (file: string, c: Coverage): string =>
  c.missing.length === 0
    ? `✓ ${file} : ${c.total}/${c.total} lignes lues`
    : `✗ ${file} : ${c.read}/${c.total} lignes lues ; NON LUES : ${c.missing.map(span).join(', ')}`

/** Mémoire : agent → fichier → intervalles lus. */
export type ReadLog = Map<string, Map<string, Interval[]>>

export const logRead = (log: ReadLog, agent: string, file: string, iv: Interval): void => {
  const files = log.get(agent) ?? new Map<string, Interval[]>()
  log.set(agent, files)
  files.set(file, [...(files.get(file) ?? []), iv])
}

export const countLines = (text: string): number =>
  text.length === 0 ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
