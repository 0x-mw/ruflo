---
name: autopilot-status
description: 작업 완료 통계를 포함한 오토파일럿 진행 상황 간단 요약
---
$ARGUMENTS
Show autopilot progress. Calls `autopilot_status` and `autopilot_progress` via MCP.

Displays:
- Enabled/disabled state
- Iteration count vs max
- Elapsed time vs timeout
- Task completion by source (team-tasks, swarm-tasks, file-checklist)
- Overall completion percentage

For detailed task breakdown, use `autopilot_progress`. For event log, use `autopilot_log`.
