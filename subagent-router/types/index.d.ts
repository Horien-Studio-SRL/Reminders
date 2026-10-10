export type Level = 'low' | 'mid' | 'high' | 'xhigh'
export type Approval = 'plan' | 'step' | 'off'
// started is false while the pane still shows the settings; awaiting is what the orchestrator asked approval for, '' when nothing;
// showAgents unfolds the agent rows, folded by default since Claude Code lists running agents itself;
// startedAt is when Start was pressed and finishedAt when the last task completed, in epoch ms, 0 when not yet
export type Run = { task: string; level: Level; workers: number; approval: Approval; started: boolean; warned: boolean; awaiting: string; showAgents: boolean; startedAt: number; finishedAt: number }
export type RunTask = { id: string; subject: string; status: string; blockedBy: string[]; contract: string }
export type RunAgent = { id: string; role: string; model: string; description: string; isDone: boolean; usd: number }

declare module 'claude-code' {
  interface PluginState {
    'subagent-router': {
      // ids of the subagents this session started on a cheaper model
      routed: string[]
      // the /orchestrate run, null when none
      run: Run | null
      tasks: RunTask[]
      agents: RunAgent[]
    }
  }
}
