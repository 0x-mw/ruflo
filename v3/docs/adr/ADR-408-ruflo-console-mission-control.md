# ADR 408: Mission Control in the ruflo-console cockpit

Status: Accepted

Date: 2026 10 02

Decision owner: Ruflo maintainers

Scope: the Missions view and the main menu's mission strip in `plugins/ruflo-console` (0.11.0): the planner, the mission and task writes, how work reaches the primary Claude Code session, Claude's guidance, the band, and the nav hotkeys.

Extends: ADR 406 (mission records and the `session-bound` executor) and ADR 407 (the cockpit and its safety contract).

## 1. Decision

A goal typed into the cockpit becomes a **SPARC plan** (a goal-oriented action planner, no model, no writes), then, on confirmation, a governed **mission** (`mission_create`, `mission_plan`) with one ruflo **task** per plan node (`task_create`, tagged `mission:<id>`, `task:<tN>`, `phase:<S|P|A|R|C|X>`). The **primary Claude Code session** does the work, one task at a time, as a visible prompt. The ruflo task store is the one authority for execution state: the console reads it and never infers it.

## 2. One lifecycle for every mission

Whatever the kind of work, a plan runs the same lifecycle, in order: **Research → Create (specification, design, ADRs and the SOP) → Build → Test → Validate → Secure → Benchmark → Learn**.

- *Lean* is the core only (specify or reproduce, design, tests first, build, test, validate).
- *Standard* runs the whole lifecycle: it adds research of prior art and existing ADRs, recording the decisions as ADRs with an SOP, review, a security review, a benchmark against the baseline, and Learn.
- *Thorough* adds documentation, a threat model and the full benchmark and ADR set for every kind.
- Bug fixes skip the ADR and benchmark stages. Research missions end in Learn (the findings stored as patterns).
- **Learn** stores the validated outcome (memory and trajectory) and trains routing on it, so the next mission starts better (self-optimization). It needs the work to be validated first, so it is the last step.

The planner (`hooks/goap.ts`) is A* over fact sets: actions have preconditions, effects and costs; the task graph is read off the preconditions, so independent branches (research beside specification, pseudocode beside architecture) share a wave. It is pure and deterministic. The plan is accepted by the real `mission_plan` (checked against the CLI).

## 3. How work reaches Claude

- **Next task** asks first (it starts a model turn), marks the task `in_progress`, and submits one visible prompt naming the ruflo task id, the role, what done means, and how to record it (`task_complete` with evidence in its result, or `task_update` failed). Auto-run hands over the next ready task when Claude is idle.
- **Ask aside** uses `/btw` (run when idle; prepared in the prompt box while a turn runs). **Guide Claude** is a visible instruction, asked first. **Control**: pause, resume and cancel are the console's own ledger (a session-bound mission has no durable executor to pause).
- `submit` and `slash` calls run from a clock tick, never inside a `command.run` hook (`/ruflo yes` is one): the host refuses that, because it would wait on the turn the hook holds.
- The **ruflo-goals skills** (goal-plan, horizon-track, deep-research, research-synthesize, dossier-collect) are mission options, run as `/ruflo-goals:<skill>` in the main UI; a skill is offered only when the session lists its command.

## 4. Claude's guidance (`claude -p`)

After a goal is entered and planned, `claude -p` (plan mode, read-only, the per-turn budget and model from Settings, a fresh session) is given the goal, the plan, the lifecycle and what this installation can do (the ruflo plugins and skills the session offers, the AI settings) and asked for guidance by lifecycle stage, with the exact ruflo agents, plugins, skills, MCP tools and commands to bring in, then suggestions the plan does not use and risks. It costs a model turn, so it **asks first**, under the goal; **Always accept** runs it at once; **Mission guidance** in Settings turns it off. The answer streams into a collapsible section, stripped of escape and control characters, capped at 400 lines and five minutes.

## 5. Where the confirm sits

