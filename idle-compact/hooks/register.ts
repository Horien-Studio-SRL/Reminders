import type { Register } from 'claude-code'

// ponytail: assumes the 1-hour TTL Claude Code uses on subscriptions, like context-meter
const CACHE_TTL_MS = 60 * 60 * 1000
// compact this long before the cache expires, so the summary call still reads from it
const MARGIN_MS = 5 * 60 * 1000
const INSTRUCTIONS = 'Keep the open task, decisions made, files changed and anything left to do.'

let enabled = true
let minTokens = 80_000
// when the last main-thread request finished; undefined once compacted, until the next one
let cachedAt: number | undefined

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'idle-compact',
      description: 'Show or set compaction of idle sessions before the cache expires: on, off, or a minimum context in thousands of tokens',
      argumentHint: '[on | off | <k tokens>]',
    })
    $.clock.every(60_000, async () => {
      if (!enabled || cachedAt === undefined || (await $.clock.now()) - cachedAt < CACHE_TTL_MS - MARGIN_MS) return
      const tokens = (await $.session.usage()).context.tokens ?? 0
      if (tokens < minTokens) return
      cachedAt = undefined
      // rejects while a turn runs; the next idle stretch tries again
      const r = await $.session.compact({ instructions: INSTRUCTIONS }).catch(() => undefined)
      if (r && !('skip' in r)) $.ui.toast(`idle-compact: compacted a ${Math.round(tokens / 1000)}k context before its cache expired.`)
    })
    return started
  })

  on('command.run', { command: 'idle-compact' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase().replace(/k$/, '')
    if (arg === 'on' || arg === 'off') enabled = arg === 'on'
    else if (/^\d+$/.test(arg)) minTokens = Number(arg) * 1000
    else if (arg) return { text: `Unknown argument "${arg}". Use on, off or a number of thousands of tokens.` }
    return { text: enabled ? `idle-compact is on for contexts of ${minTokens / 1000}k tokens or more.` : 'idle-compact is off.' }
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    if (e.agentId === undefined && result.usage) cachedAt = await $.clock.now()
    return result
  })
}
