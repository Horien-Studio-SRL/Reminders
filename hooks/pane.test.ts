import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { add, age, complete, EMPTY, parseDone, parseOpen } from './todos'

const SURFACES = ['terminal', 'desktop'] as const
const PROPS = {
  title: 'Todos',
  isFocused: true,
  bodyColumns: 60,
  placement: 'inline',
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
} as const

// Docs/todos.md lives in `file.md`, and every other path exists unless it ends in one `gone` names; the clock reads
// 2026-10-07. The engine's own pane drawing is a stub.
const fakeDisk = (on: On, md: string, gone: string[] = []) =>
{
  const file = { md }
  on('fs.exists', (_$, e) => ({ value: !gone.some(g => e.path.replace(/\\/g, '/').endsWith(g)) }))
  on('fs.read', () => ({ value: file.md }))
  on('fs.write', (_$, e) => ((file.md = e.text), { value: undefined }))
  on('clock.now', () => ({ value: new Date(2026, 9, 7, 12).getTime() }))
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: 'engine' }))
  return file
}

// Prompts the pane submits, as the model would read them.
const stubPrompt = (on: On) =>
{
  const sent: string[] = []
  on('prompt.submit', (_$, e) => (sent.push(e.text), { text: e.text }))
  return sent
}

const seeded = () =>
{
  let md = add(EMPTY, { priority: 'P3', date: '2026-10-07', text: 'Tidy settings page' }).md
  md = add(md, { priority: 'P1', date: '2026-09-30', text: 'Retry limit undecided', at: 'src/net/retry.ts:42' }).md
  return add(md, { priority: 'P1', date: '2026-10-06', text: 'Checkout crashes' }).md
}

