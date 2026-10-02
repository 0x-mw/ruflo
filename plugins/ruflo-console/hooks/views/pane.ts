/**
 * The console pane's frame: a title strip, the tab row, then the palette, the help or the view in front, the confirm
 * row and a footer that says how fresh the data is and whether the pane holds the keys. Below NARROW columns the pane
 * is text only, one view at a time.
 */
import type { RenderElement } from 'claude-code'

import { HELP } from '../commands'
import { isBooting, rowsOf, VIEWS, type ViewId } from '../state'
import { agentView } from './agent'
import { claimsView } from './claims'
import { ago, button, clip, col, isBbs, row, setLook, text, THEME, type Ctx } from './common'
import { costView } from './cost'
import { federationView } from './federation'
import { learningView } from './learning'
import { approvalsView, eventsView, timelineView } from './manage'
import { memoryView } from './memory'
import { metaharnessView } from './metaharness'
import { missionsView } from './missions'
import { overviewView } from './overview'
import { paletteView } from './palette'
import { pluginsView } from './plugins'
import { swarmView } from './swarm'

export const NARROW = 44
/** Width from which every tab spells its name beside its emoji (the 1-9 row is about 128 columns with names). */
const WIDE_TABS = 140

const BODIES: Record<ViewId, (ctx: Ctx) => RenderElement> = {
  overview: overviewView,
  swarm: swarmView,
  claims: claimsView,
  federation: federationView,
  plugins: pluginsView,
  learning: learningView,
  metaharness: metaharnessView,
  memory: memoryView,
  cost: costView,
  timeline: timelineView,
  approvals: approvalsView,
  events: eventsView,
  missions: missionsView,
  agent: agentView,
}

function tabs(ctx: Ctx): RenderElement {
  if (ctx.columns < NARROW) {
    const index = VIEWS.findIndex(view => view.id === ctx.state.view)
    const label = index < 0 ? 'Agent' : (VIEWS[index]?.label ?? '')

    return text(ctx, `${index < 0 ? '·' : `${index + 1}/${VIEWS.length}`} ${label} · /ruflo help`, { bold: true, color: THEME.head })
  }

  // Two rows: the nine data views (1-9), then the four management views (g q e m). Each tab is its emoji; the
  // current one is highlighted, and from WIDE_TABS columns every tab also spells its name. The line under the bar
  // always names the current view and says what it is for. The dock width is the engine's (it keeps where the
  // divider was left), so the narrow form must fit about 60 columns.
  const withNames = ctx.columns >= WIDE_TABS
  const tab = (view: (typeof VIEWS)[number]): RenderElement => {
    const isCurrent = view.id === ctx.state.view || (ctx.state.view === 'agent' && view.id === ctx.state.back)
    const words = withNames ? `${view.icon} ${view.label}` : view.icon

    // A Button cannot be styled, so the current tab is Text: its key is not needed, the view is already open
    // (from a drill-down, b goes back).
    // BBS: the current tab is framed like a menu pick, [2: 🐝 SWARM]; the name always shows there, in capitals.
    const current = isBbs() ? `[${view.key}: ${view.icon}${withNames || view.label.length <= 6 ? ` ${view.label.toUpperCase()}` : ''}]` : `${view.key}: ${words}`

    if (isCurrent) return ctx.kit.Box({ key: `tab-${view.id}`, children: [ctx.kit.Text({ bold: true, color: THEME.head, wrap: 'truncate-end', children: current })] })

    return ctx.kit.Button({ key: `tab-${view.id}`, label: words, hotkey: view.key, plain: true, dimColor: true, onPress: () => ctx.act.view(view.id) })
  }
  const line = (views: readonly (typeof VIEWS)[number][], key: string) => ctx.kit.Box({ flexDirection: 'row', gap: 1, key, children: views.map(tab) })

  return ctx.kit.Box({
    flexDirection: 'column',
    key: 'tabs',
    children: [line(VIEWS.filter(view => /^[0-9]$/.test(view.key)), 'tabs-views'), line(VIEWS.filter(view => !/^[0-9]$/.test(view.key)), 'tabs-manage')],
  })
}

