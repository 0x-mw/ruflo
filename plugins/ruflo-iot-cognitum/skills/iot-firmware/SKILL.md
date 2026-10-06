---
name: iot-firmware
description: 카나리 배포와 이상 징후 기반 진행으로 펌웨어 롤아웃을 오케스트레이션
allowed-tools: Bash(npx *) mcp__plugin_ruflo-core_ruflo__memory_store mcp__plugin_ruflo-core_ruflo__memory_search Read
argument-hint: "<deploy|advance|rollback|status|list> [options]"
---
Manage firmware rollouts across device fleets.

**deploy**: `npx -y -p @claude-flow/plugin-iot-cognitum@latest cognitum-iot firmware deploy FLEET_ID --version VERSION`
**advance**: `npx -y -p @claude-flow/plugin-iot-cognitum@latest cognitum-iot firmware advance ROLLOUT_ID`
**rollback**: `npx -y -p @claude-flow/plugin-iot-cognitum@latest cognitum-iot firmware rollback ROLLOUT_ID`
**status**: `npx -y -p @claude-flow/plugin-iot-cognitum@latest cognitum-iot firmware status ROLLOUT_ID`
**list**: `npx -y -p @claude-flow/plugin-iot-cognitum@latest cognitum-iot firmware list`

Rollout stages: pending → canary → rolling → complete (or rolled-back)
