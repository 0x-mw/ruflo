/**
 * The autopilot's step machine (ADR-466 §2, §4, §5). Pure: `foldJournal(events)` is the whole state, `tick(state, facts)` answers what
 * to journal and whether to start one step. No I/O, no clock (the time is in `facts`), so every rule is testable and a crash can only
 * lose what was not journaled yet.
 *
 * The order of the checks in `tick` IS the safety property: the kill switch is looked at before anything else and a stopped loop never
 * acts again without an explicit `start` event; an in-flight step is settled (finished, timed out, or found lost) before any new one
 * is considered; budget, Anatole and the failure ladder all sit between "settled" and "act". A step is started at most once per id,
 * and a task with a started or done step is never started again.
 */
import { classAllowed, pathAllowed, sha256, type Envelope, type Spend } from './ap-envelope'
import type { Anatole, JournalEvent, Receipt } from './ap-journal'

export type Phase = 'idle' | 'running' | 'paused' | 'stopped'
export type StepRec = { id: string; task: string; cls: string; attempt: number; startedAt: number; deadline: number; status: 'started' | 'done' | 'failed'; verified?: boolean; why?: string; tier: string; par?: number; endedAt?: number }
export type ParkedRec = { id: string; task: string; question: string; at: number; answer?: 'once' | 'deny'; /** True once a step ran under an `once` answer. */ isUsed?: boolean }

export type LoopState = {
  phase: Phase
  startedAtMs: number | null
  envHash: string | null
  revision: number | null
  anatole: Anatole | null
  reason: string | null
  steps: StepRec[]
  parked: ParkedRec[]
  failures: number
  lastFailureAt: number | null
  lastBeatAt: number | null
  lastDigestDay: string | null
  receipts: Receipt[]
}

export const emptyLoop = (): LoopState => ({ phase: 'idle', startedAtMs: null, envHash: null, revision: null, anatole: null, reason: null, steps: [], parked: [], failures: 0, lastFailureAt: null, lastBeatAt: null, lastDigestDay: null, receipts: [] })

export const KEEP_STEPS = 400
/** Consecutive failures that pause the loop instead of letting it thrash. */
export const FAILURE_BUDGET = 5
export const BACKOFF_BASE_MS = 60_000
export const BACKOFF_MAX_MS = 3_600_000
export const BEAT_MS = 300_000
/** The share of the total spend ceiling at which the loop pauses (it stops at 100%). */
export const PAUSE_AT = 0.8

/** The loop's state as the journal says it. `base` is a checkpoint to continue from. */
export function foldJournal(events: readonly JournalEvent[], base: LoopState = emptyLoop()): LoopState {
  const s: LoopState = { ...base, steps: base.steps.map(step => ({ ...step })), parked: base.parked.map(p => ({ ...p })), receipts: [...base.receipts] }

  for (const e of events) {
    switch (e.t) {
      case 'start':
        Object.assign(s, { phase: 'running', startedAtMs: e.at, envHash: e.envHash, revision: e.revision, anatole: e.anatole, reason: null, failures: 0, lastFailureAt: null })
        break
      case 'step.started':
        // A repeated id (a replayed line) changes nothing: one step per id.
        if (!s.steps.some(step => step.id === e.id)) {
          s.steps.push({ id: e.id, task: e.task, cls: e.cls, attempt: e.attempt, startedAt: e.at, deadline: e.deadline, status: 'started', tier: e.tier, ...(e.par !== undefined && { par: e.par }) })

          const once = s.parked.find(p => p.task === e.task && p.answer === 'once' && p.isUsed !== true)

          if (once !== undefined) once.isUsed = true
        }
        break
      case 'step.done': {
        const step = s.steps.find(x => x.id === e.id && x.status === 'started')

        if (step !== undefined) {
          Object.assign(step, { status: 'done', verified: e.verified, endedAt: e.at })
          s.failures = 0
        }
        break
      }

      case 'step.failed': {
        const step = s.steps.find(x => x.id === e.id && x.status === 'started')

        if (step !== undefined) {
          Object.assign(step, { status: 'failed', why: e.why, endedAt: e.at })
          s.failures += 1
          s.lastFailureAt = e.at
        }
        break
      }

      case 'parked':
        if (!s.parked.some(p => p.id === e.id && p.answer === undefined)) s.parked.push({ id: e.id, task: e.task, question: e.question, at: e.at })
        break
      case 'answered': {
        const held = s.parked.find(p => p.id === e.id && p.answer === undefined)

        if (held !== undefined) held.answer = e.answer
        break
      }

      case 'pause':
        if (s.phase === 'running') Object.assign(s, { phase: 'paused', reason: e.reason })
        break
      case 'resume':
        if (s.phase === 'paused') Object.assign(s, { phase: 'running', reason: null, failures: 0 })
        break
      case 'stop':
        Object.assign(s, { phase: 'stopped', reason: e.reason })
        break
      case 'beat':
        s.lastBeatAt = e.at
        break
      case 'adapt':
        s.receipts.push(e.receipt)
        break
      case 'digest':
        s.lastDigestDay = e.day
        break
    }
  }

  return compactState(s)
}

