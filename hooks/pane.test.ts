import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { across, clampExplanation, explainPrompt, vertical } from './register'
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
// 2026-10-07. A path ending in a key of `code` reads as its text. The engine's own pane drawing is a stub.
const fakeDisk = (on: On, md: string, gone: string[] = [], code: Record<string, string> = {}) =>
{
  const file = { md }
  const ends = (path: string, end: string) => path.replace(/\\/g, '/').endsWith(end)
  on('fs.exists', (_$, e) => ({ value: !gone.some(g => ends(e.path, g)) }))
  on('fs.read', (_$, e) => ({ value: Object.entries(code).find(([end]) => ends(e.path, end))?.[1] ?? file.md }))
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

// The person's arrow key moving the pane's focus ring onto `element`, as the engine raises it.
const arrowTo = ($: Parameters<Parameters<typeof test>[1]>[0], element: string) =>
  $.ui.focus({ component: 'Pane', requestId: 'todos', plugin: 'reminders', element, origin: { kind: 'person' } } as never)

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
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(15)
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

  test(`the focused button's row, header or title shows the marker (${surface})`, async ($, on) =>
  {
    fakeDisk(on, seeded())
    on('ui.focus', () => ({}))
    const ui = await $.ui.mount({ plugin: 'reminders', surface, component: 'Pane', requestId: 'todos', props: PROPS })

    await arrowTo($, 'add')
    expect((await ui.find({ key: 'title' }))?.text).toMatch(/^› Todos/)

    await arrowTo($, 'ask:Retry limit undecided')
    expect((await ui.find({ key: 'row:Retry limit undecided' }))?.text).toContain('›')
    expect((await ui.find({ key: 'row:Checkout crashes' }))?.text).not.toContain('›')
    expect((await ui.find({ key: 'title' }))?.text).not.toContain('›')

    await arrowTo($, 'fold:P1')
    expect((await ui.find({ key: 'group:P1' }))?.text).toMatch(/^› ▾ P1/)
    expect((await ui.find({ key: 'row:Retry limit undecided' }))?.text).not.toContain('›')
  })

  test(`Tab and Shift+Tab step along the item's buttons, wrapping (${surface})`, async ($, on) =>
  {
    fakeDisk(on, seeded())
    const landed: (string | undefined)[] = []
    on('ui.focus', (_$, e) => (landed.push(e.element), {}))
    const ui = await $.ui.mount({ plugin: 'reminders', surface, component: 'Pane', requestId: 'todos', props: PROPS })
    // The engine's ring: every button in the order drawn.
    const ring = (await ui.findAll({ type: 'Button' })).map(b => b.key!)
    const tab = (from: string, by: number) => arrowTo($, ring[ring.indexOf(from) + by])

    await arrowTo($, 'done:Checkout crashes')
    await tab('done:Checkout crashes', 1)
    await tab('prio:Checkout crashes', 1)
    await tab('why:Checkout crashes', 1)
    await tab('ask:Checkout crashes', 1)
    await tab('done:Checkout crashes', -1)
    expect(landed).toEqual([
      'done:Checkout crashes', 'prio:Checkout crashes', 'why:Checkout crashes', 'ask:Checkout crashes',
      'done:Checkout crashes', 'ask:Checkout crashes',
    ])
  })

  // The arrows' move onto the next button goes through `step`; the kit can't carry a hook's $.ui.focus.
  test(`the wheel and the page keys still scroll the pane (${surface})`, async ($, on) =>
  {
    fakeDisk(on, seeded())
    const scrolls: number[] = []
    on('ui.scroll', (_$, e) => (scrolls.push(e.by), {}))
    await $.ui.mount({ plugin: 'reminders', surface, component: 'Pane', requestId: 'todos', props: PROPS })
    const scroll = (by: number, pointer?: object) =>
      $.ui.scroll({ component: 'Pane', requestId: 'todos', offset: 1, by, bodyRows: 5, contentRows: 20, origin: { kind: 'person' }, pointer } as never)

    await scroll(5)
    await scroll(1, { row: 0, column: 0 })
    expect(scrolls).toEqual([5, 1])
  })

  test(`[?] shows a short explanation from the small model, asked once (${surface})`, async ($, on) =>
  {
    fakeDisk(on, seeded(), [], { 'src/net/retry.ts': 'const a = 1\nconst limit = undefined\n' })
    const asked: { model: string; prompt: string }[] = []
    on('model.complete', (_$, e) =>
    {
      asked.push({ model: e.model, prompt: String(e.prompt) })
      return { value: { isAnswered: true, text: 'The retry count is unset.', usage: { input_tokens: 600, output_tokens: 20 } } }
    })
    on('ui.open', () => ({ value: undefined }))
    on('ui.panes', () => ({ value: [{ id: 'todos', title: 'Todos', isShown: true, isFocused: true }] }))
    const ui = await $.ui.mount({ plugin: 'reminders', surface, component: 'Pane', requestId: 'todos', props: PROPS })

    await ui.press({ key: 'why:Retry limit undecided' })
    expect((await ui.find({ key: 'explanation:Retry limit undecided' }))?.text).toBe('The retry count is unset.')
    expect(asked).toHaveLength(1)
    expect(asked[0].model).toBe('haiku')
    expect(asked[0].prompt).toContain('2  const limit = undefined')

    await ui.press({ key: 'why:Retry limit undecided' })
    expect(await ui.find({ key: 'explanation:Retry limit undecided' })).toBeUndefined()
    await ui.press({ key: 'why:Retry limit undecided' })
    expect((await ui.find({ key: 'explanation:Retry limit undecided' }))?.text).toBe('The retry count is unset.')
    expect(asked).toHaveLength(1)
  })

  test(`empty list (${surface})`, async ($, on) =>
  {
    fakeDisk(on, EMPTY)
    const ui = await $.ui.mount({ plugin: 'reminders', surface, component: 'Pane', requestId: 'todos', props: PROPS })
    expect(await ui.find({ text: /Nothing open/ })).toBeDefined()
  })
}

