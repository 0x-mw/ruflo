/**
 * Mission Control: a goal becomes a SPARC plan (goap.ts), the plan becomes a governed mission (`mission_create`,
 * `mission_plan`) and one ruflo task per plan node (`task_create`, tagged `mission:<id>` and `task:<tN>`), and the
 * primary Claude Code session does the work. The ruflo task store is the one authority for execution state: the console
 * reads it, never infers it. Claude is handed one ready task at a time as a visible prompt (the person confirms it, or
 * opts into auto-run), records the outcome with `task_complete` (evidence in its result) or `task_update` failed, and the
 * console moves on. Pause, resume and cancel are the console's own ledger (a session-bound mission has no durable
 * executor to pause). Every ledger change is an ordered event {seq, type, taskId, status, evidenceRef}.
 */
import type { ActionSpec } from './actions'
import { PHASE_NAME, plan as planOf, stageOf, type Plan, type Profile, profileOf, type Rigor, toMissionPlan } from './goap'
import type { Host } from './host'
import { plain, type TaskRecord } from './data/parse'
import { isAvailable, MISSION_SKILLS, slashOf, GOALS_PLUGIN } from './mission-skills'
import { offerGuidance } from './mission-guidance'
import { blocksCreate, blocksGuidance, isCapability, screenText } from './mission-options'
import type { Runner } from './runner'
import { CLI_PREFIXES, type State } from './state'
import type { Derived, LedgerEvent, LedgerTask, McState, McTab, MissionActions, MissionRecord } from './mission-types'

export type { Derived, LedgerEvent, LedgerTask, McState, McTab, MissionActions, MissionRecord } from './mission-types'

const states = new WeakMap<State, McState>()
export const LEDGER_KEY = 'mission-ledger'

export function mcOf(state: State): McState {
  let found = states.get(state)

  if (found === undefined) {
    found = { goal: '', profile: 'feature', rigor: 'standard', isProfilePicked: false, planned: null, missions: new Map(), active: null, tab: 'plan', lastGuide: '', guidance: null, screen: null, isScreenOn: true, last: null }
    states.set(state, found)
  }

  return found
}

export const activeMission = (state: State): MissionRecord | null => {
  const mc = mcOf(state)

  return mc.active === null ? null : (mc.missions.get(mc.active) ?? null)
}

/** The goal typed in: plans it (a pure computation, nothing is written) with the profile the words or the person chose. */
export function setGoal(state: State, goal: string): void {
  const mc = mcOf(state)

  mc.goal = plain(goal, 500).trim()
  if (!mc.isProfilePicked) mc.profile = profileOf(mc.goal)
  mc.planned = mc.goal === '' ? null : planOf(mc.profile, mc.rigor)
}

export function setProfile(state: State, profile: Profile, rigor: Rigor): void {
  const mc = mcOf(state)

  mc.profile = profile
  mc.rigor = rigor
  mc.isProfilePicked = true
  mc.planned = mc.goal === '' ? null : planOf(profile, rigor)
}

/** The ruflo task a ledger task is, read from the task store by its id (the store is the authority). */
export const rufloTaskOf = (tasks: readonly TaskRecord[], task: LedgerTask): TaskRecord | undefined => tasks.find(candidate => candidate.id === task.rufloTaskId)

/** Where a ledger task stands: from the ruflo task store, plus whether its dependencies are done (ready) or not (waiting). */
export function derive(mission: MissionRecord, tasks: readonly TaskRecord[]): Map<string, Derived> {
  const out = new Map<string, Derived>()

  for (const task of mission.tasks) {
    const status = rufloTaskOf(tasks, task)?.status
    const done = (id: string) => out.get(id) === 'done'

    out.set(task.id, status === 'completed' ? 'done' : status === 'failed' ? 'failed' : status === 'cancelled' ? 'cancelled' : status === 'in_progress' || status === 'running' ? 'running' : task.dependsOn.every(done) ? 'ready' : 'waiting')
  }

  return out
}

/** The next task to hand to Claude: the first ready one in plan order, unless something is running, paused or cancelled. */
export function nextTask(mission: MissionRecord, tasks: readonly TaskRecord[]): LedgerTask | null {
  if (mission.paused || mission.cancelled) return null

  const status = derive(mission, tasks)

  if ([...status.values()].some(value => value === 'running' || value === 'failed')) return null

  return mission.tasks.find(task => status.get(task.id) === 'ready' && task.rufloTaskId !== undefined) ?? null
}

export const progressOf = (mission: MissionRecord, tasks: readonly TaskRecord[]) => {
  const status = derive(mission, tasks)

  return { done: [...status.values()].filter(value => value === 'done').length, total: mission.tasks.length }
}

