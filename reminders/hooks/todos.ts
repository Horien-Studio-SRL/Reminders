// Docs/todos.md is a markdown checklist with an "## Open" and a "## Done" section.
// Open line: `- [ ] P2 2026-10-07 Text (at src/x.ts:42)`, Done line: `- [x] ... (done 2026-10-08)`.
// Lines that don't parse are kept as-is.

export type Priority = 'P1' | 'P2' | 'P3'
export type Todo = { priority: Priority; date: string; text: string; at?: string; line: number; done?: string }

// Where the file goes when neither the `path` option nor a lowercase docs/ folder says otherwise.
export const PATH = 'Docs/todos.md'
export const DONE_KEEP = 20

const OPEN = '## Open'
const DONE = '## Done'
const ITEM = /^- \[ \] (P[123]) (\d{4}-\d{2}-\d{2}) (.+?)(?: \(at ([^()]+)\))?$/
const DONE_ITEM = /^- \[x\] (P[123]) (\d{4}-\d{2}-\d{2}) (.+?)(?: \(at ([^()]+)\))? \(done (\d{4}-\d{2}-\d{2})\)$/

export const EMPTY = `# Todos

Unfinished work: partial implementations, undecided design, deferred tasks.
Claude edits this through the reminders mod. Hand edits are fine; keep the line format.

${OPEN}

${DONE}
`

const sectionEnd = (lines: string[], header: string) =>
{
  const start = lines.indexOf(header)
  if (start < 0) return -1
  let end = start + 1
  while (end < lines.length && !lines[end]!.startsWith('## ')) end++
  return end
}

const ensureSections = (lines: string[]) =>
{
  if (!lines.includes(OPEN)) lines.push('', OPEN)
  if (!lines.includes(DONE)) lines.push('', DONE)
}

export const parseOpen = (md: string): Todo[] =>
{
  const lines = md.split(/\r?\n/)
  const start = lines.indexOf(OPEN)
  if (start < 0) return []
  const todos: Todo[] = []
  for (let i = start + 1; i < lines.length && !lines[i]!.startsWith('## '); i++)
  {
    const m = ITEM.exec(lines[i]!.trimEnd())
    if (m) todos.push({ priority: m[1] as Priority, date: m[2]!, text: m[3]!, at: m[4], line: i })
  }
  return todos.sort((a, b) => a.priority.localeCompare(b.priority) || a.line - b.line)
}

// How long an item has been open, short enough for a column: today, 3d, 2w, 4mo.
export const age = (date: string, today: string) =>
{
  const days = Math.round((Date.parse(today) - Date.parse(date)) / 86_400_000)
  if (!(days > 0)) return 'today'
  if (days < 14) return `${days}d`
  if (days < 60) return `${Math.floor(days / 7)}w`
  return `${Math.floor(days / 30)}mo`
}

// Done items, newest first, as the Done section keeps them.
export const parseDone = (md: string): Todo[] =>
{
  const lines = md.split(/\r?\n/)
  const start = lines.indexOf(DONE)
  if (start < 0) return []
  const todos: Todo[] = []
  for (let i = start + 1; i < lines.length && !lines[i]!.startsWith('## '); i++)
  {
    const m = DONE_ITEM.exec(lines[i]!.trimEnd())
    if (m) todos.push({ priority: m[1] as Priority, date: m[2]!, text: m[3]!, at: m[4], line: i, done: m[5] })
  }
  return todos
}

export const format = (t: Omit<Todo, 'line'>) =>
  `- [ ] ${t.priority} ${t.date} ${t.text.replace(/\s+/g, ' ').trim()}${t.at ? ` (at ${t.at})` : ''}`

