import type { RenderElement } from 'claude-code'

import { HARNESSES, harnessOf, isLive } from '../harness'
import type { AgentId, TermLine } from '../state'
import { button, col, row, rule, text, THEME, type Ctx } from './common'

/** Screen rows of scrollback under the picker: the newest, wrapped to the pane, so an answer reads like a chat. */
export const TERM_ROWS = 18

const TAG: Record<AgentId, { text: string; color: string }> = {
  codex: { text: 'codex ', color: '#00afd7' },
  claude: { text: 'claude', color: '#d7af00' },
  ruflo: { text: 'ruflo ', color: '#d7005f' },
}

/** A line folded to the pane's width, so a long answer wraps instead of being cut at the edge. */
function fold(line: string, width: number): string[] {
  if (line.length <= width) return [line === '' ? ' ' : line]

  const out: string[] = []
  let rest = line

  while (rest.length > width) {
    const cut = rest.lastIndexOf(' ', width)
    const at = cut > width * 0.5 ? cut : width

    out.push(rest.slice(0, at))
    rest = rest.slice(at).replace(/^ /, '')
  }

  out.push(rest)

  return out
}

/**
 * The second terminal: pick a harness (c codex, l claude, v swarm = both, u ruflo) and talk to it. Each agent keeps
 * its conversation per project, so a follow-up carries the context; the first message of a session is asked (Enter
 * shows the command, Enter again runs it), later ones go as you press Enter. Answers type out as they stream in, with
 * the tools each agent runs; s stops, o starts a new session, z clears the screen.
 */
export function terminalView(ctx: Ctx): RenderElement {
  const { state, nowMs } = ctx
  const term = state.terminal
  const harness = harnessOf(term.harness)
  const running = [...term.runs.entries()].map(([agent, run]) => `${agent} ${Math.round((nowMs - run.startedAtMs) / 1000)}s`)
  const rows: RenderElement[] = [rule(ctx, 'Harness', running.length > 0 ? `answering: ${running.join(' · ')}` : term.costUsd > 0 ? `$${term.costUsd.toFixed(2)} this session` : 'idle')]

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

  // Where each conversation stands: new, or resuming a thread with so many turns behind it.
  const sessions = harness.agents
    .filter((agent): agent is 'codex' | 'claude' => agent !== 'ruflo')
    .map(agent => {
      const id = term.sessions[agent]

      return `${agent}: ${id === undefined ? 'new session' : `session ${id.slice(0, 8)}… · ${term.turns[agent]} turn${term.turns[agent] === 1 ? '' : 's'} here`}${term.isLive[agent] ? ' · live' : ''}`
    })

  if (sessions.length > 0) rows.push(text(ctx, ` ${sessions.join('   ')}`, { dimColor: true }))
  rows.push(rule(ctx, 'Screen', `${term.lines.length} lines`))

  const width = Math.max(10, ctx.columns - 8)
  const screen: { line: TermLine; text: string; isFirst: boolean }[] = []

  for (const line of term.lines) fold(line.text, width).forEach((part, i) => screen.push({ line, text: part, isFirst: i === 0 }))

  if (screen.length === 0) {
    rows.push(text(ctx, ` nothing yet: type below and press Enter. The first message of a session shows its command; Enter again runs it.`, { dimColor: true }))
  }

  for (const { line, text: shown, isFirst } of screen.slice(-TERM_ROWS)) {
    const props = line.kind === 'in' ? { bold: true, color: THEME.head } : line.kind === 'err' ? { color: THEME.warn } : line.kind === 'sys' ? { dimColor: true, italic: true } : line.kind === 'tool' ? { color: THEME.info, dimColor: true } : {}
    const tag = line.from !== undefined ? TAG[line.from] : undefined

    rows.push(
      row(ctx, [
        ctx.kit.Text({ bold: true, color: tag?.color ?? THEME.info, children: tag === undefined ? '' : isFirst ? `${tag.text}│ ` : '      │ ' }),
        ctx.kit.Text({ wrap: 'truncate-end', ...props, children: shown }),
      ]),
    )
  }

  if (term.runs.size > 0) {
    // Data, not decoration: the cursor blinks only while an agent is writing back.
    rows.push(text(ctx, Math.floor(nowMs / 500) % 2 === 0 ? '█' : ' ', { color: THEME.ok }))
  }

  rows.push(text(ctx, ' '))

  if (ctx.kit.Input !== undefined) {
    rows.push(
      ctx.kit.Input({
        key: 'term-input',
        label: harness.label,
        placeholder: harness.id === 'ruflo' ? 'a ruflo command: swarm status, memory search -q auth …' : isLive(state) ? `follow up with ${harness.label}… (/new starts over)` : `ask ${harness.label} about this project…`,
        value: term.draft,
        submitLabel: isLive(state) ? 'send' : 'ask',
        onInput: value => ctx.act.term.draft(value),
        onSubmit: value => ctx.act.term.submit(value),
      }),
    )
  } else {
    rows.push(text(ctx, 'this surface has no text field: the terminal needs Claude Code in a terminal', { dimColor: true }))
  }

  rows.push(
    row(ctx, [
      ...(term.runs.size > 0 ? [button(ctx, 'term-stop', 'Stop', ctx.act.term.stop, { hotkey: 's' })] : []),
      ...(harness.id !== 'ruflo' ? [button(ctx, 'term-new', 'New session', ctx.act.term.fresh, { hotkey: 'o' })] : []),
      button(ctx, 'term-clear', 'Clear', ctx.act.term.clear, { hotkey: 'z' }),
      text(ctx, isLive(state) ? '  live: Enter sends' : '  Enter shows the command · Enter again runs it', { dimColor: true }),
    ]),
  )

  return col(ctx, rows, 'terminal')
}