/** The instruction handed to the primary session for one task: what, as whom, what it must show, and how to record it. */
export function instructionOf(mission: MissionRecord, task: LedgerTask): string {
  const criteria = mission.acceptance.slice(0, 8).map(criterion => `- ${criterion.check}`).join('\n')
  const deps = task.dependsOn.length === 0 ? 'none' : task.dependsOn.map(id => `${id} (${mission.tasks.find(candidate => candidate.id === id)?.title ?? ''})`).join(', ')

  return [
    `Mission ${mission.id}: ${mission.objective}`,
    `Task ${task.id} (${PHASE_NAME[task.phase as keyof typeof PHASE_NAME] ?? task.phase}): ${task.title}`,
    `Act as: ${task.agent}. It is done when: ${task.requirement}`,
    `Already done: ${deps}.`,
    `The mission's acceptance criteria, for context:\n${criteria}`,
    `When this task is finished, record it: call the ruflo MCP tool task_complete with taskId "${task.rufloTaskId ?? ''}" and a result object {summary, evidence} (evidence = files changed, commands run, test output). If you cannot finish it, call task_update with the same taskId, status "failed" and a result {reason}. Do not complete it unless "it is done when" is true. Keep this transcript to decisions and verified results.`,
  ].join('\n')
}

export function record(mission: MissionRecord, event: Omit<LedgerEvent, 'seq' | 'atMs'>): void {
  const seq = Math.max(0, ...mission.events.map(candidate => candidate.seq)) + 1

  mission.events.push({ seq, atMs: Date.now(), ...event })
  if (mission.events.length > 500) mission.events.splice(0, mission.events.length - 500)
}

export function saveLedger(state: State, host: Host): void {
  const mc = mcOf(state)

  void host.storeSet(LEDGER_KEY, { active: mc.active, missions: [...mc.missions.values()].slice(-20) }).catch(() => undefined)
}

export async function loadLedger(state: State, host: Host): Promise<void> {
  const saved = await host.storeGet(LEDGER_KEY).catch(() => undefined)
  const missions = (saved as { missions?: unknown } | undefined)?.missions
  const mc = mcOf(state)

  if (!Array.isArray(missions)) return

  for (const raw of missions.slice(0, 20)) {
    const m = raw as MissionRecord

    if (typeof m?.id === 'string' && /^msn_[a-f0-9]{24}$/.test(m.id) && Array.isArray(m.tasks) && Array.isArray(m.events)) mc.missions.set(m.id, m)
  }

  const active = (saved as { active?: unknown }).active

  if (typeof active === 'string' && mc.missions.has(active)) mc.active = active
}

/** `ruflo mcp exec -t <tool> -p <json>` as an argv on the configured CLI prefix. */
const argvOf = (state: State, tool: string, params: unknown): string[] => [...CLI_PREFIXES[state.options.cli], 'mcp', 'exec', '-t', tool, '-p', JSON.stringify(params)]

/** The JSON object after `Result:` in a tool run's output (the CLI logs around it), or null. */
export function resultOf(stdout: string): Record<string, unknown> | null {
  const text = stdout.replace(/\x1b\[[0-9;]*m/g, '')
  const start = text.indexOf('{', Math.max(0, text.indexOf('Result:')))
  let depth = 0

  for (let i = start; i >= 0 && i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}' && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1)) as Record<string, unknown>
      } catch {
        return null
      }
    }
  }

  return null
}

const taskType = (profile: Profile) => (profile === 'bugfix' ? 'bugfix' : profile === 'refactor' ? 'refactor' : profile === 'research' ? 'research' : 'feature')

