# Context meter

A Claude Code mod that draws two rows at the right of the band above the prompt:

```
▰▰▰▱▱▱▱▱ 42% 84k/200k │ 5h 24%  7d  7%
                  $1.24 │ ✻ Opus 5.5 · high
```

- The first row shows how full the context window is, then how much of each rate-limit window you have used. Each figure turns yellow at 60% and red at 85%.
- The second row shows the session's cost, the model and its effort level. A `/model` switch shows within a second.
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
