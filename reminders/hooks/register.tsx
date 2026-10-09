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
// Columns the right side of a row holds: a gap, then "[?] [Ask]" above the age ("today", "11mo").
const RIGHT = 10
// Columns a done item's age holds, after a gap.
const AGE = 6
// Days after which an item's age is drawn in the warning color.
const OLD_DAYS = 30

const rowKey = (t: Todo) => `done:${t.text}`
const prioKey = (t: Todo) => `prio:${t.text}`
const askKey = (t: Todo) => `ask:${t.text}`
const whyKey = (t: Todo) => `why:${t.text}`
const howKey = (t: Todo) => `how:${t.text}`
const undoKey = (t: Todo) => `undo:${t.text}`
const foldKey = (section: string) => `fold:${section}`
const ADD = 'add'
const NOTE = 'add:note'

// The button the focus ring is on; the row around it is drawn highlighted.
let focused: string | undefined
// The pane's buttons and fields as last drawn, one array per line: the title, a section header, an item's
// [Done] [P#] [?] [Ask], its Ask field, a done item. ↑↓ move between lines, Tab and Shift+Tab along one.
let lines: string[][] = []
// The place on a line ↑↓ keep: 0 [Done], 1 [P#], 2 [?], 3 [Ask]; a one-button line leaves it as it was.
let column = 0
// The item whose Ask was pressed; its row shows the field for how Claude should do it.
let asking: string | undefined
// Whether Add was pressed; the header shows the field for the person's note. Never open with `asking`.
let adding = false
// The item whose [?] was pressed; its row shows the explanation under it.
let explaining: string | undefined
// Explanations this session, by item text: the reply, or undefined while it is being written.
const explained = new Map<string, string | undefined>()
// The pane's width as last drawn, to count the rows an explanation wraps to.
let width = 60
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

// Rows an explanation may take under its item, so the list stays short.
const EXPLANATION_ROWS = 3

// An explanation as drawn: one paragraph cut to EXPLANATION_ROWS rows beside the left column, at the last
// sentence that fits, else with an ellipsis.
export const clampExplanation = (text: string, columns: number) =>
{
  const flat = text.replace(/\s+/g, ' ').trim()
  const room = Math.max(20, columns - LEFT - 1) * EXPLANATION_ROWS - EXPLANATION_ROWS * 4
  if (flat.length <= room) return flat
  const cut = flat.slice(0, room)
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '))
  return end > room / 2 ? cut.slice(0, end + 1) : `${cut.slice(0, room - 1).trimEnd()}…`
}

// The rows an explanation takes under its item, wrapped beside the row's left column.
const explanationRows = (text: string) =>
  Math.max(1, Math.ceil(clampExplanation(text, width).length / Math.max(20, width - LEFT - 1)))

// Rows the pane needs: title, each section's header and the gap above it, two lines per item in an
// unfolded section, the Ask or Add field, an open explanation, footer.
const paneRows = (open: Todo[], recent: Todo[], fold: Set<string>) =>
{
  let rows = 1 + 1 + 2
  if (explaining !== undefined) rows += explanationRows(explained.get(explaining) ?? 'Explaining...')
  for (const g of GROUPS)
  {
    const n = open.filter(t => t.priority === g.priority).length
    if (n) rows += 2 + (fold.has(g.priority) ? 0 : n * 2)
  }
  if (recent.length) rows += 2 + (fold.has('done') ? 0 : recent.length)
  return Math.max(4, rows)
}

// Where ↑ (`by` -1) or ↓ (1) takes the focus from `at`: the line above or below, wrapping, at `column` or the
// last button short of it; from nothing, the first or the last line.
export const vertical = (lines: string[][], at: string | undefined, by: number, column: number) =>
{
  const i = at === undefined ? -1 : lines.findIndex(l => l.includes(at))
  const line = lines[i < 0 ? (by > 0 ? 0 : lines.length - 1) : (i + by + lines.length) % lines.length]
  return line[Math.min(column, line.length - 1)]
}

// Where Tab (`by` 1) or Shift+Tab (-1) takes the focus from `at`: the next or previous button on its line, wrapping.
export const across = (lines: string[][], at: string, by: number) =>
{
  const line = lines.find(l => l.includes(at))
  return line ? line[(line.indexOf(at) + by + line.length) % line.length] : at
}

