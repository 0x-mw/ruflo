import type { RenderElement } from 'claude-code'

import { EXPECTED_IN_MARKET, RUFLO_MARKET } from '../data/snapshot'
import { PLUGIN_NAME } from '../state'
import { ago, clip, col, kv, rule, text, THEME, type Ctx } from './common'

const WEEK = 7 * 86_400_000

/**
 * Installed ruflo plugins and whether the marketplace clone they came from is current. A clone that does not list the
 * plugins this repository publishes (ruflo-mods first) is stale: `/plugin install ruflo-mods@ruflo` then fails with
 * "not found", a real report today. The fix is named, never run.
 */
export function pluginsView(ctx: Ctx): RenderElement {
  const { state, nowMs } = ctx
  const facts = state.snapshot?.plugins ?? null
  const rows: RenderElement[] = [rule(ctx, 'Marketplace', RUFLO_MARKET)]

  if (facts === null) {
    return text(ctx, 'reading plugin records…', { dimColor: true })
  }

  const market = facts.markets?.find(entry => entry.name === RUFLO_MARKET) ?? null

  if (state.home === null) {
    rows.push(text(ctx, 'n/a — HOME is not readable to this mod, so ~/.claude/plugins cannot be found', { dimColor: true }))
  } else if (market === null) {
    rows.push(kv(ctx, 'ruflo clone', facts.markets === null ? 'n/a — no known_marketplaces.json' : 'not added — /plugin marketplace add ruvnet/ruflo'))
  } else {
    const isOld = market.updatedMs !== undefined && nowMs - market.updatedMs > WEEK

    rows.push(kv(ctx, 'ruflo clone', `pulled ${ago(market.updatedMs, nowMs)} · auto-update ${market.isAutoUpdate ? 'on' : 'off'} · lists ${facts.rufloOffered?.length ?? 'n/a'} plugins`, isOld ? THEME.warn : undefined))

    if (facts.missingFromClone.length > 0) {
      rows.push(text(ctx, `STALE: the clone does not list ${facts.missingFromClone.join(', ')} — run /plugin marketplace update ${RUFLO_MARKET}`, { bold: true, color: THEME.bad }))
    } else if (facts.rufloOffered === null) {
      rows.push(text(ctx, "n/a — the clone's marketplace.json is not readable, so freshness is unknown", { dimColor: true }))
    } else {
      rows.push(text(ctx, `current: lists ${EXPECTED_IN_MARKET.join(', ')}`, { color: THEME.ok }))
    }
  }

  const ruflo = (facts.installed ?? []).filter(plugin => plugin.marketplace === RUFLO_MARKET)
  const enabled = ruflo.filter(plugin => facts.enabled.has(plugin.id)).length

  rows.push(rule(ctx, 'Installed', facts.installed === null ? 'n/a' : `${ruflo.length} ruflo · ${enabled} enabled · ${(facts.installed ?? []).length} total`))

  const width = Math.max(10, Math.floor((ctx.columns - 2) / 2))
  const cells = ruflo
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(plugin => `${facts.enabled.has(plugin.id) ? '✓' : '·'} ${plugin.name.replace(/^ruflo-/, '')} ${plugin.version}${facts.rufloOffered !== null && !facts.rufloOffered.includes(plugin.name) ? ' (gone from clone)' : ''}`)

  for (let i = 0; i < Math.min(cells.length, 24); i += 2) {
    rows.push(text(ctx, `${clip(cells[i] ?? '', width - 1).padEnd(width)}${clip(cells[i + 1] ?? '', width - 1)}`))
  }

  if (cells.length > 24) rows.push(text(ctx, `+${cells.length - 24} more`, { dimColor: true }))
  if (cells.length === 0) rows.push(text(ctx, 'no ruflo plugins installed — /plugin install ruflo-core@ruflo', { dimColor: true }))

  rows.push(rule(ctx, 'Mods', 'function hooks'))
  rows.push(kv(ctx, PLUGIN_NAME, 'loaded (you are reading it)', THEME.ok))
  rows.push(kv(ctx, 'ruflo-mods', state.ruflo.snapshot !== null ? 'seated ($.ruflo answers)' : 'not seated in this session', state.ruflo.snapshot !== null ? THEME.ok : undefined))

  for (const mod of state.mods.slice(-5)) {
    rows.push(kv(ctx, mod.name, `${mod.isLoaded ? 'loaded' : `REFUSED: ${mod.reason ?? 'no reason given'}`} · ${mod.provenance} · ${ago(mod.atMs, nowMs)}`, mod.isLoaded ? undefined : THEME.bad))
  }

  rows.push(text(ctx, 'mods list: those registered after the console loaded (the engine admits earlier ones unseen)', { dimColor: true }))

  return col(ctx, rows, 'plugins')
}
