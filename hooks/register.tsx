import type { EngineInterface, Register, ToolCallResult } from 'claude-code'

import {
  add, age, complete, EMPTY, format, parseDone, parseOpen, PATH, pointerFile, reopen, setPriority, type Priority, type Todo,
} from './todos'

const PANE = 'todos'

const GROUPS: { priority: Priority; label: string; color: 'error' | 'warning' | 'subtle' }[] = [
  { priority: 'P1', label: 'Blocking', color: 'error' },
  { priority: 'P2', label: 'Incomplete', color: 'warning' },
  { priority: 'P3', label: 'Polish', color: 'subtle' },
]

// What the priority button on a row steps to.
const NEXT_PRIORITY: Record<Priority, Priority> = { P1: 'P2', P2: 'P3', P3: 'P1' }

// Done items the pane offers to undo.
const RECENT = 3

// Columns the left side of a row holds: the focus mark and "[Done]", the priority button under it.
const LEFT = 8
// Columns the right side of a row holds: a gap, then "[Ask]" or the age ("today", "11mo").
const RIGHT = 6
// Days after which an item's age is drawn in the warning color.
const OLD_DAYS = 30

const rowKey = (t: Todo) => `done:${t.text}`
const prioKey = (t: Todo) => `prio:${t.text}`
const askKey = (t: Todo) => `ask:${t.text}`
const howKey = (t: Todo) => `how:${t.text}`
const undoKey = (t: Todo) => `undo:${t.text}`
const foldKey = (section: string) => `fold:${section}`
const ADD = 'add'
const NOTE = 'add:note'

// The button the focus ring is on; the row around it is drawn highlighted.
let focused: string | undefined
// The item whose Ask was pressed; its row shows the field for how Claude should do it.
let asking: string | undefined
// Whether Add was pressed; the header shows the field for the person's note. Never open with `asking`.
let adding = false
// Sections folded in the pane (P1, P2, P3, done), kept in $.store across sessions.
let folded: Set<string> | undefined
// Reminders already pointed out to Claude this session, so each edit to their file doesn't repeat them.
const told = new Set<string>()

// The `path` and `showHeader` options; set by register.
let configured = ''
let showHeader = true
// The reminders file for this project, found once per session.
let where: Promise<string> | undefined

// The `path` option, else docs/todos.md in an existing docs folder spelled any case, else Docs/todos.md.
const detect = async ($: EngineInterface) =>
{
  if (configured) return configured
  const dirs = await $.fs.list().then(
    entries => entries.filter(x => x.kind === 'dir' && x.name.toLowerCase() === 'docs').map(x => x.name),
    () => [] as string[],
  )
  for (const dir of dirs) if (await $.fs.exists(`${dir}/todos.md`)) return `${dir}/todos.md`
  return dirs.length ? `${dirs[0]}/todos.md` : PATH
}
const filePath = ($: EngineInterface) => (where ??= detect($))

const getFolded = async ($: EngineInterface) =>
{
  if (folded) return folded
  const kept = await $.store.get('folded').catch(() => undefined)
  return (folded ??= new Set(Array.isArray(kept) ? kept.filter(x => typeof x === 'string') : []))
}

// Rows the pane needs: title, each section's header and the gap above it, two lines per item in an
// unfolded section, the Ask or Add field, footer.
const paneRows = (open: Todo[], recent: Todo[], fold: Set<string>) =>
{
  let rows = 1 + 1 + 2
  for (const g of GROUPS)
  {
    const n = open.filter(t => t.priority === g.priority).length
    if (n) rows += 2 + (fold.has(g.priority) ? 0 : n * 2)
  }
  if (recent.length) rows += 2 + (fold.has('done') ? 0 : recent.length)
  return Math.max(4, rows)
}

// Repo-relative or absolute, either slash, any case: comparable.
const norm = (p: string) => p.trim().replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()
const sameFile = (edited: string, file: string) => edited === file || edited.endsWith(`/${file}`)

