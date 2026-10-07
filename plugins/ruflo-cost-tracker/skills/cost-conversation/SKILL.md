---
name: cost-conversation
description: 대화별 비용 보기 — 비용 추적에 있는 모든 세션을 시작 시각, 메시지 수, 상위 모델, 총비용과 함께 나열
argument-hint: ""
allowed-tools: Bash
---

# Cost per Conversation

`cost-report` and `cost-optimize` aggregate by **agent** and **model**. This skill aggregates by **conversation (session)** — a different lens that surfaces *which conversations cost the most*. Useful for retrospectives ("which sessions ran long on Opus?") and for evaluating whether a given project's session pattern is sustainable.

## When to use

- After multiple sessions, to see total spend per conversation.
- Before scoping a long session, to understand typical cost-per-conversation.
- For per-project rollups via `CONV_NAMESPACE=cost-tracking-<project>`.

## Steps

1. **Run the script** from anywhere:

   ```bash
   node plugins/ruflo-cost-tracker/scripts/conversation.mjs
   ```

   Optional env:
   - `CONV_FORMAT=json` — emit JSON instead of markdown
   - `CONV_LIMIT=20` — show only the most recent N conversations
   - `CONV_NAMESPACE=cost-tracking` — override target namespace

2. **Inspect the markdown table** — total cost across all conversations, per-tier rollup, then a per-session table (started-at, sessionId prefix, message count, top model, cost).

## Cross-references

- `cost-track` — the producer that populates `cost-tracking:session-*`
- `cost-report` — same data, per-agent / per-model lens
- `cost-trend` — drift across bench runs (different axis: corpus runs vs conversations)
- `cost-budget-check` — sums across conversations to evaluate the budget threshold
