---
name: ruos-host-run
description: 테넌트 인증 플릿 MCP를 통해 사용자 본인의 ruOS 클라우드 데스크톱에서 ruflo 스웜 에이전트를 실행하고, 출력을 스트리밍하며, ruflo의 스웜 상태에 기록합니다. 사용자가 ruOS 데스크톱에서 에이전트를 실행하려 하거나, "내 ruOS 데스크톱에서 이거 실행해"("run this on my ruOS desktop")라고 하거나, 스웜 에이전트를 원격 ruOS 호스트에 배치할 때 사용합니다.
argument-hint: "<desktop> <task>"
allowed-tools: Bash(node *) mcp__ruos__desktop_status mcp__ruos__desktop_exec mcp__ruos__desktop_keepawake mcp__ruos__desktop_start mcp__ruos__llm_route_get
---
# Run a ruflo agent on a ruOS desktop (session path, ADR-405)

Transport rules — non-negotiable:
- Use ONLY the fleet MCP tools (`mcp__ruos__*`, or the claude.ai ruOS connector's
  equivalents) or the plugin CLI. Never call a desktop on port 17870 and never set a
  `Host` header yourself (ruOS ADR-070: that executor has no per-tenant auth).
- Send ONLY the command strings printed by `cli.mjs build`. Never compose a
  `desktop_exec` command from task text.

`CLI` below is `node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs"`.

`desktop_exec` output is framed: the first line echoes your command (`▶ run: …`), and the
last lines are `✓ SUCCESS…` and `📝 transcript:`. Every marker the desktop prints is
`RUOS<nonce>_NAME`, on its own line, where `<nonce>` is the `nonce` from `CLI build`. That
token never appears in the echoed command, so match only complete lines that start with it.
Output is capped at about 4 KiB, so `poll` returns 2 KiB slices.
Never call `desktop_delete` or `secret_delete`; deleting is the user's job.

1. **Pick the host.** Call `desktop_status`. Resolve the user's desktop by `machine_id`,
   `fly_machine_id` or exact `display_name`; if it is not in that list, stop. Save the raw
   JSON to a temp file (`status.json`) for step 4.
2. **Liveness.** A desktop is up only if `heartbeat_status` is not `asleep`/`missing`/`stale`
   and `last_heartbeat_at` is recent. If it is down, ask before `desktop_start` (billable),
   then re-poll `desktop_status` until the heartbeat advances.
3. **Auto-stop.** `CLI status` prints `nextAutoStop` (weekday 23:00 America/Toronto). If the
   run could cross it, tell the user and stop unless they accept. `desktop_keepawake` blocks
   idle autosleep only; it does not override the 23:00 stop.
4. **Build + record.** Write the task to a file, then:
   - `CLI build --prompt-file task.txt [--model sonnet]` → JSON with `runId`, `steps[]`,
     `poll`, `stop`, `promptSha256`.
   - `CLI record start --run <runId> --desktop "<ref>" --desktop-status-file status.json --task "<one-line summary>"`
     — registers the agent through ruflo's `agent_spawn` (with `config.host`) and claims
     `ruos-run-<runId>` via `claims_claim`.
   Before launching, call `llm_route_get`. Stop if the desktop has no route. If the gateway is
   "unconfigured" but the route is "shared", warn and continue.
5. **Launch.** Call `desktop_exec` with each `steps[i]` in order (`machine` = the desktop's
   `fly_machine_id`). The last step prints `RUOS<nonce>_SHA:<hash>` — it must equal
   `promptSha256`, else `desktop_exec` the `stop` string and abort. `RUOS<nonce>_NO_RUNNER` means
   `claude` is not installed there.
6. **Stream.** Call `desktop_exec` with `poll` (rebuild with `CLI build --run <runId> --nonce <nonce> --offset <n> ...`
   as the offset grows, or use `CLI run` for automatic polling). Output is
   `RUOS<nonce>_POLL:<exit|->:<size>:<alive 0|1>:<base64>`; pass the base64 to
   `CLI record output --run <runId> --b64 <b64>` and show the decoded text. Back off 1s→5s
   between empty polls — each poll is audited on ruOS and serialises behind the desktop's
   run lock.
7. **Finish.** When exit is not `-` and all bytes are read:
   `CLI record end --run <runId> --exit <code>` (agent → idle, claim released).
   On failure, check `desktop_status`: a stopped desktop means it was auto-stopped mid-run.
8. **Stop early** only on the user's request: `desktop_exec` the `stop` string.

For unattended runs from a terminal, `CLI run --desktop "<ref>" --prompt-file task.txt`
does steps 1–7 itself (needs `RUOS_MCP_URL` + `RUOS_MCP_TOKEN`, or `--transport ssh` with
`RUOS_SSH_KEY` when ruflo runs on a same-tenant ruOS desktop).
