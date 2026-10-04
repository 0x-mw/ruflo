import type { PluginOptions } from 'claude-code'

/** The plugin's `userConfig`, validated: a bad value is the safe default (guard on, wildcard bind refused). */
export type ModOptions = { readonly guard: boolean; readonly allowWildcardBind: boolean }

const flag = (value: unknown, fallback: boolean) =>
  value === true || value === 'true' || value === 'on' ? true : value === false || value === 'false' || value === 'off' ? false : fallback

export const readOptions = (options: PluginOptions | undefined): ModOptions => ({
  guard: flag(options?.guard, true),
  allowWildcardBind: flag(options?.allowWildcardBind, false),
})

export const modeOf = (o: ModOptions) => ({ guard: o.guard, allowWildcardBind: o.allowWildcardBind })
