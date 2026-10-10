import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, TurnStepResult } from 'claude-code'
import type { Approval, Level, Run, RunTask } from '../types/index'

// Agent types whose work a cheaper model does as well; any other type keeps its own model.
const ROUTES: Record<string, string> = { Explore: 'haiku', 'general-purpose': 'sonnet' }
const RANK = ['haiku', 'sonnet', 'opus']
// ponytail: a model id naming none of the three ranks as unknown, so the route is skipped
const rank = (model: string) => RANK.findIndex(m => model.toLowerCase().includes(m))

let enabled = true
// numbers the slot an orchestration agent holds until its spawn returns an id
let reserved = 0
// savings-meter reads this to price the routed agents' tokens
const routedAtom = atom({ plugin: 'subagent-router', key: 'routed' } as const, [])
const runAtom = atom({ plugin: 'subagent-router', key: 'run' } as const, null)
const tasksAtom = atom({ plugin: 'subagent-router', key: 'tasks' } as const, [])
const agentsAtom = atom({ plugin: 'subagent-router', key: 'agents' } as const, [])

// /orchestrate: each level sets the model and effort of the three roles the orchestrator spawns.
type Role = 'scout' | 'worker' | 'reviewer'
const ROLES: Role[] = ['scout', 'worker', 'reviewer']
const LEVELS: Level[] = ['low', 'mid', 'high', 'xhigh']
const TABLE: Record<Level, Record<Role, [string, string]>> = {
  low: { scout: ['haiku', 'low'], worker: ['sonnet', 'medium'], reviewer: ['sonnet', 'high'] },
  mid: { scout: ['haiku', 'low'], worker: ['sonnet', 'high'], reviewer: ['opus', 'medium'] },
  high: { scout: ['haiku', 'low'], worker: ['opus', 'medium'], reviewer: ['opus', 'high'] },
  xhigh: { scout: ['haiku', 'medium'], worker: ['opus', 'high'], reviewer: ['opus', 'high'] },
}
const APPROVALS: Approval[] = ['plan', 'step', 'off']
const ROLE_SPECS: Record<Role, { description: string; prompt: string; disallowedTools: string[] }> = {
  scout: {
    description: 'Orchestration scout: reads code and answers questions about it, never edits',
    prompt: 'You are a scout for an orchestrator. Read the code the brief points at and answer its questions with file paths and line numbers. Do not edit files. Keep the answer under 300 words: facts, not advice.',
    disallowedTools: ['Edit', 'Write', 'NotebookEdit', 'Agent'],
  },
  worker: {
    description: 'Orchestration worker: completes one task from a contract',
    prompt: 'You are a worker for an orchestrator. You get one task as a contract: what to do, the files you own, a check command and a deliverable format. Edit only the files you own; if the task needs another file, stop and say which and why. Run the check command before you finish. Reply in the deliverable format only: files changed, the check result, open questions.',
    disallowedTools: ['Agent'],
  },
  reviewer: {
    description: 'Orchestration reviewer: checks one task\'s diff against its contract, never edits',
    prompt: 'You are a reviewer for an orchestrator. You get a contract and the task\'s diff, not the worker\'s reasoning. Find bugs that break the contract or would fail in use: each with file:line, what goes wrong and when. Most severe first. Do not edit files. If you find nothing, say so in one line.',
    disallowedTools: ['Edit', 'Write', 'NotebookEdit', 'Agent'],
  },
}
const row = (level: Level) => ROLES.map(r => `${r} ${TABLE[level][r].join('-')}`).join(', ')
const roleOf = (type: string) => (type.startsWith('subagent-router:') ? (type.slice(16) as Role) : undefined)

