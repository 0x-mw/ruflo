# ruflo-console

ruflo's cockpit inside Claude Code: the `/ruflo` command, its pages, and a band above the prompt. It reads ruflo's own files; anything it cannot measure reads `n/a`. Design notes: ADR-407 (cockpit), ADR-448 (the Room), ADR-446 (plugin mods).

## Room and Mods

Open it with `/ruflo room` (menu: Safety → The Room).

- **Waiting for a yes**: the one confirm that is pending, with the seconds left to answer it.
- **The feed**: events, Claude's console actions and what you said, newest first. Filter by who, search, pause, page back. **⛔ blocked** shows only what was refused or failed: Claude's actions the control log marked denied or error, and events that say denied. Press a line to open it; an event that came from a page of its own (swarm, claims, learning, plugins, missions) offers a jump button to that page.
- **Mods**: one line per plugin mod that has written `.claude-flow/<name>-mod/status.json`. Press a line for its detail: what it guards (the file's own `summary`), guard, calls, blocked, the *class* of its last refusal (`secret`, `destructive`, `path`, `network`, `policy`, `other`; the refused text is never kept), `modVersion`, session start, last write, file age, and a stale marker when the last write was an earlier session.

A status file is data, not instructions: it is size-capped, shape-checked (`version: 1` only), and every string is stripped of control and bidi characters and cut to length before it is drawn. `summary`, `modVersion` and `lastDenied` are optional; a mod that does not write them shows "not reported".
