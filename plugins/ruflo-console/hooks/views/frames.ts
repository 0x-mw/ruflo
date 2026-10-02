/**
 * The pictures of the view in front, by Raster key, for one instant. The render mounts them and the animation loop
 * blits them, both through `picturesOf`, so a frame is always the mounted size.
 */
import type { HarnessScore } from '../data/cli'
import type { Snapshot } from '../data/snapshot'
import { activityPicture, claimsPicture, curvePicture, scorePicture, topologyPicture, type ClaimBar, type TopoModel } from '../gfx/pictures'
import type { Grid } from '../gfx/raster'
import type { State } from '../state'
import { live } from './common'

export const MAX_NODES = 12
export const MAX_CLAIM_BARS = 8

/** The swarm as a graph: the hive's queen leads where there is one, else the swarm itself stands at the root. */
export function topoModelOf(snapshot: Snapshot | null): TopoModel | null {
  const swarm = snapshot?.swarm ?? null

  if (snapshot === null || (swarm === null && snapshot.hive === null && snapshot.agents.length === 0)) {
    return null
  }

  const members = swarm !== null && swarm.agentIds.length > 0 ? snapshot.agents.filter(agent => swarm.agentIds.includes(agent.id)) : snapshot.agents
  const leader = snapshot.hive?.queen !== undefined ? { id: snapshot.hive.queen, label: 'queen', status: 'leader', isLeader: true } : { id: swarm?.id ?? 'swarm', label: 'swarm', status: swarm?.status ?? 'unknown', isLeader: true }

  return {
    topology: swarm?.topology ?? snapshot.hive?.topology ?? 'hierarchical',
    nodes: [leader, ...members.slice(0, MAX_NODES - 1).map(agent => ({ id: agent.id, label: agent.name ?? agent.type, status: agent.status, isLeader: false }))],
  }
}

export function claimBarsOf(snapshot: Snapshot | null): ClaimBar[] {
  return (snapshot?.claims ?? []).slice(0, MAX_CLAIM_BARS).map(claim => ({
    label: claim.issueId,
    isStealable: claim.isStealable,
    ...(claim.claimedAtMs !== undefined && { claimedAtMs: claim.claimedAtMs }),
    ...(claim.expiresAtMs !== undefined && { expiresAtMs: claim.expiresAtMs }),
    ...(claim.progress !== undefined && { progress: claim.progress }),
  }))
}

/** Running success of routed outcomes, oldest first. */
export const curvePointsOf = (snapshot: Snapshot | null): boolean[] => (snapshot?.outcomes?.points ?? []).map(point => point.ok)

/** Rows the topology graph takes at a width: enough for a tree, more for a circle. */
export const topologyRows = (columns: number): number => (columns >= 90 ? 12 : 10)

/** When the score on screen was first drawn: the fill animates from there. Module-held, reset by a new value. */
const scoreShown = new WeakMap<object, number>()

export function picturesOf(state: State, columns: number, nowMs: number, t: number): Map<string, Grid> {
  const pictures = new Map<string, Grid>()
  const width = Math.max(20, Math.min(160, columns))
  const snapshot = state.snapshot

  switch (state.view) {
    case 'overview':
      pictures.set(
        'activity',
        activityPicture(
          [
            { label: 'tool calls/5s', values: state.activity },
            { label: 'state writes', values: state.writes },
          ],
          width,
          t,
        ),
      )
      break
    case 'swarm': {
      const model = topoModelOf(snapshot)

      if (model !== null) pictures.set('topology', topologyPicture(model, width, topologyRows(width), t))
      break
    }
    case 'claims': {
      const bars = claimBarsOf(snapshot)

      if (bars.length > 0) pictures.set('claims', claimsPicture(bars, width, bars.length, nowMs))
      break
    }
    case 'learning':
      pictures.set('curve', curvePicture(curvePointsOf(snapshot), width, 6, t))
      break
    case 'metaharness': {
      const score = live<HarnessScore>(state.probes.get('metaharness'))

      if (score !== null) {
        if (!scoreShown.has(score)) scoreShown.set(score, t)
        pictures.set('score', scorePicture(score.dims, width, t, scoreShown.get(score) ?? t))
      }
      break
    }
    default:
      break
  }

  return pictures
}
