/**
 * The menu's design carried through the pages, without the Claude Code test kit: a fake kit records what is drawn. A cost tag is a solid
 * chip in the BBS look and coloured text in the plain one; the nav's open page and group are solid chips in the page's accent, and its
 * page buttons carry the same badges as the menu, without ever pushing a row past its width. Run with
 *   npx vitest run plugins/ruflo-console/tests/design.spec.ts
 */
import { afterEach, describe, expect, it } from 'vitest'

import { COST_CHIP, INK, NAV_ACCENT } from '../hooks/menu-colors'
import { newState, type State, type ViewId } from '../hooks/state'
import { CARD_COLUMNS } from '../hooks/views/card'
import { setLook, tagChip, THEME, type Actions, type Ctx } from '../hooks/views/common'
import { groupedTabs } from '../hooks/views/nav'

type El = { kind: string; props: Record<string, unknown> }

const kit = { Box: (props: Record<string, unknown>): El => ({ kind: 'Box', props }), Text: (props: Record<string, unknown>): El => ({ kind: 'Text', props }), Button: (props: Record<string, unknown>): El => ({ kind: 'Button', props }), Input: (props: Record<string, unknown>): El => ({ kind: 'Input', props }) }
const act: Actions = (() => {
  const proxy: unknown = new Proxy(() => undefined, { get: (_t, key) => (key === 'then' ? undefined : proxy), apply: () => undefined })

  return proxy as Actions
})()
const ctxOf = (state: State, columns = 120): Ctx => ({ kit, state, nowMs: 5_000, columns, pictures: new Map(), act, cards: true }) as unknown as Ctx
const flat = (el: unknown): El[] => {
  const node = el as El

  if (typeof node !== 'object' || node === null) return []

  const kids = node.props.children

  return [node, ...(Array.isArray(kids) ? kids.flatMap(flat) : typeof kids === 'object' ? flat(kids) : [])]
}
const texts = (el: unknown): El[] => flat(el).filter(node => node.kind === 'Text')
const tab = (el: unknown, view: ViewId): El | undefined => flat(el).find(node => node.props.key === `tab-${view}`)

afterEach(() => setLook('plain'))

describe('a cost tag', () => {
  const chip = (color: string): El => tagChip(ctxOf(newState({})), ' $0 ', color) as unknown as El

  it('is a solid chip in the BBS look, on a ground by how much the run asks', () => {
    setLook('bbs')

    for (const [color, ground] of [[THEME.ok, COST_CHIP.ok], [THEME.info, COST_CHIP.info], [THEME.warn, COST_CHIP.warn], [THEME.bad, COST_CHIP.bad]] as const) {
      const shown = texts(chip(color)).find(node => node.props.backgroundColor !== undefined)

      expect(shown?.props, color).toMatchObject({ backgroundColor: ground, color: INK, bold: true, children: ' $0 ' })
    }
  })

  it('stays coloured text in the plain look, as it always was, and a colour that is none of the four is text in either', () => {
    setLook('plain')
    expect(chip(THEME.ok)).toMatchObject({ kind: 'Text', props: { color: THEME.ok, children: '  $0 ' } })
    expect(flat(chip(THEME.ok)).some(node => node.props.backgroundColor !== undefined)).toBe(false)

    setLook('bbs')
    expect(chip(THEME.head)).toMatchObject({ kind: 'Text' })
  })
})

describe('the nav card', () => {
  const open = (view: ViewId, columns = 120, mutate: (state: State) => void = () => undefined): { card: El; state: State } => {
    const state = newState({})

    state.view = view
    mutate(state)

    return { card: groupedTabs(ctxOf(state, columns), () => true) as unknown as El, state }
  }

  it('draws the open page as a solid chip in its group\'s accent in the BBS look, and as text in the plain one', () => {
    setLook('bbs')

    const bbs = tab(open('secure').card, 'secure')
    const chipText = texts(bbs).find(node => String(node.props.children).includes('SECURITY & DOCTOR'))

    expect(chipText?.props).toMatchObject({ backgroundColor: NAV_ACCENT.SAFETY, color: INK, bold: true, children: '[u: 🔒 SECURITY & DOCTOR]' })

    setLook('plain')

    const plain = texts(tab(open('secure').card, 'secure')).find(node => String(node.props.children).includes('Security & Doctor'))

    expect(plain?.props.backgroundColor).toBeUndefined()
    expect(plain?.props.children).toBe('u: 🔒 Security & Doctor')
  })

  it('draws the open group as a solid chip in its accent', () => {
    setLook('bbs')

    const group = texts(open('secure').card).find(node => String(node.props.children).includes('SAFETY ▾'))

    expect(group?.props).toMatchObject({ backgroundColor: NAV_ACCENT.SAFETY, color: INK })
  })

  it('puts the menu\'s badges on the page buttons: spend on Cost, an update on Settings', () => {
    const cost = open('learning', 140, state => {
      state.usage = { costUsd: 19.81 }
    })
    const settings = open('terminal', 140, state => {
      state.updateAvailable = '0.27.0'
    })

    expect(String(tab(cost.card, 'cost')?.props.label)).toContain('$19.81')
    expect(String(tab(settings.card, 'settings')?.props.label)).toContain('⬆ 0.27.0')
    // And none where there is nothing to say.
    expect(String(tab(open('learning', 140).card, 'cost')?.props.label)).not.toMatch(/\$\d/)
  })

  it('never lets a badge push a row of pages past the width, at any width the nav draws', () => {
    // Every width, not a few: the auto form is chosen by whether the widest row fits, so an uncounted badge only overruns in the narrow
    // window of widths where that choice is on the edge.
    for (let columns = 50; columns <= 200; columns++) {
      const { card } = open('learning', columns, state => {
        state.usage = { costUsd: 1234.5 }
        state.updateAvailable = '10.20.30'
      })
      const inner = columns - CARD_COLUMNS

      for (const row of flat(card).filter(node => String(node.props.key).startsWith('tabs-row-'))) {
        // A button draws its label with a space of gap beside it, and the engine puts "k: " in front of one that has a hotkey.
        const used = flat(row).reduce((sum, node) => sum + (node.kind === 'Button' ? String(node.props.label).length + (node.props.hotkey === undefined ? 0 : 3) + 1 : node.kind === 'Text' && typeof node.props.children === 'string' ? node.props.children.length + 1 : 0), 0)

        expect(used, `${columns} columns, ${String(row.props.key)}`).toBeLessThanOrEqual(inner)
      }
    }
  })
})
