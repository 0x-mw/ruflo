# ADR 404: Ruflo as a Claude Code Mod (Function Hooks)

Status: Proposed

Date: 2026 10 01

Related: #3555 (helpers in `"type":"module"` projects), #3565 (signed helper manifest), #3567 (no-match routing confidence), #3602 (ledger anchor deletion), ADR 150 (removable augmentation), ADR 174 (failures as learning signal), ADR 324 (policy engine)

## Context

Ruflo plugs into Claude Code through classic settings hooks. Every `UserPromptSubmit`, `PreToolUse` (Bash) and `PostToolUse` (edit) starts `node .claude/helpers/hook-handler.cjs <event>`. Measured on the reference host below, that costs 16 to 19 ms per event at the median, p95 up to 39 ms. The 3.49.0 release fixed a class of bugs that comes from the same model. Copied helpers broke in `"type":"module"` projects (#3555). They could be tampered with, which needed a signed manifest (#3565). An older CLI refreshing helpers mid-session overwrote them. Some fallbacks were silent ("Router not available").

Claude Code now offers mods: a plugin whose `hooks/hooks.json` names a hooks module, `register(on, options)`, hooking engine events as in-process middleware `($, e, next)`. The API is early access and may change without notice.

### Verified facts the design rests on

Each fact was checked against Claude Code 2.1.282 (`claude plugin validate`, `claude plugin test`, a debug log of a live `claude -p` session) or read from the upstream `mods/` sources and declarations.

- A hooks module runs in its own environment: no Node, no fs, no network, no process. Everything goes through `$`. `claude plugin validate` refuses an import outside the plugin folder ("it is outside the plugin's folder"). It also refuses `$` passed to anything other than a top-level function of the same file, because the engine reads a module's `$` uses off its source.
- Whether a module loads is decided by a server-side rollout switch (`tengu_plugin_hooks_modules`, cached in `~/.claude.json`). On this account it flipped off and on twice in one afternoon.
  - **While it served off**, `claude plugin test` refused to run, and a live session with `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` logged "hooks module not loaded … the rollout switch served off".
  - **While it served on**, the plugin loaded with the variable unset, both from `--plugin-dir` and installed from the marketplace. That was tested with an isolated `CLAUDE_CONFIG_DIR`, a local marketplace and `claude plugin install ruflo-mods@ruflo`.
  - **The variable** is therefore neither required nor sufficient on 2.1.282. `ruflo mods install` writes it anyway, as the CLI's messages ask for it, and `ruflo mods doctor` reports the switch as what decides.
- `sec-default`, seated outermost for managed or Team/Enterprise organizations, continues past the user tier on `prompt.context`, `prompt.section`, `prompt.compose`, `settings.read` and `classic.*`. A person's plugins keep `prompt.submit` and its additive `context`. On `tool.check` it re-runs the chain without the user tier when a user-tier plugin loosened a verdict that a settings deny rule decided. Its `allowManagedModsOnly` option refuses user-tier modules at `plugin.register`.
- `$.env.set` sets a variable on the Claude Code process and on everything it starts afterwards, settings hooks included.
- `$.fs.read` rejects files over 4 MiB, and `$.fs.stat` rejects a missing path with ENOENT.

## Decision

### A separate, opt-in plugin: `plugins/ruflo-mods`

The mod is its own plugin rather than a module added to `ruflo-core`, for three reasons:

- **Opt-in.** Every `ruflo-core` install would otherwise start loading early-access code wherever function hooks are on.
- **Removable.** Uninstalling the plugin leaves ruflo exactly as it was. This is the ADR 150 rule.
- **Separation.** `ruflo-core`'s classic `hooks.json` and the module never share a manifest, so a change to one cannot alter the other's loading.

`ruflo mods install` (or `ruflo init --mods`) enables it. It writes `enabledPlugins["ruflo-mods@ruflo"]`, the `ruflo` marketplace and `env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` into `.claude/settings.local.json` by default, so the choice is one person's, not the repository's. It records what it added in `.claude-flow/mods/install.json`, and `ruflo mods uninstall` removes only that.

### What the mod does

| Event | Classic equivalent | Mod behaviour |
|---|---|---|
| `prompt.submit` | `route` (UserPromptSubmit) | Routes in-process. The routing block, and the ranked-memory block from `ranked-context.json`, ride the prompt as `context`. The text is byte-identical to `hook-handler.cjs route`'s output (tested). No-match results carry the #3567 fields (`matched: false`, `reason: "no-match-default"`, confidence 0.3). |
| `tool.check` | `pre-bash` (PreToolUse) | Tightens only. `stricter(chain, ruflo)` over `deny > ask > allow`. Applies the `pre-bash` dangerous-command list and the Claude Code rules of ruflo policy. |
| `tool.call` (Write/Edit/MultiEdit) | `post-edit` (PostToolUse) | Records each finished edit, with `success: false` on error (ADR 174) and nothing for a denied call. Lines use `recordEdit`'s format and are written once per turn. |
| `turn.complete`, `session.end` | none | Write pending edit records. |
| `session.start` | none (handshake) | Decides ownership, sets `RUFLO_MODS_OWNS`, registers `/ruflo-mods`, writes a heartbeat for `ruflo mods doctor`. |
| `session.measure`, `agent.spawn` | `ruflo-cost-tracker` budget ladder | With the `costBudgetUsd` option, applies `budget.mjs`'s 50/75/90/100% ladder to the live session cost and says so once per rung. With `costHardStop`, denies new subagent spawns at 100%. |
| `ui.status` (op) | statusline | One compact line. Skipped where the ruflo `statusline.cjs` is configured. |

Context is injected through `prompt.submit` and not `prompt.context`, because under `sec-default` the user tier never sees `prompt.context`.

### One owner per event: the handshake

The classic hooks stay the default and the fallback; nothing removes them. The two paths agree at runtime:

1. **Ownable events.** Only `route` and `post-edit` can be owned. They are side-effect events (context injection, learning records), where firing twice is the bug. `pre-bash` is a guard: both paths refuse the same commands, a second refusal changes nothing, and no handshake can ever switch a guard off. `session-restore`/`session-end` stay classic, because PageRank consolidation and intelligence init need Node.
2. **The ownership decision.** At `session.start` the mod takes an event only if no classic hook in the merged settings runs it, or if every `hook-handler.cjs` a classic hook could run (the project's and `$HOME`'s copies) carries the handshake. One copy predating the handshake is enough to stand down. Unreadable settings mean the mod owns nothing.
3. **The signal.** The mod sets `RUFLO_MODS_OWNS=route,post-edit` with `$.env.set`. `hook-handler.cjs` returns before doing any work for an event named there and only for `route`/`post-edit` (`ownedByMod`). `ruflo-core`'s `ruflo-hook.cjs` does the same for its `post-edit`, which otherwise races `hook-handler.cjs` for the same edit through the dedup claim.
4. **Fallback.** If the mod is not loaded (function hooks off, rollout switch off, `allowManagedModsOnly`, `session.start` failed), the variable is never set, so every classic hook runs as before. The variable lives in the process environment, so it dies with the process; no stale state survives a crash.

Tests run the real `hook-handler.cjs` and `ruflo-hook.cjs` with the environment the mod set. They count exactly one routing block per prompt and one edit record per edit, both with a handshake-aware helper and with an older one. They also confirm that `pre-bash` blocks even when the variable names it.

### Tiers and `sec-default`

Ruflo loads in the user tier. Under `sec-default`:

- `prompt.submit` context still reaches the model.
- `settings.read` answers what the organization's tiers say, which the ownership decision reads.
- `tool.check` from ruflo never loosens, so `sec-default`'s held-verdict recheck is never triggered by ruflo. A ruflo deny is not a settings rule deny, so `sec-default` does not need to hold it; it is the last word only because it is the strictest.
- Under `allowManagedModsOnly` the module is refused whole, and the classic hooks keep every event.

### Security model

- **Tighten only.** `tool.check` merges the chain's verdict with ruflo's opinion by rank. A tie returns the chain's own object, so the `rule` that `sec-default` reads is never rewritten or erased. A property test covers every chain verdict, five policy states and seven inputs.
- **Fail closed, by one step.** Only where ruflo guards something: if the policy projection exists but cannot be read or validated, or the hook throws, an `allow` becomes an `ask` and an `ask` or `deny` stands. An absent projection means no policy, which is not a failure.
- **Input validation.** Every event field the mod reads is type-checked before use. A non-string command is checked as text (#2017). `file_path` is length-bounded. The projection is schema-validated, rule by rule.
- **No network, process, model or MCP calls.** The smoke contract enforces it statically. The only environment variable written is `RUFLO_MODS_OWNS`; the only one read is `HOME`.
- **No secrets** in the module. The heartbeat and install record hold no credentials.
- **Policy projection.** A hooks module cannot read `state.json`: it holds the receipt ledger, 43 MB on the reference host and over the 4 MiB read limit. `policy-runtime.ts` therefore writes `.claude-flow/policy/claude-code.json` after every successful state write, owner-only and atomically. It holds the mode and only those rules whose `actions` name a `claude-code.` pattern explicitly. Rules with no actions or with `*` keep their meaning (MCP only), and the engine's default-deny never applies to Claude Code tools. Matching is a copy of `evaluator.ts ruleMatches`, held to over 10,000 rule-by-request comparisons against the real evaluator.
- **#3602.** The mod never reads or writes `state.json`, receipts or the ledger anchor, so it cannot make #3602 worse. Deleting the projection only returns Claude Code tool calls to the no-mod baseline; it cannot loosen them. A stale projection left by a failed write can only be stricter or as loose as the baseline.

### What the mod does not carry

- **Implicit confidence boost.** The classic route writes `lastMatchedPatterns` and boosts the previous match's confidence on every prompt. The mod scores ranked memory read-only, so with the mod owning `route` that boost does not happen.
- **Rate-limit nudge.** The sponsored-capacity nudge (ADR 312/313) in the classic `route` is not ported.
- **Capability envelopes.** Workers' `CLAUDE_FLOW_CAPABILITY_ENVELOPE` is not applied to Claude Code tools.
- **Lost lines.** `$.fs` has no append, so edit records are written by read-modify-write once per turn. A classic writer appending in the same instant can lose a line.

## Testing

| Suite | Where | Result |
|---|---|---|
| Claude Code kit (`claude plugin test`), real engine | `plugins/ruflo-mods/tests` | 7/7 pass (ran while the rollout switch served on) |
| Harness faithful to the declarations (vitest) | `v3/@claude-flow/cli/__tests__/mods` | 87/87 pass |
| Existing CLI suite | `v3/@claude-flow/cli` | Same failures as `origin/main` in the same environment (4 memory tests), plus `helper-signing` until the manifest is re-signed |

Live runs, Claude Code 2.1.282 with `claude -p`:

1. **`/ruflo-mods` via `--plugin-dir`.** The module was admitted at user tier and wrote its heartbeat. It owned nothing, correctly: this machine's user settings run an older `$HOME` hook-handler.
2. **Enforce-mode projection denying `echo forbidden*`.** The engine logged `tool.check Bash: allow -> deny by plugin ruflo-mods: ruflo policy: denied-by:no-forbidden-echo`. The allowed command still ran.
3. **Rollout switch off.** The module was refused and the session finished on the classic path.
4. **Installed plugin.** Installed from a local marketplace into an isolated config, it loaded and owned `route, post-edit` (no classic hooks configured there).

No live prompt was routed by an owning mod, because the isolated config has no credentials for a model call.
| Typecheck against the declarations (`tsc`, strict) | `plugins/ruflo-mods/tsconfig.json` | clean |
| `claude plugin validate` | plugin and marketplace | pass |
| Plugin smoke contract (static security) | `plugins/ruflo-mods/scripts/smoke.sh` | 9/9 |

The kit needs the rollout switch on, so CI relies on the vitest harness, whose header lists what it models and what it does not. The typecheck needs the declarations `/plugin-types` writes. They are not vendored (early access, regenerated per release); copy them to `plugins/ruflo-mods/.claude/types/` and run `tsc -p plugins/ruflo-mods`.

## Benchmarks

`npx tsx scripts/bench-mods-latency.ts`: Node 22.23.2, Ryzen 9 9950X; spawn n=40 after 3 warm-up runs, in-process n=2000. Median / p95 in milliseconds, same inputs and project, third of three consistent runs.

| Event | Classic spawn | Classic, handed over (`RUFLO_MODS_OWNS` set) | Mod handler, in-process |
|---|---|---|---|
| route (`prompt.submit`) | 18.2 / 20.0 | 13.8 / 16.1 | 0.045 / 0.089 |
| pre-bash (`tool.check`) | 17.1 / 20.5 | n/a (guards never hand over) | 0.005 / 0.007 |
| post-edit (`tool.call`) | 19.0 / 32.4 | 13.8 / 23.2 | 0.001 / 0.003 |
| edit plus per-turn write | | | 0.20 / 0.41 |

How to read the table:

- **The mod column excludes Claude Code's own dispatch.** A live `claude -p` session logged the module's `tool.check` as "settled in 4.8 ms" and "2.6 ms" (n=2). Those figures cover the worker hop and `next()`, so they include the engine's own permission decision. That is the honest per-event comparison against the classic spawn.
- **While a classic hook stays configured, its spawn still runs and returns early.** That costs about 13 to 14 ms of Node startup. The mod path then saves 4 to 5 ms and the duplicated work per owned event, not the whole spawn.
- **The full saving needs the classic entries removed.** That is deferred, because a removed classic hook has no automatic fallback when the mod is refused.
- **One optimization:** ranked-memory trigrams are computed once per file change rather than per prompt, which took the route handler from 0.159 to 0.045 ms at the median.

## Other plugins (follow-ups, not built here)

Implemented now: `ruflo-cost-tracker`'s budget ladder (`session.measure`, `agent.spawn`). Candidates, roughly by value:

1. **ruflo-aidefence:** scan tool results on `tool.call` for prompt injection (`context` warning) and PII in Write content (`tool.check` ask). This needs the AIMDS patterns shipped as a data file inside the plugin.
2. **ruflo-observability:** spans from `turn.start` / `turn.step` / `turn.complete` and `tool.call` timing, without spawning.
3. **ruflo-security-audit:** `tool.check` ask on dependency-changing commands such as `npm install` and lockfile writes.
4. **ruflo-swarm / ruflo-agent:** 3-tier model selection on `agent.spawn`. This rewrites the model, which is not tightening, so it needs its own ADR.
5. **ruflo-rag-memory / ruflo-agentdb:** memory recall into `prompt.submit` context through `$.mcp.call` to the ruflo MCP server.
6. **ruflo-federation / x-gateway:** `session.receive` filtering for peer deliveries.
7. **`ruflo mods install --exclusive`:** remove the owned classic entries, with `ruflo mods doctor` restoring them when the mod is refused.

The remaining plugins (skills, agents, MCP-only) would gain nothing from function hooks.

## Consequences

- **Releases.** Ships with `@claude-flow/cli` (the `mods` command, doctor check, `init --mods`, policy projection) and the plugin marketplace. `plugins/ruflo-mods` and `plugins/ruflo-core` (`ruflo-hook.cjs`) reach users through the marketplace `git pull`, not npm. `hook-handler.cjs` changed in both copies, so the helpers manifest must be re-signed at release; until then `helper-signing.test.ts` fails on the content hash.
- **API churn.** The module is written against early-access declarations. A Claude Code release can change them; `claude plugin validate` and the kit tests are the gate, and the classic path is unaffected either way.
