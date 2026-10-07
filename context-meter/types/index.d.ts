export type ContextMeterUsage = {
  tokens?: number
  window: number
  percent?: number
  approx?: boolean
  limits: { label: string; percent: number }[]
  usd?: number
} | null

export type ContextMeterModel = { name: string; effort?: string } | null

declare module 'claude-code' {
  interface PluginState {
    'context-meter': { usage: ContextMeterUsage; model: ContextMeterModel }
  }
}
