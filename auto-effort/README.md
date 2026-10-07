# Auto effort

A Claude Code mod that picks the effort level for each prompt you send. On a subscription, lower effort on easy turns means less thinking, so your usage limits last longer.

When you send a prompt, Haiku sorts it into one of three levels:

| Level | For |
| --- | --- |
| `low` | Questions, explanations, chat, running a command, git chores. No file edits. |
| `medium` | Ordinary code edits and multi-step work. |
| `high` | Hard debugging, design, large refactors, or "still broken" after a failed attempt. |

The level holds for every step of that turn. A turn you didn't start, such as a background task finishing, keeps the previous level so effort doesn't flip back and forth. With context-meter installed, its band shows the current level; the mod draws nothing itself.

Explore subagents run at `low` unless Claude asks for a specific effort. A subagent starts with an empty context, so this costs no cache.

The mod never goes above `high`. If you set `xhigh` or `max` with `/effort`, or write "ultrathink", it leaves that turn alone.

## Budget mode

Once any of your usage windows passes 80%, either the 5-hour or the 7-day one, turns the mod would run at `high` run at `medium` instead. context-meter then shows `(budget)` after the level. A level you pinned yourself isn't capped.

## The prompt cache

Anthropic's API can change effort in two ways. A per-message change keeps the cached conversation. A top-level change throws it away, and the next request pays to cache the whole conversation again. I haven't confirmed which way Claude Code sends the change this mod makes. So the mod checks: if a switch writes more to the cache than it reads, you get a toast saying so. If that toast keeps appearing, the switches cost more than they save, and you should run `/auto-effort off`.

## Commands

```
/auto-effort            show the current state
/auto-effort off        stop changing effort
/auto-effort on         back to automatic
/auto-effort high       pin one level (low, medium or high)
/auto-effort budget 70  start budget mode at 70% instead of 80%
/auto-effort budget off turn budget mode off (budget on brings back 80%)
```

Each prompt costs one small Haiku call to classify it.

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
