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


/** The tools this plugin owns: the six analyze_* tools and the three github_* tools its skills use. */
export const isOwn = (name: string, _input?: unknown): boolean => name.startsWith('analyze_') || ['github_pr_manage', 'github_repo_analyze', 'github_metrics'].includes(name)

/** The reason a call is refused, or undefined when it may go. Never names or echoes a secret. */
export function verdict(name: string, input: unknown, opts: ModOptions, _calls: Record<string, number>): string | undefined {
  if (name !== 'github_pr_manage') return undefined
  const action = field(input, 'action')
  if (['create', 'review'].includes(String(action)) && textsOf(input).some(hasSecret)) {
    return 'ruflo-jujutsu: this pull request text holds what looks like a secret (a key, token or password). PR text is public; remove it and retry.'
  }
  if (opts.confirmPrActions && (action === 'merge' || action === 'close') && field(input, 'confirm') !== true) {
    return `ruflo-jujutsu: ${String(action)} changes a pull request for everyone. Ask the user, then retry with confirm: true.`
  }
  return undefined
}
