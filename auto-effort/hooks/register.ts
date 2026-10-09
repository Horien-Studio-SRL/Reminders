import { atom, update } from 'claude-code'
import type { Register, SessionMessage } from 'claude-code'

type Level = 'low' | 'medium' | 'high'

// Haiku answers with one label verbatim; the word before the colon is the level.
const LABELS = [
  'low: a question, explanation, chat, running a command or a git chore, no file edits',
  'medium: ordinary code edits or multi-step work',
  'high: hard debugging, design, a large refactor, or a retry after a failed attempt',
]
const LEVELS: readonly string[] = ['low', 'medium', 'high']
const RANK: Record<Level, number> = { low: 0, medium: 1, high: 2 }
const EDITS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']
// context-meter reads this to show the effort the mod picked
const effortAtom = atom({ plugin: 'auto-effort', key: 'effort' } as const, null)

let mode: 'auto' | 'off' | Level = 'auto'
// the newest prompt's level; a turn with no prompt of its own keeps it, so effort doesn't flap
let level: Level | undefined
let last: { model: string; effort: Level } | undefined
let warned = false
// what the current turn has done so far; it can only raise the level
let turn: string | undefined
let edited = new Set<string>()
let planned = false
// budget mode: past this share of any usage window, high turns run at medium
let budget: number | 'off' = 80
let used = 0
const budgetOn = () => budget !== 'off' && used >= budget

// "implement the plan above" says nothing alone, so Haiku also reads the last few messages
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n / 2)}\n…\n${s.slice(-n / 2)}` : s)
const describe = (m: SessionMessage) =>
  `${m.role}: ${clip(m.text, 800)}${m.toolUses.length ? ` [${m.toolUses.map(t => t.name).join(', ')}]` : ''}`
const withContext = (prompt: string, messages: SessionMessage[]) => {
  const before = messages.slice(-6).map(describe).join('\n\n')
  const ask = `Rate the work the new prompt asks for.\n\nNew prompt:\n${clip(prompt, 4000)}`
  return before ? `Conversation so far:\n${before}\n\n${ask}` : ask
}

// edits to several files, a plan being carried out, or a long run of steps mean the turn is bigger than its prompt
const observed = (index: number): Level =>
  edited.size >= 4 || planned || index >= 15 ? 'high' : edited.size > 0 ? 'medium' : 'low'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'auto-effort',
      description: 'Show or set automatic effort: on, off, pin low|medium|high, or budget on|off|<percent>',
      argumentHint: '[on | off | low | medium | high | budget on|off|<percent>]',
    })
    return next(e)
  })

  on('command.run', { command: 'auto-effort' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase().replace(/^pin\s+/, '')
    const b = /^budget(?:\s+(on|off|\d{1,3})%?)?$/.exec(arg)
    if (b) budget = b[1] === 'off' ? 'off' : b[1] === 'on' || !b[1] ? 80 : Math.min(100, Number(b[1]))
    else if (arg === 'on') mode = 'auto'
    else if (arg === 'off' || LEVELS.includes(arg)) mode = arg as typeof mode
    else if (arg) return { text: `Unknown argument "${arg}". Use on, off, low, medium or high.` }
    if (mode === 'off') await update($, effortAtom, () => null)
    const now = mode === 'auto' ? `on${level ? `, last pick ${level}` : ''}` : mode === 'off' ? 'off' : `pinned to ${mode}`
    const limit = budget === 'off' ? 'off' : `at ${budget}%, ${Math.round(used)}% of the fullest usage window used`
    return { text: `auto-effort is ${now}. Budget mode is ${limit}.` }
  })

  // Typed prompts only: a message delivered into a running turn shouldn't re-pick its effort.
  on('prompt.submit', async ($, e, next) => {
    if (mode === 'auto' && e.turnId === undefined && !e.text.startsWith('/')) {
      const messages = await $.session.messages().catch(() => [])
      const label = await $.model.classify(withContext(e.text, messages), LABELS, { model: 'haiku' }).catch(() => undefined)
      const picked = label?.split(':')[0]
      if (picked && LEVELS.includes(picked)) level = picked as Level
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // rateLimits is the whole list each time, so the fullest window is recomputed, not accumulated
  on('session.measure', ($, e, next) => {
    used = Math.max(0, ...e.rateLimits.map(r => r.percentUsed))
    return next(e)
  })

  // Search subagents start with no context, so a lower effort there loses no cache.
  on('tool.call', { tool: 'Agent' }, ($, e, next) =>
    mode !== 'off' && e.subagent_type === 'Explore' && e.effort === undefined ? next({ ...e, effort: 'low' }) : next(e),
  ).catch(($, e, next) => next(e))

  // Only the main loop's tools count: a subagent's edits don't make the main turn harder.
  on('tool.call', ($, e, next) => {
    if (e.agentId === undefined) {
      const { file_path, notebook_path } = e as { file_path?: string; notebook_path?: string }
      const file = file_path ?? notebook_path
      if (EDITS.includes(e.tool) && file) edited.add(file)
      if (e.tool === 'ExitPlanMode') planned = true
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    // xhigh, max or a number came from /effort or ultrathink: more than the mod would pick, so it stands
    if (e.agentId !== undefined || mode === 'off' || !LEVELS.includes(String(e.effort))) return yield* next(e)
    if (e.turnId !== turn) {
      turn = e.turnId
      edited = new Set()
      planned = false
    }
    // Switches among low, medium and high kept the cache in real sessions, so rising mid-turn is cheap.
    const seen = observed(e.index)
    const auto = seen === 'low' || (level && RANK[level] >= RANK[seen]) ? level : seen
    // a pin is the person's choice, so budget mode only caps automatic picks
    const effort = mode !== 'auto' ? mode : auto === 'high' && budgetOn() ? 'medium' : auto
    if (!effort) return yield* next(e)

    await update($, effortAtom, () => `${effort}${mode !== 'auto' ? ' (pinned)' : budgetOn() ? ' (budget)' : ''}`)
    const result = yield* next({ ...e, effort })

    // Writing more than it read right after a switch means the change went out top-level and rebuilt the cache.
    const u = result.usage
    const switched = last !== undefined && last.model === e.model && last.effort !== effort
    if (switched && u && !warned && u.cache_creation_input_tokens > u.cache_read_input_tokens) {
      warned = true
      $.ui.toast(`auto-effort: switching to ${effort} rebuilt the prompt cache. If this keeps happening, run /auto-effort off.`)
    }
    last = { model: e.model, effort }
    return result
  })
}
