---
name: iot-anomalies
description: Cognitum Seed 기기의 텔레메트리 이상을 탐지하고 분류합니다. 이상한 메트릭을 보고하는 기기를 조사할 때, 펌웨어 카나리 진행을 승인하기 전에, 플릿 전체 상태 경고를 분류할 때 사용합니다.
allowed-tools: Bash(npx *) mcp__plugin_ruflo-core_ruflo__memory_store Read
argument-hint: "<device-id>"
---
Run Z-score anomaly detection on a device's recent telemetry.

Steps:
1. `npx -y -p @claude-flow/plugin-iot-cognitum@latest cognitum-iot anomalies DEVICE_ID`
2. Review detected anomaly types (spike, flatline, drift, oscillation, pattern-break, cluster-outlier)
3. If score > 0.9, recommend quarantine
4. Store anomaly pattern for learning:
   `mcp__plugin_ruflo-core_ruflo__memory_store({ key: "iot-anomaly-DEVICEID", value: "TYPE at SCORE", namespace: "iot-anomalies" })`
