---
name: harness-mint
description: "`metaharness new <name> --template <id> --host <id>`로 사용자 지정 AI 에이전트 하네스를 스캐폴딩합니다. --confirm을 넘기지 않으면 기본은 드라이런(쓰기 없음)입니다. 호출한 저장소 루트와 그 내부 어디에도 쓰기를 거부합니다. ADR-150 아키텍처 제약과 ruflo의 \"파괴적 작업 확인\"(\"destructive-action confirmation\") 패턴을 준수합니다."
argument-hint: "--name <id> --template <vertical:coding|minimal|…> [--host claude-code|codex|…] [--target /abs/path] [--confirm] [--format table|json]"
allowed-tools: Bash
---

The one write-capable skill in the plugin. Every other skill is
pure-read. This one calls `metaharness new`, which writes a new
directory tree.

## Safety (load-bearing)

1. **Dry-run by default.** Without `--confirm`, the script prints what
   it would do and exits 0 without touching disk.
2. **Refuses project root.** If `--target` resolves to the current
   working directory OR any path inside it, the script errors out with
   exit 2. Target must be an absolute path OUTSIDE the calling repo
   (default is a fresh `/tmp/ruflo-mint-<ts>-<name>/` dir).
3. **Refuses existing target.** Won't overwrite — must scaffold into a
   non-existent dir.
4. **Subprocess + 60s timeout.** No library import, no in-process
   execution. The mint stays sandboxed from ruflo's runtime.

## Algorithm

Implementation: [`scripts/mint.mjs`](../../scripts/mint.mjs).

1. Validate `--name`, `--template`. Default `--host` to `claude-code`.
2. Resolve `--target` (default: temp dir).
3. Run safety checks (no project-root writes; target must not exist).
4. Without `--confirm`: emit dry-run plan, exit 0.
5. With `--confirm`: shell `npx metaharness new <name> --template <id>
   --host <id> --target <abs> --yes`.

## Templates

`minimal`, `vertical:coding`, `vertical:devops`, `vertical:support`,
`vertical:legal`, `vertical:research`, `vertical:trading`, `vertical:health`,
`vertical:education`, `vertical:sales`, `vertical:business`,
`vertical:crm`, `vertical:marketing`, `vertical:advertising`,
`vertical:ai`, `vertical:agentics`, `vertical:ruview`, `vertical:gaming`,
`vertical:repo-maintainer`, `vertical:exotic`.

## Hosts

`claude-code`, `codex`, `pi-dev`, `hermes`, `openclaw`, `rvm`,
`copilot`, `opencode`, `github-actions`.

## Example dry-run

```
$ node scripts/mint.mjs --name my-harness --template vertical:coding --host claude-code
# harness-mint (dry-run)

- action: metaharness new
- name: my-harness
- template: vertical:coding
- host: claude-code
- target: /tmp/ruflo-mint-1718560000-my-harness
- confirm: false
- willWrite: false

Re-run with `--confirm` to actually scaffold.
```

## Why dry-run by default

Ruflo's behavioral rules say "executing actions with care" — destructive
or repo-touching actions need confirmation. The dry-run output makes the
WHAT visible before the WHEN. A human sees `target`, decides, then
adds `--confirm` if happy.
