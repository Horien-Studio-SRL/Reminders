import type { EngineInterface, Register } from 'claude-code'

const MAX_LINES = 150
const MAX_CHARS = 8000
const HEAD = 30
const TAIL = 60
const MAX_SIGNALS = 40
const LINE_CHARS = 300
const DIR = 'claude-trimmed'
const SIGNAL = /error|fail|warn|exception|traceback|panic|assert|denied|not found|✗|✖/i
// Claude asked for exactly this text (a file, a diff, a search), so trimming it would hide what it came for.
const READS = /^\s*(cat|type|head|tail|sed|awk|less|more|grep|rg|jq|diff|git\s+(diff|show|log|blame))\b/

// Keeps the first and last lines plus any line that looks like an error; undefined when it's short enough already.
export const trim = (text: string): string | undefined => {
  const lines = text.split('\n')
  if (lines.length <= MAX_LINES && text.length <= MAX_CHARS) return undefined
  const keep = lines.map((_, i) => i < HEAD || i >= lines.length - TAIL)
  let signals = 0
  lines.forEach((line, i) => {
    if (!keep[i] && signals < MAX_SIGNALS && SIGNAL.test(line)) keep[i] = !!++signals
  })
  const out: string[] = []
  let gap = 0
  lines.forEach((line, i) => {
    if (!keep[i]) return void gap++
    if (gap) out.push(`... ${gap} lines trimmed ...`)
    gap = 0
    out.push(line.length > LINE_CHARS ? `${line.slice(0, LINE_CHARS)}...` : line)
  })
  if (gap) out.push(`... ${gap} lines trimmed ...`)
  const trimmed = out.join('\n')
  return trimmed.length < text.length ? trimmed : undefined
}

const save = async ($: EngineInterface, id: string, text: string) => {
  const tmp = (await $.env.get('TEMP')) ?? (await $.env.get('TMPDIR')) ?? '/tmp'
  const path = `${tmp.replace(/\\/g, '/')}/${DIR}/${id}.txt`
  await $.fs.write(path, text)
  return `[output-trimmer kept the start, the end and the error lines. Full output: ${path}]`
}

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || READS.test(e.command) || e.command.includes(DIR)) return ran
    const id = e.tool_use_id ?? String(await $.clock.now())

    // A failed command's output only reaches Claude as error text; a deny after the run delivers the trimmed text the same way.
    if (ran.isError) {
      const short = ran.text === undefined ? undefined : trim(ran.text)
      return short === undefined || ran.text === undefined ? ran : { deny: `${await save($, id, ran.text)}\n${short}` }
    }

    const r = ran.result
    if (r.isImage || r.backgroundTaskId || r.persistedOutputPath) return ran
    const stdout = trim(r.stdout)
    const stderr = trim(r.stderr)
    if (stdout === undefined && stderr === undefined) return ran
    const note = await save($, id, `${r.stdout}\n${r.stderr}`)
    return { result: { ...r, stdout: `${note}\n${stdout ?? r.stdout}`, stderr: stderr ?? r.stderr }, context: ran.context }
  }).catch(($, e, next) => next(e))
}
