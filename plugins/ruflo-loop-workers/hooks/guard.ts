import { hasSecret } from './screen'
import type { ModOptions } from './options'

/** `mcp__<server>__<tool>` into its tool half; tool names never hold a double underscore. */
export function shortName(name: string): string {
  const at = name.lastIndexOf('__')
  return name.startsWith('mcp__') && at > 5 ? name.slice(at + 2) : name
}

/** Every string in a tool's input, to a bounded depth and size: what the guard reads. */
export function textsOf(input: unknown, budget = { left: 20_000 }, depth = 0): string[] {
  if (budget.left <= 0 || depth > 6) return []
  if (typeof input === 'string') {
    budget.left -= input.length
    return [input]
  }
  if (Array.isArray(input)) return input.slice(0, 200).flatMap(v => textsOf(v, budget, depth + 1))
  if (typeof input === 'object' && input !== null) return Object.values(input).slice(0, 200).flatMap(v => textsOf(v, budget, depth + 1))
  return []
}

const field = (input: unknown, key: string): unknown => (typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[key] : undefined)


/** The tools this plugin owns: the hooks_worker-* family. */
export const isOwn = (name: string, _input?: unknown): boolean => name.startsWith('hooks_worker-')

/** The reason a call is refused, or undefined when it may go. Never names or echoes a secret. */
export function verdict(name: string, input: unknown, opts: ModOptions, calls: Record<string, number>): string | undefined {
  if (name !== 'hooks_worker-dispatch') return undefined
  if (textsOf(input).some(hasSecret)) {
    return 'ruflo-loop-workers: this worker context holds what looks like a secret (a key, token or password). Workers log their context; pass a reference to where it lives.'
  }
  if ((calls[name] ?? 0) >= opts.maxDispatch) {
    return `ruflo-loop-workers: ${opts.maxDispatch} workers were dispatched this session, the cap. A loop that keeps dispatching is probably stuck; check hooks_worker-status, or raise maxDispatch.`
  }
  return undefined
}
