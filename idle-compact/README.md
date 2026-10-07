# Idle compact

A Claude Code mod that compacts a session you've walked away from, just before its prompt cache expires.

The prompt cache lasts an hour after the last request. Coming back later, your next prompt rewrites the whole context at the cache-write price, twice the input price. Compacting first means only the short summary gets written. Compacting just *before* expiry is cheaper still, because the summary call reads the context from cache at a fraction of the input price.

When the main conversation has had no request for 55 minutes and the context holds 80k tokens or more, the mod runs `/compact` and tells the summary to keep the open task, decisions made, files changed and anything left to do. A toast says when it happened. If a turn is running, nothing happens, and the mod waits for the next idle stretch.

The trade-off: a compaction loses detail. If you come back to a task in the middle, Claude may need to re-read a file or two. Raise the threshold or turn the mod off if that costs more than it saves.

## Commands

- `/idle-compact` shows the current setting
- `/idle-compact off` and `/idle-compact on` turn it off and back on for the session
- `/idle-compact 120k` sets the minimum context size for this session

## Install

```
/plugin install idle-compact --marketplace noash-xrc/claude-tools
```

Answer `y` to add the marketplace, then pick a scope.

## Update

```
claude plugin marketplace update noash-tools
claude plugin update idle-compact@noash-tools
```

Restart Claude Code to load the new version.

## License

MIT