/** Create the mission: `mission_create`, `mission_plan`, then a ruflo task per plan node. One confirm for the chain. */
export function createSpec(state: State, host: Host, onDone: () => void): ActionSpec | null {
  const mc = mcOf(state)

  if (mc.planned === null || mc.goal === '') return null

  const planned = mc.planned
  const body = toMissionPlan(planned)
  const stamp = Date.now().toString(36)

  return {
    label: `create the mission and its ${body.tasks.length} tasks: ${plain(mc.goal, 60)}`,
    scope: 'goal',
    args: [],
    argv: argvOf(state, 'mission_create', { requestId: `console-create-${stamp}`, objective: mc.goal }),
    shows: `mission_create → mission_plan → task_create × ${body.tasks.length}, each \`ruflo mcp exec -t <tool>\` (${planned.profile}, ${planned.rigor}; ceiling ${body.budget.ceilingMinor / 100} ${body.budget.currency}, a record, not a charge)`,
    expect: 'a planned mission and its tasks in the ruflo task store',
    note: 'Writes the mission record and one task per plan node to this project’s ruflo stores. It runs no agent and spends nothing.',
    run: async () => {
      const mission = mc
      const fail = (label: string, detail: string) => {
        mission.last = { label, ok: false, detail }
        host.invalidate()
      }
      const call = async (tool: string, params: unknown) => resultOf((await host.run(argvOf(state, tool, params), 60_000)).stdout)
      const created = await call('mission_create', { requestId: `console-create-${stamp}`, objective: mc.goal })
      const data = (created?.data ?? {}) as { missionId?: string; revision?: number }

      if (created?.ok !== true || typeof data.missionId !== 'string') return fail('mission_create failed', plain(String(created?.message ?? 'no answer'), 160))

      const id = data.missionId
      const placed = await call('mission_plan', { requestId: `console-plan-${stamp}`, missionId: id, expectedRevision: data.revision ?? 1, plan: body })

      if (placed?.ok !== true) return fail('mission_plan refused the plan', plain(String(placed?.message ?? 'no answer'), 200))

      const tasks: LedgerTask[] = []

      for (const step of planned.steps) {
        const task = body.tasks.find(candidate => candidate.id === step.id)
        const made = await call('task_create', {
          type: taskType(planned.profile),
          description: `[${id}/${step.id}] ${task?.title ?? step.action.title}`.slice(0, 200),
          priority: 'normal',
          tags: [`mission:${id}`, `task:${step.id}`, `phase:${step.action.phase}`],
        })
        const rufloTaskId = typeof made?.taskId === 'string' ? made.taskId : undefined

        tasks.push({ id: step.id, title: step.action.title, phase: step.action.phase, stage: stageOf(step.action), agent: step.action.agent, requirement: step.action.requirement, dependsOn: step.dependsOn, ...(rufloTaskId !== undefined && { rufloTaskId }) })
      }

      const record0: MissionRecord = {
        id,
        objective: mc.goal,
        profile: planned.profile,
        rigor: planned.rigor,
        planDigest: typeof (placed.data as { planDigest?: string } | undefined)?.planDigest === 'string' ? (placed.data as { planDigest: string }).planDigest : undefined,
        tasks,
        acceptance: body.acceptance.map(criterion => ({ id: criterion.id, check: criterion.check })),
        events: [],
        paused: false,
        cancelled: false,
        auto: false,
        createdAtMs: Date.now(),
      }

      record(record0, { type: 'mission.created', status: 'draft' })
      record(record0, { type: 'plan.validated', status: 'planned', evidenceRef: record0.planDigest })
      record(record0, { type: 'tasks.created', note: `${tasks.filter(task => task.rufloTaskId !== undefined).length} of ${tasks.length}` })
      mc.missions.set(id, record0)
      mc.active = id
      mc.tab = 'tasks'
      mc.last = { label: `mission ${id} planned`, ok: true, detail: `${tasks.length} tasks in the ruflo task store; ▶ Run next hands the first to Claude` }
      saveLedger(state, host)
      onDone()
      host.invalidate()
    },
  }
}

/** Mark one task in progress and hand it to the primary session as a visible prompt. One confirm: it starts a model turn. */
export function dispatchSpec(state: State, host: Host, mission: MissionRecord, task: LedgerTask, send: (text: string) => Promise<void>): ActionSpec {
  const text = instructionOf(mission, task)

  return {
    label: `hand task ${task.id} to Claude: ${task.title}`,
    scope: 'controls',
    args: [],
    shows: `task_update ${task.rufloTaskId ?? ''} in_progress, then this prompt to the Claude Code session: “${plain(text, 140)}…”`,
    expect: 'a visible prompt in the transcript; the task in progress',
    note: 'Starts a Claude Code turn on your plan (billed as any turn is); the prompt is visible and Claude records the result with task_complete.',
    run: async () => {
      await host.run(argvOf(state, 'task_update', { taskId: task.rufloTaskId, status: 'in_progress', progress: 5 }), 60_000)
      task.dispatchedAtMs = Date.now()
      record(mission, { type: 'task.dispatched', taskId: task.id, status: 'in_progress', evidenceRef: task.rufloTaskId })
      saveLedger(state, host)
      await send(text)
      mcOf(state).last = { label: `task ${task.id} handed to Claude`, ok: true, detail: 'it is in the transcript now; the pane follows the task store' }
      host.invalidate()
    },
  }
}

