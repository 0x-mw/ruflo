import type { BudgetLevel } from './cost/budget'
import type { EditRecord } from './learn/insights'
import type { Ownable } from './ownership'
import type { RouteResult } from './route/route-task'

/**
 * What the mod knows during one process, shared by its features. In memory
 * only: it dies with the process, as the classic handshake variable does.
 */
export type ModState = {
  /** The session's project root, where the classic helpers keep their files. */
  root: string
  owned: ReadonlySet<Ownable>
  statusLine: boolean
  lastRoute?: RouteResult
  routed: number
  tightened: number
  observed: number
  edits: EditRecord[]
  editCount: number
  policy: 'none' | 'legacy' | 'observe' | 'enforce' | 'unreadable'
  budget: { level: BudgetLevel; usd?: number; limit?: number }
}

export function createState(): ModState {
  return {
    root: '.',
    owned: new Set(),
    statusLine: false,
    routed: 0,
    tightened: 0,
    observed: 0,
    edits: [],
    editCount: 0,
    policy: 'none',
    budget: { level: 'OK' },
  }
}

/** A path under the session's project root. */
export const under = (s: ModState, relative: string) => `${s.root}/${relative}`

/** The one status line under the prompt. */
export function statusText(s: ModState): string {
  const parts = ['ruflo']
  if (s.lastRoute) {
    const pct = Math.round(s.lastRoute.confidence * 100)
    parts.push(s.lastRoute.matched ? `${s.lastRoute.agent} ${pct}%` : `no route (${pct}%)`)
  }
  if (s.editCount) parts.push(`${s.editCount} edit${s.editCount === 1 ? '' : 's'}`)
  if (s.policy !== 'none' && s.policy !== 'legacy') parts.push(`policy ${s.policy}`)
  if (s.tightened) parts.push(`${s.tightened} tightened`)
  if (s.budget.limit !== undefined && s.budget.level !== 'OK') parts.push(`budget ${s.budget.level}`)
  return parts.join(' · ')
}

/** What `/ruflo-mods` prints. */
export function report(s: ModState): string {
  const route = s.lastRoute
    ? `${s.lastRoute.agent} (${(s.lastRoute.confidence * 100).toFixed(0)}%, ${s.lastRoute.matched ? 'matched' : 'no match'})`
    : 'none yet'
  const budget =
    s.budget.limit === undefined
      ? 'off (set the costBudgetUsd option)'
      : `${s.budget.level}: $${(s.budget.usd ?? 0).toFixed(2)} of $${s.budget.limit.toFixed(2)}`
  return [
    'ruflo mods (ADR-404, early access)',
    `  owns:        ${[...s.owned].join(', ') || 'nothing (classic hooks keep every event)'}`,
    `  routed:      ${s.routed} prompt(s); last ${route}`,
    `  edits:       ${s.editCount} recorded, ${s.edits.length} pending write`,
    `  policy:      ${s.policy}; ${s.tightened} call(s) tightened, ${s.observed} observed`,
    `  budget:      ${budget}`,
  ].join('\n')
}
