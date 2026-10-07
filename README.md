# Reminders

A Claude Code mod. Claude records unfinished work (partial implementations, undecided design, deferred tasks) in `Docs/todos.md` of the project it runs in.

- `add_reminder`, `list_reminders`, `complete_reminder`, `reopen_reminder`: tools Claude calls.
- `/todos`: a pane listing the reminders, described below.
- `writing-reminders`: a skill Claude loads before writing a reminder, so each line reads clearly to a later session that has none of the original context.

## The /todos pane

```
Todos [Add]                           3 open · 2 blocking

P1 Blocking 2
› [Done] Checkout crashes when the cart is empty.   [Ask]
         src/checkout/order.ts:42                      1d
  [Done] Retry limit has no value.                  [Ask]
                                                       1w

P3 Polish 1
  [Done] Settings form drops unsaved input.         [Ask]
                                                    today

Recently done
  [Undo] Login redirect loops on expired session.   today

↑↓ move · Enter press · Esc close
```

Open reminders are grouped by priority: P1 Blocking, P2 Incomplete, P3 Polish. Each shows its text, the file it points at, and how long ago it was recorded.

↑↓ move between buttons, Enter presses the highlighted one, Esc closes the pane.

- **Done** marks the reminder finished. It moves to the `## Done` section of `Docs/todos.md`, which keeps the last 20.
- **Undo** puts a done reminder back where it was, with its priority, date and file pointer. The pane lists the last 3 done reminders for this. To undo an older one, ask Claude: it calls `reopen_reminder`.
- **Ask** hands the reminder to Claude. A field opens under the item: type how you want it done, or leave it empty to let Claude choose the approach. Enter closes the pane and sends Claude the reminder with your directions, and Claude marks it done when the work is finished. Press Ask again to close the field without sending.
- **Add** records a reminder of your own. A field opens under the title: type a rough note, such as "csv export breaks on commas". Enter closes the pane and sends the note to Claude, which words it by the `writing-reminders` skill, looks up the code for exact names and the file pointer, picks the priority, and adds it. It records the reminder only and leaves the work for later. Enter on an empty field closes it. Telling Claude "add a reminder: ..." in the chat does the same.

## Install

```
/plugin install reminders --marketplace Horien-Studio-SRL/Reminders
```

Answer `y` to add the marketplace, then pick a scope.

## Update

Run `/todos --update`. It refreshes the `horien-reminders` marketplace, then updates the plugin at the scope it was installed with, and prints what changed. Restart Claude Code to load the new version.

By hand, the same two steps are:

```
claude plugin marketplace update horien-reminders
claude plugin update reminders@horien-reminders
```

A plugin installed at user scope is updated once for every project. One installed at project or local scope is updated in each project that has it.

## Credits

The `writing-reminders` skill adapts [unslop](https://github.com/cursor/plugins/blob/main/pstack/skills/unslop/SKILL.md) by Lauren Tan and [writing-for-agents](https://github.com/mattpocock/skills/tree/main/skills/productivity/writing-for-agents) by Matt Pocock, both MIT licensed. See [CREDITS.md](CREDITS.md).

## License

MIT
