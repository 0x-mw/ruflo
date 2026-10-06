---
name: ruflo-schedule
description: CronCreate로 영속 워커를 예약
---
$ARGUMENTS
Schedule a persistent background worker using CronCreate.

Usage: /schedule <worker> [cron-expression]

Workers: audit, map, optimize, consolidate, testgaps, predict, document, benchmark.

Default cron expressions:
- audit, testgaps: `*/15 * * * *`
- optimize, map: `*/30 * * * *`
- consolidate, document: `0 * * * *`

Example: /schedule audit */15 * * * *
Creates: `CronCreate("audit", "*/15 * * * *", "Run security audit worker")`
