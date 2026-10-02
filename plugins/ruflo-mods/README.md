# ruflo-mods

ruflo as a Claude Code mod (function hooks): on by default in Claude Code >= 2.1.287; from 2.1.277 with `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`. Design and evidence: [ADR-404](../../v3/docs/adr/ADR-404-claude-code-mods-function-hooks.md), including Amendment 1 (default-on in `ruflo init`).

```bash
ruflo init                      # new projects: mods on by default, in the committed .claude/settings.json
ruflo init upgrade --mods       # existing projects: merge the same keys (never overwrites yours) and install
ruflo mods install              # just this checkout (.claude/settings.local.json); --scope project for the team
ruflo mods doctor               # marketplace fresh? plugins loadable? function hooks on? what does it own?
ruflo mods uninstall            # remove exactly what ruflo added, from every settings file it wrote
```

These enable `ruflo-mods@ruflo`, `ruflo-swarm@ruflo` and `ruflo-console@ruflo`, the `ruflo` marketplace and `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`. A key you already set is left as it is: a plugin you set to `false` stays off. `ruflo init --no-mods` writes none of it.

What loads:

- **ruflo-mods and ruflo-console** run only where function hooks are on. With them off, or with Claude Code's rollout switch off, they do nothing, and the classic hooks keep every event.
- **ruflo-swarm's** commands, skills and agents load regardless. Its live pane needs function hooks.
- **ruflo-console** is reported as "pending" until it is released in the marketplace.

When a `claude` binary is on PATH, init and install also do what you would do by hand, in the project directory:

```bash
claude plugin marketplace update ruflo                     # or, first time: claude plugin marketplace add ruvnet/ruflo --scope <scope>
claude plugin install ruflo-mods@ruflo --scope <scope>
claude plugin install ruflo-swarm@ruflo --scope <scope>
```

Settings alone are not always enough. Claude Code loads these plugins from its local clone of the `ruflo` marketplace (`~/.claude/plugins/marketplaces/ruflo`, or under `$CLAUDE_CONFIG_DIR`).

- **No clone yet.** An interactive, trusted session clones it on start. A headless `claude -p` run does not.
- **A stale clone.** A clone from before ruflo-mods shipped has no `plugins/ruflo-mods`, so Claude Code skips the enabled plugin without a word, and `/ruflo-mods` is an unknown command. It does not refresh the clone on start. `ruflo mods doctor` and `ruflo doctor` report this as a failure, with the exact commands above.
- **Why `claude plugin install` too.** It keeps a cached copy that still loads if the clone goes stale later.

Flags:

- `--no-plugin-install` writes settings only and runs no `claude` command.
- `--dry-run` (`mods install`) prints the settings and the `claude` commands without running either.
- If `claude` is missing or a step fails, the manual commands are printed and the exit code is 0. Pass `--strict` (`mods install`) to exit 1 instead.
- Under `VITEST` or `CI`, init skips the `claude` step and prints the commands.
- Claude Code reformats `.claude/settings.json` (key order) when it installs at project scope. The content is unchanged.

In a session, `/ruflo-mods` reports what the mod owns, routed, recorded and tightened.

## What it does

- **Routing:** `prompt.submit` routes each prompt in-process and hands the route, plus ranked memory, to the model as context. The text is the same as the classic `route` hook produces.
- **Edit learning:** `tool.call` records finished edits for the intelligence consolidator, once per turn.
- **Tool checks:** `tool.check` only tightens. It applies the dangerous-command list and ruflo policy rules that name `claude-code.*` actions (written by the CLI to `.claude-flow/policy/claude-code.json`). It never loosens a verdict.
- **Trust gate:** `plugin.register` names what a later-installed mod can do (host commands, network, environment, tool verdicts) and, under `modTrust: refuse-risky`, refuses it unless allow-listed.
- **`$.ruflo`:** other mods add a status segment with `$.ruflo.segment({ id, text })` instead of drawing a second bar; `lastRoute()` and `snapshot()` read what the mod measured. Contract: `types/index.d.ts`.
- **Budget:** `session.measure` applies the cost-tracker budget ladder to live session cost (`costBudgetUsd`); `costHardStop` halts new subagents at 100%.

The classic `hook-handler.cjs` hooks stay installed and remain the fallback. The mod takes an event only where the classic helper hands it over (`RUFLO_MODS_OWNS`), so nothing fires twice. When the mod is not loaded, every classic hook runs as before.

## Options

Claude Code reads a plugin's options from `pluginConfigs["ruflo-mods@ruflo"].options` in user settings, `--settings` or managed settings. Project settings are not read for this. Every option has a default:

| Option | Default | Effect |
|---|---|---|
| `routeContext` | `true` | Include ranked memory with routes |
| `statusLine` | `true` | One-line ruflo status. Skipped where the ruflo statusLine helper is configured |
| `costBudgetUsd` | `0` (off) | Session budget for the ladder |
| `costHardStop` | `false` | Refuse new subagents at 100% of budget |
| `modTrust` | `observe` | `observe` / `refuse-risky` / `off`: the mod trust gate |
| `modTrustAllow` | `` | Comma-separated plugin names the gate never refuses |

## Tests

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test plugins/ruflo-mods   # real engine; needs the rollout switch on
cd v3/@claude-flow/cli && npx vitest run __tests__/mods/                      # declaration-faithful harness, parity tests
bash plugins/ruflo-mods/scripts/smoke.sh                                       # static security contract
```

To typecheck, load the plugin once (Claude Code >= 2.1.287 writes its declarations into `.claude-plugin/types/`), then run `npx tsc -p plugins/ruflo-mods`.
