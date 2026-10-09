# Auto effort

A Claude Code mod that picks the effort level for each prompt you send. On a subscription, lower effort on easy turns means less thinking, so your usage limits last longer.

When you send a prompt, Haiku reads it along with the last six messages of the conversation and sorts it into one of three levels. Because of the context, a short prompt like "go ahead and implement it" is rated by the plan it refers to.

| Level | For |
| --- | --- |
| `low` | Questions, explanations, chat, running a command, git chores. No file edits. |
| `medium` | Ordinary code edits and multi-step work. |
| `high` | Hard debugging, design, large refactors, or "still broken" after a failed attempt. |

During the turn the level can only rise, based on what Claude does:

- After the first file edit, at least `medium`.
- After edits to four different files, Claude leaving plan mode (`ExitPlanMode`), or 15 steps, `high`.

Edits made by subagents don't count. The next prompt starts from Haiku's pick again. A turn you didn't start, such as a background task finishing, keeps the previous level so effort doesn't flip back and forth. With context-meter installed, its band shows the current level; the mod draws nothing itself.

Explore subagents run at `low` unless Claude asks for a specific effort. A subagent starts with an empty context, so this costs no cache.

The mod never goes above `high`. If you set `xhigh` or `max` with `/effort`, or write "ultrathink", it leaves that turn alone.

## Budget mode

Once any of your usage windows passes 80%, either the 5-hour or the 7-day one, turns the mod would run at `high` run at `medium` instead. context-meter then shows `(budget)` after the level. A level you pinned yourself isn't capped.

## The prompt cache

I checked about 40 effort switches across 40 sessions. Switching between `low`, `medium` and `high` kept the cached conversation every time, so raising the level partway through a turn costs nothing extra. Switching to or from `max` threw the cache away and rewrote 180-250k tokens. The mod never sets `max` or `xhigh`, so that cost only comes from `/effort` or ultrathink.

In case that changes, the mod still checks: if a switch writes more to the cache than it reads, you get a toast once. If it keeps appearing, run `/auto-effort off`.

## Commands

```
/auto-effort            show the current state
/auto-effort off        stop changing effort
/auto-effort on         back to automatic
/auto-effort high       pin one level (low, medium or high)
/auto-effort budget 70  start budget mode at 70% instead of 80%
/auto-effort budget off turn budget mode off (budget on brings back 80%)
```

Each prompt costs one small Haiku call to classify it, with the last six messages included (up to 800 characters each).

## Install

```
/plugin install auto-effort --marketplace noash-xrc/claude-tools
```

Answer `y` to add the marketplace, then pick a scope.

## Update

```
claude plugin marketplace update noash-tools
claude plugin update auto-effort@noash-tools
```

Restart Claude Code to load the new version.

## License

MIT