// The prompt Ask sends: the item as recorded, then the person's directions or a go-ahead to decide.
export const resolvePrompt = (t: Todo, how: string, path = PATH) =>
{
  const facts = [t.priority, `recorded ${t.date}`, t.at && `at ${t.at}`].filter(Boolean).join(', ')
  const directions = how.trim()
    ? `How I want it done: ${how.trim()}`
    : 'I have no specific directions: take the initiative and pick the approach you judge best.'
  return [
    `Resolve this reminder from ${path}:`,
    `"${t.text}" (${facts})`,
    '',
    directions,
    '',
    'When the work is finished, mark it done with complete_reminder.',
  ].join('\n')
}

// The prompt Add sends: the person's rough note, for Claude to word, place and prioritise.
export const addPrompt = (note: string, path = PATH) =>
  [
    `Add a reminder to ${path} for this note of mine:`,
    `"${note.trim()}"`,
    '',
    'Load the reminders:writing-reminders skill and word the reminder by it.',
    'Read the code the note concerns to get the exact names and the at pointer, and pick the priority.',
    'Then call add_reminder. Only record it; the work itself waits for later.',
  ].join('\n')

// Reminders one scan records at most; the rest are listed in Claude's reply.
const SCAN_LIMIT = 30

// The prompt `/todos --scan` sends: collect the unfinished work already in the code, optionally under `within`.
export const scanPrompt = (within: string, path = PATH) =>
  [
    `Fill ${path} with the unfinished work already in this project${within.trim() ? `, looking only in ${within.trim()}` : ''}.`,
    '',
    'Look for:',
    '- TODO, FIXME, HACK and XXX comments;',
    '- stubs: code that throws "not implemented", returns a placeholder value, or is left empty for later;',
    '- skipped or disabled tests;',
    '- known issues and open questions written in the README or other docs.',
    '',
    'Search tracked files only (git grep in a git repository) and skip vendored, generated and build output.',
    'Call list_reminders first and skip anything an open reminder already covers.',
    'Read the code around each finding before judging it: drop what is stale or already done,',
    'and merge findings that describe the same piece of work into one reminder.',
    'Load the reminders:writing-reminders skill and word each reminder by it, with an at pointer and a priority.',
    `Then call add_reminder for each, at most ${SCAN_LIMIT}: if there are more, keep the ones that matter most.`,
    'Only record them; change no code.',
    'Finish with how many you added per priority, and what you left out and why.',
  ].join('\n')

// What Claude reads after editing a file that open reminders point at.
export const pointerNote = (items: Todo[], path = PATH) =>
  [
    `Open reminders in ${path} point at the file you just changed:`,
    ...items.map(t => `- ${t.priority} ${t.text} (at ${t.at})`),
    'If your change finishes one, call complete_reminder for it. If it makes one inaccurate, tell the user.',
  ].join('\n')

const USAGE = 'Usage: /todos [add <note> | --scan [path] | --header on|off | --update]'

const addDescription = (path: string) => `Record unfinished work in ${path} so a later session can pick it up.
Call it the moment you:
- leave a partial implementation (a stub, a skipped branch, a placeholder value),
- hit a design question nobody has decided (a balance number, an unspecified edge case),
- hear the user defer something ("later", "not now").
Don't call it for every ponytail: comment; /ponytail-debt covers those.
priority: P1 = something is broken or blocks other work, P2 = a feature is incomplete, P3 = polish or cleanup.
at: optional repo-relative pointer to the partial code, e.g. src/api/orders.ts:42.
Word the text by the reminders:writing-reminders skill; load it before your first reminder in a session.
The text must make sense with no context from this conversation.`

const completeDescription = (path: string) => `Mark an open reminder in ${path} done; it moves to the Done section.
match: a case-insensitive piece of the reminder text that matches exactly one open item.
If the item's pointer leads to a TODO/FIXME/ponytail: comment or a TODO note in memory/, delete that marker in the same change.`

const reopenDescription = (path: string) => `Move a reminder in ${path} from Done back to Open, keeping its priority and date.
Call it when the user says an item was marked done by mistake, or the work turns out unfinished.
match: a case-insensitive piece of the reminder text that matches exactly one Done item.`

