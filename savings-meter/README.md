# Savings meter

A Claude Code mod that keeps a ledger of what the other token-saving mods in this collection save. Run `/savings` to see it:

```
Since 2026-10-08, at API prices:
output-trimmer: 1.2M input tokens not re-read, about $0.24
subagent-router: 340k tokens on a cheaper model, about $1.10
auto-effort on: 42 prompts, $0.31 and 2k output tokens per prompt, 0.40% of the 5-hour window per prompt
auto-effort off: 9 prompts, $0.44 and 3k output tokens per prompt, 0.55% of the 5-hour window per prompt
Prompts differ, so the auto-effort rows only mean something after a few days of each.
```

## How each figure is worked out

- **output-trimmer.** Every main request after a trim would have re-read the cut text, so each request adds the tokens trimmed so far, priced as cache reads. A compaction drops the old output from the context, so the count starts over after one.
- **subagent-router.** Each request from a routed subagent is priced twice, at the main model and at the model it ran on, and the difference is added.
- **auto-effort.** There's no way to know what a turn would have cost at another effort, so the ledger compares instead. Every prompt is filed under on or off, depending on whether auto-effort set the effort, with its API cost, output tokens and the share of the 5-hour window it used. To get a fair comparison, run `/auto-effort off` for a few days of ordinary work now and then.

Dollar figures use Anthropic's API prices. On a subscription you don't pay per token, so the window share per prompt is the closer figure to what you use up.

Two of the prices are guesses: Haiku cache reads at a tenth of its input price, and cache writes at twice the input price, the rate for the 1-hour cache.

The ledger is kept between sessions. If two sessions run at once, the last one to save wins.

## Commands

- `/savings` shows the ledger
- `/savings reset` clears it and starts a new one from today

## Install

Install it with the mods it measures:

```
/plugin install savings-meter --marketplace noash-xrc/claude-tools
```

Answer `y` to add the marketplace, then pick a scope.

## Update

```
claude plugin marketplace update noash-tools
claude plugin update savings-meter@noash-tools
```

Restart Claude Code to load the new version.

## License

MIT
