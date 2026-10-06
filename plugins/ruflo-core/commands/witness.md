---
name: witness
description: 시간 이력이 있는, 암호학적으로 서명된 수정 매니페스트를 관리하고 검증(ADR-103)
argument-hint: "init|regen|verify|history|regressions [--manifest <path>] [--history <path>]"
---

$ARGUMENTS

Run the appropriate witness sub-command. Defaults assume `verification.md.json` and `verification-history.jsonl` at the project root.

```bash
# Bootstrap (one-time per project)
node plugins/ruflo-core/scripts/witness/init.mjs

# Regen + append history (each release)
node plugins/ruflo-core/scripts/witness/regen.mjs \
  --manifest verification.md.json \
  --history  verification-history.jsonl \
  --fixes    witness-fixes.json

# Verify against live tree
node plugins/ruflo-core/scripts/witness/verify.mjs --manifest verification.md.json

# Verify without dependencies or generated dist/ artifacts
node plugins/ruflo-core/scripts/witness/verify.mjs \
  --manifest verification.md.json --source-only

# Temporal queries
node plugins/ruflo-core/scripts/witness/history.mjs --history verification-history.jsonl summary
node plugins/ruflo-core/scripts/witness/history.mjs --history verification-history.jsonl regressions
node plugins/ruflo-core/scripts/witness/history.mjs --history verification-history.jsonl timeline --id <fix-id>
```

See `plugins/ruflo-core/skills/witness/SKILL.md` for the full workflow + anti-patterns.
