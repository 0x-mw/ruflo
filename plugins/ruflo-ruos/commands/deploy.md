---
name: deploy
description: ruOS 데스크톱에서 스웜이 끝난 뒤의 읽기 전용 배포 인계 — 배포될 내용을 보고하며 절대 푸시하지 않음
---
$ARGUMENTS

After a remote swarm run, report the state of a repo on the desktop so the user can
decide on a deploy:

`node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" deploy-info --desktop "<ref>" --repo <path-relative-to-$HOME>`

It returns branch, HEAD, dirty file count and commits ahead of upstream. The hand-off is:

- a branch or PR;
- this summary, for a human to review, merge and deploy.

The swarm is read-only for deploys. It never pushes, merges, deploys or publishes, and ruOS has no deploy tool to call. Present the summary and stop.
