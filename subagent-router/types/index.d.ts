// ids of the subagents this session started on a cheaper model
declare module 'claude-code' {
  interface PluginState {
    'subagent-router': { routed: string[] }
  }
}
export type Contract = never
