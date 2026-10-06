---
name: ddd-context
description: 표준 디렉터리 구조로 DDD 바운디드 컨텍스트를 생성하고 관리합니다. 새 서브도메인을 시작할 때, 모놀리스를 바운디드 컨텍스트로 쪼갤 때, 새 모듈의 domain/application/infrastructure 레이아웃을 스캐폴딩할 때 사용합니다.
argument-hint: "<context-name>"
allowed-tools: Bash Read Write Edit Grep Glob mcp__plugin_ruflo-core_ruflo__memory_store mcp__plugin_ruflo-core_ruflo__memory_search mcp__plugin_ruflo-core_ruflo__agentdb_hierarchical-store
---
Create a bounded context directory structure for the given context name.

Parse `$ARGUMENTS` as the context name (kebab-case). If empty, list existing contexts.

## Steps

1. **Validate name**: Ensure the context name is kebab-case and does not already exist under `src/`.

2. **Create directory structure**:
   ```
   src/<context-name>/
     domain/
       entities/
       value-objects/
       events/
       services/
       repositories/
     application/
     infrastructure/
   ```

3. **Generate index files**:
   - `src/<context-name>/domain/entities/index.ts` -- barrel export for entities
   - `src/<context-name>/domain/value-objects/index.ts` -- barrel export for value objects
   - `src/<context-name>/domain/events/index.ts` -- barrel export for domain events
   - `src/<context-name>/domain/services/index.ts` -- barrel export for domain services
   - `src/<context-name>/domain/repositories/index.ts` -- barrel export for repository interfaces
   - `src/<context-name>/domain/index.ts` -- re-export all domain submodules
   - `src/<context-name>/application/index.ts` -- barrel export for application services
   - `src/<context-name>/infrastructure/index.ts` -- barrel export for infrastructure implementations
   - `src/<context-name>/index.ts` -- public API of the bounded context (re-exports domain and application only, NOT infrastructure)

4. **Store in domain model graph**:
   ```
   mcp__plugin_ruflo-core_ruflo__agentdb_hierarchical-store --parent "domain" --child "context:<context-name>" --relation "contains"
   mcp__plugin_ruflo-core_ruflo__memory_store --key "ddd-context-<context-name>" --value "Created bounded context" --namespace tasks
   ```

5. **Report**: Confirm the context was created and list the generated files.
