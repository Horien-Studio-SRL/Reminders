import type { EngineInterface, Register } from 'claude-code'

import { add, age, complete, EMPTY, format, parseDone, parseOpen, PATH, reopen, type Priority, type Todo } from './todos'

const PANE = 'todos'

const GROUPS: { priority: Priority; label: string; color: 'error' | 'warning' | 'subtle' }[] = [
  { priority: 'P1', label: 'Blocking', color: 'error' },
  { priority: 'P2', label: 'Incomplete', color: 'warning' },
  { priority: 'P3', label: 'Polish', color: 'subtle' },
]

// Done items the pane offers to undo.
const RECENT = 3

// Columns the right side of a row holds: a gap, then "[Ask]" or the age ("today", "11mo").
const RIGHT = 6

const rowKey = (t: Todo) => `done:${t.text}`
const askKey = (t: Todo) => `ask:${t.text}`
const howKey = (t: Todo) => `how:${t.text}`
const undoKey = (t: Todo) => `undo:${t.text}`
const ADD = 'add'
const NOTE = 'add:note'

// The button the focus ring is on; the row around it is drawn highlighted.
let focused: string | undefined
// The item whose Ask was pressed; its row shows the field for how Claude should do it.
let asking: string | undefined
// Whether Add was pressed; the header shows the field for the person's note. Never open with `asking`.
let adding = false

// Rows the pane needs: title, each group's header and the gap above it, two lines per item,
// the Ask or Add field, footer.
const paneRows = (open: Todo[], recent: Todo[]) =>
{
  const groups = new Set(open.map(t => t.priority)).size + (recent.length ? 1 : 0)
  return 1 + groups * 2 + open.length * 2 + 1 + recent.length + 2
}

// The prompt Ask sends: the item as recorded, then the person's directions or a go-ahead to decide.
export const resolvePrompt = (t: Todo, how: string) =>
{
  const facts = [t.priority, `recorded ${t.date}`, t.at && `at ${t.at}`].filter(Boolean).join(', ')
  const directions = how.trim()
    ? `How I want it done: ${how.trim()}`
    : 'I have no specific directions: take the initiative and pick the approach you judge best.'
  return [
    `Resolve this reminder from ${PATH}:`,
    `"${t.text}" (${facts})`,
    '',
    directions,
    '',
    'When the work is finished, mark it done with complete_reminder.',
  ].join('\n')
}

// The prompt Add sends: the person's rough note, for Claude to word, place and prioritise.
export const addPrompt = (note: string) =>
  [
    `Add a reminder to ${PATH} for this note of mine:`,
    `"${note.trim()}"`,
    '',
    'Load the reminders:writing-reminders skill and word the reminder by it.',
    'Read the code the note concerns to get the exact names and the at pointer, and pick the priority.',
    'Then call add_reminder. Only record it; the work itself waits for later.',
  ].join('\n')

const ADD_DESCRIPTION = `Record unfinished work in ${PATH} so a later session can pick it up.
Call it the moment you:
- leave a partial implementation (a stub, a skipped branch, a placeholder value),
- hit a design question nobody has decided (a balance number, an unspecified edge case),
- hear the user defer something ("later", "not now").
Don't call it for every ponytail: comment; /ponytail-debt covers those.
priority: P1 = something is broken or blocks other work, P2 = a feature is incomplete, P3 = polish or cleanup.
at: optional repo-relative pointer to the partial code, e.g. src/api/orders.ts:42.
Word the text by the reminders:writing-reminders skill; load it before your first reminder in a session.
The text must make sense with no context from this conversation.`

const COMPLETE_DESCRIPTION = `Mark an open reminder in ${PATH} done; it moves to the Done section.
match: a case-insensitive piece of the reminder text that matches exactly one open item.
If the item's pointer leads to a TODO/FIXME/ponytail: comment or a TODO note in memory/, delete that marker in the same change.`

const REOPEN_DESCRIPTION = `Move a reminder in ${PATH} from Done back to Open, keeping its priority and date.
Call it when the user says an item was marked done by mistake, or the work turns out unfinished.
match: a case-insensitive piece of the reminder text that matches exactly one Done item.`

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

const reopenItem = async ($: EngineInterface, match: string) =>
{
  const r = reopen(await load($), match)
  if (!r.error) await save($, r.md)
  return r
}

// The marketplace this plugin is published in.
const MARKETPLACE = 'horien-reminders'

