---
name: project-memory
description: Save, update or forget a memory in this repo's memory/ folder. Use when the user says "remember", "save to memory", "forget" or "update memory", or when a decision, correction or rejected approach comes up that a future session should know.
---

# Saving to project memory

The repo keeps shared memory in `memory/`. Reading it is the `project-memory:memory-recall` agent's job, and compacting it is `project-memory:memory-keeper`'s. This skill covers saving, which needs the conversation, so you do it.

## What to save

Things a future session can't get from the code or git history: decisions and why, user corrections, rejected approaches, constraints, gotchas, pointers to external resources.

Don't save code structure, details of a past fix, or anything only this conversation needs.

## How

1. Grep `memory/MEMORY.md` for the topic. If a memory covers it, edit that file instead of adding one.
2. Otherwise write `memory/<short-kebab-slug>.md`:

```markdown
---
name: <short-kebab-slug>
description: <one-line summary used to decide relevance>
metadata:
  type: user | feedback | project | reference
---

<the fact. For feedback and project memories add **Why:** and **How to apply:** lines.
Link related memories with [[their-slug]]. Use absolute dates, never "yesterday".>
```

3. Add one line to `memory/MEMORY.md`: `- [Title](slug.md) — hook`, 150 characters at most. The hook names the topic and its key word or trap. Detail goes in the file.
4. To forget, delete the file and its index line.

Mark a rejected approach with `REJECTED` or "don't re-propose": the recall agent copies those word for word.

When the index passes 16KB, hand compacting to `project-memory:memory-keeper`.
