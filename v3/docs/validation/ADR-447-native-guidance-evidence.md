# ADR-447 verification evidence

Date: 2026-10-04
Issue: https://github.com/ruvnet/ruflo/issues/3701
Implementation revision: 745503c3e57514e260cc50236ada4f7d8437401e
Baseline: 8ce24908c51c26aa859308bdb2e7e819e4f9fc88

## Execution and coordination

Codex owned the implementation. Three independent read only reviews covered
guidance contracts, mod security and end to end design. Ruflo coordinated through
a project scoped ledger using @claude-flow/cli 3.25.6, with the bridge disabled,
and a private Ruflo AI Team publication run. Ruflo coordination records do not
establish command execution.

ruOS executed the checks on an isolated checkout. Successful executor responses
reported completionVersion=1, completionVerified=true, status=ok and exitCode=0.
Those structured fields were checked alongside test assertions. No provider
inference, cloud model task or learning quality benchmark was run.

Versions: Node 20.20.2, TypeScript 5.9.3, Vitest 4.1.0, Claude Code 2.1.283.
Claude Code 2.1.287 was installed separately for a compatibility check; it reported
that the function hooks rollout switch was off.

## Measured results

| Check | Result | Scope |
|---|---|---|
| Native plugin validation | Passed | Real Claude Code module scanner, one handler per event, unchanged host capabilities |
| Configured native guidance smoke | 3 passed, 0 failed | Production hooks in a disposable explicitly configured fixture; not the complete native suite |
| Static security smoke | 11 passed, 0 failed | No hook process, network, model or MCP calls; tighten only guard; no automatic training or promotion |
| CLI adapter strict typecheck | Passed | src/guidance/mod-projection.ts with strict, noEmit, NodeNext and Node 20 declarations |
| Source mod regression suites | 166 passed, 0 failed across 10 files | Includes 24 new guidance contract and filesystem cases; two built CLI tests excluded |
| Standard native suite on 2.1.283 baseline | 17 passed, 5 failed | Existing cost, research and trust tests fail with this older kit |
| Standard native suite on 2.1.283 candidate | 19 passed, 7 failed | The five existing failures remain; two enabled guidance tests fail because per-test options are ignored |
| Standard native suite on 2.1.287 | Blocked by rollout gate | No passing result claimed |
| Full repository build and native plugin typecheck | Not verified | Full build dependencies and generated native declarations were not present |
| Live model task quality or routing latency | Not measured | No improvement percentage or routing benchmark claimed |

The configured fixture changes only registration options and selects the three
enabled guidance tests. It preserves all production hook implementations.
scripts/native-guidance-smoke.sh reproduces this setup and cleans up its copy.
The standard suite separately covers disabled defaults; the source suite verifies
both enabled and disabled registration paths.

The two built CLI tests initially failed because dist/src/index.js was missing.
They were excluded from the source regression command, not counted as passing.

## Reproduction

From a checkout with the listed test tools installed:

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin validate plugins/ruflo-mods
bash plugins/ruflo-mods/scripts/native-guidance-smoke.sh
bash plugins/ruflo-mods/scripts/smoke.sh
cd v3/@claude-flow/cli
tsc --strict --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck --types node src/guidance/mod-projection.ts
vitest run __tests__/mods/ --exclude '**/mods-cli-bin.test.ts'
```

Before moving the PR out of draft, run the standard native suite and plugin
typecheck with a compatible enabled runtime, plus the normal CLI build and built
CLI tests in the repository's fully provisioned environment.

## Acceptance observations

The real filesystem lifecycle runs the actual guidance compile command with the
workspace compiler, exports a projection, attaches versioned advisory context,
records permission and failed execution counters, flushes once, then invokes the
actual mod-candidates command. The report stays pending independent verification.
Canonical source and the accepted guidance ledger stay untouched.

Additional cases cover all nine permission combinations, original rule and reason
preservation, corrupt advisory and enforced data, aborted and interrupted turns,
tool and turn replay, storage retry, corrupt queue recovery, concurrent flushes,
version changes, hidden guidance attribution, classic ownership, bounded retention,
credential shaped IDs and forged verification claims.

An observation with a successful tool and the answer done still has verified=false
and learningEligible=false. Candidate review does not authorize trusted learning
or promotion. Independent task bound acceptance and held out evidence remain
required under existing governance.
