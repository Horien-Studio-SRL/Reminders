// the effort the last main-thread step ran at, with " (pinned)" or " (budget)"; null while the mod stands aside
export type AutoEffortEffort = string | null

declare module 'claude-code' {
  interface PluginState {
    'auto-effort': { effort: AutoEffortEffort }
  }
}
