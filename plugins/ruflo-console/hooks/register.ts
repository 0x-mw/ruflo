import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import { createController, median, p95, type Controller } from './controller'
import { plain } from './data/parse'
import { markPicture } from './gfx/pictures'
import type { Host } from './host'
import { newState, PANE_ID, restore, storeKeyOf, viewOf, VIEWS, type State } from './state'
import { BAR_KEY, barText, barView } from './views/bar'
import type { Kit } from './views/common'
import { picturesOf } from './views/frames'
import { NARROW, paneView } from './views/pane'

const RUFLO_TOOL = /^mcp__(?:claude-flow|ruflo|plugin_ruflo[\w-]*)__/

/**
 * Binds a Host from `$`, every member spelled `$.noun.method(...)` here and nowhere else, so the engine reads what
 * the module calls off this one place. Calls that answer nothing are wrapped: a refused draw is not a crashed hook.
 */
function hostOf($: EngineInterface, cwd: string): Host {
  const rooted = (path: string) => (path.startsWith('/') ? path : `${cwd.replace(/\/+$/, '')}/${path}`)
  const quietly = (fn: () => unknown) => {
    try {
      const result = fn()

      if (result instanceof Promise) result.catch(() => undefined)
    } catch {
      // Refused: there is nothing to do about a draw nobody may make.
    }
  }

  return {
    fs: { read: async path => $.fs.read(rooted(path)), stat: async path => $.fs.stat(rooted(path)), list: async path => $.fs.list(rooted(path)) },
        every: (ms, fn) => $.clock.every(ms, fn),
    storeGet: async key => $.store.get(key),
    storeSet: async (key, value) => $.store.set(key, value as never),
    invalidate: () => quietly(() => $.ui.invalidate('ui.render')),
    blit: args => quietly(() => $.ui.blit(args)),
    openPane: async pane => $.ui.open(pane),
    closePane: async id => $.ui.close({ id }),
    panes: async () => $.ui.panes(),
    registerCommand: async spec => $.command.register(spec),
    run: async (argv, timeoutMs) => $.process.run(argv, { cwd, timeoutMs }),
    usage: async () => {
      const usage = await $.session.usage()

      return { ...(usage.cost?.usd !== undefined && { costUsd: usage.cost.usd }), ...(usage.context?.percent !== undefined && { contextPercent: usage.context.percent }) }
    },
    rufloTools: async () => (await $.tool.list()).filter(tool => RUFLO_TOOL.test(tool.name)).length,
    settings: async () => $.settings.read(),
    home: async () => $.env.get('HOME'),
    // `$.ruflo` exists only where ruflo-mods is seated; validate refuses feature-detecting a noun, so these are
    // async: a missing noun throws inside the promise and every caller's catch sees a rejection.
    rufloSnapshot: async () => $.ruflo.snapshot(),
    rufloRoute: async () => $.ruflo.lastRoute(),
    rufloSegment: async text => $.ruflo.segment({ id: 'console', text }),
  }
}

/** The one-line answer of `/ruflo-console status`, and the bench's numbers when asked. */
function statusLine(state: State): string {
  const stat = (name: string, values: readonly number[]) => (values.length === 0 ? `${name} n/a` : `${name} median ${median(values)}ms p95 ${p95(values)}ms (n=${values.length})`)

  return [barText(state), stat('render', state.stats.renders), stat('refresh', state.stats.refreshes), stat('frame', state.stats.frames)].join(' · ')
}

/**
 * ruflo-console: ruflo's cockpit inside Claude Code. A pane of eight views over ruflo's state on disk and the ruflo
 * CLI's local answers, a band above the prompt, and `/ruflo-console`. Read-only but for the claims actions, which go
 * through the ruflo CLI with fixed argv after a confirm.
 */
