# ruvector 0.3.3 vs the pinned ^0.2.27 — validation report

Date: 2026-10-04 · Branch base: `origin/main` @ `cd010ee76` · Scope: **report only**.
No `package.json`, lockfile or pin was changed anywhere. All installs and runs were in a private
`mktemp -d` scratch dir (two side-by-side installs, `a/` = 0.2.27, `b/` = 0.3.3), Node v22.23.2, linux-x64.

## Recommendation: **GO, conditionally** (one blocking migration, three small follow-ups)

0.3.3 is a strict superset of 0.2.27 on every surface the CLI and plugins touch, and it fixes a real
data-loss bug (RVF string ids). The single behavioural break is the **legacy vector-store write lock
(ADR-210)**: after the bump, `ruvector hooks remember` fails on every existing `~/.ruvector/intelligence.json`
until the user runs `ruvector hooks reembed`. That must be handled (or at minimum documented) in the
same release. Details and exact steps are at the end.

## What the repo uses

Direct imports of `ruvector` in `v3/@claude-flow/cli/src` (all dynamic, all `.catch(() => null)`):

| Call site | API used |
|---|---|
| `mcp-tools/neural-tools.ts:125` | `embed`, `isOnnxAvailable`, `initOnnxEmbedder`; unwraps `{embedding,dimension,timeMs}` |
| `memory/memory-initializer.ts:2390` | `initOnnxEmbedder`, `getOptimizedOnnxEmbedder().embed` |
| `ruvector/vector-db.ts:172` | `VectorDB`/`VectorDb` ctor (`dimensions`, `hnswConfig{m,efConstruction}`, `storagePath`), `insert`, `search`, `delete`, `len`, `isWasm` |
| `browser-session-tools.ts` | spawns the `ruvector` bin directly (comment names 0.2.27) |

No deep imports (`ruvector/dist/core/*`) exist in the CLI. `@ruvector/core` is imported separately and is
unchanged (0.1.32 in both installs). Pins: `package.json:109`, `v3/@claude-flow/cli/package.json:141`,
`ruflo/package.json:47` are all `^0.2.27`; `v3/pnpm-lock.yaml:12016` and `package-lock.json` lock it.
Caret on a `0.x` is `<0.3.0`, so **0.3.3 is unreachable without editing the range**.

Plugin/mod surface: `ruflo-agentdb` mod calls MCP tool `hooks_recall` with `{query, top_k}`
(`plugins/ruflo-agentdb/hooks/tools.ts:11`); `ruflo-ruvector` mod owns a set of `ruvector` tool names
(`hooks/tools.ts:14`); plugin docs call `npx ruvector@0.2.25 …` (228 mentions, already stale vs the 0.2.27 pin;
11 mentions of 0.3.3 already exist).

## Compatibility table

| Area | Check | 0.2.27 | 0.3.3 | Verdict |
|---|---|---|---|---|
| Module exports | `Object.keys(require('ruvector'))` + arity | 181 | 237 | 0 removed, 0 changed, 56 added — compatible |
| `embed()` shape | keys, dim, type | `{embedding,dimension,timeMs}`, 384, Array | identical | same |
| Embedding values | `embed('probe')`, `embed('the quick brown fox')` | — | max abs diff **0** vs 0.2.27 | bit-identical, no re-embed needed for ONNX vectors |
| `embed` latency | 50 sequential calls | 13.44 s (~270 ms each) | 13.41 s | same (slow in both) |
| `initOnnxEmbedder` | cold | 479 ms | 536 ms | same |
| `getOptimizedOnnxEmbedder().embed` | | throws "Failed to initialize optimized ONNX embedder" | identical throw | **pre-existing in both**; CLI falls through to next tier |
| `VectorDB` (awaited, 200 vec, d=8) | len / delete / top-3 | 200 / 199 / `id0,id7,id51` | identical | same |
| HNSW recall (3000×64d, m=32/ef=200, k=10, 40 queries, awaited) | recall@10 | 0.982, 0.977 | 0.980, 0.990 | same; 0.3.3 inserts 5.4/4.4 s vs 6.3/7.1 s, search 158/136 ms vs 297/207 ms total (faster, small n) |
| CLI's own `vector-db.ts` adapter (copied to scratch, run on each) | `loadRuVector`, `getStatus` | `ruvector-native`, wasm false | same | same |
| `ruvector` CLI commands | `--help` listing | 34 | 36 | +`harness`, +`tiny-dancer` |
| `hooks` subcommands | | 56 | 57 | +`reembed` |
| MCP tools (`ruvector mcp tools`) | names | 91 | 97 | 0 removed; +6 `decompile_*`. `hooks_recall`, `hooks_remember`, `brain_search`, `brain_share` entries byte-identical (listing carries name/desc/group only, **no input schemas**, so arg schemas were not compared) |
| `hooks route "implement user login"` | output | `coder`, conf 0 | identical | same |
| `hooks remember/recall`, **fresh** store | | ok | ok, identical result | same |
| `hooks remember`, **legacy** store | existing `intelligence.json` | ok | **`ERR_LEGACY_STORE_READONLY`** | **BREAKING** (see below) |
| `hooks recall`, legacy store | | ok | works, prints "recall quality degraded" warning to stderr | degraded, not broken |
| `rvf` string ids (`alpha/beta/gamma`) | ingest 3, status, query | `totalVectors: 1`, result `id=0` | `totalVectors: 3`, `beta` d=0.0, `alpha` d=1.0 | **fix** — 0.3.3 pulls `@ruvector/rvf` 0.3.4 (0.2.27 gets 0.1.9) |
| Install | cold npm cache | 4.72 s, 165 pkgs, 68 MB | 4.42 s, 156 pkgs, 72 MB | no regression |
| Install `--no-optional` | | 0.37 s | 0.44 s | same; `@metaharness/*` absent |

