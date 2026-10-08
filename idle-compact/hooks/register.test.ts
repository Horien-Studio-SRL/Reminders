import { test, expect, mock } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type Engine = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]

// the engine beneath the plugin: a context of `tokens`, compactions counted
const engine = (on: On, tokens: number) => {
  const clock = mock.clock(on)
  const compacted: unknown[] = []
  on('session.start', () => ({ cwd: '/' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens, window: 200_000, percent: 50 }, rateLimits: [] } }))
  on('session.compact', (_$, e) => {
    compacted.push(e.instructions)
    return { messages: [{ role: 'user', text: 'summary', toolUses: [] }] } as never
  })
  on('ui.toast', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { input_tokens: 1, cache_read_input_tokens: 1, cache_creation_input_tokens: 0, output_tokens: 1, model: e.model } } as never
  })
  return { clock, compacted }
}

const step = async ($: Engine) => {
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 }));
}

test('an idle large context compacts once, five minutes before the cache expires', async ($, on) => {
  const { clock, compacted } = engine(on, 150_000)
  await $.session.start({ cwd: '/' } as never)
  await step($)
  await clock.advance(54 * 60_000)
  expect(compacted.length).toBe(0)
  await clock.advance(2 * 60_000)
  await clock.advance(10 * 60_000)
  expect(compacted.length).toBe(1)
})

test('a small context, or the mod turned off, is left alone', async ($, on) => {
  const { clock, compacted } = engine(on, 150_000)
  await $.session.start({ cwd: '/' } as never)
  expect((await $.command.run({ command: 'idle-compact', args: '200k' })).text).toBe('idle-compact is on for contexts of 200k tokens or more.')
  await step($)
  await clock.advance(60 * 60_000)
  await $.command.run({ command: 'idle-compact', args: '80' })
  await $.command.run({ command: 'idle-compact', args: 'off' })
  await step($)
  await clock.advance(60 * 60_000)
  expect(compacted.length).toBe(0)
})

test('a prompt on a cold cache is held back, compacted for, and put back in the box', async ($, on) => {
  const { clock, compacted } = engine(on, 150_000)
  const filled: string[] = []
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('prompt.fill', (_$, e) => {
    filled.push(e.text)
    return { isFilled: true } as never
  })
  // the mod's settings outlive a test, and the one before turned it off
  await $.command.run({ command: 'idle-compact', args: 'on' })
  await step($)
  // no session.start, so no timer: as if the computer slept through it
  await clock.advance(61 * 60_000)
  expect('drop' in (await $.prompt.submit({ text: '/help', origin: { kind: 'composer' } } as never))).toBe(false)
  expect('drop' in (await $.prompt.submit({ text: 'add a retry to the upload', origin: { kind: 'composer' } } as never))).toBe(true)
  await clock.advance(1)
  expect(compacted).toEqual(['Keep the open task, decisions made, files changed and anything left to do. Above all, keep what the next request needs: add a retry to the upload'])
  expect(filled).toEqual(['add a retry to the upload'])
  expect('drop' in (await $.prompt.submit({ text: 'add a retry to the upload', origin: { kind: 'composer' } } as never))).toBe(false)
})
