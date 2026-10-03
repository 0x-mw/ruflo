/**
 * The main menu wraps at small widths: no text and no row of it is wider than the pane, at any width from 30 to 120 columns (the mission
 * strip's stage line wraps; the status bar drops its modem text before it overflows). Run with
 *   npx vitest run plugins/ruflo-console/tests/menu-wrap.spec.ts
 */
import { afterEach, describe, expect, it } from 'vitest'

import { newState } from '../hooks/state'
import { setLook, type Ctx } from '../hooks/views/common'
import { menuView } from '../hooks/views/menu'
import { wrap } from '../hooks/views/common'

type El = { props: Record<string, unknown>; kind: string }

const make = (kind: string) => (props: Record<string, unknown>): El => ({ kind, props })
const kit = { Box: make('Box'), Text: make('Text'), Button: make('Button'), Input: make('Input'), Raster: make('Raster') }
const act = (() => {
  const proxy: unknown = new Proxy(() => undefined, { get: (_t, key) => (key === 'then' ? undefined : proxy), apply: () => undefined })

  return proxy
})() as never

/** How wide an element draws: a row is the sum of its parts, a column its widest part, a button its label and a gap. */
function widthOf(el: unknown): number {
  const node = el as El

  if (typeof node !== 'object' || node === null) return 0

  const kids = node.props.children

  if (node.kind === 'Button') return String(node.props.label).length + 1
  if (typeof kids === 'string') return kids.length
  if (Array.isArray(kids)) return node.props.flexDirection === 'row' ? kids.reduce((sum: number, kid) => sum + widthOf(kid), 0) : Math.max(0, ...kids.map(widthOf))

  return kids === undefined ? 0 : widthOf(kids)
}

/** Every row and text in the tree wider than `columns`, as a short description. */
function overflow(columns: number): string[] {
  const state = newState({})

  state.options.look = 'bbs'
  state.view = 'menu'
  setLook('bbs')

  const found: string[] = []
  const walk = (el: unknown): void => {
    const node = el as El

    if (typeof node !== 'object' || node === null) return

    // A box with its own width clips what is inside it (the group cards): they are checked by their own widths below.
    if (node.kind === 'Text' || node.props.flexDirection === 'row') {
      const width = widthOf(node)

      if (width > columns) found.push(`${width} > ${columns}: ${String(node.props.key ?? (typeof node.props.children === 'string' ? node.props.children.slice(0, 24) : node.kind))}`)
    }

    const kids = node.props.children

    if (Array.isArray(kids)) kids.forEach(walk)
    else if (typeof kids === 'object') walk(kids)
  }

  walk(menuView({ kit, state, nowMs: 5_000, columns, pictures: new Map(), act, cards: false } as unknown as Ctx))

  return found
}

/** Every string the menu draws, joined: what a person can read of it. */
function readable(columns: number): string {
  const state = newState({})

  state.options.look = 'bbs'
  state.view = 'menu'
  setLook('bbs')

  const out: string[] = []
  const walk = (el: unknown): void => {
    const node = el as El

    if (typeof node !== 'object' || node === null) return

    const kids = node.props.children

    if (typeof kids === 'string') out.push(kids)
    else if (Array.isArray(kids)) kids.forEach(walk)
    else if (typeof kids === 'object') walk(kids)
  }

  walk(menuView({ kit, state, nowMs: 5_000, columns, pictures: new Map(), act, cards: false } as unknown as Ctx))

  return out.join('\n')
}

afterEach(() => setLook('plain'))

describe('the main menu at small widths', () => {
  it('has no text or row wider than the pane, at any width from 30 to 120 columns', () => {
    const problems: string[] = []

    for (let columns = 30; columns <= 120; columns++) problems.push(...overflow(columns).map(problem => `${columns} columns: ${problem}`))

    expect(problems).toEqual([])
  })

  it('wraps the mission stages instead of cutting them off: every stage is readable at every width', () => {
    for (let columns = 30; columns <= 120; columns++) {
      const text = readable(columns)

      for (const stage of ['research', 'create', 'build', 'test', 'validate', 'secure', 'benchmark', 'learn']) expect(text, `${columns} columns: ${stage}`).toContain(stage)
      expect(text, `${columns} columns`).not.toContain('SOP…')
    }
  })

  it('wraps the stage line into several lines when the pane is narrow, and keeps every stage', () => {
    expect(wrap('research → create (ADRs, SOP) → build → test → validate → secure → benchmark → learn', 30).length).toBeGreaterThan(2)
    expect(wrap('research → create (ADRs, SOP) → build → test → validate → secure → benchmark → learn', 30).join(' ')).toContain('benchmark → learn')
  })
})
