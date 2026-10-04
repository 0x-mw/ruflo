import type { PluginOptions } from 'claude-code'

/** The plugin's `userConfig`, validated: a bad value is the default (guard on). */
export type ModOptions = { readonly guard: boolean }

const flag = (value: unknown, fallback: boolean) =>
  value === true || value === 'true' || value === 'on' ? true : value === false || value === 'false' || value === 'off' ? false : fallback

export function readOptions(options: PluginOptions | undefined): ModOptions {
  return { guard: flag((options ?? {}).guard, true) }
}

export const modeOf = (o: ModOptions): Record<string, boolean> => ({ guard: o.guard })
