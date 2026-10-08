import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage, Timer, TurnStepInput } from 'claude-code'
import type { ContextMeterCold, ContextMeterUsage } from '../types/index'

const usageAtom = atom({ plugin: 'context-meter', key: 'usage' } as const, null)
const modelAtom = atom({ plugin: 'context-meter', key: 'model' } as const, null)
const cacheAtom = atom({ plugin: 'context-meter', key: 'cache' } as const, null)
const coldAtom = atom({ plugin: 'context-meter', key: 'cold' } as const, null)
const COLD_PANE = 'cold-cache'
// auto-effort rewrites the effort after this mod's turn.step may have seen it, so its pick wins when set
const autoEffortAtom = atom({ plugin: 'auto-effort', key: 'effort' } as const, null)

// ponytail: assumes the 1-hour TTL Claude Code uses on subscriptions; API-key sessions on 5 minutes read too warm
const CACHE_TTL_MS = 60 * 60 * 1000
// past this, a prompt sent on a cold cache rewrites enough to be worth a warning
const COLD_WARN_TOKENS = 120_000

// List input price in $/MTok, first prefix match wins. A 1h cache write costs twice that, a plain read once.
// ponytail: hardcoded list prices, update when they change; managed modelPricing is ignored
const INPUT_PRICE: [RegExp, number][] = [
  [/fable|mythos/, 10],
  [/opus-5-5/, 4],
  [/opus/, 5],
  [/sonnet-5/, 2],
  [/sonnet/, 3],
  [/haiku-5/, 0.1],
  [/haiku/, 1],
]
const inputPrice = (id: string) => INPUT_PRICE.find(([re]) => re.test(id))?.[1] ?? 4

const LIMIT_LABEL: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }
const BAR_CELLS = 8

const k = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1000)}k`)
const heat = (percent: number) => (percent >= 85 ? 'error' : percent >= 60 ? 'warning' : 'success')

// claude-opus-5-5 -> Opus 5.5, claude-haiku-4-5-20251001 -> Haiku 4.5; anything else as given
const prettyModel = (id: string) => {
  const [, family, major, minor] = /^(?:claude-)?([a-z]+)-(\d+)(?:-(\d{1,2}))?/i.exec(id) ?? []
  if (!family) return id
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}${minor ? `.${minor}` : ''}`
}

const model = (id: string, effort?: TurnStepInput['effort'] | unknown) => ({
  name: prettyModel(id),
  ...(effort === undefined || effort === null ? {} : { effort: String(effort) }),
})

const toUsage = ({ context, rateLimits, cost }: Pick<SessionUsage, 'context' | 'rateLimits' | 'cost'>, approx = false): ContextMeterUsage => ({
  tokens: context.tokens,
  window: context.window,
  percent: context.percent,
  approx,
  limits: rateLimits.map(r => ({ label: LIMIT_LABEL[r.kind] ?? r.kind, percent: r.percentUsed })),
  usd: cost?.usd,
})

// After a compaction the last response's token count is stale until the next one,
// so the fill comes from the engine's local estimate (no API call) and shows a "~".
const refresh = async ($: EngineInterface, estimate = false) => {
  const usage = await $.session.usage(estimate ? { breakdown: 'summary' } : undefined)
  const total = usage.context.breakdown?.totalTokens
  if (total === undefined) return update($, usageAtom, () => toUsage(usage))
  const context = { window: usage.context.window, tokens: total, percent: Math.round((total / usage.context.window) * 100) }
  return update($, usageAtom, () => toUsage({ ...usage, context }, true))
}

// Effort reaches turn.step only; until the first model call, read it from settings.
const effortFromSettings = async ($: EngineInterface, id: string) => {
  const settings = await $.settings.read()
  const perModel = settings.modelSettings as Record<string, { effortLevel?: string }> | undefined
  return perModel?.[id]?.effortLevel ?? (settings.effortLevel as string | undefined)
}

let seen = ''
let watch: Timer | undefined
// when the last main-thread request finished; each request refreshes the cache's TTL
let cachedAt: number | undefined
let warnedCold = false
// the session the cache age belongs to: a resume (from the picker too) swaps it without a session.start
let knownFor: string | undefined

