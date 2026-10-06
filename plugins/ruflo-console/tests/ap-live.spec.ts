/**
 * The autopilot's live half and its panel (ADR-466): the start confirm and what it writes, the kill switch through the files, a tick
 * that hands a step over only after journaling it, crash-resume through a fresh process, parked questions, masking, and the slots.
 * An in-memory disk and a fake host: no engine. Run with
 *   npx vitest run plugins/ruflo-console/tests/ap-live.spec.ts --testTimeout=30000
 */
import { describe, expect, it } from 'vitest'

import { apTick, appendEvents, answerParked, refreshAutopilot, storeOf, stopNow, wireAutopilot } from '../hooks/ap-live'
import { hashOf, seal, type Envelope } from '../hooks/data/ap-envelope'
import { encodeLine, JOURNAL_FILE, parseJournal, type JournalEvent } from '../hooks/data/ap-journal'
import type { TaskRecord } from '../hooks/data/parse'
import type { Host } from '../hooks/host'
import { mcOf, type MissionRecord } from '../hooks/mission-control'
import { newState, type State } from '../hooks/state'
import { boardRows, defaultDraft, draftOf, editDraft, registerAutopilotSlots, startSpec } from '../hooks/views/ap-panel'
import { parkedRows } from '../hooks/views/ap-parked'
import type { Ctx, Kit } from '../hooks/views/common'
import { resetSlots, slotsFor, type SlotEnv } from '../hooks/views/wf-slots'
import '../hooks/views/wf-register'

const CWD = '/w'
const T0 = Date.parse('2026-10-06T00:00:00.000Z')
const J = `${CWD}/${JOURNAL_FILE}`
const E = `${CWD}/.claude-flow/console/autopilot/envelope.json`
const KILL = `${CWD}/.claude-flow/console/autopilot/KILL`

const ENV: Envelope = { name: 'night', toolClasses: ['edit', 'read', 'test'], paths: [CWD], repos: [], network: [], secretEnv: [], spend: { hourUsd: 2, dayUsd: 10, totalUsd: 40 }, concurrency: 1, maxDurationMs: 7 * 86_400_000, verify: [['true']], acceptWithoutAnatole: true }

type Rig = { files: Map<string, string>; runs: string[][]; prompts: string[]; toasts: string[]; host: Host; failVerify: { on: boolean } }

function rig(): Rig {
  const files = new Map<string, string>()
  const runs: string[][] = []
  const prompts: string[] = []
  const toasts: string[] = []
  const failVerify = { on: false }

  const host = {
    fs: {
      read: async (p: string) => files.get(p) ?? Promise.reject(new Error('ENOENT')),
      stat: async (p: string) => (files.has(p) ? { mtimeMs: 1, size: (files.get(p) as string).length, kind: 'file', isLink: false } : [...files.keys()].some(k => k.startsWith(`${p}/`)) ? { kind: 'dir', isLink: false } : Promise.reject(new Error('ENOENT'))),
      list: async () => [],
    },
    run: async (argv: readonly string[], _t: number, stdin?: string) => {
      runs.push([...argv])

      if (argv[0] === 'dd') {
        const path = (argv.find(a => a.startsWith('of=')) as string).slice(3)

        files.set(path, argv.includes('oflag=append') ? `${files.get(path) ?? ''}${stdin ?? ''}` : (stdin ?? ''))
      } else if (argv[0] === 'install') {
        const path = argv.at(-1) as string

        files.set(path, argv.includes('/dev/null') ? '' : (stdin ?? ''))
      } else if (argv[0] === 'rm') files.delete(argv.at(-1) as string)
      else if (argv[0] === 'cp') files.set(argv.at(-1) as string, files.get(argv.at(-2) as string) ?? '')
      else if (argv[0] === 'true' || argv[0] === 'false') return { exitCode: failVerify.on ? 1 : 0, stdout: '', stderr: '' }

      return { exitCode: 0, stdout: '', stderr: '' }
    },
    invalidate: () => undefined,
    toast: (t: string) => void toasts.push(t),
    every: () => ({ cancel: () => undefined }),
    after: () => ({ cancel: () => undefined }),
    storeSet: async () => undefined,
    submitPrompt: async (t: string) => void prompts.push(t),
  } as unknown as Host

  return { files, runs, prompts, toasts, host, failVerify }
}

