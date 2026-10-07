import type { EngineInterface, Register } from 'claude-code'

import { add, complete, EMPTY, format, parseOpen, PATH, type Priority } from './todos'

const PANE = 'todos'

const ADD_DESCRIPTION = `Record unfinished work in ${PATH} so a later session can pick it up.
Call it the moment you:
- leave a partial implementation (a stub, a skipped branch, a placeholder value),
- hit a design question nobody has decided (a balance number, an unspecified edge case),
- hear the user defer something ("later", "not now").
Don't call it for every ponytail: comment; /ponytail-debt covers those.
priority: P1 = something is broken or blocks other work, P2 = a feature is incomplete, P3 = polish or cleanup.
at: optional repo-relative pointer to the partial code, e.g. Assets/Game/Scripts/X.cs:42.
Write the text so it makes sense with no context from this conversation.`

const COMPLETE_DESCRIPTION = `Mark an open reminder in ${PATH} done; it moves to the Done section.
match: a case-insensitive piece of the reminder text that matches exactly one open item.
If the item's pointer leads to a TODO/FIXME/ponytail: comment or a TODO note in memory/, delete that marker in the same change.`

const today = async ($: EngineInterface) =>
{
  const d = new Date(await $.clock.now())
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const load = async ($: EngineInterface) => ((await $.fs.exists(PATH)) ? $.fs.read(PATH) : EMPTY)

const save = async ($: EngineInterface, md: string) =>
{
  await $.fs.write(PATH, md)
  $.ui.invalidate('ui.render')
}

const closeItem = async ($: EngineInterface, match: string) =>
{
  const r = complete(await load($), match, await today($))
  if (!r.error) await save($, r.md)
  return r
}

export const register: Register = on =>
{
  on('session.start', async ($, e, next) =>
  {
    await $.command.register({ name: 'todos', description: `Show open reminders from ${PATH}` })
    await $.tool.register({
      name: 'add_reminder',
      description: ADD_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          priority: { type: 'string', enum: ['P1', 'P2', 'P3'] },
          at: { type: 'string' },
        },
        required: ['text', 'priority'],
      },
    })
    await $.tool.register({
      name: 'list_reminders',
      description: `List open reminders from ${PATH}, sorted P1 to P3. Call only when the user asks about open work or reminders.`,
    })
    await $.tool.register({
      name: 'complete_reminder',
      description: COMPLETE_DESCRIPTION,
      inputSchema: { type: 'object', properties: { match: { type: 'string' } }, required: ['match'] },
    })
    return next(e)
  })

  on('command.run', { command: 'todos' }, async $ =>
  {
    await $.ui.open({ id: PANE, title: 'Todos' })
    return { text: 'Todos pane opened.' }
  })

  on('tool.call', { tool: 'mcp__reminders__add_reminder' }, async ($, e) =>
  {
    const priority = (['P1', 'P2', 'P3'].includes(String(e.priority)) ? e.priority : 'P2') as Priority
    const at = typeof e.at === 'string' && e.at.trim() ? e.at.trim() : undefined
    const item = { priority, date: await today($), text: String(e.text ?? ''), at }
    const r = add(await load($), item)
    if (r.error) return { result: r.error }
    await save($, r.md)
    return { result: `Added: ${format(item)}` }
  })

  on('tool.call', { tool: 'mcp__reminders__list_reminders' }, async $ =>
  {
    const open = parseOpen(await load($))
    return { result: open.length ? open.map(format).join('\n') : 'No open reminders.' }
  })

  on('tool.call', { tool: 'mcp__reminders__complete_reminder' }, async ($, e) =>
  {
    const r = await closeItem($, String(e.match ?? ''))
    return { result: r.error ?? `Done: ${r.done!.text}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) =>
  {
    const { Box, Button, Text } = $.ui.resolve(e)
    const open = parseOpen(await load($))
    if (!open.length) return <Text dimColor>No open reminders in {PATH}.</Text>

    return (
      <Box flexDirection="column">
        {open.map((t, i) => (
          <Box key={`row${i}`} flexDirection="row">
            <Button
              key={`done${i}`}
              label="Done"
              onPress={async () =>
              {
                const r = await closeItem($, t.text)
                if (r.error) $.ui.toast(r.error)
              }}
            />
            <Text color={t.priority === 'P1' ? 'red' : undefined}> {t.priority} {t.text}</Text>
            {t.at && <Text dimColor> {t.at}</Text>}
          </Box>
        ))}
      </Box>
    )
  })
}
