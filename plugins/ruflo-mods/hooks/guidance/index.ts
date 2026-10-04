import type { On } from 'claude-code'

import { cachedFile } from '../files'
import type { ModOptions } from '../options'
import { under, type ModState } from '../state'
import { finishTask, flushObservations, newRunId, OBSERVATIONS_DIR } from './observations'
import { MAX_PROJECTION_BYTES, parseProjection, PROJECTION_PATH, selectGuidance } from './projection'

/** Optional retrieval and candidate telemetry. No training, authority or promotion. */
export function registerGuidance(on: On, state: ModState, options: ModOptions) {
  const s = state.guidance
  const enabled = options.guidanceContext || options.guidanceLearning
  if (!enabled) return
  const projection = cachedFile(() => under(state, PROJECTION_PATH), parseProjection)
  const queuePath = () => under(state, `${OBSERVATIONS_DIR}/${s.runId}.json`)

  on('session.start', ($, e, next) => {
    if (enabled && !s.runId) { s.runId = newRunId(); s.status = 'missing' }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (!enabled || !s.runId) return next(e)
    if (options.guidanceLearning) finishTask(s, 'interrupted')
    const read = await projection({
      stat: async path => {
        const stat = await $.fs.stat(path)
        if (stat.isLink || stat.size > MAX_PROJECTION_BYTES) throw new Error('invalid guidance file')
        return stat
      },
      read: path => $.fs.read(path),
    })
    s.status = read.kind === 'ok' ? 'ready' : read.kind === 'absent' ? 'missing' : 'unreadable'
    if (read.kind !== 'ok') return next(e)
    const selected = selectGuidance(e.text, read.value)
    if (options.guidanceLearning) {
      s.active = { taskId: ++s.taskSeq, projection: read.value, ruleIds: options.guidanceContext ? selected.ids : [], checks: { allow: 0, ask: 0, deny: 0 }, tools: { ok: 0, error: 0, denied: 0 }, toolIds: new Set() }
    }
    return next(options.guidanceContext && selected.context ? { ...e, context: [...(e.context ?? []), selected.context] } : e)
  }).catch(($, e, next) => next(e))

  on('tool.check', async ($, e, next) => {
    const task = s.active
    const result = await next(e)
    if (task && ['allow', 'ask', 'deny'].includes(result.decision)) task.checks[result.decision as 'allow' | 'ask' | 'deny']++
    return result
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    // Capture before awaiting: another prompt cannot acquire this event.
    const task = s.active
    const result = await next(e)
    if (!task) return result
    // Host ids only deduplicate telemetry in memory; never persist arbitrary ids/inputs.
    const id = (e as unknown as { tool_use_id?: unknown }).tool_use_id
    if (typeof id === 'string') {
      if (task.toolIds.has(id)) return result
      if (task.toolIds.size >= 256) return result
      task.toolIds.add(id)
    }
    if (result.deny !== undefined) task.tools.denied++
    else if (result.isError === true) task.tools.error++
    else task.tools.ok++
    return result
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (options.guidanceLearning && s.runId) {
      if (!s.seenTurns.has(e.turnId)) {
        if (s.seenTurns.size < 256) s.seenTurns.add(e.turnId)
        finishTask(s, e.isAborted ? 'aborted' : 'completed')
      }
      await flushObservations(s, queuePath(), { read: path => $.fs.read(path), write: (path, text) => $.fs.write(path, text) })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    if (options.guidanceLearning && s.runId) {
      finishTask(s, 'interrupted')
      await flushObservations(s, queuePath(), { read: path => $.fs.read(path), write: (path, text) => $.fs.write(path, text) })
    }
    return next(e)
  }).catch(($, e, next) => next(e))
}
