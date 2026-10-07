import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

// The `claude` commands the plugin runs, answered by `answer(argv)`; the status line is a stub.
const fakeCli = (on: On, answer: (argv: readonly string[]) => { exitCode: number; stdout: string }) =>
{
  const ran: string[] = []
  on('process.run', (_$, e) =>
  {
    ran.push(e.argv.join(' '))
    return { value: { stderr: '', ...answer(e.argv) } }
  })
  on('ui.status', () => ({ value: undefined }))
  return ran
}

test('/todos --update refreshes the marketplace, then updates the plugin', async ($, on) =>
{
  const ran = fakeCli(on, argv => ({ exitCode: 0, stdout: argv.includes('marketplace') ? 'Refreshed' : 'Updated to 0.3.0' }))
  const r = await $.command.run({ command: 'todos', args: '--update' })

  expect(ran).toEqual([
    'claude plugin marketplace update noash-tools',
    'claude plugin update reminders@noash-tools',
  ])
  expect(r.text).toContain('Updated to 0.3.0')
})

test('/todos --update stops when the marketplace refresh fails', async ($, on) =>
{
  const ran = fakeCli(on, () => ({ exitCode: 1, stdout: 'network down' }))
  const r = await $.command.run({ command: 'todos', args: 'update' })

  expect(ran).toHaveLength(1)
  expect(r.text).toContain('Could not refresh the noash-tools marketplace')
  expect(r.text).toContain('network down')
})
