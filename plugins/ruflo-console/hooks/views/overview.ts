import type { RenderElement } from 'claude-code'

import type { MemoryStats } from '../data/cli'
import { ago, col, count, kv, live, picture, rule, sourceLine, text, THEME, type Ctx } from './common'

/** Each subsystem in one line: what it is, from where, as of when. Nothing on this view is estimated. */
export function overviewView(ctx: Ctx): RenderElement {
  const { state, nowMs } = ctx
  const snap = state.snapshot
  const version = live<string>(state.probes.get('version'))
  const memory = live<MemoryStats>(state.probes.get('memory'))
  const daemon = snap?.daemon ?? null
  const helpers = snap?.helpers ?? null
  const ruflo = state.ruflo.snapshot
  const loaded = state.mods.filter(mod => mod.isLoaded).length
  const refused = state.mods.length - loaded
  const swarm = snap?.swarm ?? null
  const rows: RenderElement[] = [rule(ctx, 'Subsystems', snap?.isRufloProject === false ? 'not a ruflo project' : '')]

  rows.push(kv(ctx, 'ruflo CLI', version !== null ? `v${version} (${state.options.cli})` : sourceLine(state.probes.get('version'), nowMs, 'n/a').text))
  rows.push(
    kv(
      ctx,
      'project',
      snap === null ? 'reading…' : snap.isRufloProject ? `ruflo state in ${state.cwd.split('/').slice(-2).join('/')}` : 'n/a — no .claude-flow here; `npx ruflo init` makes one',
      snap?.isRufloProject === true ? THEME.ok : undefined,
    ),
  )
  rows.push(
    kv(
      ctx,
      'daemon',
      daemon === null
        ? 'n/a — no daemon-state.json'
        : `${daemon.running ? 'running' : 'stopped'} per daemon-state.json (written ${ago(daemon.savedAtMs, nowMs)}) · ${daemon.workers.length} workers · ${count(daemon.workers.reduce((n, w) => n + w.runs, 0))} runs`,
      daemon?.running === true ? THEME.ok : undefined,
    ),
  )
  rows.push(kv(ctx, 'MCP tools', state.rufloTools === null ? 'n/a' : state.rufloTools > 0 ? `${state.rufloTools} ruflo tools callable now (Claude Code's tool list)` : 'none connected in this session', state.rufloTools !== null && state.rufloTools > 0 ? THEME.ok : undefined))
  rows.push(kv(ctx, 'memory DB', memory !== null ? `${count(memory.total)} entries · ${count(memory.vectors)} vectors · ${memory.backend}${memory.storage !== undefined ? ` · ${memory.storage}` : ''}` : sourceLine(state.probes.get('memory'), nowMs, 'n/a').text))
  rows.push(
    kv(
      ctx,
      'helpers',
      helpers === null
        ? 'n/a — no .claude/helpers/helpers.manifest.json'
        : `manifest v${helpers.version} · ${helpers.files.length} files · ${helpers.isSigned ? `signed (${helpers.algorithm ?? 'unknown'})` : 'UNSIGNED'} · signature not checked here (ruflo verify)`,
      helpers !== null && !helpers.isSigned ? THEME.warn : undefined,
    ),
  )
  rows.push(
    kv(
      ctx,
      'ruflo-mods',
      ruflo !== null ? `seated · policy ${ruflo.policy} · routed ${ruflo.routed} · tightened ${ruflo.tightened} · owns ${ruflo.owned.join('+') || 'nothing'}` : 'not seated — classic hooks handle every event',
      ruflo !== null ? THEME.ok : undefined,
    ),
  )
  rows.push(kv(ctx, 'function hooks', `on (this mod runs) · mods seen since it loaded: ${loaded} loaded, ${refused} refused`, refused > 0 ? THEME.warn : THEME.ok))
  rows.push(kv(ctx, 'swarm', swarm === null ? 'n/a — no swarm on disk' : `${swarm.id} · ${swarm.topology} · ${swarm.status} · ${swarm.agentIds.length || (snap?.agents.length ?? 0)} agents`))

  rows.push(rule(ctx, 'Activity', 'measured'))
  rows.push(picture(ctx, 'activity', `tool calls/5s: ${state.activity.slice(-12).join(' ') || 'none yet'}`))
  rows.push(text(ctx, 'tool calls the console saw (5 s buckets) and ruflo files changed between reads; the glow is decoration', { dimColor: true }))

  return col(ctx, rows, 'overview')
}
