# ADR 432: A data-driven cyberpunk boot log, and Refresh that replays it

Status: Accepted (ships in ruflo-console 0.26.0)

Date: 2026 10 03

Decision owner: Ruflo maintainers

Scope: `plugins/ruflo-console`: `hooks/boot-facts.ts` (new), `hooks/gfx/boot-cyber.ts` (new), `hooks/gfx/boot.ts`, `hooks/views/frames.ts`, `hooks/bindings.ts` (`restart`), `hooks/views/pane.ts`, `tests/boot-cyber.spec.ts` (new).

Extends: ADR 426 (the self-check the log reports), ADR 430 (the menu's look).

## 1. Decision

- **The log under the sign is an uplink drawn from real data.** A title strip scrambles into place (`RUV.NET // RUVECTOR CONSTELLATION`, rUv, the console version and git build); the ruvector constellation (ruflo, agentdb, sona, ruvector, rvf, ruvllm, rulake, ruqu, rvdna) is drawn as stars and lines; a signal row cycles the project's real numbers (agents, claims, tasks, patterns, plugins, missions); a scan grid lists the 26 console areas with the self-check's verdict; READY closes it.
- **Nothing is invented.** A star is lit only if `boot-facts` found evidence (the CLI version probe, the memory and intelligence probes, the installed-plugin list, the neural and SONA files); a dark star says why. A data pulse runs only along a line whose two ends are both lit. READY says `ALL STARS ALIGNED` only when every star is lit and every area verified; otherwise it counts failed areas and dark stars.
- **Reproducible.** Motion is a function of the age and a hash, never `Math.random`.
- **An easter egg** sits mid-boot (2.4 to 3.8 s): a ghost signal of the binary for `rUv` that decodes byte by byte.
- **Fallback.** Under 64 columns, or without room for the title, scan grid and READY, the plain log is drawn as before.
- **Refresh restarts the intro.** The footer Refresh button and the `r` key now reset the boot clock (so the intro plays again, in the BBS look with the boot option on) and then do the full re-read. The Cost page's own "Refresh cost" button and `/ruflo refresh` stay plain re-reads.

## 2. What this does not prove

Seen only through `Grid` text in specs, not on a terminal. The constellation's evidence is by plugin name (`ruflo-ruvector`, `ruflo-rvf`, `ruflo-ruvllm`, `rulake*`, `ruqu*`, `rvdna*`), so a package installed another way reads as dark.

## 3. Tests

`tests/boot-cyber.spec.ts` (8): evidence lights stars, READY matches the evidence, the egg's window, determinism and scramble, the narrow fallback, and the boot replaying from a reset clock.