// A resumed session has no request in this process yet, so its last reply comes from the transcript.
// ponytail: same lookup as idle-compact's; assumes ~/.claude/projects/<cwd with - for each symbol>/<id>.jsonl
const lastReplyAt = async ($: EngineInterface, id: string) => {
  const home = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${(await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))}/.claude`
  const folder = (await $.session.cwd()).replace(/[^a-zA-Z0-9]/g, '-')
  const lines = (await $.fs.read(`${home}/projects/${folder}/${id}.jsonl`)).split('\n')
  const last = lines.findLast(line => line.includes('"type":"assistant"'))
  const at = last === undefined ? NaN : Date.parse((JSON.parse(last) as { timestamp?: string }).timestamp ?? '')
  return Number.isNaN(at) ? undefined : at
}

// Opens the cold-cache pane once per cold spell when the next prompt would rewrite a large context.
// Opened unasked (on resume) the pane needs a wide terminal, so a toast says the same below that.
const checkCold = async ($: EngineInterface) => {
  if (warnedCold || cachedAt === undefined) return
  const idleMs = (await $.clock.now()) - cachedAt
  const tokens = (await read($, usageAtom))?.tokens ?? 0
  if (idleMs < CACHE_TTL_MS || tokens < COLD_WARN_TOKENS) return
  warnedCold = true
  const id = await $.session.model()
  const price = inputPrice(id)
  const cold: ContextMeterCold = {
    tokens,
    idleMin: Math.round(idleMs / 60_000),
    model: prettyModel(id),
    price,
    rewriteUsd: (tokens * price * 2) / 1e6,
    compactUsd: (tokens * price) / 1e6,
  }
  await update($, coldAtom, () => cold)
  const opened = await $.ui.open({ id: COLD_PANE, title: 'Cold cache' }).catch(() => undefined)
  if (!opened?.isPlaced) {
    $.ui.toast(`Cold cache, ${k(tokens)} context: the next prompt rewrites it for about $${cold.rewriteUsd.toFixed(2)}. /compact first costs about $${cold.compactUsd.toFixed(2)}.`, { timeoutMs: 10_000 })
  }
}

// Reads the transcript once per session id, and only when this process has no request of its own for it.
const syncSession = async ($: EngineInterface) => {
  const id = await $.session.id()
  if (id === knownFor) return
  knownFor = id
  cachedAt = await lastReplyAt($, id).catch(() => undefined)
  warnedCold = false
}

const idle = (min: number) => (min >= 120 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`)

