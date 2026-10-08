import { test, expect, mock } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type Engine = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]

const BAND = {
  plugin: 'context-meter',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 120, scroll: { offset: 0, bodyRows: 4 }, view: {} },
  viewport: { columns: 125, rows: 30 },
} as const

const bandText = async ($: Engine) => {
  const ui = await $.ui.mount(BAND)
  const boxes = await ui.findAll({ type: 'Box' })
  const rows = boxes.slice(boxes.findIndex(b => b.key === 'meter') + 1).map(b => b.text)
  await ui.unmount()
  return rows
}

// what the engine draws under the plugins when nothing else claims the band
const coreBand = (on: On) => on('ui.render', () => ({ type: 'Box' }) as never)

const usage = (on: On) =>
  on('session.usage', (_$, e) => ({
    value: {
      startedAt: 0,
      context: e.breakdown
        ? { tokens: 150_000, window: 200_000, percent: 75, breakdown: { totalTokens: 20_000 } as never }
        : { tokens: 150_000, window: 200_000, percent: 75 },
      rateLimits: [],
      cost: { usd: 0.5 },
    },
  }))

test('measure fills the band above the prompt', async ($, on) => {
  coreBand(on)
  on('session.measure', (_$, e) => ({ changed: e.changed }))

  await $.session.measure({
    context: { tokens: 84_000, window: 200_000, percent: 42 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 23.5 },
      { kind: 'seven_day', percentUsed: 7 },
    ],
    cost: { usd: 1.236 },
    changed: ['context'],
  })
  expect(await bandText($)).toEqual(['▰▰▰▱▱▱▱▱ 42% 84k/200k │ 5h 24%  7d  7%', '$1.24'])

  await $.session.measure({ context: { window: 1_000_000 }, rateLimits: [], changed: ['context'] })
  expect(await bandText($)).toEqual(['▱▱▱▱▱▱▱▱ -/1M'])
})

test('startup reads effort from settings', async ($, on) => {
  usage(on)
  coreBand(on)
  on('session.start', () => ({ cwd: '/' }))
  on('ui.status', () => ({ value: undefined }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: { effortLevel: 'low', modelSettings: { 'claude-opus-5-5': { effortLevel: 'xhigh' } } } }))

  await $.session.start({ cwd: '/' } as never)
  expect(await bandText($)).toEqual(['▰▰▰▰▰▰▱▱ 75% 150k/200k', '$0.50 │ ✻ Opus 5.5 · xhigh'])
})

test('model steps set model + effort, compaction shows an estimate', async ($, on) => {
  const clock = mock.clock(on)
  usage(on)
  coreBand(on)
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, text: '', answer: '', toolUses: [] } as never
  })
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'summary', toolUses: [] }] as never }))

  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'claude-haiku-4-5-20251001', effort: 'high', messageCount: 1 }));
  await clock.advance(250)
  expect(await bandText($)).toEqual(['▰▰▰▰▰▰▱▱ 75% 150k/200k', '$0.50 │ ✻ Haiku 4.5 · high'])

  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hi', toolUses: [] }] } as never)
  await clock.advance(1000)
  expect(await bandText($)).toEqual(['▰▱▱▱▱▱▱▱ ~10% 20k/200k', '$0.50 │ ✻ Haiku 4.5 · high'])
})

test('a /model switch shows without waiting for the next turn', async ($, on) => {
  const clock = mock.clock(on)
  usage(on)
  coreBand(on)
  on('session.start', () => ({ cwd: '/' }))
  on('ui.status', () => ({ value: undefined }))
  let id = 'claude-opus-5-5'
  on('session.model', () => ({ value: id }))
  on('settings.read', () => ({ value: { effortLevel: 'low' } }))

  await $.session.start({ cwd: '/' } as never)
  expect((await bandText($))[1]).toContain('Opus 5.5')
  id = 'claude-sonnet-5-5'
  await clock.advance(1000)
  expect((await bandText($))[1]).toEqual('$0.50 │ ✻ Sonnet 5.5 · low')
})

test('the cache shows its hit rate and minutes left, then goes cold', async ($, on) => {
  const clock = mock.clock(on)
  usage(on)
  coreBand(on)
  on('session.start', () => ({ cwd: '/' }))
  on('ui.status', () => ({ value: undefined }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: { effortLevel: 'high' } }))
  on('turn.step', async function* (_$, e) {
    const usage = { input_tokens: 1_000, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 9_000, output_tokens: 500, model: e.model }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage } as never
  })

  await $.session.start({ cwd: '/' } as never)
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 }));
  await clock.advance(250)
  expect((await bandText($))[1]).toEqual('$0.50 │ cache 90% 60m │ ✻ Opus 5.5 · high')
  await clock.advance(51 * 60_000)
  expect((await bandText($))[1]).toEqual('$0.50 │ cache 90% 9m │ ✻ Opus 5.5 · high')
  await clock.advance(9 * 60_000)
  expect((await bandText($))[1]).toEqual('$0.50 │ cache cold │ ✻ Opus 5.5 · high')
})

test('a prompt on a cold cache with a large context warns once', async ($, on) => {
  const clock = mock.clock(on)
  usage(on)
  coreBand(on)
  const toasts: string[] = []
  on('session.start', () => ({ cwd: '/' }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', (_$, e) => {
    toasts.push((e as { text: string }).text)
    return { value: undefined } as never
  })
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: {} }))
  on('turn.step', async function* (_$, e) {
    const usage = { input_tokens: 1_000, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 9_000, output_tokens: 500, model: e.model }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage } as never
  })

  await $.session.start({ cwd: '/' } as never)
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 }));
  await clock.advance(250)
  await $.prompt.submit({ text: 'warm' })
  await clock.advance(60 * 60_000)
  await $.prompt.submit({ text: 'back from lunch' })
  await $.prompt.submit({ text: 'again' })
  expect(toasts).toEqual(['The prompt cache is cold and the context is 150k: this prompt rewrites all of it. Next time, /compact or /clear first.'])
})

test('a resumed session whose first usage read fails still shows the band', async ($, on) => {
  const clock = mock.clock(on)
  coreBand(on)
  let calls = 0
  on('session.usage', (_$, e) => {
    if (calls++ === 0) throw new Error('still loading')
    return { value: { startedAt: 0, context: e.breakdown ? { window: 200_000, breakdown: { totalTokens: 60_000 } as never } : { window: 200_000 }, rateLimits: [] } }
  })
  on('session.start', () => ({ cwd: '/' }))
  on('ui.status', () => ({ value: undefined }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: {} }))

  await $.session.start({ cwd: '/' } as never)
  await clock.advance(1000)
  expect((await bandText($))[0]).toBe('▰▰▱▱▱▱▱▱ ~30% 60k/200k')
})
