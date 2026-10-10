import { test, expect } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type Engine = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]

// the engine beneath the plugin: records the model each spawn was started with
const engine = (on: On) => {
  const got: unknown[] = []
  on('agent.spawn', (_$, e) => {
    got.push(e.model)
    return { model: e.model ?? 'inherit' } as never
  })
  return got
}

const spawn = ($: Engine, subagentType: string, parentModel = 'claude-opus-5-5', extra = {}) =>
  $.agent.spawn({ tool_use_id: 't', prompt: 'p', description: 'd', subagentType, parentModel, background: false, fork: false, provider: { plugin: 'engine', tier: 'core' }, ...extra } as never)

test('search agents run on Haiku and general-purpose ones on Sonnet', async ($, on) => {
  const got = engine(on)
  await spawn($, 'Explore')
  await spawn($, 'general-purpose')
  await spawn($, 'Plan')
  expect(got).toEqual(['haiku', 'sonnet', undefined])
})

test('a named model, a fork and a cheaper parent are left alone', async ($, on) => {
  const got = engine(on)
  await spawn($, 'Explore', 'claude-opus-5-5', { model: 'opus' })
  await spawn($, 'general-purpose', 'claude-opus-5-5', { fork: true })
  await spawn($, 'general-purpose', 'claude-sonnet-5-5')
  await spawn($, 'Explore', 'claude-haiku-5-5')
  expect(got).toEqual(['opus', undefined, undefined, undefined])
})

test('/subagent-router turns routing off and on', async ($, on) => {
  const got = engine(on)
  expect((await $.command.run({ command: 'subagent-router', args: 'off' })).text).toBe('subagent-router is off.')
  await spawn($, 'Explore')
  expect((await $.command.run({ command: 'subagent-router', args: 'on' })).text).toBe('subagent-router is on: Explore on haiku, general-purpose on sonnet.')
  await spawn($, 'Explore')
  expect(got).toEqual([undefined, 'haiku'])
})