test('↑↓ move between lines keeping the column, Tab along one', async () =>
{
  const lines = [['add'], ['fold:P1'], ['done:a', 'prio:a', 'ask:a'], ['done:b', 'prio:b', 'ask:b'], ['undo:c']]
  expect(vertical(lines, undefined, 1, 0)).toBe('add')
  expect(vertical(lines, undefined, -1, 0)).toBe('undo:c')
  expect(vertical(lines, 'ask:a', 1, 2)).toBe('ask:b')
  expect(vertical(lines, 'fold:P1', 1, 2)).toBe('ask:a')
  expect(vertical(lines, 'ask:b', 1, 2)).toBe('undo:c')
  expect(vertical(lines, 'undo:c', 1, 2)).toBe('add')
  expect(vertical(lines, 'add', -1, 1)).toBe('undo:c')
  expect(across(lines, 'done:a', 1)).toBe('prio:a')
  expect(across(lines, 'ask:a', 1)).toBe('done:a')
  expect(across(lines, 'done:a', -1)).toBe('ask:a')
  expect(across(lines, 'fold:P1', 1)).toBe('fold:P1')
})

test('[?] sends the entry and the code around its line, numbered', async () =>
{
  const code = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n')
  const t = { priority: 'P1' as const, date: '2026-10-06', text: 'Retry limit undecided', at: 'src/net/retry.ts:50', line: 0 }
  const p = explainPrompt(t, code)
  expect(p).toStartWith('Entry (P1, recorded 2026-10-06): "Retry limit undecided"')
  expect(p).toContain('Lines 30-70 of src/net/retry.ts:')
  expect(p).toContain('50  line 50')
  expect(p).not.toContain('line 29')
  expect(p).not.toContain('line 71')
  expect(explainPrompt({ ...t, at: undefined })).toBe('Entry (P1, recorded 2026-10-06): "Retry limit undecided"')
  expect(explainPrompt(t)).toContain('the file is missing')
})

test('an explanation is drawn as one paragraph of at most 3 rows, cut at a sentence', async () =>
{
  expect(clampExplanation('Short.\n\nStill short.', 60)).toBe('Short. Still short.')
  const long = Array.from({ length: 20 }, (_, i) => `Sentence number ${i + 1} is here.`).join(' ')
  const cut = clampExplanation(long, 60)
  expect(cut.length).toBeLessThanOrEqual((60 - 13) * 3)
  expect(cut).toEndWith('is here.')
  expect(clampExplanation('x'.repeat(500), 60)).toEndWith('…')
})

test('age', async () =>
{
  expect(age('2026-10-07', '2026-10-07')).toBe('today')
  expect(age('2026-10-04', '2026-10-07')).toBe('3d')
  expect(age('2026-09-16', '2026-10-07')).toBe('3w')
  expect(age('2026-06-01', '2026-10-07')).toBe('4mo')
})