/** One line under the tabs saying what the current view is for. */
function blurb(ctx: Ctx): RenderElement | null {
  if (ctx.columns < NARROW) return null

  const view = VIEWS.find(entry => entry.id === (ctx.state.view === 'agent' ? ctx.state.back : ctx.state.view))

  if (view === undefined) return null

  const name = ctx.state.view === 'agent' ? 'Agent' : view.label
  const about = ctx.state.view === 'agent' ? `one agent's role, task, claims, activity and logs · b goes back to ${view.label}` : view.blurb

  if (isBbs()) {
    // A sysop prompt: >> 🐝 SWARM :: what it is for
    return row(ctx, [
      ctx.kit.Text({ bold: true, color: THEME.ok, children: '>> ' }),
      ctx.kit.Text({ bold: true, color: THEME.head, children: `${view.icon} ${name.toUpperCase()}` }),
      ctx.kit.Text({ color: THEME.info, wrap: 'truncate-end', children: clip(` :: ${about}`, Math.max(4, ctx.columns - name.length - 6)) }),
    ], 'about')
  }

  return row(ctx, [
    ctx.kit.Text({ bold: true, color: THEME.head, children: `${view.icon} ${name}` }),
    ctx.kit.Text({ dimColor: true, italic: true, wrap: 'truncate-end', children: clip(` — ${about}`, Math.max(4, ctx.columns - name.length - 2)) }),
  ], 'about')
}

function help(ctx: Ctx): RenderElement {
  return col(ctx, [...HELP.split('\n').map((line, i) => text(ctx, line || ' ', i === 0 ? { bold: true, color: THEME.head } : /^[A-Z]/.test(line) ? { bold: true } : { dimColor: i > 20 })), row(ctx, [button(ctx, 'help-close', 'Back', ctx.act.help, { hotkey: 'h' })])], 'help')
}

function confirmRow(ctx: Ctx): RenderElement | null {
  const pending = ctx.state.pending

  if (pending === null) return null

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

  if (outcome !== null && nowMs - outcome.atMs < 90_000) {
    parts.push(
      text(ctx, `${outcome.ok ? '✓' : '✗'} ${outcome.label}${outcome.verified === 'yes' ? ' · on disk' : outcome.verified === 'no' ? ' · not on disk yet' : ''}: ${outcome.detail}`, {
        color: outcome.ok ? THEME.ok : THEME.bad,
      }),
    )

    for (const line of (outcome.lines ?? []).slice(0, 8)) parts.push(text(ctx, `  ${line}`, { dimColor: true }))
  }

  // BBS: the link status in modem-speak, [LINK OK] ▸ sync 3s · keys on.
  const read = state.snapshot === null ? (isBbs() ? '[DIALING…]' : 'reading…') : isBbs() ? `[LINK OK] ▸ sync ${ago(state.snapshot.readAtMs, nowMs).replace(' ago', '')}` : `read ${ago(state.snapshot.readAtMs, nowMs)}`
  const keys = state.pane.isFocused ? 'keys on' : 'keys off: click the pane (or /ruflo …)'

  parts.push(
    row(ctx, [
      text(ctx, `${clip(`${read} · ${keys}`, Math.max(10, ctx.columns - 46))} `, { dimColor: true }),
      ...(ctx.columns >= NARROW
        ? [
            button(ctx, 'palette', 'Palette', () => ctx.act.palette('all'), { hotkey: 'p' }),
            ...(state.view === 'agent' || state.palette.isOpen ? [] : [button(ctx, 'actions', 'Actions', () => ctx.act.palette('selection'), { hotkey: 'x' })]),
            button(ctx, 'refresh', 'Refresh', ctx.act.refresh, { hotkey: 'r' }),
            button(ctx, 'help', 'Help', ctx.act.help, { hotkey: 'h' }),
            button(ctx, 'close', 'Close', ctx.act.close),
          ]
        : []),
    ]),
  )

  return col(ctx, parts, 'footer')
}

/**
 * The whole pane for this frame. Given fewer body rows than the view asked for (an inline pane the layout could not
 * make that tall), it goes compact: no title strip, and the confirm row and the footer's buttons move up under the
 * tabs, so every control stays on screen while the view below scrolls.
 */
/**
 * The Wildcat-board furniture for the BBS look: under the banner a welcome line and the networks this node is on,
 * the way boards listed their nets; and the current view's name as block art under the tabs.
 */
