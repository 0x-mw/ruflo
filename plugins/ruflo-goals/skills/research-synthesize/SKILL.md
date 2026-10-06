---
name: research-synthesize
description: 증거 등급 평가, 모순 해소, 실행 가능한 권장 사항으로 메모리의 리서치 결과를 구조화된 보고서로 종합
argument-hint: "<topic> [--format report|brief|table]"
allowed-tools: mcp__plugin_ruflo-core_ruflo__memory_search mcp__plugin_ruflo-core_ruflo__memory_search_unified mcp__plugin_ruflo-core_ruflo__memory_list mcp__plugin_ruflo-core_ruflo__memory_retrieve mcp__plugin_ruflo-core_ruflo__memory_store mcp__plugin_ruflo-core_ruflo__agentdb_context-synthesize mcp__plugin_ruflo-core_ruflo__agentdb_pattern-search mcp__plugin_ruflo-core_ruflo__neural_predict Bash Read Write
---

# Research Synthesize

Synthesize accumulated research findings into actionable reports.

## When to use

After running deep-research (one or multiple times), when you need to pull together findings from memory into a coherent synthesis with recommendations.

## Steps

1. **Gather findings** — search across research namespaces:
   - `mcp__plugin_ruflo-core_ruflo__memory_search` namespace `research` for raw findings
   - `mcp__plugin_ruflo-core_ruflo__memory_search` namespace `research-sources` for references
   - `mcp__plugin_ruflo-core_ruflo__agentdb_pattern-search` for discovered patterns
   - `mcp__plugin_ruflo-core_ruflo__agentdb_context-synthesize` for AI-assisted context building
2. **Grade evidence** — for each finding, assess:
   - **High**: Multiple independent sources agree, directly observed, reproducible
   - **Medium**: Single credible source, indirectly supported, plausible
   - **Low**: Anecdotal, single unverified source, speculative
3. **Resolve contradictions** — when findings conflict:
   - Identify the specific claim in tension
   - Compare evidence quality
   - Check recency (newer data may supersede)
   - Note unresolved contradictions explicitly
4. **Predict relevance** — call `mcp__plugin_ruflo-core_ruflo__neural_predict` to score which findings are most relevant to the original goal
5. **Structure report**:
   - Executive summary (2-3 sentences answering the original question)
   - Key findings (ranked by evidence quality)
   - Methodology (what sources were checked)
   - Limitations (what wasn't checked, what remains uncertain)
   - Recommendations (concrete next actions)
   - References (source links and memory keys)
6. **Store synthesis** — call `mcp__plugin_ruflo-core_ruflo__memory_store` namespace `research-synthesis` with the full report

## Output format

```
# [Research Topic] — Synthesis Report

## Summary
[2-3 sentence answer]

## Key Findings
1. [Finding] — Evidence: High/Medium/Low
2. [Finding] — Evidence: High/Medium/Low

## Contradictions
- [Claim A] vs [Claim B]: [resolution or "unresolved"]

## Recommendations
1. [Action] — because [reasoning]

## Sources
- [key]: [description]
```
