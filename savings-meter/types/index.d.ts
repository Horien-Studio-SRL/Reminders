// the other mods' own declarations, repeated so the ledger can read what they publish
declare module 'claude-code' {
  interface PluginState {
    'auto-effort': { effort: string | null }
    'output-trimmer': { trimmed: number }
    // our own: output-trimmer's count at the last compaction
    'savings-meter': { base: number }
    'subagent-router': { routed: string[] }
  }
}
export type Contract = never
