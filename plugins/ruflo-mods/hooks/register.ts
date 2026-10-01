import type { Register } from 'claude-code'

import { registerCost } from './cost'
import { registerGuard } from './guard'
import { registerLearn } from './learn'
import { readOptions } from './options'
import { registerRoute } from './route'
import { registerSession } from './session'
import { createState } from './state'

/**
 * ruflo as a Claude Code mod (ADR-404, early access).
 *
 * In-process equivalents of the classic hook-handler.cjs events that fire on
 * every prompt and every edit, plus tighten-only tool checks and the cost
 * ladder. Additive and opt-in: the classic hooks stay the default, keep every
 * event the mod does not own, and take everything back whenever the mod is not
 * loaded (function hooks off, `allowManagedModsOnly`, a failed start).
 */
export const register: Register = (on, options) => {
  const state = createState()
  const opts = readOptions(options)

  registerSession(on, state, opts)
  registerRoute(on, state, opts)
  registerGuard(on, state)
  registerLearn(on, state)
  registerCost(on, state, opts)
}
