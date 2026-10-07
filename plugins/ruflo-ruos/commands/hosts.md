---
name: hosts
description: 본인의 ruOS 데스크톱을 ruflo 스웜 호스트로 나열 — 상태, 활성 여부, 각 호스트에서 실행 중인 ruflo 에이전트
---
$ARGUMENTS

Show the caller's own ruOS desktops as candidate swarm hosts.

1. If the ruOS fleet MCP tools are connected in this session (`mcp__ruos__desktop_status`,
   or the claude.ai ruOS connector equivalent), call `desktop_status` and present each
   desktop's `display_name`, `machine_id`, `state` and `heartbeat_status`. `ready` is a
   provisioning flag, not liveness — only a recent `last_heartbeat_at` means "up".
2. Otherwise run the CLI path (needs `RUOS_MCP_URL` + `RUOS_MCP_TOKEN` in the environment;
   with them unset it exits 2 and makes no request):

   `node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" hosts`

3. Show which ruflo agents are placed on each desktop from
   `.claude-flow/ruos/hosts.json` and agents whose `config.host.kind` is `ruos`
   (`npx ruflo agent list`).

Mention the next weekday 23:00 America/Toronto auto-stop
(`node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" status` prints it). Never start a desktop
from this command.
