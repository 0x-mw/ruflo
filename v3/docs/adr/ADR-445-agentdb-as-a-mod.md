# ADR 445: AgentDB as a mod: safe recall in the prompt, a write guard, `/agentdb`, and a status the console shows

Status: Proposed

Date: 2026 10 05

Scope: `plugins/ruflo-agentdb` (new function-hook mod: `hooks/*.ts`, `scripts/bench.mjs`, `tests/`), `plugins/ruflo-console` (a status reader and an "AgentDB mod" section on the Memory page, a Help guide)

Builds on: ADR-404 (ruflo as a mod), ADR-444 (the model-tool and level pattern)

## 1. What the plugin was, and what a mod adds

`ruflo-agentdb` was skills and commands over the 15 `agentdb_*` MCP tools: a person (or Claude, when told) asks, the tools answer. The console's Memory Lab already drives them by hand. Nothing happened *automatically*, and nothing watched what Claude writes into memory. A mod can do both inside the session: bring relevant memory into a prompt without being asked, and refuse to let secrets be stored.

## 2. Review of the packages (2026-10-05)

| | `agentdb` | `ruvector` |
|---|---|---|
| Latest | 3.0.0-alpha.20 (2026-07-30), `latest` and `alpha` tags | 0.3.3 (2026-09-23) |
| What ruflo uses | `^3.0.0-alpha.17`, which resolves to alpha.20 | CLI pins `^0.2.27`, which for a 0.x package **excludes 0.3**; the `ruflo-ruvector` plugin hard-codes `ruvector@0.2.25` in 117 places |
| Useful to a mod | `query --synthesize-context`, `recall with-certificate` (retrieval with a causal-utility score and a **provenance certificate**), `store-pattern`, `route --prompt`, reflexion, skill and causal commands, `mcp start` | `hooks recall / remember / rag-context / suggest-context`, `reembed` (embedding provenance, ADR-210), an MCP server of 97 tools with a **default-deny policy** (`RUVECTOR_MCP_ALLOW`, `RUVECTOR_MCP_DENY`, `RUVECTOR_MCP_PROFILE=readonly`, ADR-256) |
| Kept out on purpose | `sync start-server` / `connect` (QUIC, network) | `brain` (a shared, network knowledge base), `edge`, `server`, `cluster` |

Measured here (warm `npx`, five runs): `agentdb status` 0.48 to 0.56 s, `ruvector hooks recall` 0.41 to 0.47 s, against 22 ms for a bare Node start. A CLI call on every prompt costs about half a second; an already-connected MCP tool answers without the process start. **Decision: the mod calls the connected MCP tool in-process, and uses a CLI only as a deadline-bounded fallback.**

Findings to act on separately (not part of this ADR): the `ruvector` pin and the plugin's hard-coded 0.2.25 are two minor versions behind 0.3.3, and nothing here has been run against 0.3.x.

## 3. Decision

Six pieces, each a small pure module with its own tests, under `plugins/ruflo-agentdb/hooks/`:

1. **Recall into the prompt** (`prompt.submit`, **off by default**). When on, the mod searches memory for the prompt and attaches the best few results as *per-prompt context* (`next({ ...e, context })`), never as a system-prompt section, so the prompt cache is not disturbed. It runs in-process against the connected AgentDB (`agentdb_hierarchical-recall`, falling back to `agentdb_pattern-search`) or ruvector (`hooks_recall`), with a deadline (default 800 ms): past it, the prompt goes out without memory and the miss is counted. It is skipped for slash commands, `!` shell lines, prompts under 12 characters, and repeats within 10 minutes (cached by a hash of the normalised prompt).
2. **Retrieved memory is untrusted.** A stored memory can carry instructions (a poisoned or careless write). Every result is length-capped, stripped of control characters, scanned for prompt-injection phrasing and secrets (a hit drops the result and is counted), and wrapped in a frame that says it is retrieved data with its source, score and age, never instructions. At most 5 results and 1500 characters in all.
3. **A write guard** (`tool.call`, **on by default**). Calls to the tools that store into memory (`agentdb_hierarchical-store`, `agentdb_pattern-store`, `agentdb_batch`, `agentdb_causal-edge`, `memory_store`, `hooks_remember`, and their prefixed MCP names) are scanned; a private-key block, a cloud or GitHub or Slack token, a bearer token, a JWT, or a key-like assignment is **denied** with the reason, so a secret never reaches the store. It never loosens anything and does nothing for other tools.
4. **`/agentdb`**, answered locally: `status`, `recall <text>` (a read through the same path), `scan <text>` (what the guard would say), `recent` (what was last attached). No model call.
5. **A status file** the console reads: `.claude-flow/agentdb-mod/status.json`: mode, the tool in use, counts (attached, skipped, timed out, dropped as unsafe, writes blocked), the last latencies, and the last few attached items (a 120-character snippet, the source and the score; never a secret, since the guard and the scan run first).
6. **Console integration**: the Memory page gets an "AgentDB mod" section from that file, absent / not installed / off / on states, and a Help guide.

Settings are the plugin's `userConfig`, which the console's Settings page already edits: `recall` (off|on, default off), `recallLimit` (1 to 5, default 3), `recallDeadlineMs` (200 to 3000, default 800), `guard` (on|off, default on), `source` (auto|agentdb|ruvector|none, default auto).

## 4. Security

- Recall is **opt-in**: it adds tokens to every prompt and puts stored text in front of the model. Off until the person turns it on.
- Poisoned memory is the main threat; items 2 and the framing are the answer. Scanning is heuristic, not a proof: the frame, the size cap and the read-only nature of recall limit the harm of a miss.
- The guard blocks secrets, not all sensitive data; PII policy is the person's, and `aidefence_has_pii` is not called implicitly.
- No network: nothing here uses `brain`, `sync`, `edge` or any server; all calls are to tools already connected in the session, or a local CLI as fallback, with a fixed argv and no shell.
- The status file holds counts and short snippets only, written under the project's `.claude-flow/`.
- ruvector's own default-deny policy is the right way to narrow its server further; the mod calls only `hooks_recall`.

## 5. Not decided here

- Auto-learning (writing to memory at the end of a turn) and `agentdb_feedback` from outcomes: a write path with a weak signal. Left for a later ADR with evidence.
- Moving the ruflo CLI to `ruvector` 0.3.x.
- Use of `recall with-certificate` provenance certificates in the frame (the CLI has it; whether a connected tool exposes it is UNVERIFIED).
