import type { PluginOptions } from 'claude-code'

/** The plugin's `userConfig`, validated: a bad value is the default (both on). */
export type ModOptions = { readonly guard: boolean; readonly personal: boolean }

const flag = (value: unknown, fallback: boolean) =>
  value === true || value === 'true' || value === 'on' ? true : value === false || value === 'false' || value === 'off' ? false : fallback

export function readOptions(options: PluginOptions | undefined): ModOptions {
  const o = options ?? {}
  return { guard: flag(o.guard, true), personal: flag(o.personal, true) }
}

export const modeOf = (o: ModOptions): Record<string, boolean> => ({ guard: o.guard, personal: o.personal })
