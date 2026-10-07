import { atom, update } from 'claude-code'
import type { Register } from 'claude-code'

type Level = 'low' | 'medium' | 'high'

// Haiku answers with one label verbatim; the word before the colon is the level.
// ponytail: a low turn that edits files anyway stays low, add a mid-turn bump if that shows up
const LABELS = [
  'low: a question, explanation, chat, running a command or a git chore, no file edits',
  'medium: ordinary code edits or multi-step work',
  'high: hard debugging, design, a large refactor, or a retry after a failed attempt',
]
const LEVELS: readonly string[] = ['low', 'medium', 'high']
// context-meter reads this to show the effort the mod picked
const effortAtom = atom({ plugin: 'auto-effort', key: 'effort' } as const, null)

let mode: 'auto' | 'off' | Level = 'auto'
// the newest prompt's level; a turn with no prompt of its own keeps it, so effort doesn't flap
let level: Level | undefined
let last: { model: string; effort: Level } | undefined
let warned = false
// budget mode: past this share of any usage window, high turns run at medium
let budget: number | 'off' = 80
let used = 0
const budgetOn = () => budget !== 'off' && used >= budget

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
      const label = await $.model.classify(e.text.slice(0, 4000), LABELS, { model: 'haiku' }).catch(() => undefined)
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

  on('turn.step', async function* ($, e, next) {
    // xhigh, max or a number came from /effort or ultrathink: more than the mod would pick, so it stands
    if (e.agentId !== undefined || mode === 'off' || !LEVELS.includes(String(e.effort))) return yield* next(e)
    // a pin is the person's choice, so budget mode only caps automatic picks
    const effort = mode !== 'auto' ? mode : level === 'high' && budgetOn() ? 'medium' : level
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
