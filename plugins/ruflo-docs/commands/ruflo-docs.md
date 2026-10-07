---
name: ruflo-docs
description: 파일, 모듈 또는 프로젝트 전체의 문서를 생성하거나 업데이트
---
$ARGUMENTS

Generate or update documentation using the document worker and drift detection.

**Full project**: `npx @claude-flow/cli@latest hooks worker dispatch --trigger document`
**Specific scope**: `npx @claude-flow/cli@latest hooks worker dispatch --trigger document --scope api`

Parse $ARGUMENTS to determine scope:
- If a file path is given, generate docs for that file
- If "api" is given, generate API documentation
- If no arguments, run full project documentation generation

Steps:
1. Analyze the target for public APIs and existing documentation
2. Detect drift between code and docs
3. Generate or update documentation
4. Report what was created or changed
