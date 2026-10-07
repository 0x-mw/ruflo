---
name: dependency-check
description: 프로젝트 의존성에서 알려진 취약점과 CVE를 스캔합니다. 서드파티 패키지를 감사할 때, 릴리스 전에, `npm install`/lockfile 변경 후, 보고된 CVE 권고를 조사할 때 사용합니다.
argument-hint: "[--path PATH]"
allowed-tools: Bash(npx * npm *) mcp__plugin_ruflo-core_ruflo__memory_store Read
---
Check dependencies for CVEs and outdated packages:

```bash
npx @claude-flow/cli@latest security cve --list
npx @claude-flow/cli@latest security cve --severity critical
npx @claude-flow/cli@latest security scan --type deps --depth deep
npm audit --json
```

| Severity | Action |
|----------|--------|
| critical | Block deployment, fix immediately |
| high | Fix before next release |
| moderate | Schedule fix within sprint |
| low | Track in backlog |

Auto-fix via the scan command: `npx @claude-flow/cli@latest security scan --type deps --fix`

For continuous monitoring, dispatch via MCP:
`mcp__plugin_ruflo-core_ruflo__hooks_worker-dispatch({ trigger: "audit" })`
