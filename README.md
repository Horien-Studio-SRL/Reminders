# claude-tools

Claude Code mods I use every day. Each folder is one plugin, and all of them install from the `noash-tools` marketplace in this repository.

| Mod | What it does |
| --- | --- |
| [reminders](reminders/) | Claude records unfinished work in `Docs/todos.md`. `/todos` opens a pane to finish, reprioritize or hand reminders back to Claude. |
| [context-meter](context-meter/) | A band above the prompt with context fill, rate-limit windows, session cost, model and effort. |

## Install

Install any mod by name:

```
/plugin install reminders --marketplace noash-xrc/claude-tools
/plugin install context-meter --marketplace noash-xrc/claude-tools
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
