import type { Register } from 'claude-code'

const SECTION = {
  id: 'project-memory:recall',
  scope: 'session',
  text: [
    '# Project memory',
    'This repo keeps shared memory in `memory/`, one file per memory, indexed in `memory/MEMORY.md`.',
    "Before a non-trivial task, ask the `project-memory:memory-recall` agent what the memory says about the task. Don't read `memory/` yourself unless its answer points you to a file you need in full.",
    'To save a memory, follow the `project-memory` skill. To compact the index or clean up the folder, hand it to the `project-memory:memory-keeper` agent.',
  ].join('\n'),
} as const

// Read once per session start: a repo gains a memory folder rarely enough that a reload catches it.
let hasMemory = false

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    hasMemory = await $.fs.exists(`${e.cwd}/memory/MEMORY.md`).catch(() => false)
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    return hasMemory ? { sections: [...r.sections, SECTION] } : r
  })

  // The agents only make sense where there is a memory folder; elsewhere they'd just add to the agent listing.
  on('agent.offer', async ($, e, next) =>
    e.agent.startsWith('project-memory:') && !hasMemory ? { isOffered: false } : next(e)).catch(($, e, next) => next(e))
}