/** Old finished steps are forgotten so weeks of running stay small; started steps and unanswered parks are never dropped. */
export function compactState(s: LoopState): LoopState {
  const live = s.steps.filter(step => step.status === 'started')
  const rest = s.steps.filter(step => step.status !== 'started').slice(-KEEP_STEPS)
  const keep = new Set([...live, ...rest])

  return { ...s, steps: s.steps.filter(step => keep.has(step)), parked: s.parked.slice(-200), receipts: s.receipts.slice(-200) }
}

export type TaskFact = { id: string; title: string; /** The envelope class the task needs, or null when it cannot be classified (it is parked, never guessed). */ cls: string | null; /** A hard deny the task text names, or null. */ hardDeny: string | null; /** A path the task names, when one can be read from it. */ path: string | null }
export type EffectFact = 'done' | 'done-unverified' | 'failed' | 'absent' | 'unknown'
export type Preflight = 'allow' | 'deny' | 'ask' | 'unwired'
export type Tunables = { parallelism: number; retries: number; stepTimeoutMs: number; tierOf: (cls: string) => string }

export type Facts = {
  nowMs: number
  killSeen: boolean
  /** Null when the sealed envelope is missing, invalid or does not match its hash. */
  envelope: Envelope | null
  anatole: 'on' | 'off' | 'absent'
  /** Null when the cost ledger has not been read: unknown is never drawn or treated as $0. */
  spend: Spend | null
  /** The next ready task the picker chose, already excluding parked and denied tasks (`skipSet`). */
  task: TaskFact | null
  effects: Readonly<Record<string, EffectFact>>
  /** Started steps that no executor in this process is working on (they began before a restart). */
  orphans: ReadonlySet<string>
  tunables: Tunables
  preflight: Readonly<Record<string, Preflight>>
}

export type Decision = { events: JournalEvent[]; act: { id: string; task: TaskFact; cls: string; attempt: number; tier: string; deadline: number } | null; status: string }

const idle = (status: string, events: JournalEvent[] = []): Decision => ({ events, act: null, status })

/** The tasks the picker must skip: parked and waiting, denied, or already carrying a started or done step. */
export function skipSet(s: LoopState): Set<string> {
  return new Set([...s.parked.filter(p => p.answer === undefined || p.answer === 'deny' || p.isUsed === true).map(p => p.task), ...s.steps.filter(step => step.status !== 'failed').map(step => step.task)])
}

const parkId = (task: string, why: string): string => `p-${sha256(`${task}:${why}`).slice(0, 12)}`
export const stepId = (task: string, attempt: number): string => `s-${sha256(`${task}:${attempt}`).slice(0, 16)}`

export const backoffMs = (failures: number): number => Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1))

/** Why a task cannot run inside the envelope, or null when it can. Ambiguous or out of scope means park with a question. */
export function whyParked(task: TaskFact, env: Envelope, preflight: Readonly<Record<string, Preflight>>): string | null {
  if (task.hardDeny !== null) return `needs "${task.hardDeny}", which autopilot can never do. Do it yourself, or deny it.`
  if (task.cls === null) return 'cannot tell which kind of action this needs, and autopilot does not guess. Which class is it?'
  if (!classAllowed(env, task.cls)) return `needs "${task.cls}", which the envelope does not allow. Approve once, or deny.`
  if (task.path !== null && !pathAllowed(env, task.path)) return `touches ${task.path.slice(0, 80)}, outside the envelope's folders. Approve once, or deny.`
  if (preflight[task.cls] === 'deny' || preflight[task.cls] === 'ask') return `your permission settings would not allow "${task.cls}" without asking. Approve once here (the engine still decides), or deny.`

  return null
}

