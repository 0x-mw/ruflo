---
name: ddd-validate
description: 도메인 경계를 검증 -- 컨텍스트 간 import 위반과 애그리게이트 불변식 문제를 탐지합니다. 바운디드 컨텍스트 간 누수에 대해 DDD 코드베이스를 감사할 때, 횡단 변경을 병합하기 전에, 경계 침식을 일찍 잡는 CI 게이트로 사용합니다.
argument-hint: ""
allowed-tools: Bash Read Grep Glob mcp__plugin_ruflo-core_ruflo__memory_store mcp__plugin_ruflo-core_ruflo__memory_search mcp__plugin_ruflo-core_ruflo__hooks_pre-task mcp__plugin_ruflo-core_ruflo__hooks_post-task
---
Validate domain boundary integrity across all bounded contexts.

## Steps

1. **Discover contexts**: Scan `src/*/domain/` to find all bounded contexts.

2. **Check cross-boundary violations**:
   - For each context, scan all `.ts` files for import statements
   - Flag any import that reaches into another context's `domain/` directory directly
   - Allowed: importing from another context's public `index.ts` (application layer)
   - Violation: importing from `src/<other-context>/domain/entities/...` directly

   ```bash
   # Find cross-boundary imports
   for ctx in $(find src -maxdepth 2 -name "domain" -type d | sed 's|src/||;s|/domain||'); do
     grep -rn "from ['\"].*src/" "src/$ctx/" --include="*.ts" | grep -v "src/$ctx/" || true
   done
   ```

3. **Check aggregate invariant enforcement**:
   - Scan aggregate root entities for public setters that bypass validation
   - Flag mutable public properties without invariant checks
   - Verify that child entities are not directly accessible (must go through aggregate root)

4. **Check event naming conventions**:
   - Domain events should be past-tense named (e.g., `OrderCreated`, not `CreateOrder`)
   - Events should be immutable (no public setters)
   - Events should carry the aggregate ID

5. **Check repository patterns**:
   - Repository interfaces should exist in `domain/repositories/`, not `infrastructure/`
   - Repository implementations should exist in `infrastructure/`, not `domain/`
   - Each aggregate root should have exactly one repository

6. **Report findings**:
   - Output a table of violations with file path, line number, violation type, and suggestion
   - Categorize as: `BOUNDARY`, `INVARIANT`, `EVENT`, `REPOSITORY`
   - Exit with summary: total violations, by category, severity

7. **Store results**:
   ```bash
   npx @claude-flow/cli@latest memory store --key "ddd-validation-TIMESTAMP" --value "RESULTS_SUMMARY" --namespace tasks
   npx @claude-flow/cli@latest hooks post-task --task-id "ddd-validate" --success true --store-results true
   ```