const task = (id: string, status: string): TaskRecord => ({ id, type: 'feature', description: '', status, assignedTo: [], tags: [] })

const mission = (): MissionRecord => ({
  id: 'msn_0123456789abcdef01234567', objective: 'tidy the parser', profile: 'feature', rigor: 'standard',
  tasks: [
    { id: 't1', title: 'Fix the parser bug', phase: 'S', agent: 'coder', requirement: 'tests pass', dependsOn: [], rufloTaskId: 'r1' },
    { id: 't2', title: 'Publish the package to npm', phase: 'A', agent: 'coder', requirement: 'it is published', dependsOn: [], rufloTaskId: 'r2' },
    { id: 't3', title: 'Review the module', phase: 'P', agent: 'coder', requirement: 'a summary', dependsOn: [], rufloTaskId: 'r3' },
  ],
  acceptance: [], events: [], paused: false, cancelled: false, auto: false, createdAtMs: 1,
})

function stateWith(tasks: TaskRecord[], anatole: 'on' | 'off' | 'absent' = 'on'): State {
  const state = newState({})

  state.cwd = CWD
  state.snapshot = { tasks, agents: [], claims: [], swarm: null, plugins: { missingFromClone: [], installed: [] }, alerts: [], anatole: anatole === 'absent' ? undefined : { present: true, status: { mode: anatole === 'on' ? 'notify' : 'off' }, modeOverride: null, overrides: {}, alerts: [], refused: [], badAlerts: 0 } } as never
  mcOf(state).missions.set('msn_0123456789abcdef01234567', mission())
  mcOf(state).active = 'msn_0123456789abcdef01234567'

  return state
}

/** Seeds an approved, started autopilot on the rig's disk. */
function started(r: Rig, extra: JournalEvent[] = []): void {
  const sealed = seal(ENV, 1, T0)

  r.files.set(E, JSON.stringify(sealed))
  r.files.set(J, [{ t: 'start', at: T0, envHash: sealed.hash, revision: 1, anatole: 'on' } as JournalEvent, ...extra].map(encodeLine).join(''))
}

const kit = { Box: (props: Record<string, unknown>) => ({ kind: 'Box', props }), Text: (props: Record<string, unknown>) => ({ kind: 'Text', props }), Button: (props: Record<string, unknown>) => ({ kind: 'Button', props }) } as unknown as Kit
const ctxOf = (state: State, nowMs: number): Ctx => ({ kit, state, nowMs, columns: 120, pictures: new Map(), act: {} as never })

type El = { kind: string; props: Record<string, unknown> }

const flat = (node: unknown, out: El[] = []): El[] => {
  if (Array.isArray(node)) node.forEach(child => flat(child, out))
  else if (typeof node === 'object' && node !== null) {
    out.push(node as El)
    flat((node as El).props?.children, out)
  }

  return out
}

const words = (tree: unknown): string => flat(tree).filter(el => el.kind === 'Text' && typeof el.props.children === 'string').map(el => el.props.children as string).join('\n')
const buttons = (tree: unknown): string[] => flat(tree).filter(el => el.kind === 'Button').map(el => String(el.props.label))
const envOf = (state: State, nowMs: number): SlotEnv => ({ ctx: ctxOf(state, nowMs), runs: [], run: null, phase: null, agent: null, ui: {} as never, nowMs })
const journal = (r: Rig): JournalEvent[] => parseJournal(r.files.get(J) ?? '').events

describe('the panel before and after wiring', () => {
  it('says it is not wired, then that autopilot is off, with no invented number', () => {
    const state = stateWith([])

    expect(words(boardRows(envOf(state, T0)))).toContain('not wired')

    const r = rig()

    wireAutopilot(state, r.host)

    const text = words(boardRows(envOf(state, T0)))

    expect(text).toContain('autopilot is off')
    expect(text).toContain('no envelope approved yet')
    expect(text).toContain('preflight not wired')
    expect(text).not.toContain('$0')
    expect(text).toContain('ledger not read')
  })

  it('draws the band line from the journal, spend n/a until read, and the parked count', async () => {
    const r = rig()
    const state = stateWith([task('r1', 'pending')])

    started(r, [{ t: 'parked', at: T0 + 1, id: 'p-1', task: 't2', question: 'needs "publish", which autopilot can never do. Do it yourself, or deny it.' }])
    wireAutopilot(state, r.host)
    await refreshAutopilot(state, r.host, T0 + 2 * 86_400_000)

    const text = words(boardRows(envOf(state, T0 + 2 * 86_400_000 + 10)))

    expect(text).toContain('autopilot day 3 · $n/a/$40 · 1 parked')
    expect(text).toContain(`hash ${hashOf(ENV).slice(0, 12)}`)
  })
})

