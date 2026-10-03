/**
 * The cyberpunk boot log (ADR-432): a star is lit only on evidence, pulses run only on lit lines, READY claims no more than was
 * verified, the scramble and easter egg are deterministic, and a small pane falls back to the plain log. Run with
 *   npx vitest run plugins/ruflo-console/tests/boot-cyber.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { bootFacts } from '../hooks/boot-facts'
import { bootPicture, BOOT_MODULES, BOOT_ROWS } from '../hooks/gfx/boot'
import { eggText, scramble, EGG_FROM_MS } from '../hooks/gfx/boot-cyber'
import { newState, type State } from '../hooks/state'

const textOf = (grid: ReturnType<typeof bootPicture>): string => {
  const lines: string[] = []

  for (let y = 0; y < grid.rows; y++) {
    let s = ''

    for (let x = 0; x < grid.columns; x++) s += String.fromCodePoint(grid.glyph(x, y))
    lines.push(s.trimEnd())
  }

  return lines.join('\n')
}
const withPlugins = (names: string[]): State => {
  const state = newState({})

  state.snapshot = { plugins: { installed: names.map(name => ({ id: `${name}@ruflo`, name, marketplace: 'ruflo', version: '1.0.0', scope: 'user' })) }, agents: [{}, {}], claims: [], tasks: [], neural: null, sona: null, missions: null, isRufloProject: false } as never

  return state
}
const allOk = BOOT_MODULES.map(entry => ({ area: entry.name, ok: true, problems: [] as string[] }))
const rowsFor = BOOT_ROWS + 20

describe('boot facts', () => {
  it('lights a star only on evidence, and says why a dark one is dark', () => {
    const facts = bootFacts(withPlugins(['ruflo-ruvector', 'rulake-stack']), '0.26.0', 'abc123')
    const star = (id: string) => facts.stars.find(entry => entry.id === id)

    expect(star('ruvector')).toMatchObject({ alive: true })
    expect(star('rulake')).toMatchObject({ alive: true, detail: '1 plugin' })
    expect(star('rvf')).toMatchObject({ alive: false, detail: 'ruflo-rvf is not installed' })
    expect(star('ruflo')?.alive).toBe(false)
  })

  it('lists only the numbers there is data for', () => {
    const facts = bootFacts(withPlugins(['a']), '1', '')

    expect(facts.stats.map(entry => entry.label)).toEqual(['agents', 'plugins'])
  })
})

describe('the cyberpunk log', () => {
  it('draws the title, the constellation, the scan grid and a READY that matches the evidence', () => {
    const facts = bootFacts(withPlugins(['ruflo-ruvector']), '0.26.0', 'abc123')
    const text = textOf(bootPicture('p', 90, 6000, 10, 10, rowsFor, allOk, facts))

    expect(text).toContain('RUV.NET // RUVECTOR CONSTELLATION')
    expect(text).toContain('rUv · ruflo v0.26.0 · abc123')
    expect(text).toContain('ruvector')
    expect(text).toMatch(/\[WARN\] READY · 26 of 26 areas verified · \d+ stars? dark/)
    expect(text).not.toContain('ALL STARS ALIGNED')
  })

  it('says ALL STARS ALIGNED only when every star is lit and every area verified, and reports a failed area', () => {
    const lit = withPlugins(['ruflo-ruvector', 'ruflo-rvf', 'ruflo-ruvllm', 'rulake-stack', 'ruqu-mcp', 'rvdna-mcp', 'ruflo-agentdb'])

    lit.snapshot = { ...(lit.snapshot as object), isRufloProject: true, sona: { patterns: 3 } } as never

    const aligned = textOf(bootPicture('p', 90, 6000, 10, 10, rowsFor, allOk, bootFacts(lit, '1', '')))

    expect(aligned).toContain('ALL STARS ALIGNED')

    const failing = allOk.map((entry, i) => (i === 3 ? { ...entry, ok: false, problems: ['x'] } : entry))
    const failed = textOf(bootPicture('p', 90, 6000, 10, 10, rowsFor, failing, bootFacts(lit, '1', '')))

    expect(failed).not.toContain('ALL STARS ALIGNED')
    expect(failed).toMatch(/\[FAIL\] READY · 25 of 26 areas verified · 1 failed/)
  })

  it('shows the easter egg only in its window, and it decodes to rUv', () => {
    const facts = bootFacts(withPlugins([]), '1', '')

    expect(textOf(bootPicture('p', 90, EGG_FROM_MS + 1400, 10, 10, rowsFor, allOk, facts))).toContain('01110010 01010101 01110110  =  rUv')
    expect(textOf(bootPicture('p', 90, 5000, 10, 10, rowsFor, allOk, facts))).not.toContain('01110010')
    expect(eggText(EGG_FROM_MS + 1400)).toBe(eggText(EGG_FROM_MS + 1400))
  })

  it('is deterministic and scrambles into place', () => {
    expect(scramble('ruflo', 1000, 1000, 500)).toHaveLength(5)
    expect(scramble('ruflo', 1600, 1000, 500)).toBe('ruflo')
    expect(scramble('ruflo', 900, 1000, 500)).toBe('')
    expect(textOf(bootPicture('p', 90, 3000, 10, 10, rowsFor, allOk, bootFacts(withPlugins([]), '1', '')))).toBe(textOf(bootPicture('p', 90, 3000, 10, 10, rowsFor, allOk, bootFacts(withPlugins([]), '1', ''))))
  })

  it('falls back to the plain log in a narrow or short pane', () => {
    const facts = bootFacts(withPlugins([]), '1', '')

    expect(textOf(bootPicture('p', 50, 6000, 10, 10, rowsFor, allOk, facts))).toContain('[ OK ] READY 26 of 26 areas verified')
    expect(textOf(bootPicture('p', 90, 6000, 10, 10, BOOT_ROWS + 6, allOk, facts))).not.toContain('RUV.NET')
  })
})

describe('restart (the footer Refresh and r)', () => {
  it('replays the intro: a pane that finished booting boots again from the new start, in the BBS look only', async () => {
    const { isBooting, BOOT_MIN_MS } = await import('../hooks/state')
    const state = newState({})

    state.options.look = 'bbs'
    state.options.boot = true
    state.snapshot = {} as never
    state.pane.bootAtMs = 1_000

    expect(isBooting(state, 1_000 + BOOT_MIN_MS + 1)).toBe(false)

    state.pane.bootAtMs = 100_000

    expect(isBooting(state, 100_500)).toBe(true)
    expect(isBooting(state, 100_000 + BOOT_MIN_MS + 1)).toBe(false)

    state.options.look = 'plain'

    expect(isBooting(state, 100_500)).toBe(false)
  })
})

describe('the constellation animation', () => {
  const dots = (age: number): number => [...textOf(bootPicture('p', 90, age, 10, 10, rowsFor, allOk, bootFacts(withPlugins(['ruflo-ruvector', 'ruflo-rvf']), '1', '')))].filter(ch => ch === '·').length

  it('flashes a lit star on as it locks, and never lights a dark one', () => {
    const facts = bootFacts(withPlugins([]), '1', '')
    const lock = textOf(bootPicture('p', 90, 1500 + 100, 10, 10, rowsFor, allOk, facts))
    const later = textOf(bootPicture('p', 90, 6000, 10, 10, rowsFor, allOk, facts))

    expect(facts.stars.every(star => !star.alive)).toBe(true)
    expect(later).not.toMatch(/[★✦✺]/)
    expect(lock).not.toContain('✺')

    const lit = bootFacts(withPlugins(['ruflo-ruvector']), '1', '')

    lit.stars.find(star => star.id === 'ruflo')!.alive = true
    expect(textOf(bootPicture('p', 90, 1500 + 100, 10, 10, rowsFor, allOk, lit))).toContain('✺')
  })

  it('draws its lines out over time rather than all at once', () => {
    expect(dots(1500 + 1000 + 100)).toBeLessThan(dots(1500 + 1000 + 1000))
  })
})
