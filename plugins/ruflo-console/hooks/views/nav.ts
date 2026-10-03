/**
 * The grouped nav, drawn when the page is in cards: one bordered NAV card, a row per group of the main menu (Swarm, Mind, Safety,
 * Network, Tools), each view a button with its hotkey, the open one marked. Every view is a click away from every page; a hotkey is
 * given only to the views that had one in the flat tab bar, so no new key can collide with a page's own.
 */
import type { RenderElement } from 'claude-code'

import { NAV_STYLES, VIEWS, type ViewId } from '../state'
import { CARD_COLUMNS } from './card'
import { isBbs, row, THEME, type Ctx } from './common'

/** The nav's groups, the main menu's own, each in rows short enough to spell their names: every view but the menu is in exactly one. */
export const NAV_GROUPS: readonly { title: string; rows: readonly (readonly ViewId[])[] }[] = [
  { title: 'SWARM', rows: [['missions', 'overview', 'swarm', 'hive', 'claims', 'approvals'], ['automate', 'timeline', 'events']] },
  { title: 'MIND', rows: [['learning', 'neural', 'metaharness', 'evolve'], ['memory', 'vector', 'cost', 'perf']] },
  { title: 'SAFETY', rows: [['secure', 'devtools']] },
  { title: 'NETWORK', rows: [['federation', 'xruv', 'plugins', 'skills', 'market']] },
  { title: 'TOOLS', rows: [['terminal', 'settings']] },
]

const LABEL_WIDTH = 9

export function groupedTabs(ctx: Ctx, hasHotkey: (view: (typeof VIEWS)[number]) => boolean): RenderElement {
  const inner = ctx.columns - CARD_COLUMNS
  const style = ctx.state.nav
  const open = ctx.state.view === 'agent' ? ctx.state.back : ctx.state.view
  const find = (id: ViewId) => VIEWS.find(entry => entry.id === id)
  // What a tab spells: its icon, and from `brief` a short name, from `full` the whole name. The engine puts a button's hotkey in front ("3: ").
  const spell = (view: (typeof VIEWS)[number], form: string) => (form === 'icons' ? view.icon : form === 'brief' ? `${view.icon} ${view.short}` : `${view.icon} ${view.label}`)
  const cells = (view: (typeof VIEWS)[number], form: string) => (hasHotkey(view) && view.key !== '' ? 3 : 0) + spell(view, form).length + 3
  const widest = (form: string) => Math.max(...NAV_GROUPS.flatMap(group => group.rows.map(ids => LABEL_WIDTH + ids.reduce((sum, id) => sum + (find(id) === undefined ? 0 : cells(find(id) as (typeof VIEWS)[number], form)), 0))))
  // auto: the richest form whose widest group row fits the page; the others are the person's choice.
  const form = style === 'auto' ? (['full', 'brief'].find(candidate => widest(candidate) <= inner) ?? 'icons') : style
  const tab = (view: (typeof VIEWS)[number]): RenderElement => {
    const words = spell(view, form)

    // The open view names itself whatever the style, as the flat tab bar did: [3: 📌 CLAIMS], [0: 📟 MAIN MENU].
    const prefix = view.key === '' ? '' : `${view.key}: `

    if (view.id === open) return ctx.kit.Box({ key: `tab-${view.id}`, children: [ctx.kit.Text({ bold: true, color: THEME.head, wrap: 'truncate-end', children: isBbs() ? `[${prefix}${view.icon} ${view.label.toUpperCase()}]` : `${prefix}${view.icon} ${view.label}` })] })

    return ctx.kit.Button({ key: `tab-${view.id}`, label: ` ${words} `, ...(hasHotkey(view) && view.key !== '' && { hotkey: view.key }), plain: true, dimColor: true, onPress: () => ctx.act.view(view.id) })
  }
  const menu = VIEWS.find(view => view.id === 'menu')
  const titleRow = row(
    ctx,
    [
      ctx.kit.Text({ bold: true, color: THEME.head, children: isBbs() ? '░▒▓ NAV ░▒▓ ' : 'NAV ' }),
      ...(menu === undefined ? [] : [open === 'menu' ? tab(menu) : ctx.kit.Button({ key: 'tab-menu', label: ' 📟 Menu ', plain: true, hotkey: '0', onPress: () => ctx.act.view('menu') })]),
      ctx.kit.Text({ dimColor: true, children: '  style ' }),
      ...NAV_STYLES.map(option =>
        ctx.kit.Button({ key: `nav-style-${option}`, label: ` ${option === style ? '●' : '○'} ${option} `, plain: true, ...(option === style ? { variant: 'primary' as const } : { dimColor: true }), onPress: () => ctx.act.nav(option) }),
      ),
    ],
    'tabs-title',
  )
  const groups = NAV_GROUPS.flatMap(group =>
    group.rows.map((ids, i) =>
      ctx.kit.Box({
        flexDirection: 'row',
        gap: 1,
        key: `tabs-${group.title.toLowerCase()}-${i}`,
        children: [
          ctx.kit.Text({ bold: true, color: THEME.info, children: (i === 0 ? group.title : '').padEnd(LABEL_WIDTH) }),
          ...ids.flatMap(id => {
            const view = find(id)

            return view === undefined ? [] : [tab(view)]
          }),
        ],
      }),
    ),
  )

  return ctx.kit.Box({ key: 'tabs', flexDirection: 'column', borderStyle: 'round', borderColor: THEME.info, paddingX: 1, children: [titleRow, ...groups] })
}
