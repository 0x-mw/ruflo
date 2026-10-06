---
name: test-gaps
description: 누락된 테스트 커버리지를 탐지하고 테스트 제안을 생성합니다. 사용자가 커버리지 공백, 테스트되지 않은 코드, 다음에 작성할 테스트를 물을 때 사용하며, 기능을 추가한 뒤 아직 테스트가 필요한 부분을 찾을 때도 사용합니다.
argument-hint: "[--path PATH] [--limit N]"
allowed-tools: Bash(npx *) mcp__plugin_ruflo-core_ruflo__hooks_worker-dispatch Read Grep
---
Find test coverage gaps via CLI:
```bash
npx @claude-flow/cli@latest hooks coverage-gaps --format table --limit 20
npx @claude-flow/cli@latest hooks coverage-route --task "add auth tests"
npx @claude-flow/cli@latest hooks coverage-suggest --path src/
```

Or dispatch the testgaps worker via MCP:
`mcp__plugin_ruflo-core_ruflo__hooks_worker-dispatch({ trigger: "testgaps" })`

For continuous detection, use `/loop` with the `loop-worker` skill targeting the `testgaps` worker.
