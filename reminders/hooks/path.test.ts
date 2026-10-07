import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

// An empty project with the folders `dirs` names; records the path each write goes to, which the
// engine has made absolute, with forward slashes.
const fakeProject = (on: On, dirs: string[]) =>
{
  const written: string[] = []
  on('fs.list', () => ({ value: dirs.map(name => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })) }))
  on('fs.exists', () => ({ value: false }))
  on('fs.write', (_$, e) => (written.push(e.path.replace(/\\/g, '/')), { value: undefined }))
  on('clock.now', () => ({ value: new Date(2026, 9, 7, 12).getTime() }))
  on('ui.invalidate', () => ({ value: undefined }))
  return written
}

const addOne = ($: Parameters<Parameters<typeof test>[1]>[0]) =>
  $.tool.call({ tool: 'mcp__reminders__add_reminder', text: 'Checkout crashes', priority: 'P1' })

test('a project with no docs folder gets Docs/todos.md', async ($, on) =>
{
  const written = fakeProject(on, ['src'])
  await addOne($)
  expect(written).toHaveLength(1)
  expect(written[0]).toEndWith('/Docs/todos.md')
})

test('a lowercase docs folder is used as it is spelled', async ($, on) =>
{
  const written = fakeProject(on, ['src', 'docs'])
  await addOne($)
  expect(written).toHaveLength(1)
  expect(written[0]).toEndWith('/docs/todos.md')
})

test('the path option wins over detection', { options: { path: 'notes/todo.md' } }, async ($, on) =>
{
  const written = fakeProject(on, ['docs'])
  await addOne($)
  expect(written).toHaveLength(1)
  expect(written[0]).toEndWith('/notes/todo.md')
})
