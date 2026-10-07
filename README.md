# Reminders

A Claude Code mod. Claude records unfinished work (partial implementations, undecided design, deferred tasks) in `Docs/todos.md` of the project it runs in.

- `add_reminder`, `list_reminders`, `complete_reminder`, `reopen_reminder`: tools Claude calls.
- `/todos`: a pane listing the reminders, plus the commands below.
- A line at the top right of the prompt with the open and blocking counts.
- `writing-reminders`: a skill Claude loads before writing a reminder, so each line reads clearly to a later session that has none of the original context. It keeps the file in one language: that of the reminders already there, else the project's docs, else your note.

## Commands

| Command | What it does |
| --- | --- |
| `/todos` | Opens the pane. |
| `/todos add <note>` | Sends your note to Claude, which words it and records it. With no note, opens the pane with the Add field ready. |
| `/todos --scan [path]` | Has Claude fill the list from the unfinished work already in the code. See [Fill the list](#fill-the-list). |
| `/todos --header on\|off` | Shows or hides the line above the prompt. Bare, it flips. |
| `/todos --update` | Updates the plugin. See [Update](#update). |

Each argument works with or without the leading `--`: `/todos scan` is the same as `/todos --scan`.

## The line above the prompt

```
                              Todos: 6 open · 2 blocking · /todos
> _
```

The line sits at the top right of the prompt, with the blocking count in red. It updates whenever a reminder is added, finished or moved. It hides itself when nothing is open. Before a project has any reminders, it reads `No reminders yet · /todos --scan collects the TODOs in the code`.

Turn it off with `/todos --header off`, or with the "Reminders line above the prompt" setting in `/config`.

## The /todos pane

```
Todos [Add]                           6 open · 2 blocking

▾ P1 Blocking 2
› [Done] Checkout crashes when the cart is empty.   [Ask]
    [P1] src/checkout/order.ts:42                      1d
  [Done] Retry limit has no value.                  [Ask]
    [P1] src/net/retry.ts:42 · file missing            5w

▸ P3 Polish 4

▾ Recently done
  [Undo] Login redirect loops on expired session.   today

↑↓ move · Enter press · Esc close
```

Open reminders are grouped by priority: P1 Blocking, P2 Incomplete, P3 Polish. Each shows its text, the file it points at, and how long ago it was recorded.

↑↓ move between buttons, Enter presses the highlighted one, Esc closes the pane.

- **▾ / ▸** folds a section to its header, or unfolds it. The pane remembers folded sections across sessions.
- **Done** marks the reminder finished. It moves to the `## Done` section of the file, which keeps the last 20.
- **P1, P2, P3** under Done changes the priority: each press steps to the next one, and the reminder moves to that section.
- **Undo** puts a done reminder back where it was, with its priority, date and file pointer. The pane lists the last 3 done reminders for this. To undo an older one, ask Claude: it calls `reopen_reminder`.
- **Ask** hands the reminder to Claude. A field opens under the item: type how you want it done, or leave it empty to let Claude choose the approach. Enter closes the pane and sends Claude the reminder with your directions, and Claude marks it done when the work is finished. Press Ask again to close the field without sending.
- **Add** records a reminder of your own. A field opens under the title: type a rough note, such as "csv export breaks on commas". Enter closes the pane and sends the note to Claude, which words it by the `writing-reminders` skill, looks up the code for exact names and the file pointer, picks the priority, and adds it. It records the reminder only and leaves the work for later. Enter on an empty field closes it.

To add without the pane, run `/todos add csv export breaks on commas`, or tell Claude "add a reminder: ..." in the chat.

The pane flags reminders that may be stale. A pointer whose file no longer exists reads `file missing`. An age of 30 days or more is drawn in yellow.

When Claude finishes a reminder, a toast names it: `Done: Checkout crashes when the cart is empty.`

## Claude and the code a reminder points at

When Claude edits a file that an open reminder points at, it is told about that reminder along with the edit's result. If the change finishes the work, Claude marks the reminder done. If the change makes the reminder inaccurate, Claude tells you. Each reminder is pointed out once per session.

## Install

```
/plugin install reminders --marketplace Horien-Studio-SRL/Reminders
```

Answer `y` to add the marketplace, then pick a scope.

## Fill the list

A new install starts with no reminders. Run `/todos --scan` to have Claude collect the unfinished work already in the project:

- TODO, FIXME, HACK and XXX comments
- stubs, such as code that throws "not implemented" or returns a placeholder
- skipped or disabled tests
- known issues written in the README or other docs

Claude reads the code around each finding, drops what is stale, and merges findings about the same work. It words each reminder by the `writing-reminders` skill and adds at most 30, skipping any that an open reminder already covers. It changes no code. Its reply says how many reminders it added and what it left out.

`/todos --scan src/api` scans only that path. Running the scan again later adds only what is new.

## Settings

Both are in `/config`, under the plugin.

| Setting | Default | What it does |
| --- | --- | --- |
| Reminders file (`path`) | empty | Where reminders are kept, relative to the project. |
| Reminders line above the prompt (`showHeader`) | on | Shows the line at the top right of the prompt. |

With the path empty, the plugin uses the project's `docs` folder however it is spelled (`docs`, `Docs`), so a lowercase `docs/` doesn't get a second `Docs/` beside it on Linux. With no such folder, it uses `Docs/todos.md`.

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