// `/todos --update`: refresh the marketplace, then update the installed copy, the two `claude plugin`
// commands a person would run. The CLI picks the install's scope; a new version loads on restart.
const updatePlugin = async ($: EngineInterface) =>
{
  const id = `${$.plugin.name}@${MARKETPLACE}`
  const run = async (argv: string[]) =>
  {
    const r = await $.process.run(argv, { timeoutMs: 120_000 })
    return { ok: r.exitCode === 0, out: `${r.stdout}\n${r.stderr}`.trim() }
  }
  // An installed plugin runs from the plugin cache; anywhere else is a folder loaded with --plugin-dir.
  const fromFolder = !/[\\/]plugins[\\/]cache[\\/]/.test($.plugin.root)
  const note = fromFolder
    ? `\nThis session runs the plugin from ${$.plugin.root}, so the update reaches the installed copy other sessions load.`
    : ''

  $.ui.status('Checking for a reminders update...')
  try
  {
    const market = await run(['claude', 'plugin', 'marketplace', 'update', MARKETPLACE])
    if (!market.ok) return `Could not refresh the ${MARKETPLACE} marketplace:\n${market.out}`
    const update = await run(['claude', 'plugin', 'update', id])
    return (update.ok ? update.out : `Could not update ${id}:\n${update.out}`) + note
  }
  catch (err)
  {
    return `Could not run the claude CLI: ${err instanceof Error ? err.message : String(err)}`
  }
  finally
  {
    $.ui.status(undefined)
  }
}

