import { test, expect, mock } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type Engine = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]

// the engine beneath the plugin: a context of `tokens`, compactions counted, and a transcript per
// session id whose last reply is at `transcripts[id]`; `session.id` is whatever `at.id` holds
const engine = (on: On, tokens: number | undefined, estimate = 0, transcripts: Record<string, number> = {}) => {
  const clock = mock.clock(on)
  const compacted: unknown[] = []
  const at = { id: 'new', failing: false }
  const reads: string[] = []
  on('session.start', () => ({ cwd: '/' }))
  on('session.id', () => ({ value: at.id }) as never)
  on('session.cwd', () => ({ value: 'C:\\work\\app' }) as never)
  on('env.get', (_$, e) => ({ value: (e as { name: string }).name === 'USERPROFILE' ? 'C:/Users/me' : undefined }) as never)
  on('fs.read', (_$, e) => {
    const path = (e as { path: string }).path.replace(/\\/g, '/')
    reads.push(path)
    const id = /([^/]+)\.jsonl$/.exec(path)?.[1] ?? ''
    if (!(id in transcripts)) throw new Error('ENOENT')
    const line = (type: string) => JSON.stringify({ type, timestamp: new Date(transcripts[id]!).toISOString() })
    return { value: `${line('user')}\n${line('assistant')}\n` } as never
  })
  on('session.usage', (_$, e) => ({
    value: { startedAt: 0, context: e.breakdown ? { window: 200_000, breakdown: { totalTokens: estimate } as never } : { tokens, window: 200_000 }, rateLimits: [] },
  }))
  on('session.compact', (_$, e) => {
    compacted.push(e.instructions)
    if (at.failing) throw new Error('a turn is running')
    return { messages: [{ role: 'user', text: 'summary', toolUses: [] }] } as never
  })
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined } as never
  })
  on('command.register', () => ({ value: undefined }) as never)
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { input_tokens: 1, cache_read_input_tokens: 1, cache_creation_input_tokens: 0, output_tokens: 1, model: e.model } } as never
  })
  return { clock, compacted, at, reads, toasts }
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

test('a failed compaction is retried on the next tick, by one timer even after a resume', async ($, on) => {
  const { clock, compacted, at, toasts } = engine(on, 150_000)
  await $.command.run({ command: 'idle-compact', args: 'on' })
  await $.session.start({ cwd: '/' } as never)
  await $.session.start({ cwd: '/' } as never)
  await step($)
  at.failing = true
  await clock.advance(55 * 60_000)
  expect(compacted.length).toBe(1)
  await clock.advance(60_000)
  expect(compacted.length).toBe(2)
  expect(toasts).toEqual(['idle-compact: could not compact the idle context, will try again.'])
  at.failing = false
  await clock.advance(60_000)
  expect(compacted.length).toBe(3)
  expect(toasts[1]).toContain('compacted a 150k context')
  await clock.advance(5 * 60_000)
  expect(compacted.length).toBe(3)
})

test('a small context, or the mod turned off, is left alone', async ($, on) => {
  const { clock, compacted } = engine(on, 150_000)
  await $.session.start({ cwd: '/' } as never)
  expect((await $.command.run({ command: 'idle-compact', args: '200k' })).text).toContain('idle-compact is on for contexts of 200k tokens or more.')
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

test('a session resumed from the picker takes its cache age from its own transcript', async ($, on) => {
  const { clock, compacted, at, reads } = engine(on, undefined, 150_000, { s1: 0 })
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  await $.command.run({ command: 'idle-compact', args: 'on' })
  // starts as a fresh session, then the picker swaps in s1, whose last reply was at 0
  await $.session.start({ cwd: '/' } as never)
  at.id = 's1'
  await clock.advance(61 * 60_000)
  expect(reads).toContain('C:/Users/me/.claude/projects/C--work-app/s1.jsonl')
  expect(compacted.length).toBe(1)
})

test('/idle-compact reports what the mod sees', async ($, on) => {
  const { clock, at } = engine(on, undefined, 150_000, { s2: 0 })
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  await $.command.run({ command: 'idle-compact', args: 'off' })
  at.id = 's2'
  await clock.advance(3 * 3_600_000 + 5 * 60_000)
  await $.prompt.submit({ text: 'hi', origin: { kind: 'composer' } } as never)
  await $.command.run({ command: 'idle-compact', args: '120' })
  expect((await $.command.run({ command: 'idle-compact', args: 'on' })).text).toBe(
    'idle-compact is on for contexts of 120k tokens or more. Now: 150k context, last reply 3h 5m ago. Last prompt: composer.',
  )
})
