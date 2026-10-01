---
name: deploy
description: Read-only deploy hand-off after a swarm finishes on a ruOS desktop — report what would ship, never push
---
$ARGUMENTS

After a remote swarm run, report the state of a repo on the desktop so the user can
decide on a deploy:

`node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" deploy-info --desktop "<ref>" --repo <path-relative-to-$HOME>`

It returns branch, HEAD, dirty file count and commits ahead of upstream. It does **not**
push, merge or deploy: ruOS's exec filter refuses `git push` / `fly deploy` literals by
design, and deploying is the user's decision through their own ruOS or project tooling.
Present the summary and stop.
