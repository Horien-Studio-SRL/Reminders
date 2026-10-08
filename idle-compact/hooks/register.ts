import type { EngineInterface, Register } from 'claude-code'

// ponytail: assumes the 1-hour TTL Claude Code uses on subscriptions, like context-meter
const CACHE_TTL_MS = 60 * 60 * 1000
// compact this long before the cache expires, so the summary call still reads from it
const MARGIN_MS = 5 * 60 * 1000
const INSTRUCTIONS = 'Keep the open task, decisions made, files changed and anything left to do.'
const forPrompt = (text: string) => `${INSTRUCTIONS} Above all, keep what the next request needs: ${text.slice(0, 2000)}`

let enabled = true
let minTokens = 120_000
// when the last main-thread request finished; undefined once compacted, until the next one
let cachedAt: number | undefined
// the session cachedAt belongs to: a resume (from the picker too) swaps it without a session.start
let knownFor: string | undefined
// what the last prompt was, for /idle-compact to report
let lastPrompt = 'none yet'

// A resumed session reports no size until its first reply, so fall back to the engine's local estimate (no API call).
const contextTokens = async ($: EngineInterface) =>
  (await $.session.usage()).context.tokens ?? (await $.session.usage({ breakdown: 'summary' })).context.breakdown?.totalTokens ?? 0

// A resumed session has no request in this process yet, so its last reply comes from the transcript.
// ponytail: reads the whole file once, and assumes the default ~/.claude/projects/<cwd with - for each symbol>/<id>.jsonl
const lastReplyAt = async ($: EngineInterface, id: string) => {
  const home = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${(await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))}/.claude`
  const folder = (await $.session.cwd()).replace(/[^a-zA-Z0-9]/g, '-')
  const lines = (await $.fs.read(`${home}/projects/${folder}/${id}.jsonl`)).split('\n')
  const last = lines.findLast(line => line.includes('"type":"assistant"'))
  const at = last === undefined ? NaN : Date.parse((JSON.parse(last) as { timestamp?: string }).timestamp ?? '')
  return Number.isNaN(at) ? undefined : at
}

// Reads the transcript once per session id, and only when this process has no request of its own for it.
const cacheAge = async ($: EngineInterface) => {
  const id = await $.session.id()
  if (id !== knownFor) {
    knownFor = id
    cachedAt = await lastReplyAt($, id).catch(() => undefined)
  }
  return cachedAt === undefined ? undefined : (await $.clock.now()) - cachedAt
}

const ago = (ms: number) => (ms >= 2 * 3_600_000 ? `${Math.floor(ms / 3_600_000)}h ${Math.round((ms % 3_600_000) / 60_000)}m` : `${Math.round(ms / 60_000)}m`)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'idle-compact',
      description: 'Show or set compaction of idle sessions before the cache expires: on, off, or a minimum context in thousands of tokens',
      argumentHint: '[on | off | <k tokens>]',
    })
    $.clock.every(60_000, async () => {
      if (!enabled) return
      const age = await cacheAge($)
      if (age === undefined || age < CACHE_TTL_MS - MARGIN_MS) return
      const tokens = await contextTokens($)
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
    if (!enabled) return { text: 'idle-compact is off.' }
    const age = await cacheAge($)
    const tokens = Math.round((await contextTokens($)) / 1000)
    const last = age === undefined ? 'no reply on record (or already compacted)' : `last reply ${ago(age)} ago`
    return { text: `idle-compact is on for contexts of ${minTokens / 1000}k tokens or more. Now: ${tokens}k context, ${last}. Last prompt: ${lastPrompt}.` }
  })

  // The fallback, for when the timer never fired (the computer slept): the cache is already cold, so the
  // summary reads the context at the full input price, still half of rewriting it all to the cache.
  // The engine refuses a compaction under a prompt.submit hook, so the prompt is dropped, the session
  // compacts, and the prompt goes back in the box for one Enter.
  on('prompt.submit', async ($, e, next) => {
    if (!e.text.startsWith('/')) lastPrompt = `${e.origin.kind}${e.turnId === undefined ? '' : ', mid-turn'}`
    // typed at the terminal or on a remote surface; notifications, triggers and SDK calls go through
    const typed = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    if (!enabled || e.turnId !== undefined || !typed || e.attachments || e.text.startsWith('/')) return next(e)
    const age = await cacheAge($)
    if (age === undefined || age < CACHE_TTL_MS) return next(e)
    const tokens = await contextTokens($)
    if (tokens < minTokens) return next(e)
    cachedAt = undefined
    $.clock.after(0, async () => {
      await $.session.compact({ instructions: forPrompt(e.text) }).catch(() => undefined)
      await $.prompt.fill({ text: e.text })
      $.ui.toast('idle-compact: compacted. Your prompt is back in the box, press Enter to send it.')
    })
    return { drop: `idle-compact: the cache expired, so the ${Math.round(tokens / 1000)}k context is compacted first. Your prompt comes back in the box when it's done.` }
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    if (e.agentId === undefined && result.usage) {
      cachedAt = await $.clock.now()
      knownFor = await $.session.id()
    }
    return result
  })
}
