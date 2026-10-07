import { atom, read } from 'claude-code'
import type { EngineInterface, Register, TurnStepResult } from 'claude-code'

type Usage = NonNullable<TurnStepResult['usage']>
type Group = { prompts: number; output: number; usd: number; window: number }
type Ledger = {
  since: string
  trimmer: { tokens: number; usd: number }
  router: { tokens: number; usd: number }
  effort: Record<'on' | 'off', Group>
}

// API dollars per million tokens: input, output, cache read.
// ponytail: the Haiku cache read is a guess at a tenth of its input price, and cache writes take the 1-hour rate of twice the input price
const PRICES: Record<string, [number, number, number]> = {
  opus: [4, 20, 0.2],
  sonnet: [2, 10, 0.2],
  haiku: [0.1, 0.5, 0.01],
}
const price = (model: string) => Object.entries(PRICES).find(([family]) => model.includes(family))?.[1]
const cost = (model: string, u: Usage) => {
  const p = price(model)
  if (!p) return undefined
  const [input, output, cached] = p
  return (u.input_tokens * input + u.cache_creation_input_tokens * input * 2 + u.cache_read_input_tokens * cached + u.output_tokens * output) / 1e6
}

const effortAtom = atom({ plugin: 'auto-effort', key: 'effort' } as const, null)
const trimmedAtom = atom({ plugin: 'output-trimmer', key: 'trimmed' } as const, 0)
const routedAtom = atom({ plugin: 'subagent-router', key: 'routed' } as const, [])

const group = (): Group => ({ prompts: 0, output: 0, usd: 0, window: 0 })
const fresh = (since: string): Ledger => ({ since, trimmer: { tokens: 0, usd: 0 }, router: { tokens: 0, usd: 0 }, effort: { on: group(), off: group() } })

let ledger: Ledger | undefined
let mainModel = ''
// trimmed tokens already dropped from the context by a compaction
let trimmedBase = 0
let window: number | undefined
let mode: 'on' | 'off' = 'off'

// ponytail: two sessions at once each write their own copy, so the last one to save wins
const load = async ($: EngineInterface) =>
  (ledger ??= ((await $.store.get('ledger')) as Ledger | undefined) ?? fresh(new Date(await $.clock.now()).toISOString().slice(0, 10)))
const save = ($: EngineInterface) => $.store.set('ledger', ledger)

const k = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)))
const usd = (n: number) => `$${n.toFixed(2)}`
const row = (name: string, g: Group) =>
  g.prompts === 0
    ? `${name}: no prompts yet`
    : `${name}: ${g.prompts} prompts, ${usd(g.usd / g.prompts)} and ${k(g.output / g.prompts)} output tokens per prompt, ${(g.window / g.prompts).toFixed(2)}% of the 5-hour window per prompt`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'savings', description: 'Show what the token-saving mods saved, or reset the ledger', argumentHint: '[reset]' })
    await load($)
    return next(e)
  })

  on('command.run', { command: 'savings' }, async ($, e) => {
    const l = await load($)
    if (e.args.trim() === 'reset') {
      ledger = fresh(new Date(await $.clock.now()).toISOString().slice(0, 10))
      await save($)
      return { text: 'Savings ledger cleared.' }
    }
    return {
      text: [
        `Since ${l.since}, at API prices:`,
        `output-trimmer: ${k(l.trimmer.tokens)} input tokens not re-read, about ${usd(l.trimmer.usd)}`,
        `subagent-router: ${k(l.router.tokens)} tokens on a cheaper model, about ${usd(l.router.usd)}`,
        row('auto-effort on', l.effort.on),
        row('auto-effort off', l.effort.off),
        'Prompts differ, so the auto-effort rows only mean something after a few days of each.',
      ].join('\n'),
    }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.turnId === undefined && !e.text.startsWith('/')) (await load($)).effort[mode].prompts++
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    const now = e.rateLimits.find(r => r.kind === 'five_hour')?.percentUsed
    // a drop means the window reset, which saved nothing
    if (now !== undefined && window !== undefined && now > window) (await load($)).effort[mode].window += now - window
    if (now !== undefined) window = now
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) trimmedBase = await read($, trimmedAtom)
    return result
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const u = result.usage
    if (!u) return result
    const l = await load($)
    const model = u.model ?? e.model

    if (e.agentId === undefined) {
      mainModel = model
      mode = (await read($, effortAtom)) === null ? 'off' : 'on'
      const g = l.effort[mode]
      g.output += u.output_tokens
      g.usd += cost(model, u) ?? 0
      // every main request would have re-read the trimmed text, at the cache-read price
      const trimmed = (await read($, trimmedAtom)) - trimmedBase
      l.trimmer.tokens += trimmed
      l.trimmer.usd += (trimmed * (price(model)?.[2] ?? 0)) / 1e6
    } else if ((await read($, routedAtom)).includes(e.agentId)) {
      const routed = cost(model, u)
      const parent = cost(mainModel, u)
      if (routed !== undefined && parent !== undefined) {
        l.router.tokens += u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens + u.output_tokens
        l.router.usd += parent - routed
      }
    }
    await save($)
    return result
  })
}
