/**
 * The band above the prompt: one row naming what ruflo is doing here, with a mark that pulses while Claude works.
 * Each part is a fact on disk or n/a; a part with nothing to say is left out rather than shown as zero.
 * Parts come most-important first, so a narrow band truncates the least useful ones: what needs a person,
 * then the swarm, this session's spend, claims, the router's last pick, and what was learned since load.
 */
import type { RenderElement } from 'claude-code'

import { alertsOf, approvalsOf } from '../data/alerts'
import type { State } from '../state'
import { clip, count, type Kit } from './common'

export const BAR_KEY = 'mark'

export type BarPart = { text: string; tone: 'attention' | 'plain' }

/** The swarm in words: how many agents and how many are working, never "0/0". */
function swarmText(state: State): string | null {
  const snap = state.snapshot

  if (snap?.swarm == null) return null

  const total = snap.swarm.agentIds.length || snap.agents.length

  if (total === 0) return 'swarm, no agents'

  const busy = snap.agents.filter(agent => /busy|active/i.test(agent.status)).length

  return busy === 0 ? `${total} agent${total === 1 ? '' : 's'} idle` : `${busy}/${total} agents busy`
}

/** Dollars a person reads at a glance: cents under $100, whole dollars with separators above. */
export function money(usd: number): string {
  return usd < 100 ? `$${usd.toFixed(2)}` : `$${Math.round(usd).toLocaleString('en-US')}`
}

export function barParts(state: State, nowMs: number = Date.now()): BarPart[] {
  const snap = state.snapshot
  const parts: BarPart[] = []

  // What needs a person: approvals waiting and warn/bad alerts. Info alerts (a claim held for days) stay in the pane.
  const approvals = approvalsOf(state).length
  const alerts = alertsOf(state, nowMs, state.loadedAtMs).filter(alert => alert.level !== 'info').length

  if (approvals > 0) parts.push({ text: `${approvals} to approve (q)`, tone: 'attention' })
  if (alerts > 0) parts.push({ text: `⚠ ${alerts} alert${alerts === 1 ? '' : 's'}`, tone: 'attention' })

  const swarm = swarmText(state)

  if (swarm !== null) parts.push({ text: swarm, tone: 'plain' })
  if (state.usage?.costUsd !== undefined && state.usage.costUsd >= 0.01) parts.push({ text: `${money(state.usage.costUsd)} this session`, tone: 'plain' })

  const claims = snap?.claims ?? []

  if (claims.length > 0) {
    const stealable = claims.filter(claim => claim.isStealable).length

    parts.push({ text: `${claims.length} claim${claims.length === 1 ? '' : 's'}${stealable > 0 ? ` (${stealable} stealable)` : ''}`, tone: 'plain' })
  }

  if (state.ruflo.route !== null) parts.push({ text: `routed → ${state.ruflo.route.agent}`, tone: 'plain' })

  // Learning shows as growth since the console loaded; the running total lives in the Learning view (6).
  const patterns = state.history.patterns

  if (patterns.length > 1) {
    const learned = (patterns[patterns.length - 1] as { value: number }).value - (patterns[0] as { value: number }).value

    if (learned > 0) parts.push({ text: `+${count(learned)} learned`, tone: 'plain' })
  }

  return parts
}

/** The band's words, for `/ruflo status` and anything that wants it as one line. */
export function barText(state: State, nowMs: number = Date.now()): string {
  return ['ruflo', ...barParts(state, nowMs).map(part => part.text)].join(' · ')
}

export function barView(kit: Kit, state: State, columns: number, mark: RenderElement | null, onOpen: () => void): RenderElement {
  // A stale marketplace clone is one of the alerts, so it already turns the band's attention part on.
  const parts = barParts(state)
  let room = Math.max(8, columns - (state.pane.isOpen ? 4 : 22))
  const children: RenderElement[] = [mark !== null ? mark : kit.Text({ color: 'claude', children: '◆ ' }), kit.Text({ dimColor: true, children: 'ruflo' })]

  room -= 5

  for (const part of parts) {
    const words = ` · ${part.text}`

    if (room <= 3) break
    children.push(kit.Text({ wrap: 'truncate-end', ...(part.tone === 'attention' ? { color: 'warning' } : { dimColor: true }), children: clip(words, room) }))
    room -= words.length
  }

  if (!state.pane.isOpen) children.push(kit.Text({ children: '  ' }), kit.Button({ key: 'open-console', label: 'open console', plain: true, onPress: onOpen }))

  return kit.Box({ flexDirection: 'row', children })
}
