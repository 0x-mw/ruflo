import type { PluginOptions } from 'claude-code'

/** The plugin's `userConfig`, validated: a bad value is the default (guard on, 100 dispatches per session). */
export type ModOptions = { readonly guard: boolean; readonly maxDispatch: number; readonly extra: Readonly<Record<string, unknown>> }

const flag = (value: unknown, fallback: boolean) =>
  value === true || value === 'true' || value === 'on' ? true : value === false || value === 'false' || value === 'off' ? false : fallback

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback
}

export function readOptions(options: PluginOptions | undefined): ModOptions {
  const o = options ?? {}
  const maxDispatch = clamp(o.maxDispatch, 1, 1000, 100)
  return { guard: flag(o.guard, true), maxDispatch, extra: { maxDispatch } }
}
