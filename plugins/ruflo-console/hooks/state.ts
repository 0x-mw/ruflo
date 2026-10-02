import type { PluginOptions, Timer } from 'claude-code'

import type { ProbeResult, ViewId } from './data/cli'
import type { ReadCache } from './data/files'
import type { Snapshot } from './data/snapshot'
import type { RufloRoute, RufloSnapshot } from '../types'

export const PLUGIN_NAME = 'ruflo-console'
export const PANE_ID = 'ruflo-console'

/** The views in tab order, each with its hotkey (a digit: letters are the actions'). */
export const VIEWS: readonly { id: ViewId; key: string; label: string; rows: number }[] = [
  { id: 'overview', key: '1', label: 'Overview', rows: 24 },
  { id: 'swarm', key: '2', label: 'Swarms', rows: 28 },
  { id: 'claims', key: '3', label: 'Claims', rows: 26 },
  { id: 'federation', key: '4', label: 'Federation', rows: 22 },
  { id: 'plugins', key: '5', label: 'Plugins', rows: 28 },
  { id: 'learning', key: '6', label: 'Learning', rows: 26 },
  { id: 'metaharness', key: '7', label: 'MetaHarness', rows: 22 },
  { id: 'memory', key: '8', label: 'Memory', rows: 22 },
]

export const viewOf = (word: string): ViewId | null => {
  const lower = word.trim().toLowerCase()

  return VIEWS.find(view => view.id === lower || view.key === lower || view.label.toLowerCase() === lower || (lower.length >= 3 && view.id.startsWith(lower)))?.id ?? null
}

/**
 * `$.store` is the plugin's, not the folder's: the key carries the working directory, so a view chosen in one project
 * never follows the person into another (the ruflo-swarm leak).
 */
export const storeKeyOf = (cwd: string): string => `ruflo-console/ui:${cwd}`

/** How actions reach the ruflo CLI: each a fixed argv prefix. Only `npx` may download. */
export const CLI_PREFIXES = {
  'npx-offline': ['npx', '--offline', '-y', '@claude-flow/cli@latest'],
  npx: ['npx', '-y', '@claude-flow/cli@latest'],
  ruflo: ['ruflo'],
  'claude-flow': ['claude-flow'],
} as const satisfies Record<string, readonly string[]>

export type CliChoice = keyof typeof CLI_PREFIXES

export type Options = {
  cli: CliChoice
  /** How often the disk is re-read while the pane or bar shows (seconds, 2-60). */
  refreshSeconds: number
  /** The animation's frame cap while the pane is shown and focused (0 turns motion off). */
  fps: number
  /** `auto`: the band above the prompt shows in a ruflo project; `on`: always; `off`: never. */
  bar: 'auto' | 'on' | 'off'
  /** Lets the federation view ask the public relay for the roster. Off by default: no network without consent. */
  federationNetwork: boolean
}

const num = (value: unknown, fallback: number, lo: number, hi: number): number => {
  const n = typeof value === 'number' ? value : Number(value)

  return Number.isFinite(n) ? Math.min(Math.max(Math.round(n), lo), hi) : fallback
}

/** The options as the settings hold them, each one checked: a value the plugin does not know is its default. */
export function optionsOf(raw: PluginOptions | undefined): Options {
  const value = (raw ?? {}) as Record<string, unknown>

  return {
    cli: typeof value.cli === 'string' && value.cli in CLI_PREFIXES ? (value.cli as CliChoice) : 'npx-offline',
    refreshSeconds: num(value.refreshSeconds, 3, 2, 60),
    fps: num(value.fps, 8, 0, 10),
    bar: value.bar === 'on' || value.bar === 'off' ? value.bar : 'auto',
    federationNetwork: value.federationNetwork === true,
  }
}

/** A mutating action waiting for the person's second press. */
export type Pending = { label: string; args: readonly string[]; expect: string; askedAtMs: number }

/** What an action did: what ran, how it exited, and whether the disk shows the change. */
export type Outcome = { label: string; ok: boolean; verified: 'yes' | 'no' | 'n/a'; detail: string; atMs: number }

/** One module seen registering since the console loaded, as the engine's scan named it. */
export type ModSeen = { name: string; provenance: string; isLoaded: boolean; reason?: string; atMs: number }

export type State = {
  options: Options
  cwd: string
  home: string | null
  view: ViewId
  isHelp: boolean
  snapshot: Snapshot | null
  cache: ReadCache
  probes: Map<string, ProbeResult>
  ruflo: { snapshot: RufloSnapshot | null; route: RufloRoute | null; error: string | null }
  usage: { costUsd?: number; contextPercent?: number } | null
  rufloTools: number | null
  mods: ModSeen[]
  /** Tool calls the console saw, per 5 s bucket, newest last: a measured series. */
  activity: number[]
  /** ruflo state files that changed per refresh, newest last: a measured series. */
  writes: number[]
  pane: { isOpen: boolean; isShown: boolean; isFocused: boolean; columns: number; rows: number; placement: 'dock' | 'inline' }
  /** The size of each Raster as last mounted, by key: a blit of any other size is refused, so none is sent. */
  mounted: Map<string, { columns: number; rows: number }>
  select: { claim: number; agent: number; task: number }
  pending: Pending | null
  outcome: Outcome | null
  isActing: boolean
  isRefreshing: boolean
  timers: Map<string, Timer>
  stats: { renders: number[]; refreshes: number[]; frames: number[] }
}

export function newState(raw: PluginOptions | undefined): State {
  return {
    options: optionsOf(raw),
    cwd: '',
    home: null,
    view: 'overview',
    isHelp: false,
    snapshot: null,
    cache: new Map(),
    probes: new Map(),
    ruflo: { snapshot: null, route: null, error: null },
    usage: null,
    rufloTools: null,
    mods: [],
    activity: [],
    writes: [],
    pane: { isOpen: false, isShown: false, isFocused: false, columns: 0, rows: 0, placement: 'inline' },
    mounted: new Map(),
    select: { claim: 0, agent: 0, task: 0 },
    pending: null,
    outcome: null,
    isActing: false,
    isRefreshing: false,
    timers: new Map(),
    stats: { renders: [], refreshes: [], frames: [] },
  }
}

/** Keeps the newest `max` samples of a series. */
export function push(series: number[], value: number, max = 120): void {
  series.push(value)

  if (series.length > max) {
    series.splice(0, series.length - max)
  }
}

/** What is written to `$.store`: the person's choices only. */
export type Persisted = { view: ViewId }

export function restore(state: State, value: unknown): void {
  const held = value !== null && typeof value === 'object' ? (value as Partial<Persisted>) : {}

  if (typeof held.view === 'string' && VIEWS.some(view => view.id === held.view)) {
    state.view = held.view
  }
}