export const register: Register = (on, raw: PluginOptions) => {
  const state = newState(raw)
  let host: Host | null = null
  let control: Controller | null = null

  on('session.start', async ($, e, next) => {
    control?.stop()
    host = hostOf($, e.cwd)
    state.cwd = e.cwd
    control = createController(state, host)

    const bound = host

    state.home = await bound.home().catch(() => undefined) ?? null
    await Promise.all([
      bound.registerCommand({ name: 'ruflo-console', description: 'ruflo console: swarms, claims, federation, plugins, learning, MetaHarness, memory', argumentHint: '[view|close|status]' }).catch(() => undefined),
      bound.storeGet(storeKeyOf(e.cwd)).then(value => restore(state, value), () => undefined),
      bound.rufloTools().then(n => void (state.rufloTools = n), () => undefined),
    ])
    control.start()
    void control.refresh()

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    control?.stop()

    return next(e)
  })

  on('command.run', { command: 'ruflo-console' }, async ($, e, next) => {
    if (control === null) {
      return next(e)
    }

    const arg = e.args.trim().toLowerCase()

    if (arg === 'close') {
      await control.close()

      return { text: 'ruflo console closed' }
    }

    if (arg === 'status') {
      await control.refresh()

      return { text: statusLine(state) }
    }

    const view = arg === '' || arg === 'open' ? null : viewOf(arg)

    if (arg !== '' && arg !== 'open' && view === null) {
      return { text: `Unknown view "${plain(arg, 30)}". Views: ${VIEWS.map(entry => `${entry.key} ${entry.id}`).join(', ')}; or close, status.` }
    }

    if (view !== null) control.setView(view)

    const opened = await control.open()

    return { text: opened.isPlaced ? `ruflo console: ${VIEWS.find(entry => entry.id === state.view)?.label}` : `The ruflo console could not be shown: ${opened.reason}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, ($, e, next) => {
    if (control === null) {
      return next(e)
    }

    const started = Date.now()
    const table = $.ui.resolve(e) as unknown as Kit
    const columns = Math.max(20, Math.floor(Number(e.props.bodyColumns) || 0) - 1)
    const isNarrow = columns < NARROW
    const kit: Kit = isNarrow ? { Box: table.Box, Text: table.Text, Button: table.Button } : table

    state.pane.isOpen = true
    state.pane.isFocused = e.props.isFocused === true
    state.pane.columns = columns
    state.pane.placement = e.props.placement
    // A reload while the pane stayed up: timers are gone, so resume them from here.
    if (!state.timers.has('watch')) control.resume()

    const pictures = isNarrow ? new Map() : picturesOf(state, columns, Date.now(), Date.now())

    state.mounted = new Map([...pictures].map(([key, grid]) => [key, { columns: grid.columns, rows: grid.rows }]))
    control.animate()

    const tree = paneView({ kit, state, nowMs: Date.now(), columns, pictures, act: control.actions })

    state.stats.renders.push(Date.now() - started)
    if (state.stats.renders.length > 200) state.stats.renders.shift()

    return tree
  })

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    const show = state.options.bar === 'on' || (state.options.bar === 'auto' && state.snapshot?.isRufloProject === true)

    if (control === null || e.props.hasSurvey || !show) {
      return next(e)
    }

    const table = $.ui.resolve(e) as unknown as Kit
    const bound = control
    const mark = table.Raster !== undefined ? table.Raster(markPicture(e.props.isWorking, Date.now()).toRaster(BAR_KEY)) : null

    bound.markFrame(e.requestId, e.props.isWorking && mark !== null)

    return barView(table, state, Math.floor(Number(e.props.bodyColumns) || 80), mark, () => void bound.open())
  })

  on('ui.close', async ($, e, next) => {
    const result = await next(e)

    if (e.id === PANE_ID && result.deny === undefined) {
      state.pane.isOpen = false
      state.pane.isShown = false
      control?.animate()
    }

    return result
  })

  /** Observes only: every call goes on unchanged; the count feeds the activity sparkline. */
  on('tool.call', ($, e, next) => {
    control?.noteToolCall()

    return next(e)
  })

  /** Observes only, never refuses: which mods the engine admitted or refused after the console, for the plugins view. */
  on('plugin.register', async ($, e, next) => {
    const result = await next(e)

    state.mods.push({ name: plain(e.name, 40), provenance: plain(e.provenance, 80), isLoaded: result.refuse === undefined, ...(result.refuse !== undefined && { reason: plain(result.refuse, 120) }), atMs: Date.now() })
    if (state.mods.length > 50) state.mods.shift()

    return result
  })
}
