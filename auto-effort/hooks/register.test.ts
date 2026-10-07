import { test, expect } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type Engine = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]

const LOW = 'low: a question, explanation, chat, running a command or a git chore, no file edits'
const HIGH = 'high: hard debugging, design, a large refactor, or a retry after a failed attempt'

// the engine beneath the plugin: records the effort each step was sent with
const engine = (on: On, usage = { cache_read_input_tokens: 9_000, cache_creation_input_tokens: 100 }, toasts: string[] = []) => {
  const sent: unknown[] = []
  on('turn.step', async function* (_$, e) {
    sent.push(e.effort)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { ...usage, input_tokens: 10, output_tokens: 10, model: e.model } } as never
  })
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('ui.toast', (_$, e) => {
    toasts.push(JSON.stringify(e))
    return { value: undefined } as never
  })
  return sent
}

const step = async ($: Engine, turnId: string, effort: string, model = 'claude-opus-5-5') => {
  for await (const _ of $.turn.step({ turnId, index: 0, model, effort: effort as never, messageCount: 1 }));
}

test('each prompt picks the effort its turn runs at', async ($, on) => {
  const sent = engine(on)
  let label = LOW
  on('model.classify', () => ({ value: label }))

  await $.prompt.submit({ text: 'what does this regex do?' })
  await step($, 't1', 'medium')
  label = HIGH
  await $.prompt.submit({ text: 'still broken, the race is back' })
  await step($, 't2', 'medium')
  expect(sent).toEqual(['low', 'high'])
})

test('xhigh and max from /effort or ultrathink stand', async ($, on) => {
  const sent = engine(on)
  on('model.classify', () => ({ value: LOW }))

  await $.prompt.submit({ text: 'ultrathink about this design' })
  await step($, 't1', 'xhigh')
  await step($, 't2', 'max')
  expect(sent).toEqual(['xhigh', 'max'])
})

test('Explore subagents run at low unless the call names an effort', async ($, on) => {
  const got: unknown[] = []
  on('tool.call', { tool: 'Agent' }, (_$, e) => {
    got.push(e.effort)
    return { result: 'ok' } as never
  })

  await $.tool.call({ tool: 'Agent', description: 'find', prompt: 'find x', subagent_type: 'Explore' } as never)
  await $.tool.call({ tool: 'Agent', description: 'find', prompt: 'find x', subagent_type: 'Explore', effort: 'high' } as never)
  await $.tool.call({ tool: 'Agent', description: 'fix', prompt: 'fix x', subagent_type: 'general-purpose' } as never)
  expect(got).toEqual(['low', 'high', undefined])
})

test('a switch that rebuilds the cache warns once', async ($, on) => {
  const toasts: string[] = []
  const sent = engine(on, { cache_read_input_tokens: 0, cache_creation_input_tokens: 50_000 }, toasts)
  let label = LOW
  on('model.classify', () => ({ value: label }))

  await $.prompt.submit({ text: 'q' })
  await step($, 't1', 'medium')
  label = HIGH
  await $.prompt.submit({ text: 'hard' })
  await step($, 't2', 'medium')
  label = LOW
  await $.prompt.submit({ text: 'q' })
  await step($, 't3', 'medium')
  expect(sent).toEqual(['low', 'high', 'low'])
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('rebuilt the prompt cache')
})

test('/auto-effort pins and turns off', async ($, on) => {
  const sent = engine(on)
  on('model.classify', () => ({ value: LOW }))

  expect((await $.command.run({ command: 'auto-effort', args: 'pin high' })).text).toBe('auto-effort is pinned to high. Budget mode is at 80%, 0% of the fullest usage window used.')
  await $.prompt.submit({ text: 'q' })
  await step($, 't1', 'medium')
  expect((await $.command.run({ command: 'auto-effort', args: 'off' })).text).toContain('auto-effort is off.')
  await step($, 't2', 'medium')
  await $.command.run({ command: 'auto-effort', args: 'on' })
  expect(sent).toEqual(['high', 'medium'])
})

test('budget mode caps high at medium once a usage window passes the threshold', async ($, on) => {
  const sent = engine(on)
  on('model.classify', () => ({ value: HIGH }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))

  await $.prompt.submit({ text: 'hard' })
  await step($, 't1', 'medium')
  await $.session.measure({ rateLimits: [{ kind: 'five_hour', percentUsed: 85 }], changed: ['rateLimits'] } as never)
  await step($, 't2', 'medium')
  expect((await $.command.run({ command: 'auto-effort', args: 'budget 90' })).text).toContain('Budget mode is at 90%, 85%')
  await step($, 't3', 'medium')
  await $.command.run({ command: 'auto-effort', args: 'budget off' })
  await step($, 't4', 'medium')
  await $.command.run({ command: 'auto-effort', args: 'budget on' })
  await step($, 't5', 'medium')
  expect(sent).toEqual(['high', 'medium', 'high', 'high', 'medium'])
})
