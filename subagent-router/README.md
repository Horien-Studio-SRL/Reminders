# Subagent router

A Claude Code mod that starts subagents on a cheaper model than the main one. A subagent reads files and searches in its own context and hands back a summary, so a cheaper model reading through a codebase saves tokens without touching the main conversation's prompt cache.

| Agent type | Model |
|---|---|
| Explore | Haiku |
| general-purpose | Sonnet |

Every other type, such as Plan or an agent you wrote, keeps the model its definition names.

The mod leaves a spawn alone when:

- Claude named a model in the call
- the subagent is a fork, which always runs on the main model
- the subagent is a teammate
- the route wouldn't be cheaper, for example a general-purpose agent started from a Sonnet session

Effort isn't set here. With auto-effort installed, Explore agents run at `low`.

## Commands

- `/subagent-router` shows whether routing is on
- `/subagent-router off` and `/subagent-router on` turn it off and back on for the session

## Install

```
/plugin install subagent-router --marketplace noash-xrc/claude-tools
```

Answer `y` to add the marketplace, then pick a scope.

## Update

```
claude plugin marketplace update noash-tools
claude plugin update subagent-router@noash-tools
```

Restart Claude Code to load the new version.

## License

MIT
