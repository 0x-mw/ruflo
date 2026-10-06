---
name: init-project
description: MCP 도구, 훅, 에이전트 설정으로 새 Ruflo 프로젝트를 초기화합니다. 새 저장소에 Ruflo를 설정할 때, 또는 사용자가 "init ruflo"("ruflo 초기화"), "set up ruflo"("ruflo 설정")라고 하거나 MCP 서버, 훅, 에이전트 설정을 처음부터 부트스트랩하는 방법을 물을 때 사용합니다.
argument-hint: "[--preset standard|minimal|full]"
allowed-tools: Bash(npx *) Read Write Edit
---
Run `npx @claude-flow/cli@latest init --wizard` to set up the project interactively, or `npx @claude-flow/cli@latest init --preset standard` for defaults.

This creates CLAUDE.md, .claude/settings.json, and .claude-flow/ config with MCP server registration for the `ruflo` MCP tools.
