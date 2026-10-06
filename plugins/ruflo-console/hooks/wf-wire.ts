/**
 * The Workflows page's one wiring point (ADR-464), kept out of the controller (its 500-line limit): bindings.ts calls
 * `wireWorkflows(state, host)` once, where the state and the built host both exist. It hands each feature the host it cannot get
 * from a slot's environment, and registers what runs after every read of the run folders (views/../wf-live.ts `afterRead`):
 * the mission-event ledger, the saved views, and the cost and guard figures. Every hook is isolated: one that throws leaves the rest.
 */
import type { Host } from './host'
import type { State } from './state'
import { refreshWfGuards } from './wf-cost-live'
import { bindWorkflowDrill } from './wf-drill'
import { afterRead } from './wf-live'
import { syncSavedViews } from './wf-saved-live'
import { recordRunEvents } from './views/wf-guide'
import { setExportFs } from './views/wf-export'
import { wireWfAnatole } from './views/wf-anatole'
import { wireWfTemplates } from './views/wf-templates'
import { wireWfWorktrees } from './views/wf-worktrees'

let isWired = false

export function wireWorkflows(state: State, host: Host): void {
  bindWorkflowDrill(state, host)
  setExportFs(host.fs)
  wireWfWorktrees(state, host)
  wireWfTemplates(state, host)
  wireWfAnatole(state, host)

  if (isWired) return

  isWired = true
  afterRead.push(
    (s, h, before, runs, nowMs) => void recordRunEvents(s, h, before, runs, nowMs),
    (s, h, _before, _runs, nowMs) => syncSavedViews(s, h, nowMs),
    (s, h, _before, _runs, nowMs) => refreshWfGuards(s, h, false, nowMs),
  )
}
