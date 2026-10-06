---
name: recall
description: 빠른 시맨틱 조회 — MMR 다양성과 최신성 가중치로 모든 메모리 네임스페이스를 검색
---
$ARGUMENTS

Semantic recall across all memory namespaces using HNSW vector search with MMR diversity reranking.

```bash
npx @claude-flow/cli@latest memory search --query "$ARGUMENTS" --limit 5
```

For richer results when ruvector is available:
```bash
npx ruvector search "$ARGUMENTS" --hybrid --limit 5
```

This searches across patterns, tasks, solutions, feedback, security, and claude-memories namespaces. Results are ranked by composite score: cosine similarity * MMR diversity * recency decay.

If no arguments provided, show recent memory entries:
```bash
npx @claude-flow/cli@latest memory list --limit 10
```
