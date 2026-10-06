---
name: iot-fleet
description: 펌웨어 정책이 있는 Cognitum Seed 기기 플릿을 생성하고 관리
allowed-tools: Bash(npx *) mcp__plugin_ruflo-core_ruflo__memory_store mcp__plugin_ruflo-core_ruflo__memory_search Read
argument-hint: "<create|list|add|remove|delete> [options]"
---
Manage device fleets. Parse subcommand from arguments.

**create**: `npx -y -p @claude-flow/plugin-iot-cognitum@latest cognitum-iot fleet create --name NAME`
**list**: `npx -y -p @claude-flow/plugin-iot-cognitum@latest cognitum-iot fleet list`
**add**: `npx -y -p @claude-flow/plugin-iot-cognitum@latest cognitum-iot fleet add FLEET_ID DEVICE_ID`
**remove**: `npx -y -p @claude-flow/plugin-iot-cognitum@latest cognitum-iot fleet remove FLEET_ID DEVICE_ID`
**delete**: `npx -y -p @claude-flow/plugin-iot-cognitum@latest cognitum-iot fleet delete FLEET_ID`
