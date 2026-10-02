import type { RenderElement } from 'claude-code'

import { HARNESSES, harnessOf } from '../harness'
import { button, clip, col, row, rule, text, THEME, type Ctx } from './common'

/** Scrollback lines shown under the picker: the newest, so a long answer reads like a terminal's tail. */
export const TERM_ROWS = 16

/**
 * The second terminal: pick a harness (c codex, l claude, u ruflo) and type into the field. Enter shows the exact
 * command, Enter again on the same text runs it (y does too, from outside the field). Output streams in as the harness
 * writes it; s stops a run, z clears the screen. While the field has focus every key types into it.
 */
export function terminalView(ctx: Ctx): RenderElement {
  const { state, nowMs } = ctx
  const term = state.terminal
  const harness = harnessOf(term.harness)
  const rows: RenderElement[] = [rule(ctx, 'Harness', term.running !== null ? `${term.running.label} running · ${Math.round((nowMs - term.running.startedAtMs) / 1000)} s` : 'idle')]

  rows.push(
    ctx.kit.Box({
      flexDirection: 'row',
      gap: 1,
      key: 'term-pick',
      children: HARNESSES.map(entry =>
        entry.id === term.harness
          ? ctx.kit.Box({ key: `term-${entry.id}`, children: [ctx.kit.Text({ bold: true, color: THEME.head, children: `[${entry.key}: ${entry.label.toUpperCase()}]` })] })
          : ctx.kit.Button({ key: `term-${entry.id}`, label: entry.label, hotkey: entry.key, plain: true, dimColor: true, onPress: () => ctx.act.term.harness(entry.id) }),
      ),
    }),
  )
  rows.push(text(ctx, ` ${harness.about}`, { color: THEME.info }))
  rows.push(rule(ctx, 'Screen', `${term.lines.length} lines`))

  const tail = term.lines.slice(-TERM_ROWS)

  if (tail.length === 0) {
    rows.push(text(ctx, ' nothing yet: type below, Enter shows the exact command, Enter again runs it', { dimColor: true }))
  }

  for (const line of tail) {
    const props = line.kind === 'in' ? { bold: true, color: THEME.head } : line.kind === 'err' ? { color: THEME.warn } : line.kind === 'sys' ? { dimColor: true, italic: true } : {}

    rows.push(ctx.kit.Text({ wrap: 'truncate-end', ...props, children: clip(line.text === '' ? ' ' : line.text, Math.max(4, ctx.columns)) }))
  }

  if (term.running !== null) {
    // Data, not decoration: the cursor blinks only while a harness is writing back.
    rows.push(text(ctx, Math.floor(nowMs / 500) % 2 === 0 ? '█' : ' ', { color: THEME.ok }))
  }

  rows.push(text(ctx, ' '))

  if (ctx.kit.Input !== undefined) {
    rows.push(
      ctx.kit.Input({
        key: 'term-input',
        label: `${harness.label}> `,
        placeholder: harness.id === 'ruflo' ? 'a ruflo command: swarm status, memory search -q auth …' : `ask ${harness.label} about this project…`,
        value: term.draft,
        submitLabel: 'ask',
        onInput: value => ctx.act.term.draft(value),
        onSubmit: value => ctx.act.term.submit(value),
      }),
    )
  } else {
    rows.push(text(ctx, 'this surface has no text field: the terminal needs Claude Code in a terminal', { dimColor: true }))
  }

  rows.push(
    row(ctx, [
      ...(term.running !== null ? [button(ctx, 'term-stop', 'Stop', ctx.act.term.stop, { hotkey: 's' })] : []),
      button(ctx, 'term-clear', 'Clear', ctx.act.term.clear, { hotkey: 'z' }),
      text(ctx, '  Tab or click to the field · Enter shows the command · Enter again runs it', { dimColor: true }),
    ]),
  )

  return col(ctx, rows, 'terminal')
}