// the engine beneath for /orchestrate: records agent types, prompts and panes
const orchestra = (on: On) => {
  const got = { types: [] as string[], prompts: [] as string[], opened: [] as string[], spawned: 0 }
  on('agent.spawn', (_$, e) => ({ model: e.model ?? 'claude-sonnet-5-5', agentId: `a${got.spawned++}` }) as never)
  on('agent.register', (_$, e) => (got.types.push(`${e.name} ${e.model}-${e.effort}`), { value: { agent: `subagent-router:${e.name}` } }) as never)
  on('prompt.submit', (_$, e) => (got.prompts.push(e.text), { text: e.text }) as never)
  on('ui.open', (_$, e) => (got.opened.push(e.id), { value: { isPlaced: true } }) as never)
  on('ui.close', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('tool.register', () => ({ value: undefined }) as never)
  return got
}
const PANE = { plugin: 'subagent-router', surface: 'terminal', component: 'Pane', requestId: 'orchestrate', props: {}, viewport: { columns: 120, rows: 40 } } as const

test('/orchestrate opens the settings, and Start registers the level\'s roles and hands over the task', async ($, on) => {
  const got = orchestra(on)
  expect((await $.command.run({ command: 'orchestrate', args: 'add dark mode' })).text).toBe('Pick the settings in the Orchestrate pane, then press Start.')
  expect(got.opened).toEqual(['orchestrate'])
  const ui = await $.ui.mount(PANE as never)
  await ui.press({ key: 'level-high' })
  await ui.press({ key: 'more' })
  await ui.press({ key: 'approval-step' })
  await ui.press({ key: 'start' })
  await ui.unmount()
  expect(got.types).toEqual(['scout haiku-low', 'worker opus-medium', 'reviewer opus-high'])
  expect(got.prompts[0]).toContain('Level high: scout haiku-low, worker opus-medium, reviewer opus-high.')
  expect(got.prompts[0]).toContain('spawn the worker again with model "opus" and effort "high"')
  expect(got.prompts[0]).toContain('At most 4 agents at once. Approval: step.')
  expect(got.prompts[0]).toEndWith('Task: add dark mode')
})

test('roles past the worker limit are refused until one finishes', async ($, on) => {
  orchestra(on)
  on('turn.complete', () => ({ text: '' }))
  await $.command.run({ command: 'orchestrate', args: 'x' })
  const ui = await $.ui.mount(PANE as never)
  for (let i = 0; i < 2; i++) await ui.press({ key: 'fewer' })
  await ui.press({ key: 'start' })
  await ui.unmount()
  expect((await spawn($, 'subagent-router:worker')).deny).toBeUndefined()
  expect((await spawn($, 'subagent-router:scout')).deny).toBe('1 orchestration agents are running and the limit is 1. Wait for one to finish.')
  await $.turn.complete({ turnId: 't', agentId: 'a0', reason: 'answer', isAborted: false, answer: '', text: '' } as never)
  expect((await spawn($, 'subagent-router:scout')).deny).toBeUndefined()
})

test('two roles spawned at once at the limit: one starts, one is refused', async ($, on) => {
  orchestra(on)
  await $.command.run({ command: 'orchestrate', args: 'x' })
  const ui = await $.ui.mount(PANE as never)
  for (let i = 0; i < 2; i++) await ui.press({ key: 'fewer' })
  await ui.press({ key: 'start' })
  await ui.unmount()
  const denies = (await Promise.all([spawn($, 'subagent-router:worker'), spawn($, 'subagent-router:scout')])).map(r => r.deny)
  expect(denies.filter(d => d === undefined).length).toBe(1)
  expect(denies).toContain('1 orchestration agents are running and the limit is 1. Wait for one to finish.')
})

const TASKS = 'mcp__subagent-router__update_tasks'

test('the pane follows the orchestrator\'s task list while it stays open', async ($, on) => {
  orchestra(on)
  await $.command.run({ command: 'orchestrate', args: 'x' })
  const ui = await $.ui.mount(PANE as never)
  await ui.press({ key: 'start' })
  expect(await ui.find({ type: 'Text', text: ' 0/0 tasks' })).toBeDefined()
  await $.tool.call({ tool: TASKS, tasks: [{ id: '1', subject: 'Write tests', contract: 'Goal: tests' }, { id: '2', subject: 'Ship', blockedBy: ['1'] }] } as never)
  await $.tool.call({ tool: TASKS, tasks: [{ id: '1', status: 'completed' }] } as never)
  expect(await ui.find({ type: 'Text', text: ' 1/2 tasks · 50%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '→ Next: Ship' })).toBeDefined()
  const list = await $.tool.call({ tool: TASKS } as never)
  expect(list.result).toBe('#1 completed: Write tests\nGoal: tests\n#2 pending: Ship (after #1)')
  await $.tool.call({ tool: TASKS, tasks: [{ id: '2', status: 'deleted' }] } as never)
  expect(await ui.find({ type: 'Text', text: ' 1/1 tasks · 100%' })).toBeDefined()
  await ui.unmount()
  expect((await $.command.run({ command: 'orchestrate', args: 'stop' })).text).toBe('Orchestration stopped. Its agents spent about $0.00 at API prices.')
})

test('Approve shows only while the orchestrator waits', async ($, on) => {
  const got = orchestra(on)
  on('turn.start', () => ({}) as never)
  await $.command.run({ command: 'orchestrate', args: 'x' })
  let ui = await $.ui.mount(PANE as never)
  await ui.press({ key: 'start' })
  expect(await ui.find({ key: 'approve' })).toBeUndefined()
  await ui.unmount()

  await $.tool.call({ tool: 'mcp__subagent-router__await_approval', summary: 'Plan: 2 tasks' } as never)
  ui = await $.ui.mount(PANE as never)
  expect(await ui.find({ type: 'Text', text: '⏸ Waiting for your approval: Plan: 2 tasks' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '· idle' })).toBeUndefined()
  await ui.press({ key: 'agents' })
  expect(await ui.findAll({ type: 'Text', text: '· idle' })).toHaveLength(3)
  await ui.press({ key: 'approve' })
  expect(got.prompts.at(-1)).toBe('Approved. Go ahead.')
  expect(await ui.find({ key: 'approve' })).toBeUndefined()
  await ui.unmount()
})
