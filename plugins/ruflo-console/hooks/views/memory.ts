import type { RenderElement } from 'claude-code'

import type { MemoryStats, Namespaces } from '../data/cli'
import { ago, col, count, kv, live, pct, rule, sourceLine, text, THEME, type Ctx } from './common'

const LADDER = [0.5, 0.75, 0.9, 1] as const

/** The budget ladder as a text bar: marks at 50/75/90/100% of the limit, the spend filled to where it stands. */
export function ladder(usd: number, limit: number, width: number): string {
  const cells = Math.max(10, width)
  const at = Math.min(cells, Math.round((usd / limit) * cells))
  const marks = new Set(LADDER.map(step => Math.min(cells - 1, Math.round(step * cells) - 1)))

  return Array.from({ length: cells }, (_, i) => (marks.has(i) ? '│' : i < at ? '█' : '·')).join('')
}

/** AgentDB counts and namespaces from the ruflo CLI, and this session's spend against the ruflo-mods budget ladder. */
export function memoryView(ctx: Ctx): RenderElement {
  const { state, nowMs } = ctx
  const memory = live<MemoryStats>(state.probes.get('memory'))
  const spaces = live<Namespaces>(state.probes.get('namespaces'))
  const budget = state.ruflo.snapshot?.budget
  const spend = state.usage?.costUsd
  const rows: RenderElement[] = [rule(ctx, 'AgentDB', memory?.backend ?? '')]

  if (memory === null) {
    rows.push(text(ctx, sourceLine(state.probes.get('memory'), nowMs, 'memory stats').text, { dimColor: true }))
  } else {
    rows.push(kv(ctx, 'entries', `${count(memory.total)} · ${count(memory.vectors)} with vectors`))
    rows.push(kv(ctx, 'storage', memory.storage ?? 'n/a'))
    rows.push(kv(ctx, 'span', `oldest ${ago(memory.oldestMs, nowMs)} · newest ${ago(memory.newestMs, nowMs)}`))
  }

  rows.push(rule(ctx, 'Namespaces', spaces === null ? '' : `newest ${spaces.sampled} entries`))

  if (spaces === null) {
    rows.push(text(ctx, sourceLine(state.probes.get('namespaces'), nowMs, 'memory list').text, { dimColor: true }))
  } else if (spaces.byName.length === 0) {
    rows.push(text(ctx, 'no entries', { dimColor: true }))
  } else {
    const top = spaces.byName[0]?.count ?? 1
    const width = Math.max(4, Math.min(30, ctx.columns - 30))

    for (const space of spaces.byName.slice(0, 6)) {
      rows.push(text(ctx, `${space.name.slice(0, 20).padEnd(21)}${'█'.repeat(Math.max(1, Math.round((space.count / top) * width)))} ${space.count}`))
    }

    rows.push(text(ctx, 'a sample: counts over the newest entries `memory list` returns, not the whole store', { dimColor: true }))
  }

  rows.push(rule(ctx, 'Cost', 'this session'))
  rows.push(kv(ctx, 'session spend', spend === undefined ? 'n/a — Claude Code did not report a cost' : `$${spend.toFixed(3)}`))
  rows.push(kv(ctx, 'context', state.usage?.contextPercent === undefined ? 'n/a' : `${Math.round(state.usage.contextPercent)}% of the window`))

  if (budget === undefined) {
    rows.push(kv(ctx, 'budget', state.ruflo.snapshot === null ? 'n/a — ruflo-mods not seated' : 'none set (ruflo-mods costBudgetUsd = 0)'))
  } else {
    const used = budget.usd ?? spend
    const color = budget.level === 'OK' || budget.level === 'INFO' ? THEME.ok : budget.level === 'WARNING' ? THEME.warn : THEME.bad

    rows.push(kv(ctx, 'budget', `${budget.level} · ${used === undefined ? 'n/a' : `$${used.toFixed(2)}`} of $${budget.limit.toFixed(2)} (${used === undefined ? 'n/a' : pct(used / budget.limit)})`, color))

    if (used !== undefined) rows.push(text(ctx, `${' '.repeat(17)}${ladder(used, budget.limit, Math.min(40, ctx.columns - 20))}  50·75·90·100%`, { color }))
  }

  return col(ctx, rows, 'memory')
}
