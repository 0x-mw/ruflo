import type { PluginOptions } from 'claude-code'

import { budgetOf } from './cost/budget'

/** The plugin's `userConfig` options, validated: a bad value is the default. */
export type ModOptions = {
  readonly routeContext: boolean
  readonly statusLine: boolean
  readonly costBudgetUsd?: number
  readonly costHardStop: boolean
}

const bool = (value: unknown, fallback: boolean) =>
  value === true || value === 'true' ? true : value === false || value === 'false' ? false : fallback

export function readOptions(options: PluginOptions | undefined): ModOptions {
  const o = options ?? {}
  return {
    routeContext: bool(o.routeContext, true),
    statusLine: bool(o.statusLine, true),
    costBudgetUsd: budgetOf(o.costBudgetUsd),
    costHardStop: bool(o.costHardStop, false),
  }
}
