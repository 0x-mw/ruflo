---
name: security-scan
description: Ruflo 보안 도구로 코드베이스 전체 보안 스캔을 실행합니다. PR에서 보안 회귀를 리뷰할 때, 인증/입력 처리 코드를 감사할 때, 프로덕션 배포 전에, 사용자가 quick/standard/deep 깊이의 보안 점검을 요청할 때 사용합니다.
allowed-tools: Bash(npx *) mcp__plugin_ruflo-core_ruflo__memory_store mcp__plugin_ruflo-core_ruflo__hooks_post-task Read Grep
argument-hint: "[depth: quick|standard|deep]"
---
Run a security scan at the specified depth.

Via CLI:
```bash
npx @claude-flow/cli@latest security scan --depth DEPTH --output json
npx @claude-flow/cli@latest security cve --list
npx @claude-flow/cli@latest security threats --model stride --export md
```

| Depth | Checks |
|-------|--------|
| quick | Dependencies, known CVEs |
| standard | + Input validation, path traversal, secrets |
| deep | + Threat modeling, injection vectors, auth flows |

Store findings via MCP: `mcp__plugin_ruflo-core_ruflo__memory_store({ key: "scan-findings", value: "SUMMARY", namespace: "security-findings" })`

Train patterns: `mcp__plugin_ruflo-core_ruflo__hooks_post-task({ taskId: "security-scan", success: true, storeResults: true })`
