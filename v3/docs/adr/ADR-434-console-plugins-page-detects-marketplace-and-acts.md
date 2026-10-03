# ADR 434: The Plugins page detects the marketplace, and can act on plugins

Status: Accepted (ships in ruflo-console 0.26.0)

Date: 2026 10 03

Scope: `plugins/ruflo-console`: `hooks/plugin-ops.ts` (new), `hooks/views/plugins.ts`, `hooks/views/steps.ts`, `hooks/bindings.ts` (`plugin`), `hooks/views/common.ts` (`Actions.plugin`), `tests/plugin-ops.spec.ts` (new).

## 1. The bug

The page's "Start here: get the ruflo plugins" card showed "1. Add the ruflo marketplace" as the next step even when the marketplace was added. The page body read `known_marketplaces.json` correctly; the card's step simply had no `done` check, so it could never see it. Step 1 now checks the marketplace list; step 2 is "Install a ruflo plugin" and is done once a plugin from the ruflo marketplace is installed, so the card goes away when both are true. A spec calls `stepsRows` directly (a first version asserted on the page text, which does not include the card, and passed with the fix removed; it now fails without it).

## 2. Capabilities added

- **Update the marketplace** (primary button when the clone is stale): `claude plugin marketplace update ruflo`.
- **Installed plugins** (folded): each ruflo plugin with its state (● enabled, ○ disabled) and version, and `update` and `enable`/`disable` buttons.
- **Available to install**: what the clone lists that is not installed, each with an `install` button (twelve shown, the rest in the Plugin Catalog; open when nothing is installed yet).
- Every one asks first (the confirm row shows the exact `claude plugin ...` command and whether it touches the network) and runs one fixed argv, always `<name>@ruflo`, never another marketplace's plugin. The name must be one lowercase plugin-shaped word, so nothing can be smuggled into the argv (spec). An install verifies against the installed records afterwards. Changes load in the next session.

## 3. Not proven

The commands were checked against `claude plugin --help`, not run (they write Claude Code's plugin records and use the network). Enable and disable have no verification (the snapshot reads enablement from settings, which a run does not re-read).
