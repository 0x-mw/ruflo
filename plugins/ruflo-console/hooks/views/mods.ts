import type { RenderElement } from 'claude-code'

import { isStale, NO_MODS } from '../data/mods'
import { ago, clip, count, row, rule, text, THEME, type Ctx } from './common'

const SHOWN = 12

/**
 * The "Mods" section (ADR-446): one line per per-plugin mod that has written `.claude-flow/<short>-mod/status.json`: guard on or off, calls, blocked,
 * when it last wrote, a marker when that was an earlier session. Any mod that has blocked something leads. It reads the files; it never calls a mod.
 */
export function modsRows(ctx: Ctx): RenderElement[] {
  const { rows, refused, truncated } = ctx.state.snapshot?.mods ?? NO_MODS
  const blocked = rows.filter(mod => mod.blocked > 0).length
  const out: RenderElement[] = [rule(ctx, 'Mods', rows.length === 0 ? 'none reporting' : `${rows.length} reporting${blocked > 0 ? ` · ${blocked} blocked something` : ''}`)]

  if (rows.length === 0) {
    out.push(text(ctx, ' No mod has written a status file in this project yet. Each plugin mod reports here once a session has started with it.', { dimColor: true }))
  }

  for (const [i, mod] of rows.slice(0, SHOWN).entries()) {
    const stale = isStale(mod, ctx.nowMs)

    out.push(
      row(
        ctx,
        [
          ctx.kit.Text({ bold: true, color: mod.blocked > 0 ? THEME.warn : THEME.head, children: ` ${clip(mod.name, 22).padEnd(22)}` }),
          ctx.kit.Text({ color: mod.guard === true ? THEME.ok : undefined, dimColor: mod.guard !== true, children: ` guard ${mod.guard === null ? '–' : mod.guard ? 'on ' : 'off'}` }),
          ctx.kit.Text({ children: ` · calls ${mod.calls === null ? '–' : count(mod.calls)}` }),
          ctx.kit.Text({ color: mod.blocked > 0 ? THEME.warn : undefined, dimColor: mod.blocked === 0, children: ` · blocked ${count(mod.blocked)}` }),
          ctx.kit.Text({ dimColor: true, children: ` · ${mod.updatedMs === null ? 'never written' : ago(mod.updatedMs, ctx.nowMs)}${stale ? ' · stale (an earlier session)' : ''}` }),
        ],
        `mod-${i}-${mod.name}`,
      ),
    )
  }

  if (rows.length > SHOWN) out.push(text(ctx, ` +${rows.length - SHOWN} more mods reporting`, { dimColor: true }))
  if (truncated) out.push(text(ctx, ' more mod folders than the 60 the console reads; the rest are not shown', { dimColor: true }))
  if (refused > 0) out.push(text(ctx, ` ${refused} status file${refused === 1 ? '' : 's'} not shown: an unknown shape, too large, or unreadable`, { color: THEME.warn }))

  return out
}
