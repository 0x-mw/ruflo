import { readBounded, under, type ReadCache, type ReaderFs } from './files'
import { jsonObject } from './parse'

/** The most mod folders read, and the most bytes of one status file (a larger one is refused, not trimmed). */
export const MODS_MAX_FILES = 60
export const MODS_MAX_BYTES = 8192
/** A status file older than this was written by a session that has ended. */
export const MODS_STALE_MS = 6 * 3_600_000

const ROOT = '.claude-flow'
const DIR = /^[a-z0-9][a-z0-9-]{0,40}-mod$/

/** One mod's status file (ADR-446): the counters every mod writes; per-plugin counters are not read here. */
export type ModRow = { name: string; guard: boolean | null; calls: number | null; blocked: number; updatedMs: number | null; startedMs: number | null }

/** What the folder scan found: the rows kept, how many folders were refused (unknown shape, too large, unreadable), and whether the cap cut the list. */
export type ModsFacts = { rows: ModRow[]; refused: number; truncated: boolean }

export const NO_MODS: ModsFacts = { rows: [], refused: 0, truncated: false }

const whole = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null)

/** Parses one status file; anything that is not version 1 of an object is null (the console never guesses at a shape it does not know). */
export function parseModStatus(name: string, text: string | null): ModRow | null {
  const value = jsonObject(text)

  if (value === null || value.version !== 1) return null

  return {
    name: name.slice(0, -4),
    guard: typeof value.guard === 'boolean' ? value.guard : null,
    calls: whole(value.calls),
    blocked: whole(value.blocked) ?? 0,
    updatedMs: whole(value.updatedMs),
    startedMs: whole(value.startedMs),
  }
}

/** Blocked first (most blocked leading), then the most recently written, then by name. */
export function orderMods(rows: readonly ModRow[]): ModRow[] {
  return [...rows].sort((a, b) => Number(b.blocked > 0) - Number(a.blocked > 0) || b.blocked - a.blocked || (b.updatedMs ?? -1) - (a.updatedMs ?? -1) || a.name.localeCompare(b.name))
}

export const isStale = (row: ModRow, nowMs: number): boolean => row.updatedMs === null || nowMs - row.updatedMs > MODS_STALE_MS

/** Lists `.claude-flow` for `*-mod` folders and reads each `status.json`, bounded by count and size; never rejects. */
export async function readMods(fs: ReaderFs, cache: ReadCache, cwd: string): Promise<ModsFacts> {
  const entries = await fs.list(under(cwd, ROOT)).catch(() => null)

  if (entries === null) return NO_MODS

  const names = entries.filter(entry => entry.kind !== 'file' && DIR.test(entry.name)).map(entry => entry.name).sort()
  const kept = names.slice(0, MODS_MAX_FILES)
  const reads = await Promise.all(kept.map(async name => ({ name, read: await readBounded(fs, cache, under(cwd, `${ROOT}/${name}/status.json`), MODS_MAX_BYTES) })))
  const rows: ModRow[] = []
  let refused = 0

  for (const { name, read } of reads) {
    if (read.text === null && read.reason === 'missing') continue

    const row = parseModStatus(name, read.text)

    if (row === null) refused += 1
    else rows.push(row)
  }

  return { rows: orderMods(rows), refused, truncated: names.length > kept.length }
}