/** One pass. See the file header for why the order matters. */
export function tick(s: LoopState, f: Facts): Decision {
  const now = f.nowMs

  if (s.phase === 'stopped') return idle(`stopped: ${s.reason ?? 'stopped'}`)
  if (f.killSeen) return idle('stopped: kill switch', [{ t: 'stop', at: now, reason: 'kill switch' }])
  if (s.phase === 'idle') return idle('not started')

  const events: JournalEvent[] = []

  // 1. Settle what is in flight: finished, timed out, or lost to a restart. Never rerun it here.
  const open = s.steps.filter(step => step.status === 'started')
  let failures = s.failures
  let lastFailure = s.lastFailureAt
  let stillOpen = 0

  for (const step of open) {
    const effect = f.effects[step.id] ?? 'unknown'

    if (effect === 'done' || effect === 'done-unverified') {
      events.push({ t: 'step.done', at: now, id: step.id, verified: effect === 'done' })
      failures = 0
    } else if (effect === 'failed') {
      events.push({ t: 'step.failed', at: now, id: step.id, why: 'the task reported failure' })
      failures += 1
      lastFailure = now
    } else if (now > step.deadline) {
      events.push({ t: 'step.failed', at: now, id: step.id, why: 'timed out' })
      failures += 1
      lastFailure = now
    } else if (f.orphans.has(step.id) && effect === 'absent') {
      events.push({ t: 'step.failed', at: now, id: step.id, why: 'lost on restart: no effect found' })
      failures += 1
      lastFailure = now
    } else stillOpen += 1
  }

  if (s.phase === 'paused') return idle(`paused: ${s.reason ?? 'paused'}`, events)

  const stopWith = (reason: string): Decision => ({ events: [...events, { t: 'stop', at: now, reason }], act: null, status: `stopped: ${reason}` })
  const pauseWith = (reason: string): Decision => ({ events: [...events, { t: 'pause', at: now, reason }], act: null, status: `paused: ${reason}` })

  // 2. The envelope, the clock, Anatole.
  if (f.envelope === null) return stopWith('the envelope is missing, invalid or was changed outside the console')
  if (s.startedAtMs !== null && now - s.startedAtMs > f.envelope.maxDurationMs) return stopWith('the envelope\'s maximum duration passed')
  if (f.anatole !== 'on' && !f.envelope.acceptWithoutAnatole) return pauseWith(f.anatole === 'off' ? 'Project Anatole is off' : 'Project Anatole is not installed')

  // 3. Spend. Total first: 100% stops, 80% pauses (nothing in flight is cut); an hour or day ceiling only holds the next step back.
  if (f.spend === null) return { events, act: null, status: 'waiting: spend not read yet' }
  if (f.spend.totalUsd >= f.envelope.spend.totalUsd) return stopWith('total spend ceiling reached')
  if (f.spend.totalUsd >= f.envelope.spend.totalUsd * PAUSE_AT) return pauseWith('80% of the total spend ceiling')
  if (f.spend.dayUsd >= f.envelope.spend.dayUsd) return { events, act: null, status: 'waiting: day spend ceiling' }
  if (f.spend.hourUsd >= f.envelope.spend.hourUsd) return { events, act: null, status: 'waiting: hour spend ceiling' }

  // 4. Failure ladder: a budget that pauses, a backoff that waits.
  if (failures >= FAILURE_BUDGET) return pauseWith(`${failures} failures in a row`)
  if (failures > 0 && lastFailure !== null && now - lastFailure < backoffMs(failures)) return { events, act: null, status: `backing off after ${failures} failure${failures === 1 ? '' : 's'}` }

  // 5. Room to start one.
  if (stillOpen >= Math.min(f.envelope.concurrency, Math.max(1, f.tunables.parallelism))) return { events, act: null, status: `${stillOpen} step${stillOpen === 1 ? '' : 's'} running` }

  const task = f.task

  if (task === null) {
    if (s.lastBeatAt === null || now - s.lastBeatAt >= BEAT_MS) events.push({ t: 'beat', at: now })

    return { events, act: null, status: 'nothing ready' }
  }

  // 6. Never twice: a task with a started or done step, or that was denied, is not started.
  if (s.steps.some(step => step.task === task.id && step.status !== 'failed')) return { events, act: null, status: `task ${task.id} already has a step` }

  const attempt = 1 + s.steps.filter(step => step.task === task.id && step.status === 'failed').length
  // A hard deny can never be approved once: the answer is ignored for it.
  const answeredOnce = task.hardDeny === null && s.parked.some(p => p.task === task.id && p.answer === 'once' && p.isUsed !== true)

  if (!answeredOnce && attempt > 1 + f.tunables.retries) {
    const why = whyParked({ ...task, cls: task.cls }, f.envelope, f.preflight) ?? `failed ${attempt - 1} times, past the retry policy. Retry once, or deny.`

    return park(s, events, task, 'retries', why, now)
  }

  const why = answeredOnce ? null : whyParked(task, f.envelope, f.preflight)

  if (why !== null) return park(s, events, task, why, why, now)

  const cls = task.cls ?? 'read'
  const tier = f.tunables.tierOf(cls)

  return { events: [...events, { t: 'step.started', at: now, id: stepId(task.id, attempt), task: task.id, cls, attempt, deadline: now + f.tunables.stepTimeoutMs, tier, par: f.tunables.parallelism }], act: { id: stepId(task.id, attempt), task, cls, attempt, tier, deadline: now + f.tunables.stepTimeoutMs }, status: `started ${task.id}` }
}

