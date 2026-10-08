export type Sample = { at: number; percent: number }

/** Average context growth per main turn over the recent climb (drops = compaction, ignored). */
export const turnsUntil = (history: Sample[], target: number): number | undefined => {
  const last = history[history.length - 1]
  if (!last || last.percent >= target) return undefined
  const deltas: number[] = []
  for (let i = history.length - 1; i > 0 && deltas.length < 6; i--) {
    const d = history[i]!.percent - history[i - 1]!.percent
    if (d < 0) break
    deltas.push(d)
  }
  if (deltas.length < 2) return undefined
  const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length
  if (avg <= 0.2) return undefined
  return Math.max(1, Math.ceil((target - last.percent) / avg))
}

/**
 * When a rate-limit window reaches 100 % at the pace of the last hour, in ms
 * from now; undefined when too few readings, not climbing, or after the reset.
 */
export const limitEta = (samples: Sample[], now: number, resetsAt?: string): number | undefined => {
  const recent = samples.filter(s => now - s.at <= 60 * 60_000)
  const first = recent[0]
  const last = recent[recent.length - 1]
  if (!first || !last || last.at - first.at < 5 * 60_000) return undefined
  const slope = (last.percent - first.percent) / (last.at - first.at)
  if (slope <= 0 || last.percent >= 100) return undefined
  const eta = (100 - last.percent) / slope - (now - last.at)
  const reset = resetsAt ? Date.parse(resetsAt) - now : Infinity
  return eta > 0 && eta < reset ? eta : undefined
}

export const duration = (ms: number): string => {
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return `${h} h ${String(min % 60).padStart(2, '0')}`
}
