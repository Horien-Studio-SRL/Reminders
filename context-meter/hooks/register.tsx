import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage, Timer, TurnStepInput } from 'claude-code'
import type { ContextMeterUsage } from '../types/index'

const usageAtom = atom({ plugin: 'context-meter', key: 'usage' } as const, null)
const modelAtom = atom({ plugin: 'context-meter', key: 'model' } as const, null)
const cacheAtom = atom({ plugin: 'context-meter', key: 'cache' } as const, null)

// ponytail: assumes the 1-hour TTL Claude Code uses on subscriptions; API-key sessions on 5 minutes read too warm
const CACHE_TTL_MS = 60 * 60 * 1000

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
    await refresh($)
    // /model fires no event, so poll; turn.step still supplies the effort of live calls
    seen = id
    watch?.cancel()
    watch = $.clock.every(1000, async () => {
      await cacheLeft($)
      const now = await $.session.model()
      if (now === seen) return
      seen = now
      await update($, modelAtom, () => model(now, undefined))
      const level = await effortFromSettings($, now)
      if (level && seen === now) await update($, modelAtom, () => model(now, level))
    })
    return started
  })

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
      await update($, cacheAtom, () => ({ hit: Math.round((u.cache_read_input_tokens / total) * 100), left: CACHE_TTL_MS / 60_000 }))
    }
    return result
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && !('skip' in result)) $.clock.after(1000, () => void refresh($, true))
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const [m, u, c] = await Promise.all([read($, modelAtom), read($, usageAtom), read($, cacheAtom)])
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
              {m?.effort && <Text dimColor italic> · {m.effort}</Text>}
            </Box>
          )}
        </Box>
      </Box>
    )
  })
}
