---
name: harness-gepa
description: "`@metaharness/darwin/gepa` 라이브러리 진입점(darwin 0.8.0)으로 GEPA 지놈을 점검하고 감사합니다 — 지놈을 불러와 검증(기본값은 출시된 cand-6 승격본)하고, 지놈이 컴파일되는 시스템 프롬프트를 렌더링하거나, 실행 대화 기록의 실패 모드를 분류합니다. `gepaOptimize` 루프 자체는 라이브러리 전용(평가기는 직접 제공)이라 여기서는 제공하지 않으며, 샌드박스 채점 진화에는 `harness-evolve`를 사용하세요. @metaharness/darwin이 없으면 기능이 단계적으로 축소됩니다."
argument-hint: "--op genome|validate|render|analyze [--path <genome.json>] [--transcript <t.json>] [--alert-on-invalid]"
allowed-tools: Bash
---

Surfaces the GEPA (genetic-evolution prompt-adaptation) *library* exports
from `@metaharness/darwin/gepa`. Unlike the other skills in this plugin
there is no CLI binary behind this — the script dynamic-imports the library
(local resolution first, versioned cache install as fallback) and calls the
subprocess-safe subset.

## When to use

- **Adopting an evolved policy**: `--op render` shows the actual system
  prompt a genome compiles to — read THAT, not the raw JSON, before
  wiring a genome into a harness.
- **Auditing a promotion**: `--op genome` loads + validates the shipped
  cand-6 genome (first holdout-confirmed cheap-tier promotion; provenance
  ships in the package) or any genome file you point at.
- **CI gate on genome edits**: `--op validate --alert-on-invalid` exits 1
  on structural errors.
- **Debugging a bad run**: `--op analyze --transcript run.json` classifies
  failure modes (GEPA's failure-class taxonomy) from a transcript array.

## What is deliberately NOT here

`gepaOptimize` — the optimization loop takes an in-process
`evaluate(candidate)` callback ("bring your own evaluator") that cannot
cross a subprocess boundary. Two supported paths instead:

1. **Library consumers**: `import { gepaOptimize, loadCand6Genome } from '@metaharness/darwin/gepa'`
2. **Sandbox-scored evolution**: `harness-evolve` (darwin CLI `evolve`),
   which pairs GEPA with its own sandbox evaluators.

## Algorithm

Implementation: [`scripts/gepa.mjs`](../../scripts/gepa.mjs).

1. `import('@metaharness/darwin/gepa')`; on MODULE_NOT_FOUND fall back to a
   one-time `npm install --prefix ~/.ruflo/darwin-cache-<pin>` and import
   the cached `dist/gepa/index.js` (versioned dir → pin bumps invalidate).
2. Dispatch `--op`:
   - `genome`  → `loadGenome(fs, path)` or `loadCand6Genome()` + `validateGenome`
   - `validate` → `validateGenome(rawJson)` (raw parse so broken files reach
     the validator instead of throwing in the loader)
   - `render`  → `buildSystemFromGenome(genome, ext?, glob?)`
   - `analyze` → `analyzeTranscript(entries)`
3. Emit one JSON object; exit 0 (or 1 under `--alert-on-invalid`, 2 on bad input).

## Examples

```bash
node scripts/gepa.mjs --op genome                          # cand-6 + validation
node scripts/gepa.mjs --op render | jq -r .system         # what does cand-6 SAY?
node scripts/gepa.mjs --op validate --path my-genome.json --alert-on-invalid
node scripts/gepa.mjs --op analyze --transcript run.json
```

## Exit codes

- `0` — op completed (or degraded — darwin not installable)
- `1` — `--alert-on-invalid` and validation found errors
- `2` — config error (unknown op, missing/broken input file)
