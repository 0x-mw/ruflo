/**
 * Everything the console does over time, as plain functions over a Host: the disk refresh, the CLI probes, the
 * animation loop, and the claims actions with their confirm step. Nothing here reaches `$` but through the Host.
 */
import { claimTask, handoffClaim, releaseClaim, stealClaim, whyNot, type ActionSpec } from './actions'
import { PROBES, type ProbeResult } from './data/cli'
import { plain } from './data/parse'
import { readSnapshot } from './data/snapshot'
import { markPicture } from './gfx/pictures'
import type { Host } from './host'
import { CLI_PREFIXES, PANE_ID, push, storeKeyOf, VIEWS, type State } from './state'
import type { Actions } from './views/common'
import { picturesOf } from './views/frames'
import { selection, openTasks } from './views/select'

const ACTIVITY_BUCKET_MS = 5_000
const PANE_WATCH_MS = 1_000
const PENDING_TTL_MS = 30_000
const MAX_PARALLEL_PROBES = 2
const BAR_FRESH_MS = 10_000
const IDLE_REFRESH_MS = 30_000
const TOOLS_RECOUNT_MS = 30_000

export type Controller = {
  refresh: () => Promise<void>
  probe: (force?: boolean) => Promise<void>
  start: () => void
  /** Restarts the pane's watch after a reload left the pane up and the timers gone. */
  resume: () => void
  stop: () => void
  open: (focus?: boolean) => Promise<{ isPlaced: boolean; reason: string }>
  close: () => Promise<void>
  setView: (view: State['view']) => void
  animate: () => void
  noteToolCall: () => void
  actions: Actions
  /** Blits the band's mark while Claude works; the band calls it with its requestId. */
  markFrame: (requestId: string, isWorking: boolean) => void
}

/** With the band off, the console's words ride ruflo-mods' status line instead: claims and a stale marketplace only. */
export function segmentOf(state: State): string | null {
  const claims = state.snapshot?.claims ?? []
  const parts = [claims.length > 0 ? `${claims.length} claims` : '', state.snapshot?.plugins.missingFromClone.length ? 'marketplace stale' : ''].filter(Boolean)

  return parts.length === 0 ? null : parts.join(' · ')
}

const sorted = (values: readonly number[]) => [...values].sort((a, b) => a - b)

export const median = (values: readonly number[]) => sorted(values)[Math.floor(values.length / 2)] ?? 0
export const p95 = (values: readonly number[]) => sorted(values)[Math.min(values.length - 1, Math.floor(values.length * 0.95))] ?? 0

