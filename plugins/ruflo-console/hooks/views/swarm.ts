import type { RenderElement } from 'claude-code'

import { clip, col, kv, picture, rule, text, THEME, type Ctx } from './common'
import { MAX_NODES } from './frames'

const STATUS_COLOR = (status: string): string | undefined =>
  /busy|active|running/i.test(status) ? THEME.warn : /error|fail/i.test(status) ? THEME.bad : /stop|terminat|offline/i.test(status) ? undefined : THEME.info

/**
 * The swarm as ruflo wrote it: a graph of its members with the leader marked, the agents' states, and the hive's votes.
 * The tile board with per-agent buttons is ruflo-swarm's pane; this view links to it rather than drawing a second one.
 */
export function swarmView(ctx: Ctx): RenderElement {
  const snap = ctx.state.snapshot
  const swarm = snap?.swarm ?? null
  const hive = snap?.hive ?? null
  const agents = swarm !== null && swarm.agentIds.length > 0 ? (snap?.agents ?? []).filter(agent => swarm.agentIds.includes(agent.id)) : (snap?.agents ?? [])
  const rows: RenderElement[] = [rule(ctx, 'Swarm', swarm?.id ?? '')]

  if (snap === null) {
    return text(ctx, 'reading ruflo state…', { dimColor: true })
  }

  if (swarm === null && hive === null && agents.length === 0) {
    rows.push(text(ctx, 'No swarm on disk here. `npx ruflo swarm init --topology hierarchical` starts one; it shows here within seconds.', { dimColor: true }))

    return ctx.kit.Box({ flexDirection: 'column', key: 'swarm', children: rows })
  }

  rows.push(kv(ctx, 'topology', swarm === null ? `${hive?.topology ?? 'n/a'} (hive-mind)` : `${swarm.topology}${swarm.strategy !== undefined ? ` · ${swarm.strategy}` : ''} · ${swarm.status}${swarm.maxAgents !== undefined ? ` · max ${swarm.maxAgents}` : ''}`))
  rows.push(picture(ctx, 'topology', `graph needs a terminal: ${agents.length} agents`))
  rows.push(text(ctx, '★ leader · ● idle (blue) · busy (yellow) · stopped (grey) — pulses run to agents ruflo marks busy; the leader breathing is decoration', { dimColor: true }))

  rows.push(rule(ctx, 'Agents', `${agents.length}${agents.length > MAX_NODES - 1 ? `, graph shows ${MAX_NODES - 1}` : ''}`))

  for (const agent of agents.slice(0, 8)) {
    rows.push(
      ctx.kit.Box({
        flexDirection: 'row',
        children: [
          ctx.kit.Text({ color: STATUS_COLOR(agent.status) ?? 'suggestion', ...(STATUS_COLOR(agent.status) === undefined && { dimColor: true }), children: '● ' }),
          ctx.kit.Text({
            wrap: 'truncate-end',
            children: clip(
              `${(agent.name ?? agent.type).padEnd(12)} ${agent.type.padEnd(12)} ${agent.status.padEnd(10)} tasks ${agent.taskCount ?? 'n/a'} · health ${agent.health === undefined ? 'n/a' : `${Math.round(agent.health * 100)}%`} · ${agent.id}`,
              ctx.columns - 2,
            ),
          }),
        ],
      }),
    )
  }

  if (agents.length > 8) rows.push(text(ctx, `+${agents.length - 8} more`, { dimColor: true }))

  rows.push(rule(ctx, 'Hive-mind', hive === null ? 'not initialised' : `${hive.strategy ?? 'consensus'}${hive.queen !== undefined ? ` · queen ${hive.queen}` : ''}`))

  if (hive === null) {
    rows.push(text(ctx, 'n/a — `npx ruflo hive-mind init` for queen-led consensus', { dimColor: true }))
  } else {
    for (const proposal of hive.pending.slice(-3)) {
      rows.push(text(ctx, `◇ ${proposal.type} (${proposal.strategy}) ${proposal.status} · for ${proposal.votesFor} · against ${proposal.votesAgainst} · ${proposal.id}`, { color: THEME.warn }))
    }

    for (const decision of hive.history.slice(-2)) {
      rows.push(text(ctx, `◆ ${decision.type} → ${decision.result} · for ${decision.votesFor} · against ${decision.votesAgainst}`, { dimColor: true }))
    }

    if (hive.pending.length === 0 && hive.history.length === 0) rows.push(text(ctx, 'no proposals yet', { dimColor: true }))
  }

  rows.push(text(ctx, 'Tile board, agent buttons and voting: /ruflo-swarm-pane (ruflo-swarm)', { dimColor: true }))

  return col(ctx, rows, 'swarm')
}
