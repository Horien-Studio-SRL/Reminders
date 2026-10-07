import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { add, EMPTY, parseOpen } from './todos'

// Docs/todos.md lives in `file.md`; the clock reads 2026-10-07; the Edit tool always succeeds.
const fakeDisk = (on: On, md: string) =>
{
  const file = { md }
  on('fs.exists', () => ({ value: true }))
  on('fs.read', () => ({ value: file.md }))
  on('fs.write', (_$, e) => ((file.md = e.text), { value: undefined }))
  on('clock.now', () => ({ value: new Date(2026, 9, 7, 12).getTime() }))
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'edited' }))
  on('ui.invalidate', () => ({ value: undefined }))
  return file
}

const seeded = () =>
{
  const md = add(EMPTY, { priority: 'P1', date: '2026-09-30', text: 'Retry limit undecided', at: 'src/net/retry.ts:42' }).md
  return add(md, { priority: 'P3', date: '2026-10-07', text: 'Tidy settings page', at: 'src/ui/settings.tsx' }).md
}

const edit = ($: Parameters<Parameters<typeof test>[1]>[0], file_path: string) =>
  $.tool.call({ tool: 'Edit', file_path, old_string: 'a', new_string: 'b', replace_all: false })

test('editing a file a reminder points at names the reminder to Claude, once', async ($, on) =>
{
  fakeDisk(on, seeded())

  const first = await edit($, 'C:\\work\\app\\src\\net\\retry.ts')
  expect(first.context?.join('\n')).toContain('P1 Retry limit undecided (at src/net/retry.ts:42)')
  expect(first.context?.join('\n')).toContain('complete_reminder')
  expect(first.context?.join('\n')).not.toContain('Tidy settings page')

  const again = await edit($, 'C:\\work\\app\\src\\net\\retry.ts')
  expect(again.context ?? []).toEqual([])
})

test('editing a file no reminder points at adds nothing', async ($, on) =>
{
  fakeDisk(on, seeded())
  const r = await edit($, '/work/app/src/net/client.ts')
  expect(r.context ?? []).toEqual([])
})

test('complete_reminder shows a toast naming the item', async ($, on) =>
{
  const file = fakeDisk(on, seeded())
  const toasts: string[] = []
  on('ui.toast', (_$, e) => (toasts.push(e.text), { value: undefined }))

  await $.tool.call({ tool: 'mcp__reminders__complete_reminder', match: 'Tidy settings' })
  expect(toasts).toEqual(['Done: Tidy settings page'])
  expect(parseOpen(file.md).map(t => t.text)).toEqual(['Retry limit undecided'])
})
