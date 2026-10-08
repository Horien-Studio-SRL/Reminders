# claude-tools

Claude Code mods I use every day. Each folder is one plugin, and all of them install from the `noash-tools` marketplace in this repository.

| Mod | What it does |
| --- | --- |
| [reminders](reminders/) | Claude records unfinished work in `Docs/todos.md`. `/todos` opens a pane to finish, reprioritize or hand reminders back to Claude. |
| [context-meter](context-meter/) | A band above the prompt with context fill, rate-limit windows, session cost, cache state, model and effort. |
| [auto-effort](auto-effort/) | Haiku sorts each prompt into low, medium or high effort, and search subagents run at low. Budget mode caps effort at medium once a usage window passes 80%. |
| [output-trimmer](output-trimmer/) | Long Bash output reaches Claude as its start, end and error lines, with the full output saved to a file. |
| [subagent-router](subagent-router/) | Search subagents run on Haiku and general-purpose ones on Sonnet, so the main model's tokens go to the work only it can do. |
| [savings-meter](savings-meter/) | `/savings` shows what output-trimmer, subagent-router and auto-effort saved. |
| [idle-compact](idle-compact/) | Compacts an idle session with a large context just before its prompt cache expires. |
| [project-memory](project-memory/) | A Haiku agent reads the repo's `memory/` folder and returns only what the task needs. Another one compacts it. |

## Install

Install any mod by name:

```
/plugin install reminders --marketplace noash-xrc/claude-tools
/plugin install context-meter --marketplace noash-xrc/claude-tools
/plugin install auto-effort --marketplace noash-xrc/claude-tools
/plugin install output-trimmer --marketplace noash-xrc/claude-tools
/plugin install subagent-router --marketplace noash-xrc/claude-tools
/plugin install savings-meter --marketplace noash-xrc/claude-tools
/plugin install idle-compact --marketplace noash-xrc/claude-tools
/plugin install project-memory --marketplace noash-xrc/claude-tools
```

The first time, answer `y` to add the marketplace, then pick a scope. Each mod's README covers its settings and how to update it.

## Develop

Each mod is a hooks module with its own tests. From the repository root:

```
claude plugin validate reminders
claude plugin test reminders
```

To run a mod from its folder instead of an install, start Claude Code with `claude --plugin-dir <folder>`.

## License

MIT. See [LICENSE](LICENSE).
