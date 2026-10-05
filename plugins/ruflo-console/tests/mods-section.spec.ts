/**
 * The Mods section (ADR-446 status files): the shape-checked parser, the order, the file and size caps, hostile content, and the folder scan.
 *   npx vitest run plugins/ruflo-console/tests/mods-section.spec.ts
 */
import { describe, expect, it } from 'vitest'

import type { ReaderFs } from '../hooks/data/files'
import { newState } from '../hooks/state'
import { readSnapshot } from '../hooks/data/snapshot'
import type { Actions } from '../hooks/views/common'
import { viewText } from '../hooks/views/pane'
import { isStale, MODS_MAX_BYTES, MODS_MAX_FILES, MODS_STALE_MS, orderMods, parseModStatus, readMods, type ModRow } from '../hooks/data/mods'

const status = (extra: Record<string, unknown> = {}) => JSON.stringify({ version: 1, updatedMs: 1_000, calls: 5, blocked: 0, startedMs: 500, guard: true, ...extra })
const row = (name: string, blocked: number, updatedMs: number | null): ModRow => ({ name, guard: true, calls: 1, blocked, updatedMs, startedMs: null })

/** A fake project: folder name → status text (null = no status.json), plus loose files. */
function fakeFs(mods: Record<string, string | null>, loose: string[] = []): ReaderFs & { reads: string[] } {
  const reads: string[] = []

  return {
    reads,
    list: async () => [...Object.keys(mods).map(name => ({ name, kind: 'directory' })), ...loose.map(name => ({ name, kind: 'file' }))],
    stat: async path => {
      const text = mods[path.split('/').at(-2) ?? '']

      if (text === null || text === undefined) throw new Error('ENOENT')

      return { mtimeMs: 1, size: text.length }
    },
    read: async path => {
      reads.push(path)

      return mods[path.split('/').at(-2) ?? ''] ?? ''
    },
  }
}

describe('parseModStatus', () => {
  it('reads version 1 and names the mod from its folder, never from the file', () => {
    expect(parseModStatus('docs-mod', status({ mod: 'evil' }))).toEqual({ name: 'docs', guard: true, calls: 5, blocked: 0, updatedMs: 1000, startedMs: 500 })
  })

  it('refuses unknown versions and junk', () => {
    for (const text of [status({ version: 2 }), status({ version: '1' }), 'nope', '[]', '"x"', 'null', '', null]) expect(parseModStatus('docs-mod', text)).toBeNull()
  })

  it('treats hostile numbers and types as absent, not as values', () => {
    const parsed = parseModStatus('docs-mod', JSON.stringify({ version: 1, calls: -3, blocked: 'lots', updatedMs: 1e999, guard: 'yes', startedMs: null, __proto__: { x: 1 } }))

    expect(parsed).toEqual({ name: 'docs', guard: null, calls: null, blocked: 0, updatedMs: null, startedMs: null })
  })

  it('floors fractions and is stale when old or unwritten', () => {
    expect(parseModStatus('a-mod', status({ calls: 2.9 }))?.calls).toBe(2)
    expect(isStale(row('a', 0, 1000), 1000 + MODS_STALE_MS)).toBe(false)
    expect(isStale(row('a', 0, 1000), 1001 + MODS_STALE_MS)).toBe(true)
    expect(isStale(row('a', 0, null), 5)).toBe(true)
  })
})

describe('orderMods', () => {
  it('leads with blocked (most first), then newest, then name', () => {
    const ordered = orderMods([row('b', 0, 10), row('a', 0, 10), row('z', 1, 1), row('y', 4, 1), row('n', 0, 99), row('u', 0, null)])

    expect(ordered.map(mod => mod.name)).toEqual(['y', 'z', 'n', 'a', 'b', 'u'])
  })
})