// The Add and Ask fields, where Tab and the arrows keep the engine's meaning.
const isField = (key: string) => key === NOTE || key.startsWith('how:')

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

// What [?] asks the small model, kept short: it pays for these words and the code, never the conversation.
export const EXPLAIN_SYSTEM =
  'You explain one entry of a project\'s to-do list to its developer. In one or two short sentences, at most 40 '
  + 'words of plain text, no Markdown: what is unfinished and where to start. Use only what is given; when the code does '
  + 'not show it, say what to check. Write in the language of the entry.'

// Lines of code [?] sends on each side of the line the pointer names; with no line, the file's first lines.
const CONTEXT = 20

// The [?] request: the item as recorded, then the numbered code around its pointer when the file is there.
export const explainPrompt = (t: Todo, code?: string) =>
{
  const entry = `Entry (${t.priority}, recorded ${t.date}): "${t.text}"`
  if (!t.at) return entry
  if (code === undefined) return `${entry}\nAt ${t.at}: the file is missing.`
  const line = Number(/^:(\d+)/.exec(t.at.trim().slice(pointerFile(t.at).length))?.[1] ?? 0)
  const all = code.split(/\r?\n/)
  const to = Math.min(all.length, line ? line + CONTEXT : CONTEXT * 2)
  // A line past the file's end, the code having moved since, shows the file's last lines.
  const from = Math.max(1, Math.min(line ? line - CONTEXT : 1, to - CONTEXT * 2 + 1))
  const shown = all.slice(from - 1, to).map((l, i) => `${from + i}  ${l.slice(0, 200)}`).join('\n')
  return `${entry}\nAt ${t.at}. Lines ${from}-${to} of ${pointerFile(t.at)}:\n${shown}`
}

// Reminders one scan records at most; the rest are listed in Claude's reply.
const SCAN_LIMIT = 30

