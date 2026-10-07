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