An ask is drawn **under the field or controls that raised it** (scope `goal`, `controls`, `guide`; Hive-Mind's ACT menu likewise), not at the top of the page, so the person never hunts for it. Each field keeps what was last entered: **✎ edit** puts it back in the box to change and send again.

## 6. Surfaces

- **Main menu**: Mission Control leads the page (progress and next task with run-next and pause, or the goal field); Missions is the first option, key **1**.
- **Band**: `🎯 done/total · tN title (1)` for the active mission, paused when paused, gone when done or cancelled.
- **Missions view** tabs: Plan, Tasks, Agents, Evidence, Record (the ADR 406 observation).
- **Hotkeys**: every view has one (a button takes one digit or lowercase letter): 0 Main Menu, 1 Missions, 2 Overview, 3 Swarm, 4 Claims, 5 Federation, 6 Plugins, 7 Learning, 8 MetaHarness, 9 Memory, then letters (c Cost, g Timeline, q Approvals, e Events, w x.ruv.io, i Terminal, b Hive-Mind, z Skills, u Security, f Performance, a Automation, l Learning Lab, v Vector Lab, t Self-Evolution, d Dev Tools, m Plugin Catalog, s Settings). No view takes `p x r h j k y n o` (footer, confirm, scrolling, the menu prompt). A view's own keys win while it is open; its tab and the menu still reach the others.

## 7. Safety

Writes are confirm-gated with the exact argv. Remembered actions are not offered for mission writes or AI turns. AI turns are read-only, in plan mode, under the budget. No secrets are shown. Mission and task text is data: drawn as text, never as markup or commands.

## 8. Consequences

- The planner is testable without a model (`tests/goap.spec.ts`, `tests/mission-control.spec.ts`, `tests/mission-guidance.spec.ts`, `tests/nav.spec.ts`, `tests/missions.test.ts`).
- Pause and resume do not stop a running Claude turn; they only stop the console handing out the next task.
- Hotkeys collide with a view's own keys inside that view by design; the tab bar shows the ten digit views and a core set of letter views, and the menu lists every area with its key.

## 9. Launch to-do, AIDefence and capabilities (0.12.0)

- **NEXT STEP to-do** sits directly under the goal and holds everything the person does next, in order: goal planned, AIDefence screen, Claude guidance, create the mission, hand tasks to Claude. The first open step is marked and carries a primary button; the confirm each step raises is drawn inside the box. The bottom create row is gone.
- **AIDefence screen** (`aidefence_is_safe`, `aidefence_has_pii` through `ruflo mcp exec`, local, $0) checks the goal and the guide text. Unsafe blocks guidance and creation; PII blocks guidance (a model would see it); an unavailable detector warns and does not block. A toggle turns it off.
- **Capabilities** lists every other ruflo plugin the session offers (ruOS, AIDefence, SPARC, swarm, ADRs, ...) as slash commands run on the goal in the main Claude UI, mission-relevant plugins first. Nothing a plugin provides is interpreted.

## 10. Every section reaches the Claude UI, and the regression matrix (0.13.0)

- **✦ Ask Claude** is in every page's footer (`hooks/ask-claude.ts`, `VIEW_ASK` has a row per view): the view's own text (what `/ruflo dump <view>` prints) goes to the primary session as a visible prompt, or a `/btw` aside, with a question (the view's default, or `/ruflo ask <question>`). It asks first with the exact text and a spend note; mid-turn it only fills the prompt box. The screen's lines are quoted data (each behind `│`, so none can start a command), secrets are redacted first (keys, tokens, JWTs, bearer headers, PEM blocks, NAME=value of a secret name), the terminal and Settings share nothing, and a typed question is screened by AIDefence.
- **▸ /plugin:command** appears beside it when the session lists the command of the ruflo plugin that fits the view (cost, security audit, swarm, memory, ...); it asks first.
- **Plugin map and Launch section (0.14.0).** `hooks/plugin-map.ts` gives each directory under `plugins/` one owning section, or says why it is reached from the Plugin Catalog only (domain plugins that can spend or write devices, and the console itself); `tests/plugin-coverage.spec.ts` fails on an unmapped plugin, a stale entry or a home that is not a view. Every section ends with a folded **Launch** section (`views/launch.ts`) listing the slash commands of the plugins it owns that the session lists; each button asks first, then runs the command in the main Claude UI (mid-turn it only fills the prompt box). A section whose plugins are not loaded draws nothing; the page redraws when the command list arrives.
- **Regression matrix** (`tests/matrix.test.ts`): every view, at 80 and 150 columns, draws without error text, names itself, has no duplicate element keys, and its Ask button asks first and then sends exactly one prompt (quoted data, no secret). `tests/ask-claude.spec.ts` covers the table, the scrubber and delivery. `scripts/e2e-smoke.sh` opens every view in a real Claude Code with no AI turn and no write (live only with `RUFLO_E2E_LIVE=1`, otherwise it skips). Smoke steps 14-16 run every pure spec, the e2e skip path and the table coverage.

## 11. Answers open where they were asked (0.13.1)

Memory Lab no longer keeps one Result block far from what was clicked. Each action records where it was raised (`memoryLab.origin`: Browse, Search, Entry, or a lab group) and its confirm (scope `mem:<area>`) and its result are drawn in a bordered panel directly under that area; the pane no longer draws that confirm at the top (`confirmInline`). An area with nothing asked or answered draws no panel. The lab groups are collapsible sections; the group of the last action stays open.
