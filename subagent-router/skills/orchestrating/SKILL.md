---
name: orchestrating
description: Run a big task as orchestrator over scout, worker and reviewer subagents. Use when a /orchestrate kickoff message names this skill.
---

# Orchestrating

You are the orchestrator. Your context is the expensive one, so subagents read and write code and you plan, check and decide. The kickoff message gives the level, the escalation model, the agent limit and the approval mode; the Orchestrate pane shows the person the plan and spend as you go.

## Steps

1. **Scout.** Spawn `subagent-router:scout` agents to answer what you need to split the task: where the code lives, what touches it, how it is tested. Done when you can name every file the task changes and the command that checks each part.

2. **Plan the next step only.** Write each task with `mcp__subagent-router__update_tasks`, not `TaskCreate`: the Orchestrate pane draws its bar from this list alone. Give each one an `id`, a `subject` of a few words, and a `contract` holding:
   - **Goal**: what changes, in one or two sentences.
   - **Owns**: the files the worker may edit. Two tasks that own the same file get a dependency (`blockedBy`), so they run in sequence.
   - **Check**: one command that passes only when the goal is met (a test, a build, a grep).
   - **Review**: yes when a bug here would be costly or quiet (security, data, concurrency, public API), otherwise no.
   - **Deliverable**: files changed, the check's result, open questions. Nothing else.

   Later steps stay one line each until the step before them reports. Size each task so the brief is shorter than the work; merge tasks smaller than that. Done when every task in the step has all five fields.

3. **Approval.** `plan`: after the first plan, call `mcp__subagent-router__await_approval` with a one-line summary, then end your turn; the person's next message approves or changes the plan. `step`: the same before every step. `off`: go on.

4. **Run.** Set a task's status to `in_progress` with `update_tasks` and spawn a `subagent-router:worker` with its contract as the prompt, as soon as the tasks it is blocked by are completed. Stay within the agent limit; a spawn past it is refused, so wait for a running agent to finish. Leave model and effort out of the spawn: the role sets them.

5. **Check every deliverable yourself.** Run the contract's check command; a worker's report that it passed is not the check. For `Review: yes`, spawn a `subagent-router:reviewer` with the contract and `git diff` of the owned files. Set the task `completed` when its check passes and its review, if any, found nothing that breaks the contract. The pane's bar counts only what you set.

6. **Failure.** A failed check or a blocking review finding: spawn the worker once more with the contract plus the failure output. Fails again: spawn it with the escalation model and effort from the kickoff. Fails a third time, or a worker says the contract cannot be met: stop and ask the person, with what was tried.

7. **Re-plan.** When a step's tasks are completed, update the next step's contracts with what you learned, then go back to step 3.

8. **Report.** When every task is completed: what changed, each check's result, open questions and anything skipped, in a few lines. Spend is in the Orchestrate pane; tell the person `/orchestrate stop` closes it and prints the total.

## Context

Keep worker deliverables out of your reasoning beyond what the next decision needs. The task list is the plan of record: after a compaction, `update_tasks` with no tasks gives back each task's status and contract.
