---
name: ddd-aggregate
description: 엔티티, 값 객체, 리포지토리 인터페이스, 도메인 이벤트, 테스트 스텁이 있는 애그리게이트 루트를 스캐폴딩합니다. 기존 바운디드 컨텍스트에 새 애그리게이트를 추가할 때, 불변식을 소유하는 새 비즈니스 개념을 모델링할 때, 엔티티 + 리포지토리 + 이벤트 3종 세트의 보일러플레이트를 생성할 때 사용합니다.
argument-hint: "<context> <aggregate-name>"
allowed-tools: Bash Read Write Edit Grep Glob mcp__plugin_ruflo-core_ruflo__memory_store mcp__plugin_ruflo-core_ruflo__memory_search mcp__plugin_ruflo-core_ruflo__agentdb_hierarchical-store mcp__plugin_ruflo-core_ruflo__hooks_pre-task mcp__plugin_ruflo-core_ruflo__hooks_post-task
---
Scaffold a complete aggregate root inside a bounded context.

Parse `$ARGUMENTS` as `<context-name> <aggregate-name>` (both kebab-case). The context must already exist under `src/`.

## Steps

1. **Validate**: Confirm `src/<context>/domain/` exists. If not, suggest running `/ddd-context <context>` first.

2. **Pre-task hook**: `npx @claude-flow/cli@latest hooks pre-task --description "DDD aggregate: <aggregate-name> in <context>"`

3. **Create aggregate root entity**:
   - File: `src/<context>/domain/entities/<aggregate-name>.entity.ts`
   - Include: unique ID field, constructor with invariant validation, domain methods that enforce business rules, `equals()` based on identity
   - Export a TypeScript class extending or implementing a base `AggregateRoot` interface

4. **Create value objects**:
   - File: `src/<context>/domain/value-objects/<aggregate-name>-id.value-object.ts`
   - Include: immutable ID value object with factory method and validation
   - Add additional value objects as properties of the aggregate suggest them

5. **Create repository interface**:
   - File: `src/<context>/domain/repositories/<aggregate-name>.repository.ts`
   - Include: `findById`, `save`, `delete` methods
   - Use the aggregate root and its ID value object as types
   - This is an interface only -- no implementation (infrastructure concern)

6. **Create domain events**:
   - File: `src/<context>/domain/events/<aggregate-name>-created.event.ts`
   - File: `src/<context>/domain/events/<aggregate-name>-updated.event.ts`
   - Include: event name (past tense), timestamp, aggregate ID, payload

7. **Create unit test stubs**:
   - File: `src/<context>/domain/entities/<aggregate-name>.entity.test.ts`
   - Include: test cases for construction invariants, domain methods, equality
   - Use `describe`/`it` with `should [behavior] when [condition]` names

8. **Update barrel exports**: Add new files to the relevant `index.ts` barrel files.

9. **Store in domain model graph**:
   ```
   mcp__plugin_ruflo-core_ruflo__agentdb_hierarchical-store --parent "context:<context>" --child "aggregate:<aggregate-name>" --relation "contains"
   mcp__plugin_ruflo-core_ruflo__memory_store --key "ddd-aggregate-<context>-<aggregate-name>" --value "AGGREGATE_SUMMARY" --namespace tasks
   ```

10. **Post-task hook**: `npx @claude-flow/cli@latest hooks post-task --task-id "ddd-aggregate-<aggregate-name>" --success true --train-neural true`
