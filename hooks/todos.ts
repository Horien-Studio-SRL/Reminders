// Docs/todos.md is a markdown checklist with an "## Open" and a "## Done" section.
// Open line: `- [ ] P2 2026-10-07 Text (at Assets/X.cs:42)`. Lines that don't parse are kept as-is.

export type Priority = 'P1' | 'P2' | 'P3'
export type Todo = { priority: Priority; date: string; text: string; at?: string; line: number }

export const PATH = 'Docs/todos.md'
export const DONE_KEEP = 20

const OPEN = '## Open'
const DONE = '## Done'
const ITEM = /^- \[ \] (P[123]) (\d{4}-\d{2}-\d{2}) (.+?)(?: \(at ([^()]+)\))?$/

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

export const format = (t: Omit<Todo, 'line'>) =>
  `- [ ] ${t.priority} ${t.date} ${t.text.replace(/\s+/g, ' ').trim()}${t.at ? ` (at ${t.at})` : ''}`

export const add = (md: string, t: Omit<Todo, 'line'>): { md: string; error?: string } =>
{
  const key = t.text.replace(/\s+/g, ' ').trim().toLowerCase()
  if (!key) return { md, error: 'Reminder text is empty.' }
  if (parseOpen(md).some(o => o.text.toLowerCase() === key)) return { md, error: 'An open reminder already has this text.' }

  const lines = md.split(/\r?\n/)
  ensureSections(lines)
  let end = sectionEnd(lines, OPEN)
  while (end > 0 && lines[end - 1]!.trim() === '' && lines[end - 1] !== OPEN) end--
  lines.splice(end, 0, format(t))
  return { md: tidy(lines) }
}

// `match` is the item text, or a case-insensitive substring of the item text that must hit exactly one open item.
export const complete = (md: string, match: string, today: string): { md: string; done?: Todo; error?: string } =>
{
  const needle = match.trim().toLowerCase()
  const open = parseOpen(md)
  const exact = open.filter(t => t.text.toLowerCase() === needle)
  const hits = !needle ? [] : exact.length ? exact : open.filter(t => t.text.toLowerCase().includes(needle))
  if (hits.length !== 1)
    return { md, error: hits.length ? `"${match}" matches ${hits.length} open reminders; be more specific.` : `No open reminder matches "${match}".` }

  const done = hits[0]!
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
