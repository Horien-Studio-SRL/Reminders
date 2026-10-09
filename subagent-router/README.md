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

## Orchestrate

`/orchestrate <task>` runs a big task with the main session as orchestrator and three subagent roles under it:

- **scout** reads code and answers questions, never edits
- **worker** completes one task from a contract: the files it owns, a check command and what to report back
- **reviewer** checks a worker's diff against its contract, for the tasks the orchestrator marks as risky

A pane opens first with three settings, then Start:

| Level | scout | worker | reviewer |
|---|---|---|---|
| low | Haiku, low | Sonnet, medium | Sonnet, high |
| mid (default) | Haiku, low | Sonnet, high | Opus, medium |
| high | Haiku, low | Opus, medium | Opus, high |
| xhigh | Haiku, medium | Opus, high | Opus, high |

- **Workers at once**, 3 by default. A spawn past the limit is refused until one finishes.
- **Approval**: `plan` (default) stops once for you to approve the plan after scouting, `step` before every step, `off` never.

The orchestrator keeps the plan in Claude Code's task list. Tasks that edit the same files run one after another. It runs each task's check command itself, and a task that fails gets one retry, then a retry on the next level's worker, then it asks you. After Start the pane keeps a fixed height: a progress bar of finished tasks, a folded line counting the running agents (click it for one row per worker slot with the agent's role, model and spend), what comes next, and Stop. Approve appears only while the orchestrator waits for you. At xhigh, consider `/model fable` for the orchestrator first; the mod leaves the main model alone.

- `/orchestrate <level>` changes the level mid-run, for agents spawned from the next turn
- `/orchestrate stop` ends the run and prints what its agents spent at API prices
- a toast warns when the 5-hour window passes 80%

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
