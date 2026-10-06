---
name: iot-witness-verify
description: 위트니스 체인 무결성을 검증하고 출처(provenance) 공백을 탐지
allowed-tools: Bash(npx *) mcp__plugin_ruflo-core_ruflo__memory_store Read
argument-hint: "<device-id>"
---
Verify the witness chain integrity for a Cognitum Seed device.

Steps:
1. `npx -y -p @claude-flow/plugin-iot-cognitum@latest cognitum-iot witness verify DEVICE_ID`
2. Check for epoch gaps and hash chain breaks
3. Report integrity score (0.0–1.0)
4. If gaps found, store for audit trail:
   `mcp__plugin_ruflo-core_ruflo__memory_store({ key: "iot-witness-gap-DEVICEID", value: "Gap from EPOCH to EPOCH", namespace: "iot-audit" })`
