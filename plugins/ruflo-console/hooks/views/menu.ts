import type { RenderElement } from 'claude-code'

import type { ViewId } from '../state'
import { barParts } from './bar'
import { clip, col, isBbs, row, text, THEME, type Ctx } from './common'

type Item = { key: string; label: string; go: ViewId | 'palette' | 'help' | 'close' }

/** The board's three menus, as the old BBS main menus grouped their commands. Keys are the pane's own hotkeys. */
const MENUS: readonly { title: string; items: readonly Item[] }[] = [
  {
    title: 'Swarm Commands',
    items: [
      { key: '1', label: 'Overview', go: 'overview' },
      { key: '2', label: 'Swarm Topology', go: 'swarm' },
      // No hotkey is free; the prompt takes its name (hive) and the entry is clickable.
      { key: '👑', label: 'Hive-Mind', go: 'hive' },
      { key: '3', label: 'Claims Board', go: 'claims' },
      { key: 'q', label: 'Approvals', go: 'approvals' },
      { key: 'm', label: 'Missions', go: 'missions' },
      { key: 'g', label: 'Agent Timeline', go: 'timeline' },
      { key: 'e', label: 'Event Stream', go: 'events' },
    ],
  },
  {
    title: 'System Features',
    items: [
      { key: '4', label: 'Federation', go: 'federation' },
      { key: '5', label: 'Plugins & Mods', go: 'plugins' },
      { key: '6', label: 'Learning', go: 'learning' },
      { key: '7', label: 'MetaHarness', go: 'metaharness' },
      { key: '8', label: 'Memory Base', go: 'memory' },
      { key: '9', label: 'Cost & Budget', go: 'cost' },
    ],
  },
  {
    title: 'Other Commands',
    items: [
      { key: 'w', label: 'x.ruv.io Board', go: 'xruv' },
      { key: 'i', label: 'Terminal', go: 'terminal' },
      { key: 'p', label: 'Command Palette', go: 'palette' },
      { key: 'h', label: 'Help', go: 'help' },
      { key: 'O', label: 'Log Off', go: 'close' },
    ],
  },
]

const mmss = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))

  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/**
 * The main menu, the board's front door: where the cockpit lands when it opens in the BBS look. The name in block
 * art comes from the frame; under it the host line, three boxed menus whose entries go where their keys go, a status
 * bar in the old modem style with this project's live facts, and a prompt that takes a key or a name and Enter.
 */
export function menuView(ctx: Ctx): RenderElement {
  const { state, nowMs } = ctx
  const project = state.cwd.split('/').filter(Boolean).at(-1) ?? 'ruflo'
  const go = (item: Item) => () => (item.go === 'palette' ? ctx.act.palette('all') : item.go === 'help' ? ctx.act.help() : item.go === 'close' ? ctx.act.close() : ctx.act.view(item.go))
  const width = Math.max(18, Math.floor((ctx.columns - 4) / (ctx.columns >= 66 ? 3 : 1)))
  const rows: RenderElement[] = []

  rows.push(
    ctx.kit.Box({
      flexDirection: 'row',
      justifyContent: 'center',
      key: 'menu-host',
      children: [
        ctx.kit.Text({ color: THEME.info, children: 'x.ruv.io' }),
        ctx.kit.Text({ color: THEME.head, children: '  ■  ' }),
        ctx.kit.Text({ bold: true, children: 'Main Menu' }),
        ctx.kit.Text({ color: THEME.head, children: '  ■  ' }),
        ctx.kit.Text({ color: THEME.info, children: clip('github.com/ruvnet/ruflo', Math.max(4, ctx.columns - 32)) }),
      ],
    }),
  )
  rows.push(text(ctx, ' '))

  rows.push(
    ctx.kit.Box({
      flexDirection: 'row',
      flexWrap: 'wrap',
      borderStyle: 'single',
      borderColor: isBbs() ? '#d0d0d0' : 'inactive',
      paddingX: 1,
      key: 'menu-box',
      children: MENUS.map(menu =>
        ctx.kit.Box({
          flexDirection: 'column',
          width,
          key: `menu-${menu.title}`,
          children: [
            ctx.kit.Text({ bold: true, color: THEME.head, wrap: 'truncate-end', children: clip(`■${menu.title}■`, width) }),
            ...menu.items.map(item =>
              ctx.kit.Box({
                flexDirection: 'row',
                key: `mi-${item.key}`,
                children: [
                  ctx.kit.Text({ bold: true, children: `(${item.key})` }),
                  ctx.kit.Button({ key: `menu-go-${item.key}`, label: clip(item.label, width - 4), plain: true, onPress: go(item) }),
                ],
              }),
            ),
          ],
        }),
      ),
    }),
  )

  // The status bar under the box: the line, then what is live in this project, then how long the board has been open.
  const online = mmss(nowMs - (state.pane.bootAtMs > 0 ? state.pane.bootAtMs : state.loadedAtMs))
  const facts = barParts(state, nowMs).map(part => part.text)
  const status = [state.snapshot?.isRufloProject === true ? 'Registered' : 'Unregistered', 'ANSI-BBS', '115200·N81 FDX', ...facts.slice(0, 3)].join(' │ ')
  const right = ` Online ${online} `

  rows.push(text(ctx, ' '))
  rows.push(
    ctx.kit.Box({
      flexDirection: 'row',
      backgroundColor: isBbs() ? '#8b1a1a' : undefined,
      key: 'menu-status',
      children: [
        ctx.kit.Text({ bold: true, color: '#ffd319', wrap: 'truncate-end', children: clip(` ${status}`, Math.max(4, ctx.columns - right.length)).padEnd(Math.max(0, ctx.columns - right.length)) }),
        ctx.kit.Text({ bold: true, color: '#ffd319', children: right }),
      ],
    }),
  )
  rows.push(text(ctx, ' '))
  rows.push(text(ctx, `T - ${online}`, { bold: true }))

  if (ctx.kit.Input !== undefined) {
    rows.push(
      ctx.kit.Input({
        key: 'menu-prompt',
        label: `(1:1) (ruflo: ${clip(project, 24)})`,
        placeholder: 'a key or a name, then Enter (? for help)',
        submitLabel: 'go',
        onSubmit: value => ctx.act.menu(value),
      }),
    )
  } else {
    rows.push(row(ctx, [text(ctx, `(1:1) (ruflo: ${clip(project, 24)}) : press a key from the menu`, { color: THEME.warn })]))
  }

  return col(ctx, rows, 'menu')
}
