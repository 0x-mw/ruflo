/**
 * The console pane's frame: the tab row, the view in front, the confirm row, and a footer that says how fresh the data
 * is and whether the pane holds the keys. Below NARROW columns the pane is text only, one view at a time.
 */
import type { RenderElement } from 'claude-code'

import { VIEWS } from '../state'
import { claimsView } from './claims'
import { ago, button, clip, col, row, text, THEME, type Ctx } from './common'
import { federationView } from './federation'
import { learningView } from './learning'
import { memoryView } from './memory'
import { metaharnessView } from './metaharness'
import { overviewView } from './overview'
import { pluginsView } from './plugins'
import { swarmView } from './swarm'

export const NARROW = 44

const BODIES = {
  overview: overviewView,
  swarm: swarmView,
  claims: claimsView,
  federation: federationView,
  plugins: pluginsView,
  learning: learningView,
  metaharness: metaharnessView,
  memory: memoryView,
} as const

function tabs(ctx: Ctx): RenderElement {
  const isShort = ctx.columns < 104

  if (ctx.columns < NARROW) {
    const index = VIEWS.findIndex(view => view.id === ctx.state.view)

    return text(ctx, `${index + 1}/${VIEWS.length} ${VIEWS[index]?.label ?? ''} · 1-8 switch · h help`, { bold: true, color: THEME.head })
  }

  return row(
    ctx,
    VIEWS.map(view => {
      const isCurrent = view.id === ctx.state.view
      const label = isShort ? view.label.slice(0, view.id === 'metaharness' ? 4 : 5) : view.label

      return ctx.kit.Button({ key: `tab-${view.id}`, label: isCurrent ? `${label}◂` : label, hotkey: view.key, plain: true, ...(isCurrent ? {} : { dimColor: true }), onPress: () => ctx.act.view(view.id) })
    }),
    'tabs',
  )
}

function help(ctx: Ctx): RenderElement {
  const lines = [
    'Keys (while the pane holds the keyboard; click it or press ctrl+x tab):',
    '  1-8  switch view: overview, swarms, claims, federation, plugins, learning, metaharness, memory',
    '  r    refresh now          h  this help          x  close the console',
    '  claims view: j/k pick a claim, a pick an agent, t pick a task,',
    '               c claim the task, l release, o hand off, s steal (each asks y/n first)',
    'Commands (work without focus):',
    '  /ruflo-console [view]   open, or switch to a view by name or number',
    '  /ruflo-console close    close      /ruflo-console status   one-line summary',
    'Sources: ruflo files under .claude-flow/ and .swarm/, Claude Code plugin records, and',
    'the ruflo CLI (local commands only). Anything not measured reads n/a, never 0.',
  ]

  return col(ctx, [...lines.map((line, i) => text(ctx, line, i === 0 || i === 5 || i === 8 ? { bold: true } : { dimColor: i > 8 })), row(ctx, [button(ctx, 'help-close', 'Back (h)', ctx.act.help)])], 'help')
}

function confirmRow(ctx: Ctx): RenderElement | null {
  const pending = ctx.state.pending

  if (pending === null) {
    return null
  }

  return col(
    ctx,
    [
      text(ctx, `Confirm: ${pending.label}?`, { bold: true, color: THEME.warn }),
      text(ctx, `runs: ruflo ${pending.args.join(' ')}`, { dimColor: true }),
      row(ctx, [button(ctx, 'confirm', 'Yes, run it (y)', ctx.act.confirm, { hotkey: 'y', primary: true }), button(ctx, 'cancel', 'Cancel (n)', ctx.act.cancel, { hotkey: 'n' })]),
    ],
    'confirm',
  )
}

function footer(ctx: Ctx): RenderElement {
  const { state, nowMs } = ctx
  const outcome = state.outcome
  const parts: RenderElement[] = []

  if (outcome !== null && nowMs - outcome.atMs < 60_000) {
    parts.push(
      text(ctx, `${outcome.ok ? '✓' : '✗'} ${outcome.label}: ${outcome.detail}${outcome.verified === 'yes' ? ' · on disk' : outcome.verified === 'no' ? ' · not on disk yet' : ''}`, {
        color: outcome.ok ? THEME.ok : THEME.bad,
      }),
    )
  }

  const read = state.snapshot === null ? 'reading…' : `read ${ago(state.snapshot.readAtMs, nowMs)}`
  const keys = state.pane.isFocused ? 'keys: on' : 'keys: off — click the pane or ctrl+x tab (or use /ruflo-console <view>)'

  parts.push(
    row(ctx, [
      text(ctx, clip(`${read} · ${keys}`, Math.max(10, ctx.columns - 24)), { dimColor: true }),
      ...(ctx.columns >= NARROW ? [button(ctx, 'refresh', 'Refresh', ctx.act.refresh, { hotkey: 'r' }), button(ctx, 'help', 'Help', ctx.act.help, { hotkey: 'h' }), button(ctx, 'close', 'Close', ctx.act.close, { hotkey: 'x' })] : []),
    ]),
  )

  return col(ctx, parts, 'footer')
}

/** The whole pane for this frame. */
export function paneView(ctx: Ctx): RenderElement {
  const body = ctx.state.isHelp ? help(ctx) : BODIES[ctx.state.view](ctx)
  const confirm = confirmRow(ctx)

  return ctx.kit.Box({ flexDirection: 'column', children: [tabs(ctx), body, ...(confirm !== null ? [confirm] : []), footer(ctx)] })
}
