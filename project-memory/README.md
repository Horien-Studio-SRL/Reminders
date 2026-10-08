# Project memory

A Claude Code mod for a repo that keeps shared memory in `memory/`, committed with the code. A Haiku agent reads the memory and hands the main session only what bears on the task, so a 26KB memory file costs the main model a few lines instead of its whole length.

The mod switches on in a repo that has `memory/MEMORY.md` and stays out of the way everywhere else.

## What's in it

| Part | What it does |
|---|---|
| `memory-recall` agent (Haiku, read-only) | Given a task, reads the index and the matching files. Returns rejected approaches word for word, the relevant facts with their source files, and which files to read in full |
| `memory-keeper` agent (Haiku) | Compacts the index, merges duplicates, fixes index lines that point nowhere, and files a memory whose text the main session wrote |
| `project-memory` skill | The file format and the rules for saving. Saving stays with the main session because it needs the conversation |
| Hook | Where `memory/MEMORY.md` exists, adds a short section to the system prompt telling Claude to ask `memory-recall` before a non-trivial task. Elsewhere it hides both agents |

A recall on a 136-memory folder took about 40 seconds and $0.02 of Haiku, and returned about 2k tokens.

## Layout

```
memory/
  MEMORY.md          index, one line per memory: - [Title](slug.md) — hook
  some-decision.md   one memory, with name / description / metadata.type frontmatter
```

The skill has the full format. A repo with no `memory/` folder needs one with a `MEMORY.md` in it before the mod switches on.

## Codex

Codex can't load the mod, but the files are plain Markdown, so it reads and writes the same folder. Put the reading and saving rules in the repo's `AGENTS.md`: read `memory/MEMORY.md` before a non-trivial task, open the matching files, and save in the format above. Claude Code doesn't read `AGENTS.md`, so the two sets of instructions don't collide. The keeper's compacting step catches a memory Codex wrote without an index line.

## Moving from a per-repo setup

If the repo's `CLAUDE.md` tells Claude to read `memory/MEMORY.md`, or the repo has its own `project-memory` skill, remove them. The mod's prompt section replaces the first, and the skills would otherwise both show up.

## Install

```
/plugin install project-memory --marketplace noash-xrc/claude-tools
```