function wildcat(ctx: Ctx): { strip: RenderElement[]; art: RenderElement[] } {
  const art = ctx.pictures.get('title')

  return {
    strip: [
      row(ctx, [
        ctx.kit.Text({ bold: true, color: THEME.head, children: 'RUFLO ' }),
        ctx.kit.Text({ color: THEME.info, children: 'x.ruv.io ' }),
        ctx.kit.Text({ bold: true, color: THEME.ok, children: clip('AGENTS WELCOME.', Math.max(4, ctx.columns - 16)) }),
      ], 'welcome'),
      row(ctx, [
        ctx.kit.Text({ color: THEME.head, children: 'NETWORKS: ' }),
        ctx.kit.Text({ color: THEME.info, wrap: 'truncate-end', children: clip('x.ruv.io * relay.ruv.io * agentbbs * mcp * claude code', Math.max(4, ctx.columns - 10)) }),
      ], 'networks'),
    ],
    art: art !== undefined && ctx.kit.Raster !== undefined ? [ctx.kit.Raster(art.toRaster('title'))] : [],
  }
}

export function paneView(ctx: Ctx): RenderElement {
  setLook(ctx.state.options.look)

  // The BBS boot screen: the first seconds after the pane opens (or until the first read lands, at most 6 s).
  if (isBooting(ctx.state, ctx.nowMs)) {
    const boot = ctx.pictures.get('boot')

    return boot !== undefined && ctx.kit.Raster !== undefined
      ? col(ctx, [ctx.kit.Raster(boot.toRaster('boot'))], 'boot')
      : col(ctx, [text(ctx, 'CONNECT 115200 · RUFLO AGENT SWARM CONSOLE · loading…', { bold: true, color: THEME.head })], 'boot')
  }
  const body = ctx.state.palette.isOpen ? paletteView(ctx) : ctx.state.isHelp ? help(ctx) : BODIES[ctx.state.view](ctx)
  const confirm = confirmRow(ctx)
  const header = ctx.pictures.get('header')
  const isCompact = ctx.state.pane.rows > 0 && ctx.state.pane.rows < rowsOf(ctx.state.view)
  const title = !isCompact && header !== undefined && ctx.kit.Raster !== undefined ? [ctx.kit.Raster(header.toRaster('header'))] : []
  const about = blurb(ctx)
  const bbs = isBbs() && !isCompact ? wildcat(ctx) : { strip: [], art: [] }
  const gap = isBbs() && !isCompact ? [text(ctx, ' ')] : []
  const parts = isCompact
    ? [tabs(ctx), ...(confirm !== null ? [confirm] : []), footer(ctx), body]
    : [...title, ...bbs.strip, ...gap, tabs(ctx), ...gap, ...bbs.art, ...(about !== null ? [about] : []), ...gap, body, ...(confirm !== null ? [confirm] : []), ...gap, footer(ctx)]

  return ctx.kit.Box({ flexDirection: 'column', children: parts })
}

type Plain = { type: string; props: { children?: unknown; label?: string } }

const plainKit = (): Ctx['kit'] => {
  const element = (type: string) => (props: Record<string, unknown>) => ({ type, props }) as never

  return { Box: element('Box'), Text: element('Text'), Button: element('Button') }
}

function linesOf(node: unknown, out: string[]): void {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))

    return
  }

  const { type, props } = node as Plain

  if (Array.isArray(node)) {
    for (const child of node) linesOf(child, out)

    return
  }

  if (type === 'Button') {
    out.push(`[${props.label ?? ''}]`)

    return
  }

  const before = out.length
  const children = Array.isArray(props.children) ? props.children : [props.children]

  for (const child of children) linesOf(child, out)

  // A row's parts read as one line; a column's as lines.
  if (type === 'Box' && (props as { flexDirection?: string }).flexDirection === 'row') out.splice(before, out.length - before, out.slice(before).join(''))
}

/**
 * One view as plain text, every picture as its fallback words: `/ruflo dump <view>`, for a headless run (claude -p),
 * a surface without the pane, or a script that wants to read what the console sees.
 */
export function viewText(ctx: Omit<Ctx, 'kit' | 'pictures'>, view: ViewId): string {
  const body = BODIES[view]({ ...ctx, kit: plainKit(), pictures: new Map() })
  const out: string[] = []

  linesOf(body, out)

  return out.map(line => line.trimEnd()).filter(line => line !== '').join('\n')
}

