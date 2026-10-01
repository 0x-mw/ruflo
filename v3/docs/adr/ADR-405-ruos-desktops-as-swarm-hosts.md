# ADR 405: ruOS Desktops as Swarm Execution Hosts

Status: Proposed

Date: 2026 10 01

Related: ADR 150 (removable integrations), ADR 324 (policy chokepoint), ADR 325 (claims plane), ruOS ADR-043 (exec literal filter), ruOS ADR-053 (per-tenant SSH :2222), ruOS ADR-070 (the desktop executor has no peer authentication), ruOS ADR-071 (remote MCP endpoint)

## Context

ruOS gives each user their own cloud Linux desktops (Fly machines), plus enrolled Macs and PCs. A ruflo swarm can only place agents on the local machine today. Users with ruOS desktops want swarm agents to run there: the desktop has its own disk, toolchain, `claude` CLI and LLM route, and the user can watch it.

There are three ways into a ruOS desktop. They have different trust properties:

| Path | Authentication | Usable from |
|---|---|---|
| ruOS fleet MCP (`desktop_status`, `desktop_exec`, `desktop_start`, `desktop_stop`, `desktop_keepawake`) | The caller's tenant credential. The fleet enforces machine ownership on every call. | Anywhere |
| sshd on `:2222` (ruOS ADR-053 Phase 2) | Pubkey-only, with a per-tenant ed25519 key minted by the fleet. `authorized_keys` is replaced with that tenant's key each time the desktop is armed. | Only inside the Fly 6PN, so only from another of the same tenant's desktops |
| Desktop executor on `:17870` | None per tenant. It is guarded only by a spoofable `Host` header, binds all interfaces, and every tenant shares one flat Fly 6PN app (ruOS ADR-070). | Any machine on the 6PN |

## Decision

### Host model

A ruOS desktop is a remote execution host for one or more ruflo swarm agents. The `ruflo-ruos` plugin places an agent on a host, launches `claude -p` there detached, streams its output back, and records the agent in ruflo's swarm state. The swarm topology, routing and coordination stay local. The desktop only runs the agent process.

### Transports

Two transports are allowed, both implemented in `plugins/ruflo-ruos/scripts/lib/`:

1. **The fleet MCP** (`fleet-mcp.mjs`). This is the default and the only control plane, used for discovery, start, stop and keepawake. In a Claude Code session the user's connected `mcp__ruos__*` tools are used directly. A terminal run reads `RUOS_MCP_URL` and `RUOS_MCP_TOKEN` from the environment. Neither value is embedded or defaulted. With either unset the CLI exits 2 with `not-configured` and makes no request. The client refuses plain `http` (except localhost) and any URL on port 17870.
2. **Per-tenant SSH on `:2222`** (`ssh.mjs`). It is opt-in (`--transport ssh`, `RUOS_SSH_KEY`) and works only when ruflo itself runs on one of the same tenant's ruOS desktops. `ssh` is spawned with a fixed argv and `shell: false`, with `BatchMode`, `IdentitiesOnly` and `StrictHostKeyChecking=accept-new`. The host is derived from the validated Fly machine id: `<fly-id>.vm.<app>.internal`. ADR-053 records that arming is probabilistic, so `Permission denied (publickey)` maps to `auth-expired` ("desktop not armed with this key").

The `:17870` executor is excluded. Any path that called it from a ruflo swarm would extend ADR-070's cross-tenant shell exposure into ruflo. The plugin sends no `Host` header and opens no connection to that port, and its smoke contract greps for any use of it. If ruOS ADR-070 lands per-request fleet authentication on the executor, a follow-up ADR can reconsider; until then the fleet MCP is the boundary.

### Command construction

Every shell string sent to a desktop comes from one audited module, `command-builder.mjs`. The same strings go over both transports.

- Each command is one line of at most 4000 bytes, the `desktop_exec` limit.
- The only variable regions are:
  - a run id matching `^[a-z0-9][a-z0-9-]{5,62}$`;
  - integers;
  - a model name from a fixed enum;
  - a canonicalised budget number;
  - base64 text inside single quotes.
- Prompt text travels only as base64. It is appended to a file in chunks, decoded on the desktop, and fed to `claude -p` on stdin, so no shell ever parses it.
- The decoded prompt's sha256 is checked against the local hash before the run is trusted.
- Output returns as `RUOS_POLL:<exit>:<size>:<alive>:<base64 slice>`, so arbitrary bytes survive the JSON tool result. Only whole base64 quanta are decoded, so a truncated result never skips bytes. The `alive` flag (`kill -0` on the pid) detects a runner killed before it wrote its exit code.
- Run files live in `~/.ruflo-ruos/runs/<runId>/` with `umask 077`. The exit code is written atomically (`tmp` + `mv`), so a poll never reads a half-written file.
- The runner starts as `nohup setsid sh -c '<constant>'`. Stop signals its process group, after re-validating the pid file as digits on the desktop.

The ADR-043 literal filter passes these commands: `nohup`, `setsid` and `sh -c` are not on its denylist. That filter is a mistake guard, not a sandbox. The fleet's ownership check is the boundary.

### Swarm state and claims

The plugin does not add a claims system or an agent store. ADR-325 already describes four disconnected claim mechanisms. This plugin uses ruflo's local work-ownership board, the `claims_*` MCP tools (`.claude-flow/claims/claims.json`), which is ADR-325's "work ownership" responsibility in single-node form.

| What | ruflo tool (called in-process via `callMCPTool`, so ADR-324 policy applies) |
|---|---|
| Register a remote agent | `agent_spawn` with `domain: "ruos"`, `config.host = {kind:"ruos", desktopId, desktopName, transport, runId}` |
| Running / done | `agent_update` (`busy` → `idle`, `config.lastRemoteResult`) |
| Ownership of the run | `claims_claim` / `claims_release`, issue `ruos-run-<runId>`, claimant `agent:<agentId>:<agentType>` |

