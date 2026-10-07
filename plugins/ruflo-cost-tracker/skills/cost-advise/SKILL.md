---
name: cost-advise
description: 본인의 Claude Code 및 Codex 로그에서 최적화 결과를 도출 — 낮은 캐시 적중률, 본전을 뽑지 못한 1시간 캐시 쓰기, 최상위 티어 모델을 쓰는 서브 에이전트, Codex 추론 비중, 비대해진 세션 — 각각 증거와 가정 절감액 포함. 지출을 줄이는 방법이나 지출이 높은 이유를 물을 때 사용합니다.
argument-hint: "[--since 7d] [--provider claude|codex|all] [--format json|markdown]"
allowed-tools: Bash
---

# Cost Advise

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/advise.mjs --since 7d
```

## Rules for presenting findings

- Savings are **what-if repricings of the same tokens** at another rate. They say nothing about quality; tell the user to spot-check before switching a model.
- A finding with `saving n/a` has no defensible number (no measured delta exists). Do not invent one.
- Do not change settings, models or CLAUDE.md on the user's behalf; present the action and let them choose.
- Prefer the largest controllable lever first: cache discipline, then model tier for sub-agents, then reasoning effort, then context size.
- Pair with `cost-ledger` for the totals and `cost-session` to drill into one expensive session.