/** Pause or resume dispatching, kept in the ledger (a session-bound mission has no durable executor to pause). */
export function setPaused(state: State, host: Host, paused: boolean): void {
  const mission = activeMission(state)

  if (mission === null || mission.cancelled) return

  mission.paused = paused
  record(mission, { type: paused ? 'mission.paused' : 'mission.resumed', status: paused ? 'paused' : 'running' })
  mcOf(state).last = { label: paused ? 'paused: no more tasks are handed out' : 'resumed', ok: true, detail: paused ? 'a task already handed to Claude finishes first' : 'Run next hands out the next ready task' }
  saveLedger(state, host)
  host.invalidate()
}

/** Cancel: cancel every task not done in the ruflo task store, then ask the mission record to cancel (allowed only from some states). */
export function cancelSpec(state: State, host: Host, mission: MissionRecord, tasks: readonly TaskRecord[]): ActionSpec {
  const open = mission.tasks.filter(task => task.rufloTaskId !== undefined && !['completed', 'cancelled'].includes(rufloTaskOf(tasks, task)?.status ?? ''))

  return {
    label: `cancel mission ${mission.id} (${open.length} open tasks)`,
    scope: 'controls',
    args: [],
    shows: `task_cancel × ${open.length}, then mission_request_action cancel (the record may refuse from its state)`,
    expect: 'every open task cancelled',
    note: 'Cancels this mission’s open tasks in the ruflo task store. A task already finished stays finished.',
    run: async () => {
      for (const task of open) await host.run(argvOf(state, 'task_cancel', { taskId: task.rufloTaskId, reason: 'mission cancelled from the console' }), 60_000)

      const refused = resultOf((await host.run(argvOf(state, 'mission_request_action', { requestId: `console-cancel-${Date.now().toString(36)}`, missionId: mission.id, expectedRevision: 2, action: 'cancel', reason: 'cancelled from the console' }), 60_000)).stdout)

      mission.cancelled = true
      record(mission, { type: 'mission.cancelled', status: 'cancelled', note: refused?.ok === true ? 'record cancelled' : `record: ${plain(String(refused?.message ?? 'not asked'), 100)}` })
      mcOf(state).last = { label: `mission ${mission.id} cancelled`, ok: true, detail: `${open.length} tasks cancelled${refused?.ok === true ? '' : `; the record said: ${plain(String(refused?.message ?? ''), 100)}`}` }
      saveLedger(state, host)
      host.invalidate()
    },
  }
}

const MAX_TEXT = 500


const wired = new WeakMap<State, { host: Host; actions: MissionActions }>()

/** The host and actions Mission Control was wired with, for the palette and the headless commands. */
export const missionWired = (state: State) => wired.get(state)

