/**
 * Carries out a `/ruflo` intent (./commands) and answers the command's row. The pane's keys all have an intent here,
 * so everything works without focus. `mods` and `swarm <sub>` are passed on to the plugins that own them; when neither
 * answers, the row says which plugin to load rather than pretending.
 */
import { HELP, parseRuflo, type Intent } from './commands'
import type { Controller } from './controller'
import { median, p95 } from './controller'
import { plain } from './data/parse'
import { VIEWS, type State } from './state'
import { barText } from './views/bar'
import { viewText } from './views/pane'

export type Delegate = () => Promise<{ text?: string } | undefined>

/** The one-line answer of `/ruflo status`, with the measured render, refresh and frame costs. */
export function statusLine(state: State): string {
  const stat = (name: string, values: readonly number[]) => (values.length === 0 ? `${name} n/a` : `${name} median ${median(values)}ms p95 ${p95(values)}ms (n=${values.length})`)

  return [barText(state), stat('render', state.stats.renders), stat('refresh', state.stats.refreshes), stat('frame', state.stats.frames)].join(' · ')
}

const OWNER_HINT = {
  'ruflo-mods': 'ruflo-mods is not loaded in this session, so nothing answered `/ruflo mods`. Install it with `npx ruflo mods install` (or enable ruflo-mods@ruflo); its old `/ruflo-mods` command is the same report.',
  'ruflo-swarm': 'ruflo-swarm is not loaded in this session, so nothing answered `/ruflo swarm …`. Enable ruflo-swarm@ruflo; the Swarm view (/ruflo swarm) is the console\'s own.',
} as const

async function open(control: Controller, state: State, label: string): Promise<{ text: string }> {
  const opened = await control.open()

  return { text: opened.isPlaced ? `ruflo console: ${label}` : `The ruflo console could not be shown: ${opened.reason}` }
}

export async function dispatch(control: Controller, state: State, args: string, delegate: Delegate): Promise<{ text: string }> {
  const intent: Intent = parseRuflo(args)

  switch (intent.kind) {
    case 'open':
      if (intent.view !== null) control.setView(intent.view)

      return open(control, state, VIEWS.find(view => view.id === state.view)?.label ?? 'Agent')
    case 'help':
      return { text: HELP }
    case 'close':
      await control.close()

      return { text: 'ruflo console closed (/ruflo opens it again)' }
    case 'status':
      await control.refresh()

      return { text: statusLine(state) }
    case 'delegate': {
      try {
        const answer = await delegate()

        if (typeof answer?.text === 'string' && answer.text.trim() !== '') return { text: answer.text }
      } catch {
        // Nothing beneath answers this command: fall through to the hint.
      }

      return { text: OWNER_HINT[intent.owner] }
    }
    case 'palette':
      state.palette = { isOpen: true, query: plain(intent.query, 200), index: 0, context: 'all' }

      return open(control, state, 'palette')
    case 'run': {
      const isRun = control.actions.run(intent.paletteId, intent.text)

      if (!isRun) return { text: `No palette entry "${plain(intent.paletteId, 40)}" right now. /ruflo palette lists them; ids look like spawn-coder, claim-release, worker-audit, route.` }

      await control.open()

      return { text: state.pending !== null ? `Asked: ${state.pending.label}. Confirm with /ruflo yes (or y in the pane), cancel with /ruflo no.` : (state.outcome?.label ?? 'done') }
    }
    case 'confirm':
      if (state.pending === null) return { text: 'Nothing is waiting for a confirm.' }

      if (!intent.isYes) {
        control.runner.cancel()

        return { text: 'Cancelled.' }
      }

      await control.runner.confirm()

      return { text: state.outcome === null ? 'Ran.' : `${state.outcome.ok ? '✓' : '✗'} ${state.outcome.label}: ${state.outcome.detail}${state.outcome.verified === 'yes' ? ' (on disk)' : state.outcome.verified === 'no' ? ' (not on disk yet)' : ''}` }
    case 'agent': {
      const who = intent.who.toLowerCase()
      const agent = state.snapshot?.agents.find(entry => entry.id.toLowerCase() === who || entry.name?.toLowerCase() === who) ?? state.snapshot?.agents.find(entry => entry.id.toLowerCase().endsWith(who))

      if (agent === undefined) return { text: `No agent "${plain(intent.who, 40)}" in .claude-flow/agents/store.json.` }

      control.drill(agent.id)

      return open(control, state, `agent ${agent.name ?? agent.type}`)
    }
    case 'back':
      control.actions.back()

      return open(control, state, VIEWS.find(view => view.id === state.view)?.label ?? 'back')
    case 'select':
      control.actions.select(intent.by)

      return { text: `selection moved (${intent.by > 0 ? 'next' : 'prev'}) on ${state.view}` }
    case 'filter':
      state.eventFilter = intent.filter
      control.setView('events')

      return open(control, state, `events · ${intent.filter}`)
    case 'dump': {
      const view = intent.view ?? state.view
      const shown = state.view

      // The view's probes run for it now, as they would were it in front; then the pane's view is put back.
      state.view = view
      await control.refresh()
      await control.probe(true)
      state.view = shown

      return { text: viewText({ state, nowMs: Date.now(), columns: 100, act: control.actions }, view) }
    }
    case 'unknown':
      return { text: `Unknown: "${plain(intent.word, 30)}". /ruflo help lists the views (${VIEWS.map(view => view.id).join(', ')}) and commands.` }
  }
}
