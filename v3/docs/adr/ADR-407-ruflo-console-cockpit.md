# ADR 407: The ruflo-console cockpit: interface, AI terminal and safety contract

Status: Accepted (sections 9–11 in progress)

Date: 2026 10 02

Decision owner: Ruflo maintainers

Scope: the `ruflo-console` Claude Code mod (`plugins/ruflo-console`): its pane layout, BBS look, boot screen, main menu, band, AI terminal, x.ruv.io board, Skills, Hive-Mind and MetaHarness lab, and the rules every view follows

Extends: ADR 404 (Ruflo as a Claude Code mod) and ADR 406 (mission control through compatible mods, §8 interface modes). Preserves ADR 150 (MetaHarness stays removable) and the repository rule that systems may propose and evaluate but never self-promote.

## 1. Decision

The console is the person's cockpit for a ruflo project inside Claude Code: one `/ruflo` command, a docked pane of views, and a band above the prompt. It reads ruflo's files and the CLI's local JSON. It acts only through fixed argv, and every change is confirmed first. It reaches the network only when the person turns it on or asks for something that needs it. This ADR records the contract that the 0.2–0.6 releases converged on, so that later views keep to it.

## 2. Frame and layout

Every page draws, top to bottom:
1. **Banner**: the animated RUFLO logo with the project name.
2. **Wildcat strip**: `RUFLO x.ruv.io AGENTS WELCOME.` and `NETWORKS: …`.
3. **Tabs**: emoji tabs with hotkeys. A view without a hotkey (`key: ''`) is a tab without one, reached by name.
4. **Block title**: the view's name in two-row half-block art.
5. **Blurb**: `>> icon NAME :: what it is for`.
6. **Body**.
7. **Confirm row**: shown only when an ask is pending.
8. **Footer**: link status, keys, and buttons.

**Compact only inline.** A pane goes compact only when it is *inline* and shorter than the view asks (`isCompactPane`). Compact drops the banner and the spacing, and moves the controls above the body. It keeps the block title and the blurb.

**The dock never goes compact, because it scrolls.** In 0.6.0 the dock went compact on the taller views (Swarm, Claims, Plugins, Learning, Terminal, x.ruv.io, Main Menu), which lost their banner and title while the shorter views kept theirs. That inconsistency is what this rule removes (0.6.2).

## 3. Look, colour and motion

**Look.** `look: 'bbs'` (default) is the neon BBS look. `plain` uses the terminal theme's own colours.

**Colours sit on the xterm‑256 cube where it matters.** Claude Code draws Rasters in 256 colours in some terminals. In tmux the pane emitted `48;5;n` codes, and off-cube dark tints collapsed to brown and grey there. Light is **added** to the wall, never blended into it. Tubes are pink `#d7005f`, yellow `#d7af00` and cyan `#00afd7`, each with a white-hot core.

**Motion must mean data.** A dot runs to a busy agent, a cell pulses after a vote, a cursor blinks while an agent writes back. The boot screen is the one decoration, and it ends by itself.

**Boot screen.** About 3–6 s, shown when the pane opens:
- ATDT, then CONNECT.
- The RuFlo neon sign (`ruflo/assets/ruflo-small.jpeg` drawn in cells: frame on clips and wires, yellow tube lettering, cyan wave badge, brick wall) strikes up tube by tube.
- Each tube cell materialises out of random letters, and the lit sign occasionally glitches (a row slips, cells flash to noise).
- A LOADING bar fills from elapsed time and from the first ruflo reads.

## 4. Main menu

In the BBS look the cockpit lands on the Main Menu, both for a bare `/ruflo` and for auto-open. `/ruflo <view>` still opens that view.

The menu shows:
- **Banner and title**: the banner and a `RUFLO BBS` block title.
- **Host line**: `x.ruv.io ■ Main Menu ■ github.com/ruvnet/ruflo`.
- **Four bordered groups**, each with sub-sections:
  - SWARM: live, work, watch
  - INTELLIGENCE: learn, remember, spend
  - NETWORK & EXTEND: federate, extend
  - TOOLS: run, session
- **Status bar**: a red modem-style bar with this project's live facts and an `Online mm:ss` clock.
- **Prompt**: a `(1:1)` prompt that takes a key or a name. `?` gives help and `O` logs off.

## 5. Band above the prompt

The band says what is happening now, most urgent first, so a narrow band truncates the least useful parts:
1. What needs a person (approvals, warn/bad alerts).
2. Who is working on what and for how long (`▶ coder on <task> 2m`).
3. The AI terminal's runs (`💻 codex answering 1m`).
4. The newest event while it is under a minute old.
5. When nothing moves: `idle · N agents ready · last activity 3m ago`.
6. Standing context last: claims, then this session's spend.

Totals (patterns learned, router picks) live in their own views, not on the band.

## 6. AI terminal

The terminal view is a conversation with **codex**, **claude**, a **swarm** of both at once, or one **ruflo** CLI command.