export function missionActions(state: State, host: Host, runner: Runner): MissionActions {
  const mc = mcOf(state)
  const say = (label: string, ok: boolean, detail: string) => {
    mc.last = { label, ok, detail }
    host.invalidate()
  }
  const tasksNow = (): readonly TaskRecord[] => state.snapshot?.tasks ?? []

  /** Runs a slash command on the goal (or the active mission's objective) in the main UI: now when idle, prepared in the prompt box mid-turn. */
  const launch = (slash: string, label: string) => {
    const objective = activeMission(state)?.objective ?? mc.goal

    if (objective.trim() === '') return say(label, false, 'type a goal first: it works on the goal')

    const args = plain(objective, MAX_TEXT)

    if (state.turnActive) {
      void host.fillPrompt(`/${slash} ${args}`).then(
        isFilled => say(isFilled ? 'prepared in the prompt box' : 'no prompt box here', isFilled, `press Enter to run /${slash} in the main conversation`),
        () => say(label, false, 'the prompt box refused it'),
      )

      return
    }

    void host.runSlash(slash, args).then(
      () => say(`${label}: /${slash} is running`, true, 'in the main conversation: the pane follows the task store'),
      () => say(label, false, `/${slash} did not run`),
    )
  }

  const actions: MissionActions = {
    goal: text => {
      setGoal(state, text)
      mc.tab = 'plan'
      mc.screen = null

      const goal = mc.goal

      // AIDefence looks at the goal first: an unsafe or PII-bearing goal is not sent to a model for guidance.
      if (!mc.isScreenOn || mc.planned === null) offerGuidance(state, host, runner, mc)
      else {
        mc.guidance = null
        void screenText(state, host, goal).then(screen => {
          if (mc.goal !== goal) return

          mc.screen = screen
          if (!blocksGuidance(screen)) offerGuidance(state, host, runner, mc)
          host.invalidate()
        })
      }

      host.invalidate()
    },
    askGuidance: () => (blocksGuidance(mc.screen) ? say('guidance blocked', false, `AIDefence: ${mc.screen?.detail ?? ''}. Change the goal.`) : offerGuidance(state, host, runner, mc)),
    capability: slash => (isCapability(state, slash) ? launch(slash, slash) : say(`${slash} is not available`, false, 'install that plugin (Plugin Catalog) and /reload-plugins')),
    screen: on => {
      mc.isScreenOn = on
      if (!on) mc.screen = null
      host.invalidate()
    },
    profile: profile => {
      setProfile(state, profile, mc.rigor)
      host.invalidate()
    },
    rigor: rigor => {
      setProfile(state, mc.profile, rigor)
      host.invalidate()
    },
    tab: tab => {
      mc.tab = tab
      host.invalidate()
    },
    create: () => runner.ask(blocksCreate(mc.screen) ? null : createSpec(state, host, () => undefined), blocksCreate(mc.screen) ? 'AIDefence flagged the goal: change it first' : 'type a goal first: the plan is made from it'),
    select: id => {
      if (mc.missions.has(id)) mc.active = id
      saveLedger(state, host)
      host.invalidate()
    },
    next: () => {
      const mission = activeMission(state)

      if (mission === null) return say('no active mission', false, 'create one from a goal first')

      const task = nextTask(mission, tasksNow())

      if (task === null) return say('nothing to hand out', false, mission.paused ? 'the mission is paused' : mission.cancelled ? 'the mission is cancelled' : 'a task is running or failed, or none is ready: see Tasks')

      runner.ask(dispatchSpec(state, host, mission, task, text => host.submitPrompt(text)), 'nothing to hand out')
    },
    pause: () => setPaused(state, host, true),
    resume: () => setPaused(state, host, false),
    cancel: () => {
      const mission = activeMission(state)

      runner.ask(mission === null ? null : cancelSpec(state, host, mission, tasksNow()), 'no active mission to cancel')
    },
    auto: on => {
      const mission = activeMission(state)

      if (mission === null) return

      mission.auto = on
      record(mission, { type: on ? 'auto.on' : 'auto.off' })
      saveLedger(state, host)
      host.invalidate()
    },
    aside: question => {
      const q = plain(question, MAX_TEXT).trim()

      if (q === '') return say('ask aside', false, 'type a question first')

      if (state.turnActive) {
        void host.fillPrompt(`/btw ${q}`).then(
          isFilled => say(isFilled ? 'prepared in the prompt box' : 'no prompt box here', isFilled, isFilled ? 'press Enter there: /btw answers beside the running task and stays out of the main conversation' : 'run /btw yourself'),
          () => say('ask aside', false, 'the prompt box refused it'),
        )

        return
      }

      void host.runSlash('btw', q).then(
        () => say('asked /btw', true, 'the answer opens beside the transcript; it is not part of the main conversation'),
        () => say('ask aside', false, '/btw is not available in this session'),
      )
    },
    skill: id => {
      const skill = MISSION_SKILLS.find(candidate => candidate.id === id)

      if (skill === undefined) return say('skill', false, 'not a ruflo-goals skill')
      if (!isAvailable(state, skill)) return say(`${slashOf(skill)} is not available`, false, `install the ${GOALS_PLUGIN} plugin (Plugin Catalog) and /reload-plugins`)

      launch(slashOf(skill), skill.title)
    },
    guide: text => {
      const t = plain(text, MAX_TEXT).trim()

      if (t !== '') mc.lastGuide = t

      const ask = () =>
        runner.ask(
          t === ''
            ? null
            : { label: `send Claude: ${plain(t, 70)}`, scope: 'guide', args: [], shows: `to the Claude Code session, as a visible prompt: “${t}”`, expect: 'the instruction in the transcript', note: 'Starts a Claude Code turn (billed as any turn is).', run: async () => host.submitPrompt(t) },
          'type the instruction first',
        )

      if (t === '' || !mc.isScreenOn) return ask()

      void screenText(state, host, t).then(screen => (blocksGuidance(screen) ? say('AIDefence blocked the instruction', false, screen.detail) : ask()))
    },

  }

  wired.set(state, { host, actions })

  return actions
}

/** Auto-run: called after the task store is read. Hands over the next ready task when the mission opted in and Claude is idle. */
export function advance(state: State, host: Host): void {
  const mission = activeMission(state)

  if (mission === null || !mission.auto || state.turnActive) return

  const task = nextTask(mission, state.snapshot?.tasks ?? [])

  if (task === null || task.dispatchedAtMs !== undefined) return

  task.dispatchedAtMs = Date.now()
  void dispatchSpec(state, host, mission, task, text => host.submitPrompt(text)).run?.()
}
