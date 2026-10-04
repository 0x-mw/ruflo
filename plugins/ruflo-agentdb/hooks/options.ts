import type { PluginOptions } from 'claude-code'

export type Source = 'auto' | 'agentdb' | 'ruvector' | 'none'

/** The plugin's `userConfig`, validated: a bad value is the default (recall off, guard on). */
export type ModOptions = {
  readonly recall: boolean
  readonly recallLimit: number
  readonly recallDeadlineMs: number
  readonly guard: boolean
  readonly source: Source
}

const SOURCES: readonly Source[] = ['auto', 'agentdb', 'ruvector', 'none']

const flag = (value: unknown, fallback: boolean) =>
  value === true || value === 'true' || value === 'on' ? true : value === false || value === 'false' || value === 'off' ? false : fallback

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback
}

export function readOptions(options: PluginOptions | undefined): ModOptions {
  const o = options ?? {}
  return {
    recall: flag(o.recall, false),
    recallLimit: clamp(o.recallLimit, 1, 5, 3),
    recallDeadlineMs: clamp(o.recallDeadlineMs, 200, 3000, 800),
    guard: flag(o.guard, true),
    source: SOURCES.includes(o.source as Source) ? (o.source as Source) : 'auto',
  }
}
