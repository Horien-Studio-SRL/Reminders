# Output trimmer

A Claude Code mod that shortens long Bash output before Claude reads it. Test runs, installs and builds can put thousands of lines into the context, and Claude re-reads them on every later turn of the session.

When a command prints more than 150 lines or 8,000 characters, Claude gets:

- the first 30 lines
- the last 60 lines
- up to 40 lines from the middle that mention an error, failure, warning, exception, traceback or panic
- a line saying where the full output is saved, so Claude can read it if the trimmed part matters

Long lines are cut at 300 characters. The full output goes to `claude-trimmed/` in your temp folder.

Some commands are left whole, because Claude ran them to see exactly that text: `cat`, `head`, `tail`, `sed`, `awk`, `grep`, `rg`, `jq`, `diff`, `git diff`, `git show`, `git log` and `git blame`. Reading the saved file back is left whole too.

When a command fails, Claude still sees the trimmed output as an error. The debug log notes this as the mod refusing the call after it ran. The command did run, and nothing is undone.

Only Bash output is trimmed. Output from MCP tools isn't touched.

## Install

```
/plugin install output-trimmer --marketplace noash-xrc/claude-tools
```

Answer `y` to add the marketplace, then pick a scope.

## Update

```
claude plugin marketplace update noash-tools
claude plugin update output-trimmer@noash-tools
```

Restart Claude Code to load the new version.

## License

MIT
