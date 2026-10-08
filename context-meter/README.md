# Context meter

A Claude Code mod that draws two rows at the right of the band above the prompt:

```
▰▰▰▱▱▱▱▱ 42% 84k/200k │ 5h 24%  7d  7%
   $1.24 │ cache 97% 52m │ ✻ Opus 5.5 · high
```

- The first row shows how full the context window is, then how much of each rate-limit window you have used. Each figure turns yellow at 60% and red at 85%.
- The second row shows the session's cost, the prompt cache, the model and its effort level. A `/model` switch shows within a second.
- The cache figure is the share of the last request's input that came from the cache, then the minutes until it expires. It turns yellow under 10 minutes and shows `cache cold` once expired. Your next prompt after that pays to cache the whole conversation again, so that's a cheap moment to `/compact`. The countdown assumes the 1-hour cache that Claude Code uses on subscriptions. With 120k tokens or more in context on a cold cache, a "Cold cache" pane opens. That happens when you resume a session whose last reply is over an hour old, or when you send a prompt after the cache expired. The pane estimates, at list price, what sending as is costs (a 1h cache write, twice the input price) next to `/compact` first (one plain read). Press `c` to compact or `x` to close it. On a terminal under 144 columns a resume can't seat the pane, so a toast gives the same figures. It shows once until the cache is warm again. Any compaction closes it, including the one idle-compact runs about a minute after a cold resume.
- After a compaction the fill is an estimate until the next response, marked with `~`.

It costs no tokens: every figure comes from what Claude Code already tracks.

## Install

```
/plugin install context-meter --marketplace noash-xrc/claude-tools
```

Answer `y` to add the marketplace, then pick a scope.

## Update

```
claude plugin marketplace update noash-tools
claude plugin update context-meter@noash-tools
```

Restart Claude Code to load the new version.

## License

MIT