// The orchestrator calls this where the skill says to wait; the pane shows Approve only then.
const APPROVAL_TOOL = 'mcp__subagent-router__await_approval'
// The run's task list, the mod's own: TaskCreate isn't in every session's toolset.
const TASKS_TOOL = 'mcp__subagent-router__update_tasks'
type TaskChange = { id: string; subject?: string; status?: string; blockedBy?: string[]; contract?: string }
const registerRoles = ($: EngineInterface, level: Level) =>
  Promise.all([
    ...ROLES.map(r => {
      const [model, effort] = TABLE[level][r]
      return $.agent.register({ name: r, ...ROLE_SPECS[r], model, effort })
    }),
    $.tool.register({
      name: 'await_approval',
      description: 'Orchestration only: ask the person to approve the plan or the next step. Shows an Approve button in the Orchestrate pane. End your turn right after calling it.',
      inputSchema: { type: 'object', properties: { summary: { type: 'string', description: 'What needs approval, in one line' } }, required: ['summary'] },
      isDeferred: false,
    }),
    $.tool.register({
      name: 'update_tasks',
      description: 'Orchestration only: the run\'s task list, drawn in the Orchestrate pane. Each entry adds a task under a new id or changes the given fields of one already there; status "deleted" removes it. Call it with no tasks to read the list back with each contract.',
      inputSchema: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Short id, such as "1"' },
                subject: { type: 'string', description: 'A title of a few words for the pane' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'deleted'] },
                blockedBy: { type: 'array', items: { type: 'string' }, description: 'Ids of the tasks this one waits for; replaces the earlier list' },
                contract: { type: 'string', description: 'Goal, Owns, Check, Review, Deliverable' },
              },
              required: ['id'],
            },
          },
        },
      },
      isDeferred: false,
    }),
  ])

const kickoff = (run: Run) => {
  const next = LEVELS[LEVELS.indexOf(run.level) + 1]
  const escalate = next ? `spawn the worker again with model "${TABLE[next].worker[0]}" and effort "${TABLE[next].worker[1]}"` : 'there is no higher level, so ask the person'
  return [
    'Orchestrate the task below with the subagent-router:orchestrating skill.',
    `Level ${run.level}: ${row(run.level)}. Spawn them as subagent-router:scout, subagent-router:worker and subagent-router:reviewer without a model or effort.`,
    `When a task fails its check twice: ${escalate}.`,
    `At most ${run.workers} agents at once. Approval: ${run.approval}.`,
    '',
    `Task: ${run.task}`,
  ].join('\n')
}

// API dollars per million tokens: input, output, cache read, as savings-meter prices them.
// ponytail: copied from savings-meter, cache writes at twice the input price
const PRICES: Record<string, [number, number, number]> = { opus: [4, 20, 0.2], sonnet: [2, 10, 0.2], haiku: [0.1, 0.5, 0.01] }
const cost = (model: string, u: NonNullable<TurnStepResult['usage']>) => {
  const p = Object.entries(PRICES).find(([family]) => model.includes(family))?.[1]
  if (!p) return 0
  return (u.input_tokens * p[0] + u.cache_creation_input_tokens * p[0] * 2 + u.cache_read_input_tokens * p[2] + u.output_tokens * p[1]) / 1e6
}
const usd = (n: number) => `$${n.toFixed(2)}`

const set = ($: EngineInterface, change: Partial<Run>) => update($, runAtom, r => (r ? { ...r, ...change } : r))

const PANE = 'orchestrate'
const approve = async ($: EngineInterface) => {
  await set($, { awaiting: '' })
  await $.prompt.submit({ text: 'Approved. Go ahead.', asUser: true })
}

const stop = async ($: EngineInterface) => {
  const spent = (await read($, agentsAtom)).reduce((sum, a) => sum + a.usd, 0)
  await update($, runAtom, () => null)
  await update($, tasksAtom, () => [])
  await update($, agentsAtom, () => [])
  await $.ui.close({ id: PANE })
  return `Orchestration stopped. Its agents spent about ${usd(spent)} at API prices.`
}

const start = async ($: EngineInterface) => {
  const run = await update($, runAtom, r => (r ? { ...r, started: true } : r))
  if (!run) return
  try {
    await registerRoles($, run.level)
    if (run.level === 'xhigh') $.ui.toast('xhigh: consider /model fable for the orchestrator')
    const sent = await $.prompt.submit({ text: kickoff(run) })
    if (sent.drop !== undefined) throw new Error(sent.drop)
  }
  catch (err) {
    // no orchestrator got the kickoff, so the pane goes back to its settings
    await set($, { started: false })
    $.ui.toast(`Could not start: ${err instanceof Error ? err.message : err}`)
  }
}