export const add = (md: string, t: Omit<Todo, 'line'>): { md: string; error?: string } =>
{
  const key = t.text.replace(/\s+/g, ' ').trim().toLowerCase()
  if (!key) return { md, error: 'Reminder text is empty.' }
  if (parseOpen(md).some(o => o.text.replace(/\s+/g, ' ').trim().toLowerCase() === key)) return { md, error: 'An open reminder already has this text.' }

  const lines = md.split(/\r?\n/)
  ensureSections(lines)
  let end = sectionEnd(lines, OPEN)
  while (end > 0 && lines[end - 1]!.trim() === '' && lines[end - 1] !== OPEN) end--
  lines.splice(end, 0, format(t))
  return { md: tidy(lines) }
}

// The one item whose text is `match`, else the one containing it (case-insensitive); an error string otherwise.
const pick = (items: Todo[], match: string, kind: 'open' | 'done'): Todo | string =>
{
  const needle = match.trim().toLowerCase()
  const exact = items.filter(t => t.text.toLowerCase() === needle)
  const hits = !needle ? [] : exact.length ? exact : items.filter(t => t.text.toLowerCase().includes(needle))
  if (hits.length === 1) return hits[0]!
  return hits.length ? `"${match}" matches ${hits.length} ${kind} reminders; be more specific.` : `No ${kind} reminder matches "${match}".`
}

// `match` is the item text, or a case-insensitive substring of the item text that must hit exactly one open item.
export const complete = (md: string, match: string, today: string): { md: string; done?: Todo; error?: string } =>
{
  const done = pick(parseOpen(md), match, 'open')
  if (typeof done === 'string') return { md, error: done }

  const lines = md.split(/\r?\n/)
  const doneLine = lines[done.line]!.trimEnd().replace('- [ ]', '- [x]') + ` (done ${today})`
  lines.splice(done.line, 1)
  ensureSections(lines)

  const doneAt = lines.indexOf(DONE)
  lines.splice(doneAt + 1, 0, doneLine)
  let kept = 0
  for (let i = doneAt + 1; i < lines.length && !lines[i]!.startsWith('## '); i++)
  {
    if (!lines[i]!.startsWith('- [x]')) continue
    if (++kept > DONE_KEEP) lines.splice(i--, 1)
  }
  return { md: tidy(lines), done }
}

// Moves a Done item back to Open with its original priority, date and pointer.
export const reopen = (md: string, match: string): { md: string; reopened?: Todo; error?: string } =>
{
  const hit = pick(parseDone(md), match, 'done')
  if (typeof hit === 'string') return { md, error: hit }

  const lines = md.split(/\r?\n/)
  lines.splice(hit.line, 1)
  const { priority, date, text, at } = hit
  const r = add(lines.join('\n'), { priority, date, text, at })
  return r.error ? { md, error: r.error } : { md: r.md, reopened: hit }
}

// Changes an open item's priority in place; the pane re-sorts it into its new group.
export const setPriority = (md: string, match: string, priority: Priority): { md: string; error?: string } =>
{
  const hit = pick(parseOpen(md), match, 'open')
  if (typeof hit === 'string') return { md, error: hit }

  const lines = md.split(/\r?\n/)
  lines[hit.line] = lines[hit.line]!.replace(/^- \[ \] P[123]/, `- [ ] ${priority}`)
  return { md: lines.join('\n') }
}

// The file an `at` pointer names: `src/x.ts:42` and `src/x.ts:42-50` are `src/x.ts`.
export const pointerFile = (at: string) => at.trim().replace(/:\d+(?:[-:]\d+)?$/, '')

// One blank line between a header and its first item, none between items, trailing newline.
const tidy = (lines: string[]) =>
{
  const out: string[] = []
  for (const line of lines)
  {
    const prev = out[out.length - 1]
    if (line.trim() === '' && (prev === undefined || prev.trim() === '')) continue
    if (line.startsWith('- ') && prev?.trim() === '' && out[out.length - 2]?.startsWith('- ')) out.pop()
    if (line.startsWith('## ') && prev !== undefined && prev.trim() !== '') out.push('')
    out.push(line)
    if (line.startsWith('## ')) out.push('')
  }
  while (out.length && out[out.length - 1]!.trim() === '') out.pop()
  return out.join('\n') + '\n'
}
