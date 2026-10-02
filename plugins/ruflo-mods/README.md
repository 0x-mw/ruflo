# ruflo-mods

ruflo as a Claude Code mod (function hooks): on by default in Claude Code >= 2.1.287; from 2.1.277 with `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`. Design and evidence: [ADR-404](../../v3/docs/adr/ADR-404-claude-code-mods-function-hooks.md).

```bash
ruflo mods install      # opt in for this project (.claude/settings.local.json)
ruflo mods doctor       # function hooks on? refused by policy? what does it own?
ruflo mods uninstall    # remove only what install added
```

In a session, `/ruflo mods` (through ruflo-console's `/ruflo`) reports what the mod owns, routed, recorded and tightened. `/ruflo-mods` still works for one release as a deprecated alias.

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
