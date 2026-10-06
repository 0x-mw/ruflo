---
name: harness-mcp-scan
description: "`harness mcp-scan <path>`로 하네스가 선언한 MCP 영역을 정적 보안 스캔합니다. `.mcp/servers.json` + `.harness/claims.json`을 읽습니다. 읽기 전용이며 디스패치는 없습니다. `--fail-on` 심각도 이상의 발견 사항이 있으면 exit 1로 끝납니다."
argument-hint: "[--path .] [--fail-on low|medium|high] [--format table|json]"
allowed-tools: Bash
---

Calls `harness mcp-scan` to enumerate every declared MCP server + tool
and flag policy / permission / dependency issues. Never executes any
tool; pure static analysis.

## Algorithm

Implementation: [`scripts/mcp-scan.mjs`](../../scripts/mcp-scan.mjs).

1. Invoke the pinned `harness` binary (`metaharness@~0.4.1`, resolved from a
   local install or the one-time `~/.ruflo/metaharness-cache-<pin>` cache —
   never `@latest`): `harness mcp-scan <path> --json`.
2. Parse `findings[]` with `{ severity, id, server, tool, message }`.
3. `--fail-on <severity>`: exit 1 when any finding is at or above that
   level. Default `high`.
4. Output JSON (default) or markdown table.

## Severity rank

| Severity | Rank |
|---|---:|
| low | 1 |
| medium | 2 |
| high | 3 |

`--fail-on high` (default) only fails on HIGH; `--fail-on medium` also
fails on MEDIUM; `--fail-on low` fails on any finding.

## CI integration

```yaml
- name: MCP static scan
  run: node plugins/ruflo-metaharness/scripts/mcp-scan.mjs --fail-on high
```

The exit code is the only thing CI watches; the JSON output goes to
artifacts for human review.

## Graceful degradation

When `harness` binary is unavailable (no network, blocked registry),
emits structured `{ degraded: true, reason: 'metaharness-not-available' }`
and exits 0. Ruflo continues — ADR-150 architectural constraint.