describe('readMods', () => {
  it('reads only *-mod folders and skips a folder with no status file', async () => {
    const fs = fakeFs({ 'docs-mod': status({ blocked: 2 }), 'sparc-mod': status(), 'agentdb': status(), 'quiet-mod': null, 'Bad-Mod': status(), '..-mod': status() }, ['loose-mod'])
    const mods = await readMods(fs, new Map(), '/p')

    expect(mods.rows.map(mod => mod.name)).toEqual(['docs', 'sparc'])
    expect(mods).toMatchObject({ refused: 0, truncated: false })
    expect(fs.reads.every(path => path.startsWith('/p/.claude-flow/') && path.endsWith('/status.json'))).toBe(true)
  })

  it('caps the folders read at 60 and says so', async () => {
    const many = Object.fromEntries(Array.from({ length: 75 }, (_, i) => [`m${String(i).padStart(2, '0')}-mod`, status()]))
    const fs = fakeFs(many)
    const mods = await readMods(fs, new Map(), '/p')

    expect(mods.rows).toHaveLength(MODS_MAX_FILES)
    expect(fs.reads).toHaveLength(MODS_MAX_FILES)
    expect(mods.truncated).toBe(true)
  })

  it('refuses a file over 8 KB without reading it, and counts unknown shapes as refused', async () => {
    const fs = fakeFs({ 'big-mod': status({ pad: 'x'.repeat(MODS_MAX_BYTES) }), 'odd-mod': status({ version: 9 }), 'junk-mod': '{{{', 'ok-mod': status() })
    const mods = await readMods(fs, new Map(), '/p')

    expect(mods.rows.map(mod => mod.name)).toEqual(['ok'])
    expect(mods.refused).toBe(3)
    expect(fs.reads.some(path => path.includes('/big-mod/'))).toBe(false)
  })

  it('answers none when the folder cannot be listed', async () => {
    const fs: ReaderFs = { list: async () => Promise.reject(new Error('EACCES')), stat: async () => undefined, read: async () => '' }

    expect(await readMods(fs, new Map(), '/p')).toEqual({ rows: [], refused: 0, truncated: false })
  })
})

describe('the Mods section on the pages', () => {
  const act = new Proxy(() => undefined, { get: () => act, apply: () => undefined }) as unknown as Actions
  const empty: ReaderFs = { read: () => Promise.reject(new Error('ENOENT')), stat: () => Promise.reject(new Error('ENOENT')), list: () => Promise.reject(new Error('ENOENT')) }
  const draw = async (view: 'room' | 'overview', rows: ModRow[], extra: { refused?: number; truncated?: boolean } = {}) => {
    const state = newState({})
    const snapshot = await readSnapshot(empty, new Map(), '/work', '/home/dev', {}, 0)

    state.snapshot = { ...snapshot, mods: { rows: orderMods(rows), refused: extra.refused ?? 0, truncated: extra.truncated ?? false } }
    state.view = view

    return viewText({ state, nowMs: 30_000_000, columns: 100, act }, view)
  }

  it('the Room leads with a blocking mod and marks a stale one', async () => {
    const text = await draw('room', [row('quiet', 0, 30_000_000 - 5000), row('docs', 3, 30_000_000 - 60_000), row('old', 0, 1000)], { refused: 2 })
    const lines = text.split('\n')

    expect(text).toContain('Mods')
    expect(text).toContain('3 reporting · 1 blocked something')
    expect(lines.findIndex(l => l.includes('docs'))).toBeLessThan(lines.findIndex(l => l.includes('quiet')))
    expect(text).toMatch(/old.*stale \(an earlier session\)/)
    expect(text).toContain('2 status files not shown')
  })

  it('says none reporting when no mod has written, and Overview carries the count and the link', async () => {
    const overview = await draw('overview', [row('docs', 1, 29_999_000)])

    expect(await draw('room', [])).toContain('No mod has written a status file')
    expect(overview).toMatch(/mods reporting\s+1 · 1 blocked something/)
    expect(overview).toContain('The Room: Mods')
  })
})