export const register: Register = on =>
{
  on('session.start', async ($, e, next) =>
  {
    await $.command.register({
      name: 'todos',
      description: `Show open reminders from ${PATH}; --update updates this plugin`,
      argumentHint: '[--update]',
    })
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
    await $.tool.register({
      name: 'reopen_reminder',
      description: REOPEN_DESCRIPTION,
      inputSchema: { type: 'object', properties: { match: { type: 'string' } }, required: ['match'] },
    })
    return next(e)
  })

  on('command.run', { command: 'todos' }, async ($, e) =>
  {
    if (/^(--)?update$/.test(e.args.trim())) return { text: await updatePlugin($) }

    asking = undefined
    adding = false
    const md = await load($)
    const rows = paneRows(parseOpen(md), parseDone(md).slice(0, RECENT))
    await $.ui.open({ id: PANE, title: 'Todos', focus: true, closeOnEscape: true, rows: Math.max(4, rows) })
    return { text: 'Todos pane opened.' }
  })

  on('ui.focus', { requestId: PANE }, async ($, e, next) =>
  {
    const r = await next(e)
    if (!r.deny)
    {
      focused = e.element
      $.ui.invalidate('ui.render')
    }
    return r
  }).catch(($, e, next) => (next.called ? {} : next(e)))

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

  on('tool.call', { tool: 'mcp__reminders__reopen_reminder' }, async ($, e) =>
  {
    const r = await reopenItem($, String(e.match ?? ''))
    return { result: r.error ?? `Reopened: ${r.reopened!.text}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) =>
  {
    const { Box, Button, Input, Text } = $.ui.resolve(e)
    const md = await load($)
    const open = parseOpen(md)
    const recent = parseDone(md).slice(0, RECENT)
    const now = await today($)
    const blocking = open.filter(t => t.priority === 'P1').length

    const markDone = async (t: Todo) =>
    {
      const i = open.indexOf(t)
      const r = await closeItem($, t.text)
      if (r.error) return $.ui.toast(r.error)
      const rest = open.filter(o => o !== t)
      const next = rest[Math.min(i, rest.length - 1)]
      if (next) await $.ui.focus({ requestId: PANE, key: rowKey(next) }).catch(() => undefined)
    }

    // Ask opens the field under the row (pressed again, closes it); Enter in the field sends.
    const ask = async (t: Todo) =>
    {
      asking = asking === t.text ? undefined : t.text
      adding = false
      $.ui.invalidate('ui.render')
      if (asking) await $.ui.focus({ requestId: PANE, key: howKey(t) }).catch(() => undefined)
    }

    const send = async (t: Todo, how: string) =>
    {
      asking = undefined
      await $.ui.close({ id: PANE }).catch(() => undefined)
      await $.prompt.submit({ text: resolvePrompt(t, how), asUser: true })
    }

    // Add opens the field under the title (pressed again, closes it); Enter with a note sends it.
    const toggleAdd = async () =>
    {
      adding = !adding
      asking = undefined
      $.ui.invalidate('ui.render')
      if (adding) await $.ui.focus({ requestId: PANE, key: NOTE }).catch(() => undefined)
    }

    const sendNote = async (note: string) =>
    {
      adding = false
      if (!note.trim()) return $.ui.invalidate('ui.render')
      await $.ui.close({ id: PANE }).catch(() => undefined)
      await $.prompt.submit({ text: addPrompt(note), asUser: true })
    }

    const undo = async (t: Todo) =>
    {
      const r = await reopenItem($, t.text)
      if (r.error) return $.ui.toast(r.error)
      await $.ui.focus({ requestId: PANE, key: rowKey(t) }).catch(() => undefined)
    }

    // Done on the left; Ask on the right, above the item's age. The focused button is drawn bright.
    const row = (t: Todo) =>
    {
      const has = (key: string) => e.props.isFocused && focused === key
      const isFocused = has(rowKey(t)) || has(askKey(t)) || has(howKey(t))
      return (
        <Box key={`row:${t.text}`} flexDirection="column">
          <Box flexDirection="row">
            <Box flexShrink={0}>
              <Text color="claude">{isFocused ? '› ' : '  '}</Text>
              <Button key={rowKey(t)} label="[Done]" plain dimColor={!has(rowKey(t))} onPress={() => markDone(t)} />
            </Box>
            <Box flexDirection="column" flexGrow={1} flexShrink={1} paddingLeft={1}>
              <Text bold={isFocused} wrap="wrap">{t.text}</Text>
              {t.at && <Text dimColor wrap="truncate-start">{t.at}</Text>}
            </Box>
            <Box flexDirection="column" alignItems="flex-end" width={RIGHT} flexShrink={0}>
              <Button key={askKey(t)} label="[Ask]" plain dimColor={!has(askKey(t))} onPress={() => ask(t)} />
              <Text dimColor>{age(t.date, now)}</Text>
            </Box>
          </Box>
          {asking === t.text && (
            <Box paddingLeft={9}>
              <Input
                key={howKey(t)}
                placeholder="How should Claude do it? Empty: Claude decides"
                submitLabel="send"
                onSubmit={how => send(t, how)}
              />
            </Box>
          )}
        </Box>
      )
    }

    const doneRow = (t: Todo) =>
    {
      const isFocused = e.props.isFocused && focused === undoKey(t)
      return (
        <Box key={`donerow:${t.text}`} flexDirection="row">
          <Box flexShrink={0}>
            <Text color="claude">{isFocused ? '› ' : '  '}</Text>
            <Button key={undoKey(t)} label="[Undo]" plain dimColor={!isFocused} onPress={() => undo(t)} />
          </Box>
          <Box flexGrow={1} flexShrink={1} paddingLeft={1}>
            <Text dimColor={!isFocused} strikethrough wrap="truncate-end">{t.text}</Text>
          </Box>
          <Box justifyContent="flex-end" width={RIGHT} flexShrink={0}>
            <Text dimColor>{age(t.done!, now)}</Text>
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" width={e.props.bodyColumns}>
        <Box flexDirection="row" justifyContent="space-between">
          <Box flexShrink={0}>
            <Text bold>Todos </Text>
            <Button key={ADD} label="[Add]" plain dimColor={!(e.props.isFocused && focused === ADD)} onPress={toggleAdd} />
          </Box>
          <Text dimColor>
            {open.length ? `${open.length} open${blocking ? ` · ${blocking} blocking` : ''}` : PATH}
          </Text>
        </Box>
        {adding && (
          <Input
            key={NOTE}
            placeholder="What to remember? Claude words it and adds it"
            submitLabel="send"
            onSubmit={note => sendNote(note)}
          />
        )}
        {!open.length && (
          <Box marginTop={1}>
            <Text dimColor>Nothing open. Press Add, or Claude adds items here when it leaves work unfinished.</Text>
          </Box>
        )}
        {GROUPS.map(g =>
        {
          const items = open.filter(t => t.priority === g.priority)
          if (!items.length) return null
          return (
            <Box key={`group:${g.priority}`} flexDirection="column" marginTop={1}>
              <Text color={g.color} bold>
                {g.priority} {g.label} <Text dimColor>{items.length}</Text>
              </Text>
              {items.map(row)}
            </Box>
          )
        })}
        {recent.length > 0 && (
          <Box key="group:done" flexDirection="column" marginTop={1}>
            <Text dimColor bold>Recently done</Text>
            {recent.map(doneRow)}
          </Box>
        )}
        <Box marginTop={1}>
          <Text dimColor>{e.props.isFocused ? '↑↓ move · Enter press · Esc close' : 'ctrl+x tab to select'}</Text>
        </Box>
      </Box>
    )
  })
}
