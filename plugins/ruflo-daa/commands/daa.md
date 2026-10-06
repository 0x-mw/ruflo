---
name: daa
description: 동적 에이전트 아키텍처 상태 -- 학습 메트릭, 활성 에이전트, 인지 패턴
---

Show DAA dashboard:

1. Call `mcp__plugin_ruflo-core_ruflo__daa_learning_status` with `detailed: true` to get the swarm summary (total / active / learning / avg success rate / total adaptations) plus per-agent records (id, status, cognitive pattern, success rate, adaptation count)
2. Call `mcp__plugin_ruflo-core_ruflo__daa_performance_metrics` for efficiency and accuracy stats
3. Present: active vs learning agents, adaptation progress, cognitive patterns per agent, and avg success rate. Note: cross-agent knowledge-sharing events are emitted by `daa_knowledge_share` but not aggregated by these tools — only surface them if a share has run this session.