## Breaking changes and risks

1. **ADR-210 embedding provenance, legacy store is read-only for writes (BREAKING).**
   Reproduced with a copy of the real `~/.ruvector/intelligence.json` under an isolated `HOME`:
   `hooks remember` returns `{"success":false,"code":"ERR_LEGACY_STORE_READONLY"}` and `recall` warns that the
   stored vectors are `{embedder=hash,dim=64,normalize=false}` while the query is `normalize=true`.
   `ruvector hooks reembed` fixed it (2 memories re-embedded, 586 ms) but **downloads the MiniLM model
   from huggingface.co** if absent and has `--dry-run` / `--drop-missing`. Consumers: the `ruflo-agentdb`
   `hooks_recall` path (read-only, so degraded not failed) and anything calling `hooks_remember` / `hooks learn`.
   Fresh stores are unaffected. Whether the CLI's own `.swarm`/AgentDB stores are affected was not tested —
   they do not use `intelligence.json`.
2. **Node floor**: 0.3.3 declares `engines.node >=20` (0.2.27: `>=18`). Root and `ruflo/` already require
   `>=20`; no action, but `engines` for the CLI package is unset.
3. **Transitive `@metaharness/*` optionalDependencies.** 0.3.3 lists 11 `@metaharness/*`/`metaharness` optional
   deps (darwin, flywheel, harness, redblue, router, weight-eft, workspace-lens, workspace-probe, …) plus
   `@ruvector/mincut-wasm`, `rvf`, `tiny-dancer`; a default install now resolves `@metaharness/{avo,darwin,
   flywheel,harness,horizon,redblue,router,turn-credit,weight-eft,workspace-lens,workspace-probe}` and
   `@ruvector/{ruvllm,tiny-dancer,mincut-wasm}`. Two repo guards were checked:
   - `no-metaharness-smoke.yml` scans only our own manifests' non-optional deps — it will **not** trip, and
     `--no-optional` correctly excludes them. But ADR-150 rule 1 ("removable") is now only true with
     `--no-optional`; default `npm ls` shows them.
   - `no-cli-optdep-bloat-2561.yml` counts the CLI's *own* `optionalDependencies` — not trip. Measured cold
     install is flat (4.4 s vs 4.7 s), so the #2561 timeout is not reproduced. Worth one cold `npx -y` timing on
     the real `@claude-flow/cli` tarball before release; not done here.
   - `js-beautify` was dropped from dependencies (fewer packages).
4. **Pre-existing, not caused by 0.3.3:** `vector-db.ts` `insert` is fire-and-forget (`db.insert(...)` result is not
   awaited). In the scratch contract run 300 inserts followed by `size()` returned 85–126 on 0.2.27 and 88–117 on
   0.3.3 (varies run to run); awaited inserts return the full count on both. This corrupts any "HNSW size" the CLI
   reports and can drop vectors from a freshly built transient index. Fix independently of the bump.
5. `getOptimizedOnnxEmbedder()` is broken in both versions in this environment (see table); the CLI's tier
   fallthrough hides it.
6. **Not verified:** the CLI's full vitest suite against 0.3.3 (see "What was not done"); MCP argument schemas;
   behaviour on macOS/Windows or arm64 native binaries (`@ruvector/ruvllm-linux-x64-gnu` and
   `tiny-dancer-linux-x64-gnu` are new native packages — check darwin/win32 optional builds exist before release).

