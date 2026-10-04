# ADR-447: Native mod guidance and observation loop

Date: 2026-10-04
Status: Proposed
Scope: ruflo-mods and the Guidance Control Plane CLI adapter

## Context

ADR-404 moved routing and edit signals into native Claude Code function hooks.
ADR-445 adds AgentDB recall. Neither a successful edit nor the assistant saying
done establishes that a task passed its acceptance test. The guidance compiler
already produces a constitution, rule shards and source hashes. Reusing it avoids
a second canonical rule system.

The current guidance ledger accepts RunEvent records without an independent
trust classification. hooks_post-task defaults omitted success to true. The
optimizer's fixed multiplier simulation is not measured held out evaluation, and
GuidanceControlPlane.optimize can apply promotions. These interfaces are unsuitable
automatic sinks for mod collected activity.

## Decision

Implement an opt in adapter with two disabled defaults: guidanceContext and
guidanceLearning. The latter means observation collection, not trusted training.

| Boundary | Input | Output | Authority |
|---|---|---|---|
| Explicit CLI export | Reviewed root and optional local source | Compiler projection with full bundle SHA256 and declared source revision | No permission changes |
| Native prompt hook | Bounded local projection and current prompt | Screened lexical excerpts, IDs, source and version | Advisory reference only |
| Native activity hooks | Final tool verdicts and execution results | Strictly bounded metadata queue per registration lifetime | Unverified observations |
| CLI candidate review | Strictly validated queue files | Version scoped rule review priorities | No training or promotion |
| Independent evaluator | Task bound acceptance outputs, immutable source and artifact evidence | Eligible evidence under existing governance | Separate authorization required |

The projection omits embeddings and compiler timestamps. Its SHA256 identifies
the exported content; it is not a signature. Compiler constitution and source
hashes are preserved. Source revision is caller supplied and must be checked by
the independent evaluator. Learned candidates are never compiled automatically.

Native retrieval validates schema and file bounds, refuses symlinks, screens
credentials, role delimiters and common injection patterns, then ranks lexically.
At most five excerpts and 4096 characters are attached. Existing prompt text and
context survive. The display is explicitly incomplete advisory data, including
any constitution excerpts. Regex screening does not authenticate content or
replace deterministic permission checks.

The existing tool.check guard remains the sole enforcement path. It runs the
chain first and combines deny over ask over allow, preserving the chain on a tie.
Guidance cannot grant authority. Unreadable advisory guidance passes the prompt;
unreadable enforced policy tightens allow to ask.

Observations persist only generated IDs, source revision, bundle version,
displayed rule IDs, verdict counters, execution counters and completion class.
No prompts, commands, paths, outputs, answers, raw host IDs or credentials enter
this queue. Execution success remains distinct from task success. Every record
has verified=false and learningEligible=false. The consumer rejects writable
verification claims and extra receipt fields rather than admitting them.

Each registration lifetime receives a new storage namespace. Same process
flushes serialize, repeated turn completions and host tool IDs deduplicate within
bounded in memory sets, and refused writes preserve pending observations. Existing
unreadable, oversized or corrupt queue bytes are never overwritten. Native fs has
no atomic append or filesystem lock; a crash can lose this lifetime's observations.
This is acceptable for unverified telemetry, never an accepted evidence store.

Retain 128 records and 256 KiB per lifetime. The CLI reviews at most 128 files per
batch, separates guidance versions, rejects namespace mismatches and duplicate
IDs, and produces priorities for review. It never appends to guidance/events.ndjson,
calls hooks_post-task, trains memory, invokes optimize or changes active guidance.
Accepted evidence and promotion remain governed by ADR-322A.

## Alternatives

1. Run a process or MCP call from every prompt. Rejected because it reintroduces
   latency and host/network capabilities into the default native mod.
2. Feed completed turns to hooks_post-task. Rejected because completion is not
   independently verified acceptance.
3. Invoke the optimizer from the mod. Rejected because simulated metrics and
   automatic promotion violate the evidence boundary.
4. Create a parallel rule compiler. Rejected in favor of the existing compiler
   and an explicitly lexical native adapter.

## Consequences

The integration provides task specific guidance and reviewable observations
without claiming autonomous correctness or measured learning improvement. Operators
must export reviewed source explicitly and archive reviewed queue files. Legacy
hook ownership and default behavior remain unchanged. An independent evaluator
is needed before review priorities can become accepted learning evidence.

## Acceptance

The automated lifecycle must compile real guidance, export the projection,
preserve prompt context, retrieve versioned excerpts, keep all nine permission
combinations monotonic, record execution failures and aborted turns, persist once,
retry refused storage, reject forged verification and leave canonical sources and
the accepted ledger untouched. Native engine tests and real filesystem tests are
reported separately from live model task execution and quality benchmarks.

Runtime versions, source revisions and measured test results belong in the linked
PR evidence. No routing latency or learning uplift is inferred from fixture tests.