describe('start: the one confirm', () => {
  it('offers no spec for an invalid draft and one with the hash, the ceilings and the never-list for a valid one', () => {
    const state = stateWith([])

    wireAutopilot(state, rig().host)
    expect(startSpec(envOf(state, T0))).not.toBeNull()

    draftOf(state).value.spend = { hourUsd: 9, dayUsd: 2, totalUsd: 1 }
    expect(startSpec(envOf(state, T0))).toBeNull()
    expect(words(boardRows(envOf(state, T0)))).toContain('draft is not valid')

    draftOf(state).value = defaultDraft(CWD)

    const spec = startSpec(envOf(state, T0))

    expect(spec?.declared).toBe('spend')
    expect(spec?.shows).toContain('never: publish, release, deploy, force-push, secret-access')
    expect(spec?.note).toContain('never bypassed')
  })

  it('refuses to start without Anatole unless the envelope accepted that; with it, writes the envelope, clears the flag and journals the start', async () => {
    const r = rig()
    const state = stateWith([], 'off')

    wireAutopilot(state, r.host)
    r.files.set(KILL, '')

    await startSpec(envOf(state, T0))?.run?.()
    expect(r.files.has(E)).toBe(false)
    expect(storeOf(state).error).toContain('Project Anatole is off')

    editDraft(draftOf(state), { kind: 'anatole' })
    await startSpec(envOf(state, T0))?.run?.()

    expect(r.files.has(E)).toBe(true)
    expect(r.files.has(KILL)).toBe(false)
    expect(journal(r)[0]).toMatchObject({ t: 'start', anatole: 'accepted-without', revision: 1 })
  })

  it('a changed envelope shows what it widens, and an unchanged running one has no spec', async () => {
    const r = rig()
    const state = stateWith([])

    started(r)
    wireAutopilot(state, r.host)
    await refreshAutopilot(state, r.host, T0)
    draftOf(state).value = JSON.parse(JSON.stringify(ENV)) as Record<string, unknown>
    expect(startSpec(envOf(state, T0))).toBeNull()

    editDraft(draftOf(state), { kind: 'concurrency', by: 1 })
    expect(startSpec(envOf(state, T0))?.shows).toContain('WIDENS: concurrency: 1 to 2')
  })
})

describe('stop is immediate and needs no confirm', () => {
  it('journals a stop and leaves the flag file, and a tick in another process then never acts', async () => {
    const r = rig()
    const state = stateWith([task('r1', 'pending'), task('r2', 'pending'), task('r3', 'pending')])

    started(r)
    wireAutopilot(state, r.host)
    await refreshAutopilot(state, r.host, T0)
    await stopNow(state, r.host, 'because')

    expect(r.files.has(KILL)).toBe(true)
    expect(journal(r).at(-1)).toMatchObject({ t: 'stop', reason: 'because' })
    expect(r.toasts.join()).toContain('autopilot stopped')

    const other = stateWith([task('r1', 'pending')])

    wireAutopilot(other, r.host)
    await apTick(other, r.host, T0 + 1000)
    expect(r.prompts).toEqual([])
  })

  it('the flag file alone halts a running loop within one tick, before anything is handed over', async () => {
    const r = rig()
    const state = stateWith([task('r1', 'pending'), task('r2', 'pending'), task('r3', 'pending')])

    started(r)
    r.files.set(KILL, '')
    wireAutopilot(state, r.host)
    await apTick(state, r.host, T0 + 1000)

    expect(r.prompts).toEqual([])
    expect(journal(r).at(-1)).toMatchObject({ t: 'stop', reason: 'kill switch' })
  })
})

