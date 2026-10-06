---
name: doc-gen
description: 드리프트 탐지와 함께 문서를 생성하고 유지 관리합니다. 사용자가 문서를 작성/업데이트/새로 고치라고(write/update/refresh) 하거나, 코드 대비 문서 드리프트를 탐지하라고 하거나, 반복되는 문서 유지 관리를 예약하라고 할 때 사용합니다.
argument-hint: "[--target PATH]"
allowed-tools: Bash(npx *) mcp__plugin_ruflo-core_ruflo__hooks_worker-dispatch mcp__plugin_ruflo-core_ruflo__memory_store CronCreate Read Write
---
Generate docs via MCP worker dispatch:
`mcp__plugin_ruflo-core_ruflo__hooks_worker-dispatch({ trigger: "document" })`

For continuous doc maintenance via CronCreate:
`CronCreate({ schedule: "0 */2 * * *", prompt: "Run document worker" })`

Detect drift by comparing current code against existing docs and flagging inconsistencies.

Scoped generation:
- API docs: `npx @claude-flow/cli@latest hooks worker dispatch --trigger document --scope api`
- Full project: `npx @claude-flow/cli@latest hooks worker dispatch --trigger document --scope full`

Store the approach: `mcp__plugin_ruflo-core_ruflo__memory_store({ key: "doc-pattern", value: "APPROACH", namespace: "patterns" })`
