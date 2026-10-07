---
name: federation-status
description: 페더레이션 상태를 보여 줍니다 — 피어, 세션, 신뢰 수준, 메시지 메트릭. 사용자가 "페더레이션 정상이야?"("is federation healthy?"), "피어 보여 줘"("show peers"), "페더레이션 상태"("federation status")라고 묻거나 설치 간 에이전트 연결 상태를 점검하려 할 때 사용합니다.
allowed-tools: Bash(npx *) mcp__plugin_ruflo-core_ruflo__memory_search Read
argument-hint: ""
---
Show the current state of the federation.

Steps:
1. `npx -y -p @claude-flow/plugin-agent-federation@latest ruflo-federation status` -- overall health
2. `npx -y -p @claude-flow/plugin-agent-federation@latest ruflo-federation peers` -- list peers with trust levels and scores
3. Summarize: active sessions, messages exchanged, PII redactions, threat detections

Search memory for federation history:
`mcp__plugin_ruflo-core_ruflo__memory_search({ query: "federation peer trust", namespace: "federation" })`