## CLI tests

The worktree has no installed dependency trees (no root or `v3/node_modules`), and installing the full v3 pnpm
workspace into scratch was out of scope for this item. Findings from reading the tests: only three CLI tests touch
`ruvector` at all — `issue-3325-pattern-embedding-fallback`, `issue-3375-rescue-local-embedder`,
`issue-3108-embedding-space` — and all three `vi.mock('ruvector', …)`, so they cannot detect a real-module
incompatibility on either version. The real-module contract was therefore tested directly: the repo's actual
`src/ruvector/vector-db.ts` + `memory/embedding-policy.ts` were copied to scratch and run (via `tsx`) against each
version (results in the table), and the `neural-tools.ts` embed sequence (`isOnnxAvailable` → `initOnnxEmbedder` →
`embed` → unwrap) was replayed against each version with identical output. The release owner should still run the
CLI suite after the pin change (step 5).

## Go / no-go steps for a human

Do these on a branch from fresh `origin/main` (sync first), in this order:

1. **Decide the legacy-store policy.** Either (a) ship release notes telling users to run
   `npx ruvector hooks reembed` (suggest `--dry-run` first), or (b) have the CLI/`ruflo-agentdb` mod detect
   `ERR_LEGACY_STORE_READONLY` and surface that exact command. (b) is recommended: today the mod would just see
   an empty/failed write.
2. **Edit the three range pins** `^0.2.27` → `^0.3.3` in `package.json:109`,
   `v3/@claude-flow/cli/package.json:141`, `ruflo/package.json:47`; update the version string in
   `neural-tools.ts` (`embeddingServiceName`) and the `browser-session-tools.ts` comment/pin. Optionally pin the
   plugin docs' stale `ruvector@0.2.25` to the new version in a separate docs PR.
3. **Lockfiles, minimal edits only** (see memory `feedback_v3_pnpm_lock_minimal_edits`): in `v3/`, apply only the
   new `ruvector@0.3.3` hunks to `v3/pnpm-lock.yaml` and prove with `pnpm install --frozen-lockfile`; do **not** run
   a full regen (it flips `@claude-flow/memory` to `link:`). Root: `npm install` regenerates `package-lock.json`;
   check that `v3/node_modules` is not wrecked (memory `project_release_3_45_0_witness_and_ci_traps`).
4. **Optional-dep guards**: run `no-metaharness-smoke` and `no-cli-optdep-bloat-2561` (both should stay green; see
   risk 3) and one cold `npx -y @claude-flow/cli@<candidate> --version` timing against 0.2.27.
5. **Tests**: `cd v3/@claude-flow/cli && npx vitest run` plus the plugin smokes, and the three mocked ruvector tests
   in particular; add one non-mocked contract test that does what the scratch script did (`loadRuVector()` →
   `createVectorDB(16)` with **awaited** inserts → search/remove).
6. **Release train** per `CLAUDE.md`: this is a dependency range change with a user-visible migration, so a MINOR
   bump of `@claude-flow/cli` → `claude-flow` → `ruflo`, standalone-publish any non-bundled leaf whose source
   changed (`memory` if step 1(b) touches it), update all three dist-tags, verify with `npm view`. Run
   `node scripts/audit-umbrella-version-lockstep.mjs` and the leaf-drift check before tagging.
7. **Post-publish smoke**: fresh `HOME`, `npx ruflo` memory store/search, `hooks recall`, and the migration command
   on a copy of a real `intelligence.json`.

Rollback: revert the three range edits and the lockfile hunks; stores that were `reembed`-ed to ADR-210
provenance were **not** tested for readability by 0.2.27 — treat `reembed` as one-way until checked.

## What was not done

- No pin, lockfile, manifest or source file in the repo was changed; this report is the only file added.
- Full CLI vitest suite not run against 0.3.3 (no installed tree; see above).
- MCP tool argument schemas not compared (the listing exposes none); `hooks_recall` through the MCP transport was not
  exercised, only the equivalent CLI commands.
- No timing run of a cold `npx -y` of the real published CLI tarball.
- Incident during testing: my first CLI probe ran without an isolated `HOME` and wrote one test memory
  (`mem_1791157548`) into the real `~/.ruvector/intelligence.json`. I removed exactly that entry and restored
  `stats.total_memories` to 2; the file was re-serialised with 2-space indentation. All later runs used an isolated
  `HOME`.
