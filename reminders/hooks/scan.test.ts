import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

// Prompts the command submits, as the model would read them; its timer fires at once.
const stubPrompt = (on: On) =>
{
  const sent: string[] = []
  on('prompt.submit', (_$, e) => (sent.push(e.text), { text: e.text }))
  on('clock.after', () => ({ value: undefined }))
  return sent
}

// Lets the timer's callback run after the command answered.
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

test('/todos --scan asks Claude to fill the list from the code', async ($, on) =>
{
  const sent = stubPrompt(on)
  await $.command.run({ command: 'todos', args: '--scan' })
  await settle()

  expect(sent).toHaveLength(1)
  expect(sent[0]).toContain('Fill Docs/todos.md with the unfinished work already in this project.')
  expect(sent[0]).toContain('TODO, FIXME, HACK and XXX in comments, in any case or form')
  expect(sent[0]).toContain('"for now", "temporary"')
  expect(sent[0]).toContain('list_reminders')
  expect(sent[0]).toContain('reminders:writing-reminders')
  expect(sent[0]).toContain('add_reminder')
  expect(sent[0]).toContain('change no code')
})

test('/todos --scan <path> limits the scan to that path', async ($, on) =>
{
  const sent = stubPrompt(on)
  await $.command.run({ command: 'todos', args: 'scan  src/api ' })
  await settle()

  expect(sent[0]).toContain('looking only in src/api.')
})

test('/todos add <note> asks Claude to word and record the note', async ($, on) =>
{
  const sent = stubPrompt(on)
  const r = await $.command.run({ command: 'todos', args: 'add csv export breaks on commas' })
  await settle()

  expect(r.text).toBeUndefined()
  expect(sent).toHaveLength(1)
  expect(sent[0]).toContain('"csv export breaks on commas"')
  expect(sent[0]).toContain('reminders:writing-reminders')
  expect(sent[0]).toContain('add_reminder')
})

test('/todos add with no note opens the pane instead', async ($, on) =>
{
  const sent = stubPrompt(on)
  on('fs.exists', () => ({ value: false }))
  on('ui.open', () => ({ value: undefined }))
  on('ui.focus', () => ({ value: {} }))
  const r = await $.command.run({ command: 'todos', args: 'add  ' })
  await settle()

  expect(sent).toEqual([])
  expect(r.text).toBe('Todos pane opened.')
})
