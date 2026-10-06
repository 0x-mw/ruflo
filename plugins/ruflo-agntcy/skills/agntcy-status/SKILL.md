---
name: agntcy-status
description: AGNTCY/SLIM/CASA 통합 상태를 보여 줍니다 — 업스트림 AGNTCY 패키지가 설치되어 있는지, 어떤 전송(로컬 또는 SLIM)이 활성인지, CASA 강제가 켜져 있는지. 사용자가 "AGNTCY 설정돼 있어?"("is AGNTCY configured?"), "SLIM/CASA 상태 보여 줘"("show SLIM/CASA status"), "AGNTCY/IOC 통합이 활성이야?"("is AGNTCY/IOC integration active?")라고 물을 때 사용합니다.
allowed-tools: Read
argument-hint: ""
---

Scaffolding stub — not yet implemented. This skill will report, once `ruflo-agntcy` ships real logic (see [ADR-380](../../docs/adrs/ADR-380-agntcy-outshift-runtime-integration.md)):

1. **Package availability** — whether `@claude-flow/agntcy` (TS) and/or the Rust `ruflo-agntcy` crate are installed as `optionalDependencies`, or absent (the expected default today — no such upstream package exists yet publicly).
2. **Active transport** — local in-process (default) vs SLIM (opt-in, per ADR-380 §2), and which swarms/hive-mind sessions are on which transport.
3. **CASA enforcement state** — enabled/disabled, and for enabled tenants, the compiled intent envelope's `allow`/`deny`/`budget_usd`/`expires_at` currently in force (ADR-380 §3).
4. **IOC coordination events** — whether optional Layer 9 semantic events (ADR-380 §4) are wired on top of `hive-mind_broadcast`/`hive-mind_consensus`.
5. **Identity/observability** — whether AGNTCY OTel span attributes (`agent.identity`, `coordination.episode`, `authorization.decision`, etc., ADR-380 §5) are being emitted through `ruflo-observability`.

Until upstream AGNTCY/SLIM packages exist, this status check MUST report "not configured — see ADR-380" rather than fabricate a healthy status. No network call to AGNTCY infrastructure (Directory, SLIM broker) is safe to make from this skill until a real client library is available.
