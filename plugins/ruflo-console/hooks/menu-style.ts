/**
 * The main menu's colours and live badges, pure (the menu that draws them is views/menu.ts). Each group has an accent: its border, a
 * solid title bar and its key chips are drawn in it, the way a BBS menu set its sections apart. The colours are from the xterm
 * 256-colour cube and grey ramp (so they render the same where a terminal has no truecolor, and in tmux), and the ink on an accent
 * has contrast enough to read: tests/menu-style.spec.ts checks both. An entry also carries a badge when there is something to say
 * about it (approvals waiting, a mission under way, findings, an update), from the same facts the band above the prompt reads; an
 * entry with nothing to say gets none, never a zero.
 */
import { activeMission, progressOf } from './mission-control'
import { alertsOf, approvalsOf } from './data/alerts'
import { secMemo } from './secure'
import type { State, ViewId } from './state'
import { money } from './views/bar'

/** The ink on an accent's solid bar, and the muted ink for a badge that is only information. */
export const INK = '#1c1c1c'
export const MUTED = '#8a8a8a'
export const LOUD = '#ffaf00'

/** One accent per menu group, by the group's title. */
export const ACCENT: Readonly<Record<string, string>> = {
  SWARM: '#ffaf00',
  INTELLIGENCE: '#5fd7ff',
  'SAFETY & OPS': '#ff5f5f',
  'NETWORK & EXTEND': '#5fd75f',
  TOOLS: '#d787ff',
}

/** The palette strip above the groups: the accents in menu order. */
export const PALETTE: readonly string[] = ['#ffaf00', '#5fd7ff', '#ff5f5f', '#5fd75f', '#d787ff']

export type Badge = { text: string; tone: 'attention' | 'plain' }

/**
 * What an entry of the menu has to say right now, by the page it opens. Only entries with something to say appear. Attention is for
 * what needs a person (approvals, alerts, critical findings, an update); the rest is information.
 */
export function badgesOf(state: State, nowMs: number): Partial<Record<ViewId, Badge>> {
  const out: Partial<Record<ViewId, Badge>> = {}
  const snap = state.snapshot
  const approvals = approvalsOf(state).length
  const alerts = alertsOf(state, nowMs, state.loadedAtMs).filter(alert => alert.level !== 'info').length
  const mission = activeMission(state)
  const busy = snap?.agents.filter(agent => /busy|active|working/i.test(agent.status)).length ?? 0
  const claims = snap?.claims.length ?? 0
  const findings = secMemo(state).findings
  const serious = findings === null ? 0 : findings.counts.critical + findings.counts.high

  if (mission !== null && !mission.cancelled) {
    const { done, total } = progressOf(mission, snap?.tasks ?? [])

    if (total > 0 && done < total) out.missions = { text: `${done}/${total}`, tone: 'plain' }
  }

  if (approvals > 0) out.approvals = { text: String(approvals), tone: 'attention' }
  if (alerts > 0) out.overview = { text: `⚠ ${alerts}`, tone: 'attention' }
  if (busy > 0) out.swarm = { text: `▶ ${busy}`, tone: 'plain' }
  if (claims > 0) out.claims = { text: String(claims), tone: 'plain' }
  if (findings !== null && serious > 0) out.secure = { text: `🔒 ${serious}`, tone: findings.counts.critical > 0 ? 'attention' : 'plain' }
  if (state.usage?.costUsd !== undefined && state.usage.costUsd >= 0.01) out.cost = { text: money(state.usage.costUsd), tone: 'plain' }
  if (state.terminal.runs.size > 0) out.terminal = { text: '●', tone: 'plain' }
  if (state.updateAvailable !== '') out.settings = { text: `⬆ ${state.updateAvailable}`, tone: 'attention' }

  return out
}