function park(s: LoopState, events: JournalEvent[], task: TaskFact, key: string, question: string, now: number): Decision {
  const id = parkId(task.id, key)

  if (!s.parked.some(p => p.id === id && p.answer === undefined)) events.push({ t: 'parked', at: now, id, task: task.id, question })

  return { events, act: null, status: `parked ${task.id}` }
}

/** The facts the band and the panel draw from a state: nothing here is a placeholder. */
export type Summary = { phase: Phase; day: number | null; running: number; parked: number; done: number; failed: number; unverified: number; reason: string | null }

export function summarize(s: LoopState, nowMs: number): Summary {
  return {
    phase: s.phase,
    day: s.startedAtMs === null ? null : Math.floor(Math.max(0, nowMs - s.startedAtMs) / 86_400_000) + 1,
    running: s.steps.filter(step => step.status === 'started').length,
    parked: s.parked.filter(p => p.answer === undefined).length,
    done: s.steps.filter(step => step.status === 'done').length,
    failed: s.steps.filter(step => step.status === 'failed').length,
    unverified: s.steps.filter(step => step.status === 'done' && step.verified === false).length,
    reason: s.reason,
  }
}

/** The band text: `autopilot day 3 · $12/$40 · 2 parked`. A spend that was not read is `$n/a`, never `$0`. */
export function bandText(s: LoopState, nowMs: number, spendUsd: number | null, env: Envelope | null): string {
  const sum = summarize(s, nowMs)

  if (sum.phase === 'idle') return ''

  const money = (n: number): string => `$${Math.round(n * 100) / 100}`
  const cost = `${spendUsd === null ? '$n/a' : money(spendUsd)}/${env === null ? '$n/a' : money(env.spend.totalUsd)}`
  const state = sum.phase === 'running' ? '' : ` ${sum.phase}`

  return `autopilot${state} day ${sum.day ?? 'n/a'} · ${cost} · ${sum.parked} parked`
}

/** Events that fold back to this state's live parts, for compaction: a rotated journal starts from these and the old one is archived. */
export function snapshotEvents(s: LoopState): JournalEvent[] {
  if (s.startedAtMs === null || s.envHash === null || s.revision === null || s.anatole === null) return []

  const out: JournalEvent[] = [{ t: 'start', at: s.startedAtMs, envHash: s.envHash, revision: s.revision, anatole: s.anatole }]

  for (const p of s.parked) {
    out.push({ t: 'parked', at: p.at, id: p.id, task: p.task, question: p.question })
    if (p.answer !== undefined) out.push({ t: 'answered', at: p.at, id: p.id, answer: p.answer })
  }

  for (const step of s.steps.slice(-50)) {
    out.push({ t: 'step.started', at: step.startedAt, id: step.id, task: step.task, cls: step.cls, attempt: step.attempt, deadline: step.deadline, tier: step.tier, ...(step.par !== undefined && { par: step.par }) })
    if (step.status === 'done') out.push({ t: 'step.done', at: step.endedAt ?? step.startedAt, id: step.id, verified: step.verified === true })
    if (step.status === 'failed') out.push({ t: 'step.failed', at: step.endedAt ?? step.startedAt, id: step.id, why: step.why ?? 'failed' })
  }

  for (const receipt of s.receipts) out.push({ t: 'adapt', at: receipt.at, receipt })
  if (s.lastDigestDay !== null) out.push({ t: 'digest', at: s.startedAtMs, day: s.lastDigestDay })
  if (s.phase === 'paused') out.push({ t: 'pause', at: s.startedAtMs, reason: s.reason ?? 'paused' })
  if (s.phase === 'stopped') out.push({ t: 'stop', at: s.startedAtMs, reason: s.reason ?? 'stopped' })

  return out
}

/** The daily digest line: what the last 24 hours did, from the steps the journal still holds. Spend is drawn only when it was read. */
export function digestText(s: LoopState, nowMs: number, spendUsd: number | null): string {
  const since = nowMs - 86_400_000
  const day = s.steps.filter(step => (step.endedAt ?? step.startedAt) >= since)
  const done = day.filter(step => step.status === 'done')
  const adapted = s.receipts.filter(r => r.at >= since).length

  return `autopilot digest: ${done.filter(step => step.verified === true).length} verified, ${done.filter(step => step.verified !== true).length} unverified, ${day.filter(step => step.status === 'failed').length} failed · ${s.parked.filter(p => p.answer === undefined).length} parked · ${adapted} adaptation${adapted === 1 ? '' : 's'} · spend ${spendUsd === null ? 'n/a' : `$${Math.round(spendUsd * 100) / 100}`}`
}
