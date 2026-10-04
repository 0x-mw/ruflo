# ruflo-console

ruflo's cockpit inside Claude Code and the one `/ruflo` command for every ruflo mod. See `.claude-plugin/plugin.json` for the full description.

## Drive the console from the command line

`scripts/drive.sh` runs the console through its own model tools (`console_open`, `console_state`, `console_set`, `console_run`) from a real headless Claude, prints what each tool answered, and can assert on it, so a dev loop or CI job can check that a UI shows something.

```bash
RUFLO_E2E_LIVE=1 bash plugins/ruflo-console/scripts/drive.sh \
  --expect 'Waiting for a yes' \
  "$PWD/plugins/ruflo-console" read "Open the Room and quote back what is waiting for a yes."
```

Output is one `CALL <tool> <input>` and one `RESULT <tool> <text>` line per console call (each result cut at 4000 characters), then `COST <usd> CALLS <n>`, then one `EXPECT ok|FAIL /regex/` line per `--expect`.

| Exit | Meaning |
|------|---------|
| 0 | a console call ran and every `--expect` matched (or the run was skipped, see below) |
| 1 | no console tool call ran |
| 2 | usage error: bad level or an invalid `--expect` regex |
| 3 | at least one `--expect` regex (case-insensitive, repeatable) matched no `RESULT` |

- **What it spends:** about $0.10 per run with haiku, hard-capped at $0.40 (`--max-budget-usd`). Use one to three runs, not a sweep.
- **Why the level is capped:** the level is `read`, `write` or `manage`; `full` is rejected (exit 2). The run happens in a scratch project (`mktemp -d`), with Bash, Write and Edit disallowed, so a drive can never spend money or delete anything.
- **Seeding:** `CONSOLE_DRIVE_SEED=<dir>` copies that directory into the scratch `.claude-flow/` first, for example a `claims/claims.json` to assert the claims view shows it.
- **Skips cleanly:** without `RUFLO_E2E_LIVE=1` or a `claude` binary (on `PATH` or `$CLAUDE_BIN`) it prints `SKIP` and exits 0, so it is safe to call from CI.
- **Extra plugins:** any further arguments are added as `--plugin-dir`.