describe('a tick', () => {
  it('journals the step first, then hands the task to the session; and parks the publish task instead of running it', async () => {
    const r = rig()
    const state = stateWith([task('r1', 'pending'), task('r2', 'pending'), task('r3', 'pending')])

    started(r)
    wireAutopilot(state, r.host)
    // Spend is read from the ledger, which this rig has not got: unknown spend waits, it never runs on a guess.
    await apTick(state, r.host, T0 + 1000)
    expect(r.prompts).toEqual([])
    expect(storeOf(state).status).toContain('spend not read')

    storeOf(state).spend = { hourUsd: 0, dayUsd: 0, totalUsd: 0 }
    storeOf(state).spendAtMs = T0 + 1000
    await apTick(state, r.host, T0 + 2000)

    expect(r.prompts.length).toBe(1)
    expect(r.prompts[0]).toContain('Fix the parser bug')

    const events = journal(r)

    expect(events.map(e => e.t)).toContain('step.started')
    expect(events.findIndex(e => e.t === 'step.started')).toBeLessThan(events.length)
  })

  it('parks the hard-deny task with a question and carries on with the next ready one', async () => {
    const r = rig()
    const state = stateWith([task('r1', 'completed'), task('r2', 'pending'), task('r3', 'pending')])

    started(r)
    wireAutopilot(state, r.host)
    storeOf(state).spend = { hourUsd: 0, dayUsd: 0, totalUsd: 0 }
    storeOf(state).spendAtMs = T0 + 1000
    await apTick(state, r.host, T0 + 2000)

    const parked = journal(r).find(e => e.t === 'parked')

    expect(parked).toMatchObject({ t: 'parked', task: 't2' })
    expect(r.prompts).toEqual([])

    storeOf(state).adaptAtMs = T0 + 2000
    await apTick(state, r.host, T0 + 3000)

    expect(r.prompts.length).toBe(1)
    expect(r.prompts[0]).toContain('Review the module')
  })

  it('crash-resume: a started step left by a dead process is settled by its effect, never run twice', async () => {
    const r = rig()
    const state = stateWith([task('r1', 'pending'), task('r2', 'pending'), task('r3', 'pending')])

    started(r, [{ t: 'step.started', at: T0 + 10, id: 's-dangling00001', task: 't1', cls: 'edit', attempt: 1, deadline: T0 + 1e9, tier: 'mid' }])
    wireAutopilot(state, r.host)
    storeOf(state).bootMs = T0 + 100
    storeOf(state).spend = { hourUsd: 0, dayUsd: 0, totalUsd: 0 }
    storeOf(state).spendAtMs = T0 + 1000
    await apTick(state, r.host, T0 + 1000)

    expect(journal(r).some(e => e.t === 'step.failed' && e.id === 's-dangling00001' && e.why.includes('lost on restart'))).toBe(true)
    // The lost step is settled; the tick did not also start a step in the same pass.
    expect(r.prompts).toEqual([])
    expect(journal(r).filter(e => e.t === 'step.started').length).toBe(1)
  })

  it('a task the store calls completed is only "done" when the verify commands pass; otherwise it fails and nothing is learned from it', async () => {
    const r = rig()
    const state = stateWith([task('r1', 'completed'), task('r2', 'pending'), task('r3', 'pending')])

    started(r, [{ t: 'step.started', at: T0 + 10, id: 's-verifyme0000001', task: 't1', cls: 'edit', attempt: 1, deadline: T0 + 1e9, tier: 'mid' }])
    wireAutopilot(state, r.host)
    storeOf(state).bootMs = T0 - 1
    storeOf(state).spend = { hourUsd: 0, dayUsd: 0, totalUsd: 0 }
    storeOf(state).spendAtMs = T0 + 1000
    r.failVerify.on = true
    await apTick(state, r.host, T0 + 1000)

    expect(r.runs.some(a => a[0] === 'true')).toBe(true)
    expect(journal(r).some(e => e.t === 'step.failed' && e.id === 's-verifyme0000001')).toBe(true)
    expect(journal(r).some(e => e.t === 'step.done')).toBe(false)
  })

  it('and with the verify commands passing the step is done and verified', async () => {
    const r = rig()
    const state = stateWith([task('r1', 'completed'), task('r2', 'pending'), task('r3', 'pending')])

    started(r, [{ t: 'step.started', at: T0 + 10, id: 's-verifyme0000002', task: 't1', cls: 'edit', attempt: 1, deadline: T0 + 1e9, tier: 'mid' }])
    wireAutopilot(state, r.host)
    storeOf(state).spend = { hourUsd: 0, dayUsd: 0, totalUsd: 0 }
    storeOf(state).spendAtMs = T0 + 1000
    await apTick(state, r.host, T0 + 1000)

    expect(journal(r).find(e => e.t === 'step.done')).toMatchObject({ id: 's-verifyme0000002', verified: true })
  })

  it('refuses to run on an envelope whose hash is not the one the start recorded', async () => {
    const r = rig()
    const state = stateWith([task('r1', 'pending')])

    started(r)
    r.files.set(E, JSON.stringify(seal({ ...ENV, spend: { hourUsd: 2, dayUsd: 10, totalUsd: 4000 } }, 2, T0)))
    wireAutopilot(state, r.host)
    await apTick(state, r.host, T0 + 1000)

    expect(r.prompts).toEqual([])
    expect(journal(r).at(-1)).toMatchObject({ t: 'stop' })
  })
})

