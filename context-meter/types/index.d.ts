export type ContextMeterUsage = {
  tokens?: number
  window: number
  percent?: number
  approx?: boolean
  limits: { label: string; percent: number }[]
  usd?: number
} | null

export type ContextMeterModel = { name: string; effort?: string } | null

// hit: share of the last main request's input read from the cache; left: whole minutes until it expires
export type ContextMeterCache = { hit: number; left: number } | null

// the cold-cache pane: what the next prompt would rewrite and what it would cost at list price
export type ContextMeterCold = {
  tokens: number
  idleMin: number
  model: string
  price: number
  rewriteUsd: number
  compactUsd: number
} | null

declare module 'claude-code' {
  interface PluginState {
    'context-meter': { usage: ContextMeterUsage; model: ContextMeterModel; cache: ContextMeterCache; cold: ContextMeterCold }
  }
}

// auto-effort's own declaration, repeated so the band can read the effort it picked
declare module 'claude-code' {
  interface PluginState {
    'auto-effort': { effort: string | null }
  }
}
