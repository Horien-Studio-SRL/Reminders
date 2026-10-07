import { test, expect, mock } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type Engine = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]

// the engine beneath the plugin: a store in memory and a model that answers with `usage`
const engine = (on: On, usage: object) => {
  mock.clock(on)
  const store: Record<string, unknown> = {}
  on('store.get', (_$, e) => ({ value: store[(e as { key: string }).key] }) as never)
  on('store.set', (_$, e) => {
    const { key, value } = e as unknown as { key: string; value: unknown }
    store[key] = value
    return { value: undefined } as never
  })
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { ...usage, model: e.model } } as never
  })
  return store
}

const step = async ($: Engine) => {
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 }));
}

test('prompts land in the auto-effort off row with their cost and window share', async ($, on) => {
  engine(on, { input_tokens: 1_000_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 100_000 })
  await $.session.measure({ rateLimits: [{ kind: 'five_hour', percentUsed: 10 }], changed: ['rateLimits'] } as never)
  await $.prompt.submit({ text: 'fix it' })
  await step($)
  await $.session.measure({ rateLimits: [{ kind: 'five_hour', percentUsed: 12.5 }], changed: ['rateLimits'] } as never)
  await $.prompt.submit({ text: '/help' })

  const text = (await $.command.run({ command: 'savings', args: '' })).text
  expect(text).toContain('auto-effort off: 1 prompts, $6.00 and 100k output tokens per prompt, 2.50% of the 5-hour window per prompt')
  expect(text).toContain('auto-effort on: no prompts yet')
  expect(text).toContain('output-trimmer: 0 input tokens not re-read, about $0.00')
})

test('reset clears the ledger', async ($, on) => {
  const store = engine(on, { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 10 })
  await $.prompt.submit({ text: 'q' })
  await step($)
  expect((await $.command.run({ command: 'savings', args: 'reset' })).text).toBe('Savings ledger cleared.')
  expect((store.ledger as { effort: { off: { prompts: number } } }).effort.off.prompts).toBe(0)
})
