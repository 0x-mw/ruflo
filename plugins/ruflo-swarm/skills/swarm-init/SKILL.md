---
name: swarm-init
description: 드리프트 방지 설정으로 멀티 에이전트 스웜을 초기화합니다. 3개 이상의 조율된 에이전트가 필요한 복잡한 다중 파일 작업(기능 구현, 모듈 간 리팩터링, 보안 감사)을 시작할 때 사용합니다. 단일 파일 편집이나 간단한 질문에는 사용하지 않습니다.
argument-hint: "[--topology hierarchical|mesh|hierarchical-mesh|ring|star|adaptive]"
allowed-tools: Bash(npx *) mcp__plugin_ruflo-core_ruflo__swarm_init mcp__plugin_ruflo-core_ruflo__swarm_status Task SendMessage
---
Initialize a hierarchical swarm for coordinated multi-agent work.

Via MCP: `mcp__plugin_ruflo-core_ruflo__swarm_init({ topology: "hierarchical", maxAgents: 8, strategy: "specialized" })`

Or via CLI:
```bash
npx @claude-flow/cli@latest swarm init --topology hierarchical --max-agents 8 --strategy specialized
```

Then spawn named agents in ONE message via Claude Code's `Task` tool with `name:` (for `SendMessage` addressability) and `run_in_background: true` (for parallel execution). Use `EnterWorktree` per agent for git-safe parallel work, and `SendMessage` for inter-agent coordination.

For larger teams (10+), use hierarchical-mesh topology:
```bash
npx @claude-flow/cli@latest swarm init --topology hierarchical-mesh --max-agents 15 --strategy specialized
```