const today = async ($: EngineInterface) =>
{
  const d = new Date(await $.clock.now())
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const load = async ($: EngineInterface) =>
{
  const path = await filePath($)
  return (await $.fs.exists(path)) ? $.fs.read(path) : EMPTY
}

const save = async ($: EngineInterface, md: string) =>
{
  await $.fs.write(await filePath($), md)
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

// Opens the pane sized to its content, or resizes it when already open.
const openPane = async ($: EngineInterface) =>
{
  const md = await load($)
  const rows = paneRows(parseOpen(md), parseDone(md).slice(0, RECENT), await getFolded($))
  await $.ui.open({ id: PANE, title: 'Todos', focus: true, closeOnEscape: true, rows })
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

// After Claude edits a file (Edit, Write, NotebookEdit), name the open reminders that point at it, once
// each per session. An edit to the reminders file itself redraws the pane and the line above the prompt.
const afterEdit = async <R extends ToolCallResult>($: EngineInterface, e: object, r: R): Promise<R> =>
{
  if (r.deny || r.isError) return r
  try
  {
    const input = e as { file_path?: unknown; notebook_path?: unknown }
    const edited = norm(String(input.file_path ?? input.notebook_path ?? ''))
    const path = await filePath($)
    if (!edited) return r
    if (sameFile(edited, norm(path)))
    {
      $.ui.invalidate('ui.render')
      return r
    }
    const hits = parseOpen(await load($)).filter(t => t.at && !told.has(t.text) && sameFile(edited, norm(pointerFile(t.at))))
    if (!hits.length) return r
    hits.forEach(t => told.add(t.text))
    return { ...r, context: [...(r.context ?? []), pointerNote(hits, path)] } as R
  }
  catch
  {
    return r
  }
}

// `/todos --header on|off`: the showHeader option, kept in settings; bare, it flips.
const setHeader = async ($: EngineInterface, value: boolean) =>
{
  const r = await $.config.set({ key: `${$.plugin.name}.showHeader`, value })
  if (r.deny) return `Could not change the reminders line: ${r.deny}`
  showHeader = value
  $.ui.invalidate('ui.render')
  return value
    ? 'The reminders line above the prompt is on.'
    : 'The reminders line above the prompt is off. /todos --header on brings it back.'
}

export const register: Register = (on, options) =>
{
  configured = typeof options.path === 'string' ? options.path.trim() : ''
  showHeader = options.showHeader !== false
  where = undefined

  on('session.start', async ($, e, next) =>
  {
    where = undefined
    told.clear()
    const path = await filePath($)
    await $.command.register({
      name: 'todos',
      description: `Show open reminders from ${path}; add <note> records one, --scan fills it from the code`,
      argumentHint: '[add <note> | --scan [path] | --header on|off | --update]',
    })
    await $.tool.register({
      name: 'add_reminder',
      description: addDescription(path),
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
      description: `List open reminders from ${path}, sorted P1 to P3. Call only when the user asks about open work or reminders.`,
    })
    await $.tool.register({
      name: 'complete_reminder',
      description: completeDescription(path),
      inputSchema: { type: 'object', properties: { match: { type: 'string' } }, required: ['match'] },
    })
    await $.tool.register({
      name: 'reopen_reminder',
      description: reopenDescription(path),
      inputSchema: { type: 'object', properties: { match: { type: 'string' } }, required: ['match'] },
    })
    return next(e)
  })

  on('command.run', { command: 'todos' }, async ($, e) =>
  {
    // A command can't submit while its own run holds the prompt, so the prompt is sent once it ends.
    const sendAfter = (text: string) =>
    {
      $.clock.after(0, () => void $.prompt.submit({ text, asUser: true }).catch(err => $.ui.toast(`Could not send to Claude: ${err}`)))
      return {}
    }

    const args = e.args.trim()
    const path = await filePath($)
    if (/^(--)?update$/.test(args)) return { text: await updatePlugin($) }
    const header = /^(?:--)?header(?:\s+(on|off))?$/i.exec(args)
    if (header) return { text: await setHeader($, header[1] ? header[1].toLowerCase() === 'on' : !showHeader) }
    const scan = /^(?:--)?scan(?:\s+(.*))?$/s.exec(args)
    if (scan) return sendAfter(scanPrompt(scan[1] ?? '', path))
    // `/todos add <note>` sends the note; `/todos add` alone opens the pane with the Add field.
    const note = /^(?:--)?add(?:\s+(.*))?$/s.exec(args)
    if (note?.[1]?.trim()) return sendAfter(addPrompt(note[1], path))
    if (args && !note) return { text: USAGE }

    asking = undefined
    adding = !!note
    await openPane($)
    if (adding) await $.ui.focus({ requestId: PANE, key: NOTE }).catch(() => undefined)
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
    if (r.error) return { result: r.error }
    $.ui.toast(`Done: ${r.done!.text}`)
    return { result: `Done: ${r.done!.text}` }
  })

  on('tool.call', { tool: 'mcp__reminders__reopen_reminder' }, async ($, e) =>
  {
    const r = await reopenItem($, String(e.match ?? ''))
    return { result: r.error ?? `Reopened: ${r.reopened!.text}` }
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => afterEdit($, e, await next(e)))
  on('tool.call', { tool: 'Write' }, async ($, e, next) => afterEdit($, e, await next(e)))
  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => afterEdit($, e, await next(e)))

  // The line at the top right of the prompt: open and blocking counts, or a hint before the file exists.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) =>
  {
    if (!showHeader || e.props.hasSurvey) return next(e)
    const path = await filePath($)
    const exists = await $.fs.exists(path)
    const open = exists ? parseOpen(await $.fs.read(path)) : []
    if (exists && !open.length) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const blocking = open.filter(t => t.priority === 'P1').length
    return (
      <Box key="todos-line" width={e.props.bodyColumns} justifyContent="flex-end">
        {exists ? (
          <Text wrap="truncate-start">
            <Text dimColor>Todos: {open.length} open</Text>
            {blocking > 0 && <Text dimColor> · </Text>}
            {blocking > 0 && <Text color="error">{blocking} blocking</Text>}
            <Text dimColor> · /todos</Text>
          </Text>
        ) : (
          <Text dimColor wrap="truncate-start">No reminders yet · /todos --scan collects the TODOs in the code</Text>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) =>
  {
    const { Box, Button, Input, Text } = $.ui.resolve(e)
    const path = await filePath($)
    const md = await load($)
    const open = parseOpen(md)
    const recent = parseDone(md).slice(0, RECENT)
    const now = await today($)
    const blocking = open.filter(t => t.priority === 'P1').length
    const fold = await getFolded($)
    const missing = new Set<string>()
    for (const t of open) if (t.at && !(await $.fs.exists(pointerFile(t.at)))) missing.add(t.text)
    const has = (key: string) => e.props.isFocused && focused === key

    const markDone = async (t: Todo) =>
    {
      const i = open.indexOf(t)
      const r = await closeItem($, t.text)
      if (r.error) return $.ui.toast(r.error)
      const rest = open.filter(o => o !== t)
      const next = rest[Math.min(i, rest.length - 1)]
      if (next) await $.ui.focus({ requestId: PANE, key: rowKey(next) }).catch(() => undefined)
    }

    // The priority button steps P1, P2, P3 and round; the item moves to that section, unfolded.
    const cycle = async (t: Todo) =>
    {
      const to = NEXT_PRIORITY[t.priority]
      const r = setPriority(await load($), t.text, to)
      if (r.error) return $.ui.toast(r.error)
      if (fold.delete(to)) await $.store.set('folded', [...fold]).catch(() => undefined)
      await save($, r.md)
      await $.ui.focus({ requestId: PANE, key: prioKey(t) }).catch(() => undefined)
    }

    // A section's arrow folds it to its header, or unfolds it; the pane resizes to fit.
    const toggleFold = async (section: string) =>
    {
      if (!fold.delete(section)) fold.add(section)
      await $.store.set('folded', [...fold]).catch(() => undefined)
      $.ui.invalidate('ui.render')
      await openPane($).catch(() => undefined)
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
      await $.prompt.submit({ text: resolvePrompt(t, how, path), asUser: true })
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
      await $.prompt.submit({ text: addPrompt(note, path), asUser: true })
    }

    const undo = async (t: Todo) =>
    {
      const r = await reopenItem($, t.text)
      if (r.error) return $.ui.toast(r.error)
      fold.delete(t.priority)
      await $.ui.focus({ requestId: PANE, key: rowKey(t) }).catch(() => undefined)
    }

    // A section header: the fold arrow, then the title and count.
    const sectionHeader = (section: string, title: JSX.Element) => (
      <Box flexDirection="row">
        <Button key={foldKey(section)} label={fold.has(section) ? '▸' : '▾'} plain dimColor={!has(foldKey(section))} onPress={() => toggleFold(section)} />
        <Text> </Text>
        {title}
      </Box>
    )

    // [Done] with the priority button under it, right-aligned; the text and pointer; [Ask] above the age.
    const row = (t: Todo) =>
    {
      const isFocused = has(rowKey(t)) || has(prioKey(t)) || has(askKey(t)) || has(howKey(t))
      const days = Math.round((Date.parse(now) - Date.parse(t.date)) / 86_400_000)
      return (
        <Box key={`row:${t.text}`} flexDirection="column">
          <Box flexDirection="row">
            <Box flexDirection="column" width={LEFT} flexShrink={0}>
              <Box>
                <Text color="claude">{isFocused ? '› ' : '  '}</Text>
                <Button key={rowKey(t)} label="[Done]" plain dimColor={!has(rowKey(t))} onPress={() => markDone(t)} />
              </Box>
              <Box justifyContent="flex-end">
                <Button key={prioKey(t)} label={`[${t.priority}]`} plain dimColor={!has(prioKey(t))} onPress={() => cycle(t)} />
              </Box>
            </Box>
            <Box flexDirection="column" flexGrow={1} flexShrink={1} paddingLeft={1}>
              <Text bold={isFocused} wrap="wrap">{t.text}</Text>
              {t.at && (
                <Box flexDirection="row">
                  <Text dimColor wrap="truncate-start">{t.at}</Text>
                  {missing.has(t.text) && <Text color="warning"> · file missing</Text>}
                </Box>
              )}
            </Box>
            <Box flexDirection="column" alignItems="flex-end" width={RIGHT} flexShrink={0}>
              <Button key={askKey(t)} label="[Ask]" plain dimColor={!has(askKey(t))} onPress={() => ask(t)} />
              {days >= OLD_DAYS ? <Text color="warning">{age(t.date, now)}</Text> : <Text dimColor>{age(t.date, now)}</Text>}
            </Box>
          </Box>
          {asking === t.text && (
            <Box paddingLeft={LEFT + 1}>
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
      const isFocused = has(undoKey(t))
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
            <Button key={ADD} label="[Add]" plain dimColor={!has(ADD)} onPress={toggleAdd} />
          </Box>
          <Text dimColor>
            {open.length ? `${open.length} open${blocking ? ` · ${blocking} blocking` : ''}` : path}
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
            <Text dimColor>Nothing open. Run /todos --scan to collect the TODOs already in the code, or press Add.</Text>
          </Box>
        )}
        {GROUPS.map(g =>
        {
          const items = open.filter(t => t.priority === g.priority)
          if (!items.length) return null
          return (
            <Box key={`group:${g.priority}`} flexDirection="column" marginTop={1}>
              {sectionHeader(g.priority, (
                <Text color={g.color} bold>
                  {g.priority} {g.label} <Text dimColor>{items.length}</Text>
                </Text>
              ))}
              {!fold.has(g.priority) && items.map(row)}
            </Box>
          )
        })}
        {recent.length > 0 && (
          <Box key="group:done" flexDirection="column" marginTop={1}>
            {sectionHeader('done', <Text dimColor bold>Recently done</Text>)}
            {!fold.has('done') && recent.map(doneRow)}
          </Box>
        )}
        <Box marginTop={1}>
          <Text dimColor>{e.props.isFocused ? '↑↓ move · Enter press · Esc close' : 'ctrl+x tab to select'}</Text>
        </Box>
      </Box>
    )
  })
}
