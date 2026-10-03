# ADR 430: The main menu: an accent for each group, key chips, live badges and a palette strip

Status: Accepted (ships in ruflo-console 0.26.0)

Date: 2026 10 03

Decision owner: Ruflo maintainers

Scope: `plugins/ruflo-console`: `hooks/menu-style.ts` (new, pure), `hooks/views/menu.ts` (`GROUPS` exported; the group box, the key, the badge, the strip), `tests/menu-style.spec.ts` (new).

Extends: ADR 407 (the BBS look and its Main Menu), ADR 429 (the band, whose facts the badges share).

## 1. Context

The Main Menu is the first screen in the BBS look: five bordered groups, each a title, short sub-sections, and entries as a key and a button, under the mission strip and a red status bar. Every group was drawn the same, in one grey border and the one title colour, so the eye had nothing to find a group by, the keys (the fastest way in) looked like part of the label, and nothing on the menu said where anything was going on: approvals waiting, a mission under way and 235 high findings looked the same as an empty project.

## 2. Decision

In the BBS look:

- **An accent for each group.** Its border, a solid title bar (dark ink on the accent) and its key chips are in it: SWARM amber, INTELLIGENCE cyan, SAFETY & OPS red, NETWORK & EXTEND green, TOOLS violet.
- **Key chips.** The key of an entry is a solid chip in the group's accent, ` 1 `, instead of `(1)` in the label colour, so the keys read as the commands they are.
- **A palette strip** of the five accents across the top, as a BBS drew its palette.
- **Badges, in both looks.** An entry carries a short badge when there is something to say about the page it opens: approvals waiting (loud), alerts (`⚠ n`, loud), the mission's progress (`3/15`), busy agents (`▶ n`), claims, high or critical findings (`🔒 n`, loud only when one is critical), spend from a cent, a running terminal, an update not yet taken (`⬆ 0.27.0`, loud). They come from the facts the band above the prompt reads, so the two cannot disagree, and an entry with nothing to say gets none, never a zero.

The plain look keeps the theme's colours, with no accents, chips, strip or title bars, and gets the badges in the theme's warn and info colours.

Nothing moves: every part is static, so `fps: 0` and a terminal that redraws slowly lose nothing.

## 3. Colours

Every colour this adds is a step of the xterm 256-colour cube or its grey ramp, so it renders the same where a terminal has no truecolor, and in tmux (the console's Rasters render in 256 colours there). The ink on an accent is `#1c1c1c`; the spec holds its contrast to 4.5 against each of the five, which is the WCAG floor for text a person must read. The status bar's two colours, which were off the palette (`#8b1a1a` and `#ffd319`), moved to the nearest steps (`#870000`, `#ffd700`).

## 4. Alternatives considered

- **A cursor that moves over the entries with the arrow keys, the selected row filled.** Not done: it is a change in how the menu takes keys, with its own state and tests, and the keys already reach every page. It is the next thing to try, not part of this.
- **A gradient across the title bars.** Rejected: a Text takes one colour, so a gradient is a run of Texts per bar, for a small gain over a solid bar, and it breaks when the width changes.
- **Theme colour names for the accents.** Rejected: a theme can make them near each other, and an unknown name can make the host refuse the tree (ADR 429). The palette's own hexes are the same on every theme.
- **Showing a zero for an empty badge.** Rejected, as on the band: a part with nothing to say is left out.

## 5. What this does not prove

It has not been seen. The spec holds the colours, the contrast and what a badge says; the layout is in the kit tests (which need the `claude-code/testing` host package and run in CI) and the real screen. Two things to look at first: a group's title bar and chips against a **light** terminal background (the bar and chips carry their own ground, but a badge and the sub-section rules are drawn on the terminal's), and the width of the longest entry with its badge at the narrowest two-column pane.

## 6. Tests

`tests/menu-style.spec.ts` (9): every group has an accent and no accent is without a group; the palette is the accents in menu order; every colour is on the 256 palette; the ink on each accent has contrast 4.5 or more and no two groups share a colour; the spec's own checks fail on a colour off the palette and on ink that cannot be read; an empty state has no badges; approvals and alerts are loud and claims are information on the pages they open; spend shows only from a cent, findings only when high or critical (loud only for critical), a running terminal, and an update not yet taken; and only pages that exist are badged.

## 7. Amendment: the strip moves, and the search finds what is on a page

- **The palette strip is animated.** It is now a picture (`palettePicture`, registered by `picturesOf` for the menu in the BBS look), not a row of Texts: one block of each accent across the width and a band of light that sweeps along it and starts again, about 28 cells a second, three cells a frame at the default 8 fps. Being a picture, it moves with the frame loop that already runs for the menu's other pictures, and costs one element, not one per cell. At `t` = 0 the light is off the strip and the cells are exactly the accents, so with `fps: 0` it draws that still strip; a surface that cannot draw pictures gets the Text strip as before. It is decoration and carries no data.
- **The menu lists every page, but the search finds only pages.** Checked: all 26 pages and the three commands (palette, help, log off) are on the menu, none missing and none unknown. The menu prompt and the nav search match a page's name, key, group and one-line description, so a feature that is a section of a page (sentries, the loop manager, Updates in Settings, AIDefence) was not found by its own name. The descriptions of Security, Settings and Automation now name them, and `tests/nav-state.spec.ts` holds that searching for `sentries`, `doctor`, `aidefence`, `updates`, `loops`, `autopilot` and `kanban` finds the page each is on (which found one more gap, `aidefence`, when first run).
- **Tests:** `tests/diagrams.spec.ts` (4): one row of blocks, exactly the colours at rest, a band that brightens only the cells it is on, moves about three cells a frame and starts again, and survives a tiny width and no colours; `tests/pure.spec.ts`: the strip is on the BBS menu only, as wide as the menu's rows, and still at fps 0.
