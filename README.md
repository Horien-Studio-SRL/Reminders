# Reminders

A Claude Code mod. Claude records unfinished work (partial implementations, undecided design, deferred tasks) in `Docs/todos.md` of the project it runs in.

- `add_reminder`, `list_reminders`, `complete_reminder`: tools Claude calls.
- `/todos`: a pane with the open items, sorted P1 to P3, each with a Done button.

Done items move to a `## Done` section that keeps the last 20.

## Install

```
/plugin install reminders --marketplace Horien-Studio-SRL/Reminders
```

Answer `y` to add the marketplace, then pick a scope.

## License

MIT