describe('the parked queue', () => {
  it('shows the question washed, approve-once and deny for an ordinary park, only deny for a hard deny, and journals the answer', async () => {
    const r = rig()
    const state = stateWith([])

    started(r, [
      { t: 'parked', at: T0 + 1, id: 'p-net', task: 't9', question: 'needs "network" \u001b[31mred\u001b[0m sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789. Approve once, or deny.' },
      { t: 'parked', at: T0 + 2, id: 'p-pub', task: 't2', question: 'needs "publish", which autopilot can never do. Do it yourself, or deny it.' },
    ])
    wireAutopilot(state, r.host)
    await refreshAutopilot(state, r.host, T0 + 5)

    const tree = parkedRows(envOf(state, T0 + 5))
    const text = words(tree)

    expect(text).not.toContain('\u001b')
    expect(text).not.toContain('sk-ant-api03-abcdef')
    expect(buttons(tree)).toEqual(['approve once', 'deny', 'deny'])

    await answerParked(state, r.host, 'p-net', 'once')
    expect(journal(r).at(-1)).toMatchObject({ t: 'answered', id: 'p-net', answer: 'once' })
    expect(storeOf(state).loop.parked.find(p => p.id === 'p-net')?.answer).toBe('once')
  })

  it('has honest empty states', () => {
    const state = stateWith([])

    wireAutopilot(state, rig().host)
    expect(words(parkedRows(envOf(state, T0)))).toContain('has not started')
  })
})

describe('writes', () => {
  it('append through one fixed argv, the path a single element, and never through a link', async () => {
    const r = rig()
    const state = stateWith([])

    wireAutopilot(state, r.host)
    expect(await appendEvents(state, r.host, [{ t: 'beat', at: T0 }])).toBe(true)

    const dd = r.runs.find(a => a[0] === 'dd')

    expect(dd).toEqual(['dd', `of=${J}`, 'oflag=append', 'conv=notrunc', 'status=none'])

    const linked = rig()

    linked.host.fs.stat = async (p: string) => (p === `${CWD}/.claude-flow` ? { kind: 'dir', isLink: true } : Promise.reject(new Error('ENOENT')))
    wireAutopilot(state, linked.host)
    expect(await appendEvents(state, linked.host, [{ t: 'beat', at: T0 }])).toBe(false)
    expect(linked.runs.filter(a => a[0] === 'dd')).toEqual([])
  })
})

describe('registration', () => {
  it('registers its board, key, action and notice slots with no refusal and no hotkey clash against the merged features', () => {
    const before = slotsFor('key').map(s => s.key)

    expect(slotsFor('board').map(s => s.id)).toEqual(expect.arrayContaining(['autopilot', 'ap-parked']))
    expect(slotsFor('key').find(s => s.id === 'ap-stop-key')?.key).toBe('9')
    expect(slotsFor('action').find(s => s.id === 'ap-start')?.hotkey).toBe('8')
    expect(slotsFor('notice').map(s => s.id)).toContain('autopilot')

    const keys = [...before, ...slotsFor('action').map(s => s.hotkey)]

    expect(new Set(keys).size).toBe(keys.length)
    resetSlots()
    registerAutopilotSlots()
    expect(slotsFor('board').length).toBe(1)
  })
})
