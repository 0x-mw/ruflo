import { hasSecret } from './screen'
import { textsOf } from './screen'
export { textsOf }

/** `mcp__<server>__<tool>` into its two halves; tool names never hold a double underscore. */
export function splitName(name: string): { server: string; tool: string } | undefined {
  if (!name.startsWith('mcp__')) return undefined
  const at = name.lastIndexOf('__')
  return at > 5 ? { server: name.slice(5, at), tool: name.slice(at + 2) } : undefined
}

const namespaceOf = (input: unknown): string => {
  const ns = (input as { namespace?: unknown } | null)?.namespace
  return typeof ns === 'string' ? ns : ''
}

/** True for the tool calls this plugin guards: ADR writes (`agentdb_hierarchical-store`, `agentdb_causal-edge`, `memory_store` into an `adr*` namespace). */
export function owns(tool: string, input: unknown): boolean {
  const parts = splitName(tool)
  const name = parts?.tool ?? tool
  return (name === 'agentdb_hierarchical-store' || name === 'agentdb_causal-edge' || name === 'memory_store') && /adr/i.test(namespaceOf(input))
}

/** The reason a call is refused, or undefined when it may go. Never names or echoes the secret. */
export function verdict(tool: string, input: unknown): string | undefined {
  if (!owns(tool, input)) return undefined
  return textsOf(input).some(hasSecret) ? "ruflo-adr: this ADR write holds what looks like a secret (a key, token or password). An ADR records a decision; name where the secret lives, not its value." : undefined
}