export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'subagent-router', description: 'Show, or turn on or off, routing subagents to cheaper models', argumentHint: '[on | off]' })
    await $.command.register({ name: 'orchestrate', description: 'Split a big task across scout, worker and reviewer subagents', argumentHint: '<task> | <level> | stop' })
    // a reload drops the plugin's agent types; a run in progress needs them back
    const run = await read($, runAtom)
    if (run?.started) await registerRoles($, run.level)
    return next(e)
  })

  on('command.run', { command: 'subagent-router' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'on' || arg === 'off') enabled = arg === 'on'
    else if (arg) return { text: `Unknown argument "${arg}". Use on or off.` }
    const routes = Object.entries(ROUTES).map(([type, model]) => `${type} on ${model}`).join(', ')
    return { text: enabled ? `subagent-router is on: ${routes}.` : 'subagent-router is off.' }
  })

  on('command.run', { command: 'orchestrate' }, async ($, e) => {
    const arg = e.args.trim()
    const run = await read($, runAtom)
    if (arg === 'stop') return { text: run ? await stop($) : 'No orchestration is running.' }
    if (run?.started && LEVELS.includes(arg as Level)) {
      await set($, { level: arg as Level })
      await registerRoles($, arg as Level)
      return { text: `Level ${arg}: ${row(arg as Level)}. Agents spawned from the next turn on use it.` }
    }
    if (!arg && !run) return { text: 'Usage: /orchestrate <task>' }
    if (arg && run?.started) return { text: 'An orchestration is running. /orchestrate stop ends it first.' }
    if (arg) {
      await update($, runAtom, () => ({ task: arg, level: run?.level ?? 'mid', workers: run?.workers ?? 3, approval: run?.approval ?? 'plan', started: false, warned: false, awaiting: '', showAgents: false }))
      await update($, tasksAtom, () => [])
      await update($, agentsAtom, () => [])
    }
    await $.ui.open({ id: PANE, title: 'Orchestrate', focus: true })
    return { text: arg ? 'Pick the settings in the Orchestrate pane, then press Start.' : 'Orchestrate pane opened.' }
  })

  // A model Claude named in the call, a fork or a teammate is left alone; so is a route that wouldn't be cheaper than the parent.
  // An orchestration role past the worker limit is refused, and each one started is tracked for the pane.
  on('agent.spawn', async ($, e, next) => {
    const role = roleOf(e.subagentType)
    if (role) {
      const run = await read($, runAtom)
      const limit = run?.started ? run.workers : Infinity
      const running = (list: { isDone: boolean }[]) => list.filter(a => !a.isDone).length
      // count and take the slot in one write, so two spawns at once can't both pass the limit
      const slot = `pending-${reserved++}`
      const taken = await update($, agentsAtom, list => (running(list) >= limit ? list : [...list, { id: slot, role, model: '', description: e.description, isDone: false, usd: 0 }]))
      if (!taken.some(a => a.id === slot)) return { deny: `${running(taken)} orchestration agents are running and the limit is ${limit}. Wait for one to finish.` }
      const release = () => update($, agentsAtom, list => list.filter(a => a.id !== slot))
      const r = await next(e).catch(async err => {
        await release()
        throw err
      })
      const id = r.agentId
      if (id) await update($, agentsAtom, list => list.map(a => (a.id === slot ? { ...a, id, model: r.model } : a)))
      else await release()
      return r
    }
    const model = Object.hasOwn(ROUTES, e.subagentType) ? ROUTES[e.subagentType] : undefined
    const cheaper = model !== undefined && rank(model) < rank(e.parentModel)
    if (!enabled || !cheaper || e.model !== undefined || e.fork || e.isTeammate) return next(e)
    const r = await next({ ...e, model })
    const id = 'agentId' in r ? r.agentId : undefined
    if (id) await update($, routedAtom, ids => [...ids, id])
    return r
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    if (e.agentId !== undefined && result.usage) {
      const u = result.usage
      const id = e.agentId
      if ((await read($, agentsAtom)).some(a => a.id === id)) await update($, agentsAtom, list => list.map(a => (a.id === id ? { ...a, usd: a.usd + cost(u.model ?? a.model, u) } : a)))
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const id = e.agentId
    if (id !== undefined && (await read($, agentsAtom)).some(a => a.id === id)) await update($, agentsAtom, list => list.map(a => (a.id === id ? { ...a, isDone: true } : a)))
    return result
  })

  on('tool.call', { tool: TASKS_TOOL }, async ($, e) => {
    const changes = (e as { tasks?: TaskChange[] }).tasks ?? []
    const list = await update($, tasksAtom, list => changes.reduce((l, c) => {
      if (c.status === 'deleted') return l.filter(t => t.id !== c.id)
      const old = l.find(t => t.id === c.id)
      const t = { id: c.id, subject: c.subject ?? old?.subject ?? `#${c.id}`, status: c.status ?? old?.status ?? 'pending', blockedBy: c.blockedBy ?? old?.blockedBy ?? [], contract: c.contract ?? old?.contract ?? '' }
      return old ? l.map(x => (x.id === c.id ? t : x)) : [...l, t]
    }, list))
    // contracts only on a read, so each update doesn't echo them all back
    const line = (t: RunTask) => `#${t.id} ${t.status}: ${t.subject}${t.blockedBy.length ? ` (after #${t.blockedBy.join(', #')})` : ''}${changes.length || !t.contract ? '' : `\n${t.contract}`}`
    return { result: list.map(line).join('\n') || 'No tasks.' } as never
  })

  on('tool.call', { tool: APPROVAL_TOOL }, async ($, e) => {
    const summary = String((e as { summary?: unknown }).summary ?? 'the plan')
    await set($, { awaiting: summary })
    return { result: 'The Orchestrate pane now shows Approve. End your turn; the approval or the changes come as the next message.' } as never
  })

  // whatever the person sends next answers the approval
  on('turn.start', async ($, e, next) => {
    if ((await read($, runAtom))?.awaiting) await set($, { awaiting: '' })
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const used = e.rateLimits.find(l => l.kind === 'five_hour')?.percentUsed ?? 0
    const run = await read($, runAtom)
    if (run?.started && !run.warned && used >= 80) {
      await set($, { warned: true })
      $.ui.toast(`The 5-hour window is ${Math.round(used)}% used. /orchestrate low makes the rest of the run cheaper.`)
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const [run, tasks, agents] = await Promise.all([read($, runAtom), read($, tasksAtom), read($, agentsAtom)])
    if (!run) return <Text dimColor>No orchestration. /orchestrate &lt;task&gt; starts one.</Text>
    const width = Math.max(20, e.props.bodyColumns || 60)
    const fit = (text: string, n = width) => (text.length > n ? `${text.slice(0, n - 1)}…` : text)
    const pick = <T extends string>(key: string, options: T[], chosen: T, choose: (o: T) => void) => (
      <Box key={key}>
        {options.map(o => (o === chosen
          ? <Button key={`${key}-${o}`} plain onPress={choose.bind(null, o)}><Text color="cyan" bold>{`● ${o}`}</Text>{'   '}</Button>
          : <Button key={`${key}-${o}`} plain dimColor onPress={choose.bind(null, o)}>{`○ ${o}   `}</Button>))}
      </Box>
    )

    if (!run.started) {
      return (
        <Box flexDirection="column">
          <Text bold>{fit(run.task)}</Text>
          <Text dimColor>{'─'.repeat(Math.min(width, 40))}</Text>
          <Text bold>Level</Text>
          {pick('level', LEVELS, run.level, level => void set($, { level }))}
          <Text dimColor>{fit(`${row(run.level)}${run.level === 'xhigh' ? '. Consider /model fable first.' : ''}`)}</Text>
          <Text> </Text>
          <Box>
            <Text bold>Agents at once  </Text>
            <Button key="fewer" plain dimColor={run.workers === 1} onPress={() => void set($, { workers: Math.max(1, run.workers - 1) })}>−</Button>
            <Text color="cyan" bold>{` ${run.workers} `}</Text>
            <Button key="more" plain dimColor={run.workers === 8} onPress={() => void set($, { workers: Math.min(8, run.workers + 1) })}>+</Button>
          </Box>
          <Text> </Text>
          <Text bold>Approval</Text>
          {pick('approval', APPROVALS, run.approval, approval => void set($, { approval }))}
          <Text dimColor>{{ plan: 'You approve the plan once, after scouting.', step: 'You approve before every step.', off: 'No pauses.' }[run.approval]}</Text>
          <Text> </Text>
          <Box>
            <Button key="start" variant="primary" autoFocus onPress={() => void start($)}>Start</Button>
            <Text>  </Text>
            <Button key="cancel" dimColor onPress={() => void stop($)}>Cancel</Button>
          </Box>
        </Box>
      )
    }

    // The height is capped so the pane never grows over the prompt: at most SHOWN task rows, and the agents fold.
    const SHOWN = 5
    const spent = agents.reduce((sum, a) => sum + a.usd, 0)
    const done = tasks.filter(t => t.status === 'completed').length
    const allDone = tasks.length > 0 && done === tasks.length
    const label = `${done}/${tasks.length} tasks${tasks.length ? ` · ${Math.round((done / tasks.length) * 100)}%` : ''}`
    const barWidth = Math.max(10, Math.min(40, width - label.length - 1))
    const filled = tasks.length ? Math.round((done / tasks.length) * barWidth) : 0
    const running = agents.filter(a => !a.isDone)
    const slots = Array.from({ length: run.workers }, (_, i) => running[i])
    const family = (model: string) => RANK.find(m => model.includes(m)) ?? model
    // a deleted blocker no longer holds a task back
    const ready = (t: RunTask) => t.blockedBy.every(id => (tasks.find(d => d.id === id)?.status ?? 'completed') === 'completed')
    const next = tasks.find(t => t.status === 'pending' && ready(t))
    // the window starts one row above the first unfinished task
    const unfinished = tasks.findIndex(t => t.status !== 'completed')
    const from = Math.max(0, Math.min((unfinished < 0 ? tasks.length : unfinished) - 1, tasks.length - SHOWN))
    const shown = tasks.slice(from, from + SHOWN)
    const taskRow = (t: RunTask) => {
      const [icon, color] = t.status === 'completed' ? ['✓', 'green'] : t.status === 'in_progress' ? ['◐', 'yellow'] : ['○', undefined]
      const waits = t.status === 'pending' && !ready(t) ? `  after #${t.blockedBy.join(', #')}` : ''
      return (
        <Text key={`task-${t.id}`} dimColor={t.status === 'completed' || !!waits}>
          <Text color={color}>{icon}</Text> {fit(`${t.subject}${waits}`, width - 2)}
        </Text>
      )
    }
    const status = run.awaiting ? `⏸ Waiting for your approval: ${run.awaiting}`
      : !tasks.length ? '… Scouting and planning'
      : allDone ? '✓ All tasks done'
      : next ? `→ Next: ${next.subject}` : '… Working'
    const meta = `${run.level} · ${usd(spent)}`
    return (
      <Box flexDirection="column">
        <Text><Text bold>{fit(run.task, width - meta.length - 2)}</Text>  <Text color="cyan">{run.level}</Text><Text dimColor> · {usd(spent)}</Text></Text>
        <Text>
          <Text color={allDone ? 'green' : 'cyan'}>{'█'.repeat(filled)}</Text>
          <Text dimColor>{'░'.repeat(barWidth - filled)}</Text>
          <Text> {label}</Text>
        </Text>
        <Text> </Text>
        {shown.map(taskRow)}
        {tasks.length > shown.length && <Text dimColor>{`  +${tasks.length - shown.length} more`}</Text>}
        {tasks.length > 0 && <Text> </Text>}
        <Button key="agents" plain dimColor onPress={() => void set($, { showAgents: !run.showAgents })}>
          {fit(`${run.showAgents ? '▾' : '▸'} ${running.length} of ${run.workers} agents running · ${agents.length} so far`)}
        </Button>
        {run.showAgents && slots.map((a, i) => (a
          ? <Text key={`slot-${i}`}><Text color="yellow">◐</Text>{fit(` ${a.role.padEnd(8)} ${family(a.model).padEnd(6)} ${usd(a.usd).padStart(6)}  ${a.description}`, width - 1)}</Text>
          : <Text key={`slot-${i}`} dimColor>· idle</Text>))}
        <Text color={run.awaiting ? 'yellow' : allDone ? 'green' : undefined} bold={!!run.awaiting} dimColor={!run.awaiting && !allDone}>{fit(status)}</Text>
        <Text> </Text>
        <Box>
          {run.awaiting && <Button key="approve" variant="primary" autoFocus onPress={() => void approve($)}>Approve</Button>}
          {run.awaiting && <Text>  </Text>}
          <Button key="stop" dimColor onPress={() => void stop($).then(text => $.ui.toast(text))}>Stop</Button>
        </Box>
      </Box>
    )
  })
}
