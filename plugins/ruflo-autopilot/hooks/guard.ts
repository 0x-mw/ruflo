import type { ModOptions } from './options'
import { hasSecret } from './screen'

/** `mcp__<server>__<tool>` into its two halves; tool names never hold a double underscore. */
export function splitName(name: string): { server: string; tool: string } | undefined {
  if (!name.startsWith('mcp__')) return undefined
  const at = name.lastIndexOf('__')
  return at > 5 ? { server: name.slice(5, at), tool: name.slice(at + 2) } : undefined
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

/** True for the tool calls this plugin guards: the autopilot log and learned patterns (`autopilot_log`, `autopilot_learn`) and a runaway loop limit on `autopilot_config` (`maxIterations` over the cap). */
export function owns(tool: string, input: unknown): boolean {
  const parts = splitName(tool)
  const name = parts?.tool ?? tool
  return name === 'autopilot_log' || name === 'autopilot_learn' || name === 'autopilot_config'
}

/** The reason a call is refused, or undefined when it may go. Never names or echoes the secret. */
export function verdict(tool: string, input: unknown, opts: ModOptions): string | undefined {
  if (!owns(tool, input)) return undefined
  const max = (input as { maxIterations?: unknown } | null)?.maxIterations
  if (typeof max === 'number' && max > opts.iterationCap) return "ruflo-autopilot: maxIterations is over the cap set in this plugin (iterationCap). Lower it, or raise the cap in the plugin options."
  return textsOf(input).some(hasSecret) ? "ruflo-autopilot: this autopilot write holds what looks like a secret (a key, token or password). Episodes are logged and learned from; record a reference, not the value." : undefined
}
