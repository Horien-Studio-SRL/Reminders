# Reminders

A Claude Code mod that keeps a to-do list of unfinished work in your project. When Claude leaves a partial implementation, hits a design question nobody has decided, or hears you put something off, it records a reminder in `Docs/todos.md`. A later session, or you, picks it up from there.

- A line at the top right of the prompt counts the open and blocking reminders.
- `/todos` opens a pane to finish, reprioritize, undo, or hand reminders to Claude.
- `/todos --scan` fills the list from the TODOs and stubs already in the code.
- When Claude edits code a reminder points at, it is told, so the list stays accurate.

**Contents:** [Install](#install) · [Getting started](#getting-started) · [How it works](#how-it-works) · [Fill the list](#fill-the-list) · [The line above the prompt](#the-line-above-the-prompt) · [The /todos pane](#the-todos-pane) · [Commands](#commands) · [Token use](#token-use) · [Settings](#settings) · [Update](#update)

## Install

```
/plugin install reminders --marketplace Horien-Studio-SRL/Reminders
```

Answer `y` to add the marketplace, then pick a scope.

## Getting started

1. Run `/todos --scan` once, so the list starts with the unfinished work already in the project. See [Fill the list](#fill-the-list).
2. Work as usual. Claude records new reminders as it goes, and the line above the prompt shows the count.
3. Run `/todos` to see the list, mark items done, or hand one to Claude.

## How it works

**Claude records reminders on its own.** It calls `add_reminder` the moment it leaves a stub or a placeholder value, meets an undecided question, or hears you say "later" or "not now". Each reminder has a priority, a date, and usually a pointer to the code, such as `src/net/retry.ts:42`:

- **P1 Blocking:** something is broken or blocks other work.
- **P2 Incomplete:** a feature is unfinished.
- **P3 Polish:** cleanup or polish.

**Each reminder is written to stand on its own.** Before writing one, Claude loads the `writing-reminders` skill, so the line makes sense to a later session that has none of the original conversation. The file stays in one language: that of the reminders already in it, else the project's docs, else your note.

**Claude keeps the list accurate.** When Claude edits a file that an open reminder points at, it is told about that reminder along with the edit's result. If the change finishes the work, Claude marks the reminder done, and a toast names it: `Done: Checkout crashes when the cart is empty.` If the change makes the reminder inaccurate, Claude tells you. Each reminder is pointed out once per session.

**The file is plain Markdown.** Reminders live in `Docs/todos.md` (see [Settings](#settings) to change it), one per line, so you can read it, edit it by hand, and commit it:

```
## Open

- [ ] P1 2026-10-06 Checkout crashes when the cart is empty. (at src/checkout/order.ts:42)
- [ ] P3 2026-10-07 Settings page spacing differs from the rest of the app.

## Done

- [x] P1 2026-10-01 Login redirect loops on expired session. (done 2026-10-07)
```

The Done section keeps the last 20. Hand edits are fine as long as each line keeps this format.

## Fill the list

A new install starts with no reminders. There are two ways to add them yourself.

### Scan the code

`/todos --scan` has Claude collect the unfinished work already in the project:

- TODO, FIXME, HACK and XXX in comments, in any case or form (`todo:`, `@todo`, `TODO(name)`), in every comment syntax the project uses
- comments that say in words that work was left: "for now", "temporary", "workaround", "not yet", "later", or the same in the language of the comments
- stubs, such as code that throws "not implemented" or returns a placeholder
- skipped or disabled tests
- known issues written in the README or other docs

Claude searches the files git tracks, skipping vendored and generated code and build output. It reads the code around each finding, drops what is stale, and merges findings about the same work. It adds at most 30 reminders, the ones that matter most, and skips any an open reminder already covers. It changes no code. Its reply says how many it added and what it left out.

`/todos --scan src/api` scans only that path. Running the scan again later adds only what is new.

> **The scan costs tokens.** It is the one part of the plugin that uses a noticeable amount: from about 10,000 tokens in a small project to 100,000 or more in a large one. Scanning one folder at a time keeps each run smaller. See [Token use](#token-use).

### Add one by hand

`/todos add csv export breaks on commas` sends your rough note to Claude. Claude words it, looks up the code for exact names and the pointer, picks the priority, and records it. The work itself waits for later.

You can also use the Add button in the pane, or tell Claude "add a reminder: ..." in the chat.

## The line above the prompt

```
                              Todos: 6 open · 2 blocking · /todos
> _
```

The line sits at the top right of the prompt, with the blocking count in red. It updates whenever a reminder is added, finished or moved, and hides itself when nothing is open. Before a project has any reminders, it reads `No reminders yet · /todos --scan collects the TODOs in the code`.

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

Open reminders are grouped by priority. Each shows its text, the file it points at, and how long ago it was recorded. ↑↓ move between buttons, Enter presses the highlighted one, Esc closes the pane.

| Button | What it does |
| --- | --- |
| **▾ / ▸** | Folds a section to its header, or unfolds it. The pane remembers folded sections across sessions. |
| **Done** | Marks the reminder finished and moves it to the Done section of the file. |
| **P1 / P2 / P3** | Steps the reminder to the next priority and moves it to that section. |
| **Undo** | Puts a done reminder back where it was, with its priority, date and pointer. The pane lists the last 3 done; to undo an older one, ask Claude. |
| **Ask** | Hands the reminder to Claude. A field opens under it: type how you want it done, or leave it empty to let Claude choose. Enter sends it, and Claude marks the reminder done when the work is finished. Press Ask again to close the field. |
| **Add** | Opens a field under the title for a rough note. Enter sends it to Claude, which words and records it, like `/todos add`. |

The pane flags reminders that may be stale: a pointer whose file no longer exists reads `file missing`, and an age of 30 days or more is drawn in yellow.

## Commands

| Command | What it does | Uses tokens |
| --- | --- | --- |
| `/todos` | Opens the pane. | No |
| `/todos add <note>` | Sends your note to Claude, which words it and records it. | Yes, a little |
| `/todos add` | With no note, opens the pane with the Add field ready. | No |
| `/todos --scan [path]` | Has Claude fill the list from the unfinished work in the code. | Yes, a lot |
| `/todos --header on\|off` | Shows or hides the line above the prompt. Bare, it flips. | No |
| `/todos --update` | Updates the plugin. See [Update](#update). | No |

Each argument works with or without the leading `--`: `/todos scan` is the same as `/todos --scan`.

## Token use

### Free

These never call Claude, so they cost no tokens:

- the line above the prompt
- the `/todos` pane, and its Done, P1/P2/P3, Undo and fold buttons, which edit the file directly
- the commands `/todos`, `/todos add` with no note, `/todos --header` and `/todos --update`

A command's one-line reply, such as "The reminders line above the prompt is off.", is part of the conversation, so Claude reads it along with your next message: a few tokens.

### What costs tokens

Rough figures (a token is about 4 characters of English):

| What | When | Tokens |
| --- | --- | --- |
| The text that tells Claude the reminder tools exist and when to use them | Every session | about 650 |
| The `writing-reminders` skill | The first time Claude writes a reminder in a session | about 1,100 |
| Recording a reminder | Each reminder | about 100 |
| Listing reminders | When you ask Claude about open work | about 25 per open reminder |
| The note after Claude edits a file a reminder points at | Once per reminder per session | about 50, plus 20 per reminder |
| Ask, Add, `/todos add <note>` | Each time | about 100, plus the code Claude reads to do or record the work |
| `/todos --scan` | Only when you run it | from about 10,000 in a small project to 100,000 or more in a large one |

**On average**, a session that records or finishes a few reminders spends about 2,000 tokens on the plugin, most of it the skill. A session that never touches reminders spends about 650.

The scan's cost grows with the number of findings, since Claude reads the code around each one. To keep it down, scan one folder at a time with `/todos --scan <path>`; a later scan only adds what is new.

These figures are estimates from the size of the text the plugin gives Claude, not measured usage.

## Settings

Both are in `/config`, under the plugin.

| Setting | Default | What it does |
| --- | --- | --- |
| Reminders file (`path`) | empty | Where reminders are kept, relative to the project. |
| Reminders line above the prompt (`showHeader`) | on | Shows the line at the top right of the prompt. |

With the path empty, the plugin uses the project's `docs` folder however it is spelled (`docs`, `Docs`), so a lowercase `docs/` doesn't get a second `Docs/` beside it on Linux. With no such folder, it uses `Docs/todos.md`.

## Update

Run `/todos --update`. It refreshes the `horien-reminders` marketplace, updates the plugin at the scope it was installed with, and prints what changed. Restart Claude Code to load the new version.

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
