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

/** The tool's short name: `mcp__<server>__<tool>` to `<tool>`. */
export const shortName = (name: string) => (name.startsWith('mcp__') && name.lastIndexOf('__') > 5 ? name.slice(name.lastIndexOf('__') + 2) : name)

const field = (input: unknown, key: string): string => {
  const v = typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[key] : undefined
  return typeof v === 'string' ? v : ''
}

const WATCH: Readonly<Record<string, string>> = {
  'hooks_worker-dispatch': 'worker dispatch',
  'hooks_coverage-gaps': 'coverage gaps',
  'hooks_coverage-route': 'coverage route',
  'hooks_coverage-suggest': 'coverage suggest',
}

/** The label of a testgen-related call, else undefined. Observed only: nothing here ever denies. */
export function watched(tool: string, _input: unknown): string | undefined {
  return WATCH[shortName(tool)]
}

/** Never refuses: testgen is observe-only. */
export function verdict(_tool: string, _input: unknown): string | undefined {
  return undefined
}
