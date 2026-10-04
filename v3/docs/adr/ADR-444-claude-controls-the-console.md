# ADR 444: Claude controls the console: model tools, an autonomy level and a live dashboard

Status: Proposed

Date: 2026 10 05

Scope: `plugins/ruflo-console` (new `model-tools.ts`, `views/control.ts`; `register.ts`, `settings.ts`, `state.ts`, `scripts/smoke.sh`, `scripts/e2e-control.sh`)

Builds on: ADR-406 (missions), ADR-443 (missions and Claude), the console's palette and confirm-gated runner

## 1. Why

The console sends commands and guidance to Claude Code. The reverse is as useful: tell Claude "set up a mission", "open the Learning Lab", "run the security scan" and have it drive the console, with the cockpit showing what it does, the way computer use shows a screen being operated. Everything the console can do for a person already goes through one surface (pages, fields, palette entries, a confirm step), so Claude can use the same surface.

## 2. What was checked

A throwaway mod registered a tool with `$.tool.register` and answered it from a `tool.call` hook. In this Claude Code build (2.1.x) the tool is listed to the model as `mcp__<plugin>__<name>` even in `claude -p`, and the call ran. The result must be a **string** (an object is refused by the tool's schema check). Not yet checked: behaviour with several tools in one turn and how permission dialogs look for them; the end-to-end check (`scripts/e2e-control.sh`) covers the first.

## 3. Decision

Four tools, `mcp__ruflo-console__` plus:

- `console_state`: the page, the readable text of what is on screen (capped, control characters stripped, with a note that third-party text is data), the palette entries (id and label), the pending confirm, the last result and the control settings.
- `console_open {view}`: go to a page and open the pane without taking the keys.
- `console_set {field, value}`: fill a field the pages have (`goal`, `profile`, `rigor`, `research.question|depth|cap`, `dev.<field>`, `cost.budget`).
- `console_run {id, text?}`: run a palette entry, the same ids `/ruflo run` takes.

**How much Claude may do is a setting**, off by default:

| Level | Claude may |
|---|---|
| `off` | nothing; the tools are not registered |
| `read` | read the state, open pages, run read-only entries |
| `write` | also fill fields and run entries that write locally |
| `manage` | also run entries that touch the network (install, update, push) |
| `full` | also run entries that spend money or delete or stop things (deploys, cancellations, resets) |

and a second setting, **confirm**: `ask` (default) leaves every non-read action pending in the console's own confirm row for the person to answer; `auto` lets Claude's call confirm itself, within the level. An entry's class is read from its spec (read-only flag, label, command and note); an entry that cannot be classified counts as the most dangerous class, so it needs `full`.

**The cockpit is the dashboard.** An "Claude control" section on Overview shows the level and confirm mode, whether control is on or paused, the call count, and a log of the last actions with their outcome (ok, waiting for you, refused, failed). A **Take back control** button pauses every tool at once (the next call is refused with that reason) and **Give control back** resumes. The log is the audit trail for a session.

**Limits that hold at every level:** a cap of 40 console actions per turn; text values capped at 500 characters; the console's existing checks still run (AIDefence on mission text, fixed argv, the budget and hard-stop settings of ruflo-mods); nothing here can pass a value to a shell. A level lower than an entry needs, or `paused`, refuses with the reason and the setting to change; it never partly runs.

## 4. Consequences

- The console's smoke contract said the console never answers `tool.call`. That is narrowed on purpose: only `hooks/model-tools.ts` may, only for names starting `mcp__ruflo-console__`, never `tool.check`. The smoke step checks it.
- The registered tools add a few hundred tokens to every request in a session where control is on, which is why it is off by default.
- Claude Code's own permission system still applies to these tools: an unlisted tool prompts the person. The console level is a second, independent limit.
- Environment `RUFLO_CONSOLE_CONTROL=<level>:<ask|auto>` sets both for one session without touching saved settings (recordings, tests).

## 5. Not decided here

- A separate human-confirm channel through Claude Code's permission dialog for `ask` mode.
- Per-entry allow lists; the level is coarse by design.
- Driving panes other than the console's own.
