---
name: diff-analyze
description: git diff를 분석해 위험 점수 산정, 리뷰어 추천, 변경 분류를 수행합니다. PR을 준비할 때, 크거나 모듈에 걸친 변경을 리뷰할 때, 병합 전에 위험을 평가하고 리뷰어를 고를 때 사용합니다.
argument-hint: "[--branch BRANCH] [--pr PR#]"
allowed-tools: mcp__plugin_ruflo-core_ruflo__analyze_diff mcp__plugin_ruflo-core_ruflo__analyze_diff-risk mcp__plugin_ruflo-core_ruflo__analyze_diff-classify mcp__plugin_ruflo-core_ruflo__analyze_diff-reviewers mcp__plugin_ruflo-core_ruflo__analyze_diff-stats mcp__plugin_ruflo-core_ruflo__analyze_file-risk Bash
---

# Diff Analysis

Analyze git diffs for risk, complexity, and reviewer assignment.

## When to use

Before submitting a PR or after making significant changes, analyze the diff to understand risk level, get reviewer recommendations, and classify the type of change.

## Steps

1. **Analyze diff** — call `mcp__plugin_ruflo-core_ruflo__analyze_diff` with the diff content for a comprehensive analysis
2. **Risk score** — call `mcp__plugin_ruflo-core_ruflo__analyze_diff-risk` for a quantified risk assessment
3. **Classify changes** — call `mcp__plugin_ruflo-core_ruflo__analyze_diff-classify` to categorize (feature, bugfix, refactor, etc.)
4. **Get reviewers** — call `mcp__plugin_ruflo-core_ruflo__analyze_diff-reviewers` for recommended reviewers based on code ownership
5. **Diff stats** — call `mcp__plugin_ruflo-core_ruflo__analyze_diff-stats` for line counts, file counts, complexity metrics
6. **File-level risk** — call `mcp__plugin_ruflo-core_ruflo__analyze_file-risk` for per-file risk breakdown

## Risk factors

- Files with high churn history
- Security-sensitive paths (auth, crypto, permissions)
- Large diffs (>500 lines)
- Cross-module changes
- Database migration files
