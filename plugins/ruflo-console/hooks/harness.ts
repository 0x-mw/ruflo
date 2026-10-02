/**
 * The terminal view's second terminal: a line of text sent to another harness (codex, claude, or one ruflo CLI
 * command), its output streamed into a scrollback. Each harness is a fixed argv; the person's text reaches a model
 * harness on stdin, never as an argument, so it cannot be read as a flag, and the ruflo harness splits it into words
 * with no shell. A run costs money, so it is asked like any other change: y runs it, n drops it.
 */
import type { ActionSpec } from './actions'
import type { Host } from './host'
import { CLI_PREFIXES, push, type HarnessId, type State, type TermLine } from './state'

export const TERM_MAX_LINES = 400
/** The engine kills a spawned child only when the loop ends: the console ends it at ten minutes, as `run` would. */
export const RUN_CAP_MS = 10 * 60_000
const MAX_PROMPT = 4_000

export type Harness = {
  id: HarnessId
  /** The picker's hotkey in the terminal view. */
  key: string
  label: string
  /** What it runs and what it may do, in the words the view shows. */
  about: string
  argv: (state: State, text: string) => readonly string[] | null
  /** True: the text goes on stdin; false: it is part of the argv. */
  isStdin: boolean
}

export const HARNESSES: readonly Harness[] = [
  {
    id: 'codex',
    key: 'c',
    label: 'codex',
    about: 'codex exec in a read-only sandbox: reads this project, writes nothing · billed to your OpenAI plan',
    argv: () => ['codex', 'exec', '--sandbox', 'read-only', '--skip-git-repo-check', '-'],
    isStdin: true,
  },
  {
    id: 'claude',
    key: 'l',
    label: 'claude',
    about: 'claude -p in plan mode, at most $1 a run: answers, edits nothing · billed to your Claude plan',
    argv: () => ['claude', '-p', '--permission-mode', 'plan', '--max-budget-usd', '1'],
    isStdin: true,
  },
  {
    id: 'ruflo',
    key: 'u',
    label: 'ruflo',
    about: 'one ruflo CLI command, split on spaces with no shell (swarm status, memory search -q auth) · local unless it reaches out',
    argv: (state, text) => {
      const words = text.split(/\s+/).filter(word => word !== '')

      return words.length === 0 || words.length > 40 ? null : [...CLI_PREFIXES[state.options.cli], ...words]
    },
    isStdin: false,
  },
]

export const harnessOf = (id: HarnessId): Harness => HARNESSES.find(harness => harness.id === id) ?? (HARNESSES[0] as Harness)

/**
 * One line of a harness's output as the scrollback keeps it: ANSI sequences, control and bidirectional characters
 * gone, tabs as two spaces, indentation kept (unlike `plain`, which folds whitespace for one-line facts).
 */
export function termText(line: string, max = 400): string {
  const cleaned = line
    .replace(/\u001b\][^\u0007\u001b]*(\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\t/g, '  ')
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '')
    .trimEnd()

  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max - 1)}…`
}

function note(state: State, kind: TermLine['kind'], text: string): void {
  for (const line of text.split('\n')) push(state.terminal.lines, { kind, text: termText(line) }, TERM_MAX_LINES)
}

/** Why the field's text cannot be asked now, or null when it can. */
export function whyNotRun(state: State, text: string): string | null {
  if (state.terminal.running !== null) return `${state.terminal.running.label} is still running: stop it first (s)`
  if (text.trim() === '') return 'type something first'
  if (harnessOf(state.terminal.harness).argv(state, text.trim()) === null) return 'that is not one ruflo command (1 to 40 words)'

  return null
}

/** The confirm-gated ask for the field's text, or null (see `whyNotRun`). */
export function harnessSpec(state: State, host: Host, text: string): ActionSpec | null {
  const harness = harnessOf(state.terminal.harness)
  const prompt = text.trim().slice(0, MAX_PROMPT)
  const argv = whyNotRun(state, prompt) === null ? harness.argv(state, prompt) : null

  if (argv === null) return null

  const input = harness.isStdin ? prompt : undefined
  const short = termText(prompt.replace(/\s+/g, ' '), 48)

  return {
    label: `ask ${harness.label}: ${short}`,
    args: argv,
    shows: `${argv.join(' ')}${input !== undefined ? '  (your text on stdin)' : ''}`,
    expect: 'its output in the terminal',
    run: () => runHarness(state, host, harness.label, argv, prompt, input),
  }
}

/** Runs one harness command, streaming each line it writes into the scrollback; s stops it, and so does the cap. */
export async function runHarness(state: State, host: Host, label: string, argv: readonly string[], prompt: string, input: string | undefined): Promise<void> {
  const startedAtMs = Date.now()
  const secs = () => `${Math.round((Date.now() - startedAtMs) / 1000)} s`
  const partial = { out: '', err: '' }
  let isStopped = false

  note(state, 'in', `${label}> ${prompt}`)

  let stream: ReturnType<Host['spawn']>

  try {
    stream = host.spawn(argv, input)
  } catch (error) {
    note(state, 'sys', `${argv[0]} did not start: ${error instanceof Error ? error.message : String(error)}`)
    host.invalidate()

    return
  }

  const stop = () => {
    isStopped = true
    void stream.return(undefined as never).catch(() => undefined)
  }
  const cap = host.after(RUN_CAP_MS, stop)

  state.terminal.running = { label, startedAtMs, stop }
  host.invalidate()

  const flush = () => {
    for (const kind of ['out', 'err'] as const) {
      if (partial[kind] !== '') note(state, kind, partial[kind])
      partial[kind] = ''
    }
  }

  try {
    for await (const chunk of stream) {
      const kind = chunk.stream === 'stderr' ? 'err' : 'out'
      const lines = (partial[kind] + chunk.text).split('\n')

      partial[kind] = lines.pop() ?? ''

      for (const line of lines) push(state.terminal.lines, { kind, text: termText(line) }, TERM_MAX_LINES)
      host.invalidate()
    }

    flush()

    const result = await stream.result

    note(state, 'sys', isStopped ? `stopped after ${secs()}` : result.signal !== null ? `ended by ${result.signal} after ${secs()}` : `exit ${result.code ?? '?'} · ${secs()}`)
  } catch (error) {
    flush()
    note(state, 'sys', isStopped ? `stopped after ${secs()}` : `${argv[0]}: ${error instanceof Error ? error.message : String(error)} (is it installed and on PATH?)`)
  } finally {
    cap.cancel()
    state.terminal.running = null
    host.invalidate()
  }
}
