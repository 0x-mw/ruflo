# ruflo-mods

ruflo as a Claude Code mod: function hooks, **early access**. Design and evidence: [ADR-404](../../v3/docs/adr/ADR-404-claude-code-mods-function-hooks.md).

```bash
ruflo mods install      # opt in for this project (.claude/settings.local.json)
ruflo mods doctor       # function hooks on? refused by policy? what does it own?
ruflo mods uninstall    # remove only what install added
```

In a session, `/ruflo-mods` reports what the mod owns, routed, recorded and tightened.

## What it does

- **Routing:** `prompt.submit` routes each prompt in-process and hands the route, plus ranked memory, to the model as context. The text is the same as the classic `route` hook produces.
- **Edit learning:** `tool.call` records finished edits for the intelligence consolidator, once per turn.
- **Tool checks:** `tool.check` only tightens. It applies the dangerous-command list and ruflo policy rules that name `claude-code.*` actions (written by the CLI to `.claude-flow/policy/claude-code.json`). It never loosens a verdict.
- **Budget:** `session.measure` applies the cost-tracker budget ladder to live session cost (`costBudgetUsd`); `costHardStop` halts new subagents at 100%.

The classic `hook-handler.cjs` hooks stay installed and remain the fallback. The mod takes an event only where the classic helper hands it over (`RUFLO_MODS_OWNS`), so nothing fires twice. When the mod is not loaded, every classic hook runs as before.

## Options

Set these in the plugin's config:

| Option | Default | Effect |
|---|---|---|
| `routeContext` | `true` | Include ranked memory with routes |
| `statusLine` | `true` | One-line ruflo status. Skipped where the ruflo statusLine helper is configured |
| `costBudgetUsd` | `0` (off) | Session budget for the ladder |
| `costHardStop` | `false` | Refuse new subagents at 100% of budget |

## Tests

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test plugins/ruflo-mods   # real engine; needs the rollout switch on
cd v3/@claude-flow/cli && npx vitest run __tests__/mods/                      # declaration-faithful harness, parity tests
bash plugins/ruflo-mods/scripts/smoke.sh                                       # static security contract
```

To typecheck, copy the declarations `/plugin-types` writes into `plugins/ruflo-mods/.claude/types/`, then run `npx tsc -p plugins/ruflo-mods`.
