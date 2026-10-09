import { test, expect } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type Engine = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]

type Repo = { index?: string; files?: Record<string, string>; unreadable?: string[] }

// the engine beneath the plugin: a repo at C:\repo, its memory/MEMORY.md found by the ancestor walk, one engine section in the prompt
const engine = (on: On, repo: Repo) => {
  on('session.start', () => ({ cwd: 'C:\\repo\\sub' }) as never)
  on('fs.ancestors', () => ({ value: repo.index === undefined ? [] : [{ dir: 'C:\\repo', name: 'memory/MEMORY.md', content: repo.index, parts: [{ path: 'C:\\repo\\memory\\MEMORY.md', content: repo.index }] }] }) as never)
  on('fs.list', () => ({ value: ['MEMORY.md', ...Object.keys(repo.files ?? {}), ...(repo.unreadable ?? [])].map(name => ({ name, kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false })) }))
  on('fs.read', (_$, e) => {
    if (repo.unreadable?.some(name => e.path.endsWith(name))) throw new Error('EACCES')
    return ({ value: Object.entries(repo.files ?? {}).find(([name]) => e.path.endsWith(name))?.[1] ?? '' }) as never
  })
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'intro', scope: 'shared' }] }))
  on('agent.offer', () => ({ isOffered: true }))
}

const start = ($: Engine) => $.session.start({ cwd: 'C:\\repo\\sub', surface: 'terminal', isInteractive: true } as never)
const sections = async ($: Engine) => (await $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: [], tools: [], outputStyle: null, traits: [] })).sections
const section = async ($: Engine) => (await sections($)).find(s => s.id === 'project-memory:recall')?.text ?? ''
const offered = async ($: Engine, agent: string) =>
  (await $.agent.offer({ agent, description: 'd', source: 'plugin', provider: { plugin: 'project-memory', tier: 'user' } } as never)).isOffered

const line = '- [Some decision](some-decision.md) — a hook naming the topic\n'

test('a small index goes into the prompt and recall is hidden', async ($, on) => {
  engine(on, { index: line })
  await start($)
  expect((await sections($)).map(s => s.id)).toEqual(['intro', 'project-memory:recall'])
  expect(await section($)).toContain('C:\\repo/memory')
  expect(await section($)).toContain('[Some decision](some-decision.md)')
  expect(await offered($, 'project-memory:memory-recall')).toBe(false)
  expect(await offered($, 'project-memory:memory-keeper')).toBe(true)
})

test('a big index sends Claude to recall instead', async ($, on) => {
  engine(on, { index: line.repeat(100) })
  await start($)
  expect(await section($)).toContain('memory-recall')
  expect(await section($)).not.toContain('[Some decision]')
  expect(await section($)).not.toContain('over 16KB')
  expect(await offered($, 'project-memory:memory-recall')).toBe(true)
})

test('an index over 16KB asks for compacting', async ($, on) => {
  engine(on, { index: line.repeat(300) })
  await start($)
  expect(await section($)).toContain('over 16KB')
})

test('rejected lines from the memory files reach the prompt with their file', async ($, on) => {
  engine(on, { index: line, files: { 'redis.md': 'Use Postgres.\nREJECTED: a Redis cache, it lost writes on restart.\n', 'other.md': 'Nothing here.' } })
  await start($)
  expect(await section($)).toContain("- REJECTED: a Redis cache, it lost writes on restart. (memory/redis.md)")
  expect(await section($)).not.toContain('Nothing here')
})

test('a memory file that cannot be read is named in the prompt', async ($, on) => {
  engine(on, { index: line, files: { 'redis.md': 'REJECTED: a Redis cache.\n' }, unreadable: ['locked.md'] })
  await start($)
  expect(await section($)).toContain("Couldn't read memory/locked.md")
  expect(await section($)).toContain('(memory/redis.md)')
})

test('rejected lines past 4KB stay in the files and the prompt says how many', async ($, on) => {
  const files = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`m${i}.md`, `REJECTED: approach number ${i} ${'x'.repeat(80)}\n`]))
  engine(on, { index: line, files })
  await start($)
  const text = await section($)
  const kept = text.split('\n').filter(l => l.startsWith('- REJECTED')).length
  expect(kept).toBeLessThan(100)
  expect(text).toContain(`- ${100 - kept} more in the memory files`)
})

test('a repo without memory gets neither, and other agents are untouched', async ($, on) => {
  engine(on, {})
  await start($)
  expect((await sections($)).map(s => s.id)).toEqual(['intro'])
  expect(await offered($, 'project-memory:memory-keeper')).toBe(false)
  expect(await offered($, 'Explore')).toBe(true)
})
