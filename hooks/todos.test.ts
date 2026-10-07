import { expect, test } from 'claude-code/testing'

import { add, complete, DONE_KEEP, EMPTY, parseOpen } from './todos'

const item = (text: string, priority: 'P1' | 'P2' | 'P3' = 'P2') => ({ priority, date: '2026-10-07', text })

test('add, sort, dedupe', async () =>
{
  let md = add(EMPTY, item('Wire refund button', 'P3')).md
  md = add(md, { ...item('Boss HP undecided', 'P1'), at: 'Assets/Game/Scripts/Boss.cs:42' }).md
  const open = parseOpen(md)
  expect(open.map(t => t.priority)).toEqual(['P1', 'P3'])
  expect(open[0]?.at).toBe('Assets/Game/Scripts/Boss.cs:42')
  expect(add(md, item('boss hp UNDECIDED')).error).toBeDefined()
})

test('hand-written junk survives a rewrite', async () =>
{
  const md = add(EMPTY.replace('## Open\n', '## Open\n\n- a sloppy line\n'), item('x')).md
  expect(md).toContain('- a sloppy line')
  expect(parseOpen(md).length).toBe(1)
})

test('complete moves to Done and keeps the last 20', async () =>
{
  let md = EMPTY
  for (let i = 0; i < DONE_KEEP + 3; i++) md = add(md, item(`task ${i}`)).md
  expect(complete(md, 'task', '2026-10-08').error).toContain('matches')

  for (let i = 0; i < DONE_KEEP + 2; i++) md = complete(md, `task ${i}`, '2026-10-08').md
  expect(parseOpen(md).map(t => t.text)).toEqual([`task ${DONE_KEEP + 2}`])
  expect(md.split('\n').filter(l => l.startsWith('- [x]')).length).toBe(DONE_KEEP)
  expect(md).toContain(`- [x] P2 2026-10-07 task ${DONE_KEEP + 1} (done 2026-10-08)`)
  expect(md).not.toContain('task 0 (done')
})

test('exact text wins over a substring hit', async () =>
{
  const md = add(add(EMPTY, item('Fix bar')).md, item('Fix bar colors')).md
  expect(complete(md, 'Fix bar', '2026-10-08').done?.text).toBe('Fix bar')
})
