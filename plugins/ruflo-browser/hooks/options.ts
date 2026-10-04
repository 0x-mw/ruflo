import type { PluginOptions } from 'claude-code'

/** The plugin's `userConfig`, validated: a bad value is the safe default (guard on, plain http allowed). */
export type ModOptions = { readonly guard: boolean; readonly strictUrls: boolean }

const flag = (value: unknown, fallback: boolean) =>
  value === true || value === 'true' || value === 'on' ? true : value === false || value === 'false' || value === 'off' ? false : fallback

export const readOptions = (options: PluginOptions | undefined): ModOptions => ({
  guard: flag(options?.guard, true),
  strictUrls: flag(options?.strictUrls, false),
})

export const modeOf = (o: ModOptions) => ({ guard: o.guard, strictUrls: o.strictUrls })
