import type { ToolInfo } from 'claude-code'

/** `mcp__<server>__<tool>` into its two halves; tool names never hold a double underscore. */
export function splitName(name: string): { server: string; tool: string } | undefined {
  if (!name.startsWith('mcp__')) return undefined
  const at = name.lastIndexOf('__')
  return at > 5 ? { server: name.slice(5, at), tool: name.slice(at + 2) } : undefined
}

/** The bare tool name: `mcp__srv__memory_store` and `memory_store` both give `memory_store`. */
export const bare = (name: string) => splitName(name)?.tool ?? name

/** A connected MCP tool whose bare name is `suffix`, split into what `$.mcp.call` takes. */
export function findTool(tools: readonly ToolInfo[], suffix: string): { server: string; tool: string } | undefined {
  const hit = tools.find(t => t.mcp && bare(t.name) === suffix)
  return hit && splitName(hit.name)
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

/** The tool input's `namespace` field when it is a string, else ''. */
export const namespaceOf = (input: unknown): string => {
  const ns = (input as { namespace?: unknown } | null)?.namespace
  return typeof ns === 'string' ? ns : ''
}
