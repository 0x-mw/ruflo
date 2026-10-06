---
name: watch
description: 스웜 이벤트와 에이전트 활동을 실시간으로 라이브 스트리밍
---
$ARGUMENTS

Start a live event stream for the active swarm. Use the Monitor tool to run:

`npx @claude-flow/cli@latest swarm watch --stream`

Each line is an NDJSON event (agent spawn, task update, memory write, health ping). Notifications arrive as events occur -- no polling needed.

For one-shot status checks, use `/status` or `npx @claude-flow/cli@latest swarm status` instead.
