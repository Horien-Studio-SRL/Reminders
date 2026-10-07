import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { add, EMPTY } from './todos'

const SURFACES = ['terminal', 'desktop'] as const
const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 6,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 6 },
  view: {},
} as const

// Docs/todos.md holds `md`, or is missing when `md` is undefined. The engine's own band is a stub.
const fakeDisk = (on: On, md: string | undefined) =>
{
  on('fs.exists', (_$, e) => ({ value: md !== undefined || !e.path.endsWith('todos.md') }))
  on('fs.read', () => ({ value: md ?? '' }))
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: 'engine' }))
}

const seeded = () =>
{
  let md = add(EMPTY, { priority: 'P3', date: '2026-10-07', text: 'Tidy settings page' }).md
  md = add(md, { priority: 'P1', date: '2026-09-30', text: 'Retry limit undecided' }).md
  return add(md, { priority: 'P1', date: '2026-10-06', text: 'Checkout crashes' }).md
}

const mount = ($: Parameters<Parameters<typeof test>[1]>[0], surface: (typeof SURFACES)[number]) =>
  $.ui.mount({ plugin: 'reminders', surface, component: 'AbovePrompt', props: PROPS })

for (const surface of SURFACES)
{
  test(`the line above the prompt counts open and blocking items (${surface})`, async ($, on) =>
  {
    fakeDisk(on, seeded())
    const ui = await mount($, surface)
    expect(await ui.find({ text: /Todos: 3 open · 2 blocking/ })).toBeDefined()
  })

  test(`before the file exists the line suggests a scan (${surface})`, async ($, on) =>
  {
    fakeDisk(on, undefined)
    const ui = await mount($, surface)
    expect(await ui.find({ text: /No reminders yet · \/todos --scan/ })).toBeDefined()
  })

  test(`with nothing open the line stays away (${surface})`, async ($, on) =>
  {
    fakeDisk(on, EMPTY)
    const ui = await mount($, surface)
    expect(await ui.find({ text: /Todos:/ })).toBeUndefined()
    expect(await ui.find({ text: 'engine' })).toBeDefined()
  })

  test(`another mod's drawing in the band stays, the line under it (${surface})`, async ($, on) =>
  {
    on('fs.exists', () => ({ value: true }))
    on('fs.read', () => ({ value: seeded() }))
    on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: 'meter: 42% used' }))
    const ui = await mount($, surface)
    const meter = await ui.find({ text: /meter: 42% used/ })
    const line = await ui.find({ text: /Todos: 3 open/ })
    expect(meter).toBeDefined()
    expect(line).toBeDefined()
  })

  test(`showHeader off hides the line (${surface})`, { options: { showHeader: false } }, async ($, on) =>
  {
    fakeDisk(on, seeded())
    const ui = await mount($, surface)
    expect(await ui.find({ text: /Todos:/ })).toBeUndefined()
  })
}

test('/todos --header off turns the showHeader option off', async ($, on) =>
{
  const set: unknown[] = []
  on('config.set', (_$, e) => (set.push([e.key, e.value]), { value: e.value }))
  const r = await $.command.run({ command: 'todos', args: '--header off' })

  expect(set).toEqual([['reminders.showHeader', false]])
  expect(r.text).toContain('/todos --header on')
})