const cacheLeft = async ($: EngineInterface) => {
  if (cachedAt === undefined) return
  const left = Math.max(0, Math.ceil((cachedAt + CACHE_TTL_MS - (await $.clock.now())) / 60_000))
  await update($, cacheAtom, prev => (prev === null || prev.left === left ? prev : { ...prev, left }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // clears the status line left by the first version of this mod
    $.ui.status(undefined)
    const id = await $.session.model()
    const effort = await effortFromSettings($, id)
    await update($, modelAtom, prev => prev ?? model(id, effort))
    // /model fires no event, so poll; turn.step still supplies the effort of live calls
    seen = id
    watch?.cancel()
    watch = $.clock.every(1000, async () => {
      // a resumed session has no response of its own yet, and its first read can fail while it loads:
      // keep trying, from the local estimate, until the band has a fill
      if ((await read($, usageAtom))?.tokens === undefined) await refresh($, true).catch(() => undefined)
      await syncSession($)
      await cacheLeft($)
      await checkCold($)
      const now = await $.session.model()
      if (now === seen) return
      seen = now
      await update($, modelAtom, () => model(now, undefined))
      const level = await effortFromSettings($, now)
      if (level && seen === now) await update($, modelAtom, () => model(now, level))
    })
    await refresh($).catch(() => undefined)
    return started
  })

  // The prompt goes out anyway; the pane only says what it will cost.
  on('prompt.submit', async ($, e, next) => {
    if (e.turnId === undefined && !e.text.startsWith('/')) await syncSession($).then(() => checkCold($))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    await update($, usageAtom, () => toUsage(e))
    return next(e)
  })

  // Every model call of the main loop: picks up /model and effort changes, and the
  // fill after each tool round instead of only at the end of the turn.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)
    await update($, modelAtom, () => model(e.model, e.effort))
    const result = yield* next(e)
    $.clock.after(250, () => void refresh($))
    const u = result.usage
    const total = u ? u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens : 0
    if (u && total > 0) {
      cachedAt = await $.clock.now()
      knownFor = await $.session.id()
      warnedCold = false
      await update($, coldAtom, () => null)
      await update($, cacheAtom, () => ({ hit: Math.round((u.cache_read_input_tokens / total) * 100), left: CACHE_TTL_MS / 60_000 }))
    }
    return result
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined || 'skip' in result) return result
    $.clock.after(1000, () => void refresh($, true))
    // whoever compacted (idle-compact, /compact, the pane's button), the pane's choice is made
    await update($, coldAtom, () => null)
    await $.ui.close({ id: COLD_PANE }).catch(() => undefined)
    return result
  })

  on('ui.render', { component: 'Pane', requestId: COLD_PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const c = await read($, coldAtom)
    if (c === null) return <Text dimColor>The cache is warm again.</Text>
    const row = (label: string, value: string, color?: string) => (
      <Box key={label}>
        <Text dimColor>{label.padEnd(16)}</Text>
        <Text color={color} bold={color !== undefined}>{value}</Text>
      </Box>
    )
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1}>
        <Text color="warning" bold>❄ The prompt cache has expired</Text>
        <Text dimColor>Idle {idle(c.idleMin)}, past the 60m cache lifetime.</Text>
        <Box flexDirection="column" marginY={1}>
          {row('Context', `${k(c.tokens)} tokens`)}
          {row('Model', `${c.model} · $${c.price}/MTok in`)}
          {row('Send as is', `~$${c.rewriteUsd.toFixed(2)}`, 'error')}
          {row('/compact first', `~$${c.compactUsd.toFixed(2)} + a small rewrite`, 'success')}
          {row('/clear', '$0', 'success')}
        </Box>
        <Text dimColor italic>List prices; a subscription bills usage limits, not dollars.</Text>
        <Box marginTop={1}>
          <Button hotkey="c" variant="primary" onPress={async () => {
            await $.ui.close({ id: COLD_PANE })
            await $.session.compact({}).catch(() => $.ui.toast('Compaction failed; run /compact.'))
          }}>Compact now</Button>
          <Text> </Text>
          <Button hotkey="x" onPress={() => $.ui.close({ id: COLD_PANE })}>Send as is</Button>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const [m, u, c, auto] = await Promise.all([read($, modelAtom), read($, usageAtom), read($, cacheAtom), read($, autoEffortAtom)])
    if (u === null || e.props.hasSurvey) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const filled = u.percent === undefined ? 0 : Math.min(BAR_CELLS, Math.round((u.percent * BAR_CELLS) / 100))
    const pct = u.percent === undefined ? '' : ` ${`${u.approx ? '~' : ''}${u.percent}%`.padStart(3)}`
    const fill = ` ${u.tokens === undefined ? '-' : k(u.tokens)}/${k(u.window)}`
    // the engine refuses its own node under a sized Box, so nothing above `inner` sets a width
    const inner = await next(e)

    return (
      <Box>
        {inner}
        <Box key="meter" flexGrow={1} flexShrink={0} flexDirection="column" alignItems="flex-end">
          <Box>
            <Text color={u.percent === undefined ? 'inactive' : heat(u.percent)}>{'▰'.repeat(filled)}</Text>
            <Text dimColor>{'▱'.repeat(BAR_CELLS - filled)}</Text>
            <Text color={u.percent === undefined ? 'inactive' : heat(u.percent)} bold>{pct}</Text>
            <Text dimColor>{fill}</Text>
            {u.limits.map((l, i) => (
              <Text key={l.label}>
                <Text dimColor>{i === 0 ? ' │ ' : '  '}{l.label} </Text>
                <Text color={heat(l.percent)}>{`${Math.round(l.percent)}%`.padStart(3)}</Text>
              </Text>
            ))}
          </Box>
          {(m || c || u.usd !== undefined) && (
            <Box>
              {u.usd !== undefined && <Text dimColor>${u.usd.toFixed(2)}{m || c ? ' │ ' : ''}</Text>}
              {c && (c.left === 0
                ? <Text color="error">cache cold</Text>
                : <Text color={c.left <= 10 ? 'warning' : 'success'}>cache {c.hit}% {c.left}m</Text>)}
              {c && m && <Text dimColor> │ </Text>}
              {m && <Text color="claude" bold>✻ {m.name}</Text>}
              {m && (auto ?? m.effort) && <Text dimColor italic> · {auto ?? m.effort}</Text>}
            </Box>
          )}
        </Box>
      </Box>
    )
  })
}