export function createController(state: State, host: Host): Controller {
  let activityCount = 0
  let pendingSpec: ActionSpec | null = null
  let markRequest: string | null = null
  let lastSegment: string | null | undefined
  let lastSpend: number | undefined
  let hasDrawn = false
  let toolsCountedAt = 0
  const lastAttempt = new Map<string, number>()

  const persist = () => void host.storeSet(storeKeyOf(state.cwd), { view: state.view }).catch(() => undefined)
  const isVisible = () => state.pane.isOpen && state.pane.isShown

  let inflight: Promise<void> | null = null

  /** Re-reads the disk and the ruflo noun; a call while one runs joins it rather than starting a second. */
  function refresh(): Promise<void> {
    inflight ??= readAll().finally(() => {
      inflight = null
    })

    return inflight
  }

  /** A read that starts after this call: what an action checks, since a read already running may predate its write. */
  async function freshRead(): Promise<void> {
    await inflight?.catch(() => undefined)

    // A file the action just created must not wait out the missing-file backoff.
    for (const [path, held] of state.cache) {
      if ('missingUntilMs' in held) state.cache.delete(path)
    }

    await refresh()
  }

  async function readAll(): Promise<void> {
    state.isRefreshing = true

    const started = Date.now()

    try {
      // Claude Code connects MCP servers after the session starts: count the ruflo tools again now and then.
      if (Date.now() - toolsCountedAt >= TOOLS_RECOUNT_MS) {
        toolsCountedAt = Date.now()
        void host.rufloTools().then(counted => void (state.rufloTools = counted), () => undefined)
      }

      const [settings, usage, snapshot, route] = await Promise.all([
        host.settings().catch(() => null),
        host.usage().catch(() => null),
        host.rufloSnapshot().catch((error: unknown) => {
          state.ruflo.error = plain(String(error), 120)

          return null
        }),
        host.rufloRoute().catch(() => null),
      ])

      state.snapshot = await readSnapshot(host.fs, state.cache, state.cwd, state.home, settings, Date.now())
      state.usage = usage
      state.ruflo.snapshot = snapshot
      state.ruflo.route = route ?? snapshot?.lastRoute ?? null
      push(state.writes, state.snapshot.changed)

      if (state.options.bar === 'off') {
        const text = segmentOf(state)

        if (text !== lastSegment) {
          lastSegment = text
          void host.rufloSegment(text).catch(() => undefined)
        }
      }
    } catch (error) {
      state.ruflo.error = plain(String(error), 120)
    } finally {
      state.isRefreshing = false
      push(state.stats.refreshes, Date.now() - started, 200)

      // Redraw only for something new while the pane is closed: the band need not repaint an unchanged line.
      const spend = state.usage?.costUsd

      if (state.pane.isOpen || (state.snapshot?.changed ?? 0) > 0 || spend !== lastSpend || !hasDrawn) {
        hasDrawn = true
        lastSpend = spend
        host.invalidate()
      }
    }
  }

  async function runProbe(probe: (typeof PROBES)[number]): Promise<void> {
    const held: ProbeResult = state.probes.get(probe.id) ?? { value: null, okAtMs: null, error: null, errorAtMs: null, isRunning: false }

    state.probes.set(probe.id, { ...held, isRunning: true })
    lastAttempt.set(probe.id, Date.now())

    try {
      const result = await host.run([...CLI_PREFIXES[state.options.cli], ...probe.args], probe.timeoutMs)
      const value = result.exitCode === 0 ? (probe.parse(result.stdout) as unknown) : null

      state.probes.set(
        probe.id,
        value !== null
          ? { value, okAtMs: Date.now(), error: null, errorAtMs: held.errorAtMs, isRunning: false }
          : {
              ...held,
              isRunning: false,
              errorAtMs: Date.now(),
              error: result.exitCode !== 0 ? `exit ${result.exitCode}: ${plain(result.stderr.split('\n').find(line => line.trim() !== '') ?? '', 100) || 'no message'}` : 'no JSON in the CLI output',
            },
      )
    } catch (error) {
      state.probes.set(probe.id, { ...held, isRunning: false, errorAtMs: Date.now(), error: plain(error instanceof Error ? error.message : String(error), 100) || 'refused' })
    } finally {
      host.invalidate()
    }
  }

  /** Runs the probes the view in front draws, each no more often than its cadence; `force` ignores the cadence. */
  async function probe(force = false): Promise<void> {
    const now = Date.now()
    const due = PROBES.filter(
      entry =>
        (isVisible() || force) &&
        entry.views.includes(state.view) &&
        (!entry.isNetwork || state.options.federationNetwork) &&
        state.probes.get(entry.id)?.isRunning !== true &&
        (force || now - (lastAttempt.get(entry.id) ?? 0) >= entry.everyMs),
    )

    for (let i = 0; i < due.length; i += MAX_PARALLEL_PROBES) {
      await Promise.all(due.slice(i, i + MAX_PARALLEL_PROBES).map(entry => runProbe(entry)))
    }
  }

  function every(name: string, ms: number, fn: () => void): void {
    if (!state.timers.has(name)) {
      state.timers.set(name, host.every(ms, fn))
    }
  }

  function cancel(name: string): void {
    state.timers.get(name)?.cancel()
    state.timers.delete(name)
  }

  /** One frame of every picture of the view in front, each blitted only at the size it was mounted. */
  function frame(): void {
    const started = Date.now()
    const pictures = picturesOf(state, state.pane.columns, Date.now(), Date.now())

    for (const [key, grid] of pictures) {
      const mounted = state.mounted.get(key)

      if (mounted !== undefined && mounted.columns === grid.columns && mounted.rows === grid.rows) {
        host.blit({ requestId: PANE_ID, key, cells: grid.encode(), columns: grid.columns, rows: grid.rows })
      }
    }

    push(state.stats.frames, Date.now() - started, 200)
  }

  /** Runs the frame loop while the pane is shown and holds the keys, at `fps`; stops it otherwise. */
  function animate(): void {
    const shouldRun = state.options.fps > 0 && isVisible() && state.pane.isFocused && state.mounted.size > 0

    if (!shouldRun) {
      cancel('frames')

      return
    }

    every('frames', Math.round(1000 / state.options.fps), frame)
  }

  /** Watches whether the pane is shown and focused, so the loop stops behind another tab and resumes in front. */
  async function watchPane(): Promise<void> {
    const panes = await host.panes().catch(() => null)
    const mine = panes?.find(pane => pane.id === PANE_ID)

    if (panes !== null) {
      state.pane.isOpen = mine !== undefined
      state.pane.isShown = mine?.isShown === true
      state.pane.isFocused = mine?.isFocused === true
    }

    if (!state.pane.isOpen) {
      cancel('watch')
    }

    animate()
  }

  function start(): void {
    let lastIdleMs = 0

    every('refresh', state.options.refreshSeconds * 1000, () => {
      const now = Date.now()
      const isSeen = state.pane.isOpen || now - state.barDrawnAtMs < BAR_FRESH_MS

      // Nothing on screen reads the disk: re-read only on the idle cadence, so a closed console costs nearly nothing.
      if (isSeen || now - lastIdleMs >= IDLE_REFRESH_MS) {
        lastIdleMs = now
        void refresh().then(() => probe())
      }
    })
    every('activity', ACTIVITY_BUCKET_MS, () => {
      push(state.activity, activityCount)
      activityCount = 0
    })
  }

  function resume(): void {
    every('watch', PANE_WATCH_MS, () => void watchPane())
  }

  function stop(): void {
    for (const timer of state.timers.values()) timer.cancel()
    state.timers.clear()
  }

  async function open(focus = true): Promise<{ isPlaced: boolean; reason: string }> {
    const rows = VIEWS.find(view => view.id === state.view)?.rows ?? 24

    try {
      const result = await host.openPane({ id: PANE_ID, title: 'ruflo console', rows, ...(focus && { focus: true, closeOnEscape: true, holdToasts: true }) })
      const isPlaced = result === undefined || result.isPlaced !== false

      state.pane.isOpen = isPlaced
      state.pane.isShown = isPlaced
      every('watch', PANE_WATCH_MS, () => void watchPane())
      void refresh().then(() => probe(true))

      return { isPlaced, reason: result?.reason ?? '' }
    } catch (error) {
      return { isPlaced: false, reason: plain(error instanceof Error ? error.message : String(error), 160) }
    }
  }

  async function close(): Promise<void> {
    state.pane.isOpen = false
    state.pane.isShown = false
    cancel('frames')
    cancel('watch')
    await host.closePane(PANE_ID).catch(() => undefined)
  }

  function setView(view: State['view']): void {
    state.isHelp = false

    if (view !== state.view) {
      state.view = view
      state.mounted.clear()
      persist()
      // A new view asks for its own height inline; the dock ignores it.
      if (state.pane.isOpen) void host.openPane({ id: PANE_ID, title: 'ruflo console', rows: VIEWS.find(entry => entry.id === view)?.rows ?? 24 }).catch(() => undefined)
      void probe(true)
    }

    host.invalidate()
  }

  function ask(spec: ActionSpec | null, why: string): void {
    if (spec === null) {
      state.outcome = { label: 'nothing to do', ok: false, verified: 'n/a', detail: why, atMs: Date.now() }
    } else {
      pendingSpec = spec
      state.pending = { label: spec.label, args: spec.args, expect: spec.expect, askedAtMs: Date.now() }
    }

    host.invalidate()
  }

  async function confirm(): Promise<void> {
    const spec = pendingSpec
    const isFresh = state.pending !== null && Date.now() - state.pending.askedAtMs < PENDING_TTL_MS

    pendingSpec = null
    state.pending = null

    if (spec === null || !isFresh || state.isActing) {
      host.invalidate()

      return
    }

    state.isActing = true
    host.invalidate()

    try {
      const result = await host.run([...CLI_PREFIXES[state.options.cli], ...spec.args], 60_000)
      const answer = /"success"\s*:\s*(true|false)/.exec(result.stdout)?.[1]
      const error = /"error"\s*:\s*"([^"]{0,160})"/.exec(result.stdout)?.[1]
      const ok = result.exitCode === 0 && answer !== 'false'

      await freshRead()

      const verified = state.snapshot === null ? 'n/a' : spec.verify(state.snapshot) ? 'yes' : 'no'

      state.outcome = { label: spec.label, ok: ok && verified !== 'no', verified, detail: ok ? `ruflo answered ok; expected ${spec.expect}` : plain(error ?? result.stderr, 120) || `exit ${result.exitCode}`, atMs: Date.now() }
    } catch (error) {
      state.outcome = { label: spec.label, ok: false, verified: 'n/a', detail: plain(error instanceof Error ? error.message : String(error), 120) || 'refused', atMs: Date.now() }
    } finally {
      state.isActing = false
      host.invalidate()
    }
  }

  const step = (key: keyof State['select'], by: number) => () => {
    state.select[key] += by
    host.invalidate()
  }

  const actions: Actions = {
    view: setView,
    refresh: () => void freshRead().then(() => probe(true)),
    help: () => {
      state.isHelp = !state.isHelp
      host.invalidate()
    },
    close: () => void close(),
    confirm: () => void confirm(),
    cancel: () => {
      pendingSpec = null
      state.pending = null
      host.invalidate()
    },
    claimPrev: step('claim', -1),
    claimNext: step('claim', 1),
    agentNext: step('agent', 1),
    taskNext: step('task', 1),
    claim: () => {
      const { agent, task, claim } = selection(state)

      ask(task !== null && agent !== null ? claimTask(task, agent) : null, whyNot('claim', claim, agent, openTasks(state)[0] ?? task))
    },
    release: () => {
      const { claim, agent, task } = selection(state)

      ask(claim !== null ? releaseClaim(claim) : null, whyNot('release', claim, agent, task))
    },
    handoff: () => {
      const { claim, agent, task } = selection(state)

      ask(claim !== null && agent !== null ? handoffClaim(claim, agent) : null, whyNot('handoff', claim, agent, task))
    },
    steal: () => {
      const { claim, agent, task } = selection(state)

      ask(claim !== null && agent !== null ? stealClaim(claim, agent) : null, whyNot('steal', claim, agent, task))
    },
  }

  function markFrame(requestId: string, isWorking: boolean): void {
    markRequest = requestId

    if (isWorking && state.options.fps > 0) {
      every('mark', Math.round(1000 / state.options.fps), () => {
        if (markRequest !== null) host.blit({ requestId: markRequest, key: 'mark', cells: markPicture(true, Date.now()).encode(), columns: 2, rows: 1 })
      })
    } else {
      cancel('mark')
    }
  }

  return { refresh, probe, start, resume, stop, open, close, setView, animate, noteToolCall: () => void (activityCount += 1), actions, markFrame }
}
