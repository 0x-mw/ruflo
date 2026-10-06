---
name: pod-sales
description: 영업 비즈니스 팟(ADR-164 §4.1, 2단계)을 한 틱 실행합니다. templates/sales.json을 불러와 pod-schema로 검증하고, ruflo의 에이전트 레지스트리와 대조해 에이전트를 확정하고, 2단계 파일 기반 스텁 원장으로 예산을 확보하고(원자적 SQLite 추적기는 ADR-164.1의 3단계), 에이전트별 드라이런 프롬프트를 구성하고, federation_bbs_publish JSONL 백업 저장소를 통해 "sales" 룸에 요약 엔벨로프를 게시하며, /loop 수집용 구조화 줄 {podName, tickId, agentsRan, totalUsd, envelopeId, status}를 출력합니다. 기본은 드라이런이며 --live는 3단계용으로 예약되어 있습니다.
argument-hint: "[--pod-template <path>] [--base-path <dir>] [--dry-run|--live] [--budget-cap-usd <amt>] [--tick-id <id>]"
allowed-tools: Bash
---

Surfaces `pod-tick.mjs` as a single-shot skill for the sales pod. Use when
Claude Code needs to demonstrate, smoke-test, or schedule one iteration of
the sales autopilot without spawning real LLM workers.

## Algorithm

Implementation: [`scripts/pod-tick.mjs`](../../scripts/pod-tick.mjs).

1. Parse args (`--pod-template`, `--base-path`, `--dry-run` / `--live`,
   `--budget-cap-usd`, `--tick-id`). `--live` is refused with exit code 3
   in Phase 2.
2. Load the pod template JSON (default: `templates/sales.json`).
3. Validate via `validatePodTemplate(json)` — schema in
   `v3/@claude-flow/cli/src/business-pods/pod-schema.ts` and inlined in
   `pod-tick.mjs` so the script runs without a built CLI. Throws with a
   JSON-pointer path on the first violation.
4. Resolve every `agent.agentType` against `KNOWN_AGENT_TYPES`. Unknown
   types abort with exit code 2 and an actionable error.
5. Reserve `min(budgetUsdPerRun, --budget-cap-usd)` USD against the
   file-based ledger at `<base-path>/budget/<roomId>.json`. Honors
   `reservationExpiryMs` (default 60_000 ms, bounded to [5000, 300000]
   per ADR-164.1 §3.2). `TODO(adr-164.1)`: swap the file ledger for the
   atomic SQLite tracker in Phase 3.
6. Build per-agent prompts (kickoff scoped to the bench description +
   pod's PII policy). In `--dry-run` they are logged to stderr and the
   model is never invoked.
7. Commit the reservation. Dry-run actual = $0; live actual = the
   reserved amount (Phase 3 wires real `claude -p` `--max-budget-usd`
   reporting).
8. Append a `pod-status` envelope to the Phase-1 backing store at
   `<base-path>/.agentbbs/room-<derivedRoomId>.jsonl` so subsequent
   `federation_bbs_watch` calls see the tick.
9. Emit a single JSON line on stdout:
   `{podName, tickId, agentsRan, totalUsd, envelopeId, status}`.

## Exit codes

- `0` — tick succeeded (`status === 'success'`)
- `2` — invalid template / unknown agent type / budget exhausted / arg error
- `3` — `--live` requested (refused in Phase 2)

## Phase 3 surfaces (not in this build)

- `--live` mode: dispatch each prompt through `claude -p` headless or a
  Managed Agent and capture the actual `--max-budget-usd` reported spend.
- Atomic SQLite budget tracker (ADR-164.1 §3.2).
- Multi-pod variants (`pod-marketing`, `pod-finance`, ...) — each gets its
  own skill once Phase 3 ships.
