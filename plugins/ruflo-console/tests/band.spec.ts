/**
 * The band's words under vitest: most important first, never a zero that says nothing.
 *   npx vitest run plugins/ruflo-console/tests/band.spec.ts
 */
import { describe, expect, it } from 'vitest'

import type { ReadCache } from '../hooks/data/files'
import { readSnapshot } from '../hooks/data/snapshot'
import { newState } from '../hooks/state'
import { barParts, barText, money } from '../hooks/views/bar'
import { RUFLO_FILES } from './fixtures/ruflo-run'

const memoryFs = (files: Record<string, string>) => ({
  read: async (path: string) => files[path] ?? Promise.reject(new Error('ENOENT')),
  stat: async (path: string) => (files[path] !== undefined ? { mtimeMs: 1, size: (files[path] as string).length } : Promise.reject(new Error('ENOENT'))),
  list: async () => Promise.reject(new Error('ENOENT')),
})

async function capturedState(marketplace: string[]) {
  const files = {
    ...Object.fromEntries(Object.entries(RUFLO_FILES).map(([path, text]) => [`/work/${path}`, text])),
    '/home/dev/.claude/plugins/known_marketplaces.json': JSON.stringify({ ruflo: { installLocation: '/home/dev/m/ruflo' } }),
    '/home/dev/m/ruflo/.claude-plugin/marketplace.json': JSON.stringify({ plugins: marketplace.map(name => ({ name })) }),
  }
  const state = newState({})

  state.snapshot = await readSnapshot(memoryFs(files), new Map() as ReadCache, '/work', '/home/dev', {}, 0)

  return state
}

describe('band', () => {
  it('leads with what needs a person, then the swarm in words, then the rest', async () => {
    const state = await capturedState(['ruflo-core', 'ruflo-swarm', 'ruflo-mods', 'ruflo-console'])

    state.usage = { costUsd: 1010.66 }
    state.ruflo.route = { agent: 'coder', confidence: 0.8, matched: true, reason: 'keyword' }
    state.history.patterns = [{ atMs: 0, value: 7466 }, { atMs: 1, value: 7478 }]

    const parts = barParts(state, 0)

    expect(parts.filter(part => part.tone === 'attention').map(part => part.text)).toEqual(['2 to approve (q)'])
    expect(barText(state, 0)).toBe('ruflo · 2 to approve (q) · 2 agents idle · $1,011 this session · 2 claims (1 stealable) · routed → coder · +12 learned')
  })

  it('a stale marketplace clone shows as an alert, not as a separate word', async () => {
    const state = await capturedState(['ruflo-core', 'ruflo-swarm'])

    expect(barParts(state, 0).find(part => part.text.startsWith('⚠'))).toEqual({ text: '⚠ 1 alert', tone: 'attention' })
    expect(barText(state, 0)).not.toContain('STALE')
  })

  it('never says 0/0: an empty swarm is named as such, and no growth means no learned part', () => {
    const state = newState({})

    state.snapshot = { swarm: { topology: 'hierarchical', agentIds: [] }, agents: [], claims: [], plugins: { missingFromClone: [] }, daemon: null, isRufloProject: true } as never
    state.history.patterns = [{ atMs: 0, value: 7466 }, { atMs: 1, value: 7466 }]
    expect(barText(state, 0)).toBe('ruflo · swarm, no agents')
  })

  it('money: cents under $100, whole dollars with separators above', () => {
    expect(money(0.4213)).toBe('$0.42')
    expect(money(99.994)).toBe('$99.99')
    expect(money(1010.66)).toBe('$1,011')
  })

  it('no spend part until there is a cent to show', () => {
    const state = newState({})

    state.usage = { costUsd: 0.004 }
    expect(barText(state, 0)).toBe('ruflo')
  })
})
