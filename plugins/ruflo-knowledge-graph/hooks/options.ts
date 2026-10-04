import type { PluginOptions } from 'claude-code'

/** The plugin's `userConfig`, validated: a bad value is the default (guard on, graph deletes confirmed). */
export type ModOptions = { readonly guard: boolean; readonly confirmDeletes: boolean; readonly extra: Readonly<Record<string, unknown>> }

const flag = (value: unknown, fallback: boolean) =>
  value === true || value === 'true' || value === 'on' ? true : value === false || value === 'false' || value === 'off' ? false : fallback

export function readOptions(options: PluginOptions | undefined): ModOptions {
  const o = options ?? {}
  const confirmDeletes = flag(o.confirmDeletes, true)
  return { guard: flag(o.guard, true), confirmDeletes, extra: { confirmDeletes } }
}
