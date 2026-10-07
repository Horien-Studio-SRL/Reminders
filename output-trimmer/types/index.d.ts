// tokens cut from Bash output this session, at about 4 characters a token
declare module 'claude-code' {
  interface PluginState {
    'output-trimmer': { trimmed: number }
  }
}
export type Contract = never
