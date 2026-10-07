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

declare module 'claude-code' {
  interface PluginState {
    'context-meter': { usage: ContextMeterUsage; model: ContextMeterModel; cache: ContextMeterCache }
  }
}