The plugin itself owns only `.claude-flow/ruos/`:

- `events.jsonl` holds lifecycle events carrying ids, sizes and states, never prompt or output text.
- `hosts.json` is a snapshot of hosts and their agents.
- `runs/<runId>.log` is a local copy of the output, mode 0600.

The swarm pane (`ruflo-swarm`) reads agents with `config.host.kind === "ruos"` plus these two files. If the CLI cannot be resolved, or policy denies a call, the ledger degrades to the plugin files and reports `swarmLedger: "unavailable"`. A remote run is never aborted because bookkeeping failed.

### Cost and auto-stop

- Starting a desktop is billable. The adapter starts one only with an explicit `--start`, and then waits for a fresh `last_heartbeat_at`, not `ready`.
- The fleet stops cloud desktops at 23:00 America/Toronto every weekday. `desktop_keepawake` blocks idle autosleep but does not override that stop. The adapter computes the next stop with `Intl`, so DST is handled. A run whose timeout crosses it is refused unless the user passes `--ignore-autostop`.
- At launch the adapter calls `desktop_keepawake` for the run's timeout plus 5 minutes.
- Polls back off from 1 s to 5 s. Each poll is an audited `desktop_exec` that waits behind the desktop's run lock.

### Deploy hand-off

After a run, `deploy-info` reports a repo's branch, HEAD, dirty count and commits ahead of upstream on the desktop. It never pushes or deploys. ruOS's exec filter refuses `git push` and `fly deploy` literals by design, and the deploy decision stays with the user.

### Removability (ADR-150 style)

- ruflo works identically when the plugin is absent. The PR changes no file under `v3/`, apart from this ADR.
- The plugin has no npm dependencies.
- The ruflo CLI is resolved at runtime and is optional.
- The `$.ruos` and `$.ruflo` Claude Code mod nouns are feature-detected and never required.

## Failure modes

Each failure surfaces as a typed `RuosError` code:

| Failure | Detection | Code |
|---|---|---|
| Fleet credential expired or revoked | HTTP 401/403, or a tool error mentioning auth | `auth-expired` |
| Fleet unreachable | `fetch` network error | `network-down` |
| Request hangs | `AbortSignal.timeout` | `timeout` |
| Desktop stopped before the run | Heartbeat not fresh, and `--start` not given | `desktop-stopped` |
| Desktop stopped mid-run (23:00 stop, idle autosleep) | A poll fails, then `desktop_status` shows the desktop down | `auto-stopped` |
| Run would cross the auto-stop | `checkWindow` | `autostop-window` |
| Desktop not the caller's | Not in `desktop_status` | `not-owned` |
| Prompt corrupted in transit | sha256 mismatch | `remote-error` |
| `claude` missing on the desktop | `RUOS_NO_RUNNER` | `remote-error` |
| SSH key not armed | ssh exit 255 + `publickey` | `auth-expired` |
| Run outlives its timeout | Wall-clock check; the process group is stopped | `timeout` |
| Runner killed without an exit code | Poll shows `alive=0` and no exit code, twice | `remote-error` |

On every failure the agent is set `idle` and the claim is released.

## Threat model

| Threat | Mitigation |
|---|---|
| Cross-tenant shell via `:17870` | Transport excluded. Smoke check 4. Client refuses the port. |
| Acting on another tenant's desktop | Ids resolve only against the caller's own `desktop_status`. The fleet re-checks ownership on every call. |
| Shell injection from task text (including a prompt-injected agent writing the task) | Base64-only payloads. One builder. Tests run hostile prompts through a real `/bin/sh`. |
| Injection via ids, model, budget, offset or repo path | Allow-list regexes. Canonical numbers. `..` and leading `-` refused. |
| Credential leakage | Bearer token and SSH key path come only from the environment. They are never logged or written to events. |
| Prompt or output leakage into shared state | Events carry ids and sizes only. Output is kept in a 0600 local file and a 0700 remote run dir. |
| Accidental spend | No start without `--start`. Auto-stop window check. `--max-budget-usd` passes through to `claude -p`. |
| Destructive operations | `stop` and `desktop-stop` require `--confirm`. No delete or provision verbs. |
| Silent success (cognitum#620 pattern) | Every run needs a positive exit code from the desktop. A missing run dir or a missing pid is an error. |

Residual risk: the remote `claude -p` runs with the desktop user's full trust. That is the user's own desktop, and its tool permissions are governed by its own Claude Code settings.

## Consequences

**Positive:**
- Swarm agents can run on the user's own ruOS desktops, visible in the swarm pane.
- No new trust path is added.
- Swarm state stays one source of truth.

**Negative:**
- Streaming is poll-based, because `desktop_exec` is request/response. Each poll costs one audited fleet call.
- SSH works only desktop-to-desktop.
- The fleet MCP's `desktop_exec` output shape is normalised defensively (`stdout|output`, `exit_code|exitCode`). A change on the ruOS side is caught by the live check, not by unit tests.

## Verification

- `bash plugins/ruflo-ruos/scripts/smoke.sh` runs the structural checks, the no-`:17870` grep, an offline exit-2 check, and the full `node --test` suite.
- The suite includes London-school adapter tests, transport failure typing with injected `fetch` and `spawn`, injection tests, real-`/bin/sh` execution of the builder output, and an integration test against the in-tree CLI's real `agent_spawn` and `claims_*` tools.
- The live end-to-end and benchmark results are recorded in the PR.