**Sessions.** Each agent keeps a session per project, saved under `$.store` as `ruflo-console/term:<cwd>`. Only id-shaped strings come back from the store, since each becomes an argv element. A follow-up carries the context:
- codex: `codex exec --json --sandbox read-only --skip-git-repo-check -`, then `codex exec resume --json -c sandbox_mode="read-only" <thread> -`.
- claude: `claude -p --output-format stream-json --verbose --include-partial-messages --permission-mode plan --max-budget-usd 1`, with `--session-id <uuid>` the first time and `--resume <uuid>` after.

**Prompt safety.** The person's text reaches an agent on **stdin, never as an argument**, so it cannot be read as a flag. ruflo commands are split into words with no shell.

**Streaming.** Output is read through `$.process.spawn` (`hooks/stream.ts`):
- claude's answer types out from text deltas.
- Commands, file changes and tool calls show as they run.
- Each turn ends with its cost and token count.
- If a stream ends with events but no answer drawn, the terminal says the format may have changed.
- Every run is capped at ten minutes, and `s` stops it.

**Spending.** Starting or resuming a session is asked once: Enter shows the exact command, and Enter again runs it. An empty Enter also confirms, because the engine empties the field on submit. After that the session is live and Enter sends. A ruflo command is asked every time.

**Keys.** The field takes the keys when the view opens and after a harness pick (`$.ui.focus`). `/codex`, `/claude`, `/swarm`, `/ruflo` and `/new` work from inside the field.

## 7. x.ruv.io board

A BBS main menu of what the open federation offers: join, roster, sync, work claims, channels, registry, and the admin-only invites, admit and publish. `▸ open` puts the matching `ruflo federation …` command into the terminal; it does not run it.

The registry and the roster come from the network, so they run only with `federationNetwork` on. Third-party text is labelled unvetted.

## 8. Actions and authority

Every change goes through the runner as one fixed argv and is confirmed first. The confirm row prints the exact command line (`ActionSpec.shows`) and notes any cost. Reads run at once.

The console never promotes, publishes or expands its own authority. MetaHarness promotion is shown as a command for the person to run, never offered as a one-key action from the pane.

## 9. Skills (in progress)

A Skills view on the `npx skills` CLI:
- installed skills (`skills ls --json`, project and global)
- search (`skills find`, text output parsed)
- add, remove, update and init, each confirmed first
- "edit", which hands the skill to the AI terminal

It has no hotkey and is reached from the menu or by name.

## 10. Hive-Mind (in progress)

A dedicated Hive-Mind view. Functionally:
- queen and members
- consensus strategy, quorum and fault tolerance (byzantine f < n/3, raft f < n/2)
- proposals with tallies against the required votes, and their history
- confirmed vote, propose and broadcast actions through the hive-mind MCP tools

Visually, a honeycomb Raster in which a cell pulses only after that member's vote. The Swarm view keeps a one-line summary.

## 11. MetaHarness lab (in progress)

Full coverage of the `metaharness` surface, in three tiers:
- **Inspect ($0, read-only, runs at once):** genome, mcp-scan, threat-model, gepa, bench verify, drift and audit-trend.
- **Audit and compare (confirmed):** oia-audit and similarity.
- **Evolve and test (confirmed, cost labelled):** redblue (mock judge by default), learn (dry-run by default), evolve, security-bench and flywheel run.

Promotion stays out of the pane (§8). Each capability also has a palette id, so it works headless.

## 12. Release gates

A console change ships only when all of these hold:
- `npx tsc -p .`, `claude plugin test .` and `scripts/smoke.sh` pass, along with the vitest specs.
- `plugin.json` is bumped, because the install cache changes only on a version change.
- After merge, the person's installed copy is updated (`claude plugin marketplace update ruflo`, then `claude plugin update ruflo-console@ruflo`) and checked by grepping the cache.
- The tour GIF is re-recorded from a live pane: `~/Pictures/ruflo/ruflo-console-tour-neon.gif` and `docs/assets/ruflo-console-tour.gif`.

The recording driver aborts rather than type into Claude's own prompt. It never presses Enter unless that prompt is empty.

## 13. Consequences

- One frame contract for every view makes consistency testable. A docked short pane must still draw its banner and title, and a kit test asserts that.
- The AI terminal spends money on the person's own plans. It mitigates that with confirm-once-per-session, read-only and plan modes, a per-turn budget cap and a ten-minute cap.
- The 256-colour constraint limits the palette, but the cockpit reads the same in every terminal.

## 14. Sources

- `plugins/ruflo-console/hooks/{state,harness,stream,bindings,controller}.ts`, `hooks/views/{pane,frames,menu,bar,terminal,xruv}.ts`, `hooks/gfx/{neon,boot,pictures}.ts`
- PRs #3625–#3632 (band, BBS look, Wildcat round, neon boot, AI terminal, compact and focus fixes)