// The prompt `/todos --scan` sends: collect the unfinished work already in the code, optionally under `within`.
export const scanPrompt = (within: string, path = PATH) =>
  [
    `Fill ${path} with the unfinished work already in this project${within.trim() ? `, looking only in ${within.trim()}` : ''}.`,
    '',
    'Look for:',
    '- TODO, FIXME, HACK and XXX in comments, in any case or form (todo:, @todo, TODO(name), "// todo handle this"),',
    '  in every comment syntax the project uses (//, #, /* */, <!-- -->, --);',
    '- comments that say in words that work was left: "for now", "temporary", "workaround", "not yet", "later",',
    '  or the same in the language the comments are written in;',
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

// [?]: shows the item's explanation under it, or hides it. The first press asks the small model with the item
// and the code around its pointer alone, no conversation, and keeps the reply for the session.
const explain = async ($: EngineInterface, t: Todo) =>
{
  explaining = explaining === t.text ? undefined : t.text
  if (explaining === undefined || explained.has(t.text))
  {
    $.ui.invalidate('ui.render')
    return openPane($).catch(() => undefined)
  }
  explained.set(t.text, undefined)
  $.ui.invalidate('ui.render')
  await openPane($).catch(() => undefined)
  const file = t.at && pointerFile(t.at)
  const code = file && (await $.fs.exists(file)) ? await $.fs.read(file).catch(() => undefined) : undefined
  const r = await $.model.complete({
    model: 'haiku',
    system: EXPLAIN_SYSTEM,
    prompt: explainPrompt(t, code),
    maxTokens: 100,
    effort: 'low',
    timeoutMs: 30_000,
  }).catch((err: unknown) => ({ isAnswered: false as const, reason: String(err) }))
  if (r.isAnswered) explained.set(t.text, r.text.trim())
  else explained.delete(t.text)
  if (!r.isAnswered && explaining === t.text) explaining = undefined
  if (!r.isAnswered) $.ui.toast(`Could not explain: ${r.reason}`)
  $.ui.invalidate('ui.render')
  // Resized to the reply only while the pane is still up: a pane closed meanwhile stays closed.
  const isUp = await $.ui.panes().then(ps => ps.some(p => p.id === PANE), () => false)
  if (isUp) await openPane($).catch(() => undefined)
}

// The marketplace this plugin is published in.
const MARKETPLACE = 'noash-tools'

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
  catch (err)
  {
    $.ui.toast(`Could not check reminders after the edit: ${err}`)
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
    explained.clear()
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
    focused = undefined
    column = 0
    explaining = undefined
    await openPane($)
    if (adding) await $.ui.focus({ requestId: PANE, key: NOTE }).catch(() => undefined)
    return { text: 'Todos pane opened.' }
  })

  // Tab and Shift+Tab step the engine's ring through every button, the last one's next being the engine's own
  // stops; here they step along the focused line instead, wrapping. In the Add and Ask fields they keep their
  // meaning. The marker follows: `focused` is set before `next`, which draws the pane, and put back on a refusal.
  on('ui.focus', { requestId: PANE }, async ($, e, next) =>
  {
    let to = e.element
    if (e.origin.kind === 'person' && focused !== undefined && !isField(focused))
    {
      const ring = lines.flat()
      const i = ring.indexOf(focused)
      const by = i < 0 ? 0 : to === ring[i + 1] ? 1 : to === ring[i - 1] ? -1 : 0
      if (by) to = across(lines, focused, by)
    }
    const line = to === undefined ? undefined : lines.find(l => l.includes(to!))
    if (line && line.length > 1) column = line.indexOf(to!)

    if (to !== e.element)
    {
      if (to === focused) return {}
      // Bound for one of the engine's stops: its move can't be turned onto a button, so the plugin makes its own.
      if (e.element === undefined)
      {
        $.clock.after(0, () => void $.ui.focus({ requestId: PANE, key: to! }).catch(() => undefined))
        return {}
      }
    }
    const was = focused
    focused = to
    const r = await next(to === e.element ? e : { ...e, element: to })
    if (r.deny) focused = was
    $.ui.invalidate('ui.render')
    return r
  }).catch(($, e, next) => (next.called ? {} : next(e)))

  // ↑↓ move to the line above or below, keeping the column. The engine raises them as a scroll of one row: the
  // pane is drawn a row taller than its window so that it always does, and they never reach the ring as Tab
  // does. The engine scrolls to keep the focus in view. The wheel (it has a pointer) and the page keys scroll.
  on('ui.scroll', { requestId: PANE }, async ($, e, next) =>
  {
    if (e.origin.kind !== 'person' || e.pointer || Math.abs(e.by) !== 1 || !lines.length) return next(e)
    const r = await $.ui.focus({ requestId: PANE, key: vertical(lines, focused, e.by, column) }).catch(() => ({ deny: 'failed' }))
    return r.deny ? next(e) : {}
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

    // The band holds one tree: another mod's drawing beneath stays, with the line under it.
    const beneath = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    const blocking = open.filter(t => t.priority === 'P1').length
    const line = (
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
    if (typeof beneath !== 'string' && beneath.type === 'engine') return line
    return (
      <Box key="todos-band" flexDirection="column">
        {beneath}
        {line}
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
    width = e.props.bodyColumns

    lines = [[ADD], ...(adding ? [[NOTE]] : [])]
    for (const g of GROUPS)
    {
      const items = open.filter(t => t.priority === g.priority)
      if (!items.length) continue
      lines.push([foldKey(g.priority)])
      if (!fold.has(g.priority))
        for (const t of items) lines.push([rowKey(t), prioKey(t), whyKey(t), askKey(t)], ...(asking === t.text ? [[howKey(t)]] : []))
    }
    if (recent.length)
    {
      lines.push([foldKey('done')])
      if (!fold.has('done')) lines.push(...recent.map(t => [undoKey(t)]))
    }

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
      await $.prompt.submit({ text: resolvePrompt(t, how, path), asUser: true }).catch(err => $.ui.toast(`Could not send to Claude: ${err}`))
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
      await $.prompt.submit({ text: addPrompt(note, path), asUser: true }).catch(err => $.ui.toast(`Could not send to Claude: ${err}`))
    }

    const undo = async (t: Todo) =>
    {
      const r = await reopenItem($, t.text)
      if (r.error) return $.ui.toast(r.error)
      fold.delete(t.priority)
      await $.ui.focus({ requestId: PANE, key: rowKey(t) }).catch(() => undefined)
    }

    // The two columns left of every line: the marker on the line holding the focus, else blank.
    const marker = (isFocused: boolean) => <Text color="claude">{isFocused ? '› ' : '  '}</Text>

    // A section header: the marker, the fold arrow, then the title and count.
    const sectionHeader = (section: string, title: JSX.Element) => (
      <Box flexDirection="row">
        {marker(has(foldKey(section)))}
        <Button key={foldKey(section)} label={fold.has(section) ? '▸' : '▾'} plain dimColor={!has(foldKey(section))} onPress={() => toggleFold(section)} />
        <Text> </Text>
        {title}
      </Box>
    )

    // [Done] with the priority button under it, right-aligned; the text and pointer; [?] [Ask] above the age;
    // under them the explanation [?] opened, then the Ask field.
    const row = (t: Todo) =>
    {
      const isFocused = has(rowKey(t)) || has(prioKey(t)) || has(whyKey(t)) || has(askKey(t)) || has(howKey(t))
      const days = Math.round((Date.parse(now) - Date.parse(t.date)) / 86_400_000)
      return (
        <Box key={`row:${t.text}`} flexDirection="column">
          <Box flexDirection="row">
            <Box flexDirection="column" width={LEFT} flexShrink={0}>
              <Box>
                {marker(isFocused)}
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
              <Box>
                <Button key={whyKey(t)} label="[?]" plain dimColor={!has(whyKey(t))} onPress={() => explain($, t)} />
                <Text> </Text>
                <Button key={askKey(t)} label="[Ask]" plain dimColor={!has(askKey(t))} onPress={() => ask(t)} />
              </Box>
              {days >= OLD_DAYS ? <Text color="warning">{age(t.date, now)}</Text> : <Text dimColor>{age(t.date, now)}</Text>}
            </Box>
          </Box>
          {explaining === t.text && (
            <Box key={`explanation:${t.text}`} paddingLeft={LEFT + 1}>
              {explained.get(t.text) === undefined
                ? <Text dimColor italic>Explaining...</Text>
                : <Text dimColor italic wrap="wrap">{clampExplanation(explained.get(t.text)!, width)}</Text>}
            </Box>
          )}
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
            {marker(isFocused)}
            <Button key={undoKey(t)} label="[Undo]" plain dimColor={!isFocused} onPress={() => undo(t)} />
          </Box>
          <Box flexGrow={1} flexShrink={1} paddingLeft={1}>
            <Text dimColor={!isFocused} strikethrough wrap="truncate-end">{t.text}</Text>
          </Box>
          <Box justifyContent="flex-end" width={AGE} flexShrink={0}>
            <Text dimColor>{age(t.done!, now)}</Text>
          </Box>
        </Box>
      )
    }

    // At least a row taller than the window, the last row blank, so that ↑↓ always come as a scroll.
    return (
      <Box flexDirection="column" width={e.props.bodyColumns} minHeight={e.props.scroll.bodyRows + 1}>
        <Box key="title" flexDirection="row" justifyContent="space-between">
          <Box flexShrink={0}>
            {marker(has(ADD))}
            <Text bold>Todos </Text>
            <Button key={ADD} label="[Add]" plain dimColor={!has(ADD)} onPress={toggleAdd} />
          </Box>
          <Text dimColor>
            {open.length ? `${open.length} open${blocking ? ` · ${blocking} blocking` : ''}` : path}
          </Text>
        </Box>
        {adding && (
          <Box paddingLeft={2}>
            <Input
              key={NOTE}
              placeholder="What to remember? Claude words it and adds it"
              submitLabel="send"
              onSubmit={note => sendNote(note)}
            />
          </Box>
        )}
        {!open.length && (
          <Box marginTop={1} paddingLeft={2}>
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
        <Box marginTop={1} paddingLeft={2}>
          <Text dimColor>{e.props.isFocused ? '↑↓ item · Tab button · Enter press · Esc close' : 'ctrl+x tab to select'}</Text>
        </Box>
      </Box>
    )
  })
}
