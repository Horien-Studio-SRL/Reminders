import { test, expect } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type Engine = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]

// the engine beneath the plugin: a repo with or without memory/MEMORY.md, one engine section in the prompt
const engine = (on: On, hasMemory: boolean) => {
  on('session.start', () => ({ cwd: 'C:\\repo' }) as never)
  on('fs.exists', (_$, e) => ({ value: hasMemory && /MEMORY.md$/.test(e.path) }) as never)
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'intro', scope: 'shared' }] }))
  on('agent.offer', () => ({ isOffered: true }))
}

const start = ($: Engine) => $.session.start({ cwd: 'C:\\repo', surface: 'terminal', isInteractive: true } as never)
const ids = async ($: Engine) => (await $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: [], tools: [], outputStyle: null, traits: [] })).sections.map(s => s.id)
const offered = async ($: Engine, agent: string) =>
  (await $.agent.offer({ agent, description: 'd', source: 'plugin', provider: { plugin: 'project-memory', tier: 'user' } } as never)).isOffered

test('a repo with a memory folder gets the prompt section and the agents', async ($, on) => {
  engine(on, true)
  await start($)
  expect(await ids($)).toEqual(['intro', 'project-memory:recall'])
  expect(await offered($, 'project-memory:memory-recall')).toBe(true)
})

test('a repo without one gets neither, and other agents are untouched', async ($, on) => {
  engine(on, false)
  await start($)
  expect(await ids($)).toEqual(['intro'])
  expect(await offered($, 'project-memory:memory-recall')).toBe(false)
  expect(await offered($, 'Explore')).toBe(true)
})