for (const surface of SURFACES)
{
  test(`groups by priority with ages (${surface})`, async ($, on) =>
  {
    fakeDisk(on, seeded())
    const ui = await $.ui.mount({ plugin: 'reminders', surface, component: 'Pane', requestId: 'todos', props: PROPS })

    expect((await ui.find({ key: 'group:P1' }))?.text).toContain('Blocking')
    expect(await ui.find({ key: 'group:P2' })).toBeUndefined()
    expect((await ui.find({ key: 'row:Retry limit undecided' }))?.text).toContain('7d')
    expect((await ui.find({ key: 'row:Retry limit undecided' }))?.text).toContain('src/net/retry.ts:42')
    expect((await ui.find({ text: /3 open · 2 blocking/ }))).toBeDefined()
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(12)
  })

  test(`Done completes that row (${surface})`, async ($, on) =>
  {
    const file = fakeDisk(on, seeded())
    const ui = await $.ui.mount({ plugin: 'reminders', surface, component: 'Pane', requestId: 'todos', props: PROPS })

    await ui.press({ key: 'done:Checkout crashes' })
    expect(parseOpen(file.md).map(t => t.text)).toEqual(['Retry limit undecided', 'Tidy settings page'])
    expect(await ui.find({ key: 'row:Checkout crashes' })).toBeUndefined()
  })

  test(`Undo puts a done item back (${surface})`, async ($, on) =>
  {
    const file = fakeDisk(on, complete(seeded(), 'Checkout crashes', '2026-10-07').md)
    const ui = await $.ui.mount({ plugin: 'reminders', surface, component: 'Pane', requestId: 'todos', props: PROPS })
    expect((await ui.find({ key: 'group:done' }))?.text).toContain('Checkout crashes')

    await ui.press({ key: 'undo:Checkout crashes' })
    expect(parseDone(file.md)).toEqual([])
    expect((await ui.find({ key: 'group:P1' }))?.text).toContain('Checkout crashes')
    expect(await ui.find({ key: 'group:done' })).toBeUndefined()
  })

  test(`Ask sends the item with the person's directions (${surface})`, async ($, on) =>
  {
    fakeDisk(on, seeded())
    const sent = stubPrompt(on)
    const ui = await $.ui.mount({ plugin: 'reminders', surface, component: 'Pane', requestId: 'todos', props: PROPS })
    expect(await ui.find({ key: 'how:Retry limit undecided' })).toBeUndefined()

    await ui.press({ key: 'ask:Retry limit undecided' })
    expect(await ui.find({ key: 'how:Retry limit undecided' })).toBeDefined()
    await ui.input({ key: 'how:Retry limit undecided', text: 'use 5, with exponential backoff' })

    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain('"Retry limit undecided" (P1, recorded 2026-09-30, at src/net/retry.ts:42)')
    expect(sent[0]).toContain('How I want it done: use 5, with exponential backoff')
    expect(sent[0]).toContain('complete_reminder')
  })

  test(`Ask with nothing typed lets Claude decide (${surface})`, async ($, on) =>
  {
    fakeDisk(on, seeded())
    const sent = stubPrompt(on)
    const ui = await $.ui.mount({ plugin: 'reminders', surface, component: 'Pane', requestId: 'todos', props: PROPS })

    await ui.press({ key: 'ask:Tidy settings page' })
    await ui.input({ key: 'how:Tidy settings page', text: '  ' })
    expect(sent[0]).toContain('take the initiative')
    expect(sent[0]).not.toContain('How I want it done')
  })

  test(`Ask pressed twice closes the field (${surface})`, async ($, on) =>
  {
    fakeDisk(on, seeded())
    const ui = await $.ui.mount({ plugin: 'reminders', surface, component: 'Pane', requestId: 'todos', props: PROPS })
    await ui.press({ key: 'ask:Tidy settings page' })
    await ui.press({ key: 'ask:Tidy settings page' })
    expect(await ui.find({ key: 'how:Tidy settings page' })).toBeUndefined()
  })

  test(`Add sends the person's note for Claude to word by the skill (${surface})`, async ($, on) =>
  {
    fakeDisk(on, EMPTY)
    const sent = stubPrompt(on)
    const ui = await $.ui.mount({ plugin: 'reminders', surface, component: 'Pane', requestId: 'todos', props: PROPS })
    expect(await ui.find({ key: 'add:note' })).toBeUndefined()

    await ui.press({ key: 'add' })
    await ui.input({ key: 'add:note', text: 'csv export breaks on commas' })

    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain('"csv export breaks on commas"')
    expect(sent[0]).toContain('reminders:writing-reminders')
    expect(sent[0]).toContain('add_reminder')
  })

  test(`Add with nothing typed sends nothing (${surface})`, async ($, on) =>
  {
    fakeDisk(on, EMPTY)
    const sent = stubPrompt(on)
    const ui = await $.ui.mount({ plugin: 'reminders', surface, component: 'Pane', requestId: 'todos', props: PROPS })

    await ui.press({ key: 'add' })
    await ui.input({ key: 'add:note', text: ' ' })
    expect(sent).toEqual([])
    expect(await ui.find({ key: 'add:note' })).toBeUndefined()
  })

  test(`a section's arrow folds and unfolds it (${surface})`, async ($, on) =>
  {
    fakeDisk(on, seeded())
    const ui = await $.ui.mount({ plugin: 'reminders', surface, component: 'Pane', requestId: 'todos', props: PROPS })

    await ui.press({ key: 'fold:P1' })
    expect((await ui.find({ key: 'group:P1' }))?.text).toContain('Blocking 2')
    expect(await ui.find({ key: 'row:Checkout crashes' })).toBeUndefined()

    await ui.press({ key: 'fold:P1' })
    expect(await ui.find({ key: 'row:Checkout crashes' })).toBeDefined()
  })

  test(`the priority button steps the item to the next priority (${surface})`, async ($, on) =>
  {
    const file = fakeDisk(on, seeded())
    const ui = await $.ui.mount({ plugin: 'reminders', surface, component: 'Pane', requestId: 'todos', props: PROPS })

    await ui.press({ key: 'prio:Checkout crashes' })
    expect(parseOpen(file.md).find(t => t.text === 'Checkout crashes')?.priority).toBe('P2')
    expect((await ui.find({ key: 'group:P2' }))?.text).toContain('Checkout crashes')

    await ui.press({ key: 'prio:Tidy settings page' })
    expect(parseOpen(file.md).find(t => t.text === 'Tidy settings page')?.priority).toBe('P1')
  })

  test(`a pointer to a missing file is flagged (${surface})`, async ($, on) =>
  {
    fakeDisk(on, seeded(), ['src/net/retry.ts'])
    const ui = await $.ui.mount({ plugin: 'reminders', surface, component: 'Pane', requestId: 'todos', props: PROPS })
    expect((await ui.find({ key: 'row:Retry limit undecided' }))?.text).toContain('file missing')
    expect((await ui.find({ key: 'row:Checkout crashes' }))?.text).not.toContain('file missing')
  })

  test(`empty list (${surface})`, async ($, on) =>
  {
    fakeDisk(on, EMPTY)
    const ui = await $.ui.mount({ plugin: 'reminders', surface, component: 'Pane', requestId: 'todos', props: PROPS })
    expect(await ui.find({ text: /Nothing open/ })).toBeDefined()
  })
}

test('age', async () =>
{
  expect(age('2026-10-07', '2026-10-07')).toBe('today')
  expect(age('2026-10-04', '2026-10-07')).toBe('3d')
  expect(age('2026-09-16', '2026-10-07')).toBe('3w')
  expect(age('2026-06-01', '2026-10-07')).toBe('4mo')
})
