import { atom, update } from 'claude-code'
import type { Register } from 'claude-code'

// Agent types whose work a cheaper model does as well; any other type keeps its own model.
const ROUTES: Record<string, string> = { Explore: 'haiku', 'general-purpose': 'sonnet' }
const RANK = ['haiku', 'sonnet', 'opus']
// ponytail: a model id naming none of the three ranks as unknown, so the route is skipped
const rank = (model: string) => RANK.findIndex(m => model.toLowerCase().includes(m))

let enabled = true
// savings-meter reads this to price the routed agents' tokens
const routedAtom = atom({ plugin: 'subagent-router', key: 'routed' } as const, [])

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'subagent-router', description: 'Show, or turn on or off, routing subagents to cheaper models', argumentHint: '[on | off]' })
    return next(e)
  })

  on('command.run', { command: 'subagent-router' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'on' || arg === 'off') enabled = arg === 'on'
    else if (arg) return { text: `Unknown argument "${arg}". Use on or off.` }
    const routes = Object.entries(ROUTES).map(([type, model]) => `${type} on ${model}`).join(', ')
    return { text: enabled ? `subagent-router is on: ${routes}.` : 'subagent-router is off.' }
  })

  // A model Claude named in the call, a fork or a teammate is left alone; so is a route that wouldn't be cheaper than the parent.
  on('agent.spawn', async ($, e, next) => {
    const model = ROUTES[e.subagentType]
    const cheaper = model !== undefined && rank(model) < rank(e.parentModel)
    if (!enabled || !cheaper || e.model !== undefined || e.fork || e.isTeammate) return next(e)
    const r = await next({ ...e, model })
    const id = 'agentId' in r ? r.agentId : undefined
    if (id) await update($, routedAtom, ids => [...ids, id])
    return r
  }).catch(($, e, next) => next(e))
}
