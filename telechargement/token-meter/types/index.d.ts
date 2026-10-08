export type TurnRecord = {
  id: string
  /** Subagent id, absent on the main loop. */
  agentId?: string
  model: string
  durationMs: number
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
}

export type Totals = {
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
  turns: number
}

export type Category = { name: string; tokens: number; color: string }

export type Gauge = {
  tokens?: number
  window: number
  percent?: number
  usd?: number
  limits: { kind: string; percentUsed: number; resetsAt?: string }[]
  categories: Category[]
}

export type GuardStats = {
  isOn: boolean
  /** Big whole-file reads held. */
  big: number
  /** Unchanged re-reads held. */
  reread: number
  /** Held calls Claude repeated, so let through. */
  overridden: number
  /** Bytes of the held big reads never repeated (estimate of what was saved). */
  savedBytes: number
}

export type Sample = { at: number; percent: number }

export type Samples = {
  context: Sample[]
  limits: Record<string, Sample[]>
}

export type Tab = 'apercu' | 'contexte' | 'tours' | 'garde'

export type Widget = { isOpen: boolean; tab: Tab }

declare module 'claude-code' {
  interface PluginState {
    'token-meter': {
      turns: TurnRecord[]
      main: Totals
      sub: Totals
      gauge: Gauge
      guard: GuardStats
      samples: Samples
      /** The widget: open or not, and the tab shown. */
      widget: Widget
    }
  }
}
