---
name: ruflo-loop
description: Ruflo 백그라운드 워커(audit, optimize, testgaps 등)를 반복 일정으로 시작
---
$ARGUMENTS
Start a cache-aware /loop worker. Parse the worker name from $ARGUMENTS.

Available workers (12 total):
- **audit** (critical) -- security scanning
- **optimize** (high) -- performance optimization
- **ultralearn** (normal) -- deep knowledge acquisition
- **predict** (normal) -- predictive preloading
- **map** (normal) -- codebase mapping
- **deepdive** (normal) -- deep code analysis
- **document** (normal) -- auto-documentation
- **refactor** (normal) -- refactoring suggestions
- **benchmark** (normal) -- performance benchmarking
- **testgaps** (normal) -- test coverage analysis
- **consolidate** (low) -- memory consolidation
- **preload** (low) -- resource preloading

Run the worker via `npx @claude-flow/cli@latest hooks worker dispatch --trigger WORKER_NAME`, then use `ScheduleWakeup` with delay 270s (cache-warm) to schedule the next iteration.
