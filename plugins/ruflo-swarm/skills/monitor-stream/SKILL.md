---
name: monitor-stream
description: 실시간(real-time) 관측을 위해 Monitor 도구로 라이브 스웜 이벤트를 스트리밍
argument-hint: ""
allowed-tools: Bash(npx *) mcp__plugin_ruflo-core_ruflo__swarm_status mcp__plugin_ruflo-core_ruflo__swarm_health Monitor
---
Use the Monitor tool to stream swarm events in real time instead of polling:

Run via Monitor: `npx @claude-flow/cli@latest swarm watch --stream`

This streams NDJSON events for agent spawns, task completions, memory writes, and health checks. Each stdout line triggers a notification.

For one-shot status, use MCP: `mcp__plugin_ruflo-core_ruflo__swarm_status` or `mcp__plugin_ruflo-core_ruflo__swarm_health`.

Prefer Monitor over polling `swarm status` in a loop. See ADR-091 for rationale.
