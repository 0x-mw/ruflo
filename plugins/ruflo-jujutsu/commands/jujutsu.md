---
name: jujutsu
description: 위험 점수 산정과 변경 분류를 포함한 Git diff 분석
---

Analyze current git changes:

1. Run `git diff` to capture the current diff
2. Call `mcp__plugin_ruflo-core_ruflo__analyze_diff` with the diff for comprehensive analysis
3. Call `mcp__plugin_ruflo-core_ruflo__analyze_diff-risk` for risk score
4. Call `mcp__plugin_ruflo-core_ruflo__analyze_diff-classify` for change type classification
5. Call `mcp__plugin_ruflo-core_ruflo__analyze_diff-reviewers` for reviewer recommendations based on code ownership
6. Present: risk level, change type, affected files, and reviewer recommendations
