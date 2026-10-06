---
name: ruflo-status
description: Ruflo 상태를 진단한 뒤, 설치를 변경하지 않고 시스템, MCP 서버, 활성 에이전트 상태를 보고
argument-hint: "[--fix]"
allowed-tools: Bash(npx *)
---

# Ruflo status

Use this skill when the user asks for Ruflo health, diagnostics, MCP server
state, or active-agent status.

## Default read-only workflow

Run these commands in order:

```bash
npx @claude-flow/cli@latest doctor
npx @claude-flow/cli@latest status
```

Summarize the diagnostics and status together. Do not repair, reset, start,
stop, install, or otherwise change anything during the default workflow.

## Explicit repair workflow

Only when the user explicitly asks to fix or auto-repair the installation,
replace the first command with:

```bash
npx @claude-flow/cli@latest doctor --fix
npx @claude-flow/cli@latest status
```

Report what the repair changed and the resulting status. Never infer
authorization for `doctor --fix` from a request to check or diagnose Ruflo.
