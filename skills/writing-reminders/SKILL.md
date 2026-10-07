---
name: writing-reminders
description: Wording a reminder for Docs/todos.md. Use before calling add_reminder, and when rewording a reminder already in the file.
---

# Writing reminders

A reminder is one line in `Docs/todos.md`. It has two readers:

- the person, scanning the `/todos` pane between other work;
- a later Claude session. When the person presses Ask, that session receives the line, its priority, its date and its `at` pointer. It knows nothing else about this conversation.

Write for the second reader. The line is a hand-off to someone who starts cold.

## Steps

1. **Name the gap.** State what is missing or broken as a fact about the code or the design, with the exact names a search will find: the function, class, file, endpoint or config key as spelled in the project.
2. **Say what done looks like** when the gap alone leaves it open: the value chosen, the case handled, the test passing. Write "Done when ..." for these.
3. **For an open decision, name the options you know and who decides.** "Undecided: ... Options: A or B. The user decides." A decision the person deferred stays theirs; record it as theirs.
4. **Set `at`** to the repo-relative line of the partial code, as `src/api/orders.ts:42`. Leave it out when no single line holds the gap.
5. **Read the line back as the cold reader.** Done when someone who never saw this conversation can tell from the line alone what is missing, where it lives, and how to know it is finished.

## The line's format

- One line. The tool collapses newlines and runs of spaces into single spaces.
- Under about 120 characters, so the pane shows it without wrapping on a laptop-width terminal. Cut words before cutting facts.
- End on a word or a period. The file format reads a trailing `(at ...)` or `(done ...)` group as its own field, so text ending in a parenthesised group can misparse.
- The pane draws text as typed, so backticks and asterisks show up literally. Write names bare.

## Plain writing

The reader acts on the line, so every word names a thing, a number or an action.

- **Concrete over impression.** "Checkout crashes when the cart is empty" tells the reader where to look. "Checkout needs robustness work" does not; rewrite it until it names the mechanism or the number.
- **Name the actor, in active voice.** "The importer skips rows with a blank email" beats "rows with a blank email are skipped".
- **Plain words.** Use "use", "help", "many", "if", "is", "has". The fancier synonym (leverage, utilize, facilitate, numerous, in the event that, serves as, boasts) adds length and no meaning.
- **Whole sentences.** Keep articles and verbs. Spell out arrows and abbreviations: "the parser rejects a bad date and writes nothing", in place of "bad date → reject, no write".
- **One idea per sentence.** Two short sentences read faster than one sentence with a clause in the middle.
- **Commit to the claim.** Write "may" once where the uncertainty is real, and drop the rest of the hedging.
- **Start with the content.** "To" for "in order to", "because" for "due to the fact that"; delete "it is important to note that" and its relatives.
- **One name per thing.** Pick "customer" or "user" for the same person and keep it, in every reminder, so a search finds them all.
- **Punctuation:** periods and commas between thoughts; colons only before a list or an example; straight quotes; no em dashes, bold or emoji.

## Examples

| Reads well cold | Needs context the reader lacks |
| --- | --- |
| `Retry limit has no value; fetchWithRetry hardcodes 3 as a placeholder. Done when the user picks a number.` | `figure out retries` |
| `Undecided: should deleting an account also delete its uploads? Options: delete them, or keep them 30 days. The user decides.` | `Deletion question from earlier` |
| `Checkout crashes when the cart is empty. OrderService.total reads items[0] without a check.` | `Fix the checkout bug we talked about` |
| `Settings form drops unsaved input when the auth token refreshes.` | `Polish the settings page, ensuring a seamless experience` |
