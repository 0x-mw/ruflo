import { hasSecret } from './screen'
import type { ModOptions } from './options'

/** `mcp__<server>__<tool>` into its tool half; tool names never hold a double underscore. */
export function shortName(name: string): string {
  const at = name.lastIndexOf('__')
  return name.startsWith('mcp__') && at > 5 ? name.slice(at + 2) : name
}

/** Every string in a tool's input (a string value led by its key, so `api_key=...` reads as an assignment), to a bounded depth and size: what the guard reads. */
export function textsOf(input: unknown, budget = { left: 100_000 }, depth = 0): string[] {
  if (budget.left <= 0 || depth > 6) return []
  if (typeof input === 'string') {
    budget.left -= Math.min(input.length, 20_000)
    return [input]
  }
  if (Array.isArray(input)) return input.slice(0, 200).flatMap(v => textsOf(v, budget, depth + 1))
  if (typeof input === 'object' && input !== null) return Object.entries(input).slice(0, 200).flatMap(([k, v]) => (typeof v === 'string' ? textsOf(`${k}=${v}`, budget, depth + 1) : textsOf(v, budget, depth + 1)))
  return []
}

const field = (input: unknown, key: string): unknown => (typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[key] : undefined)


const OWN = new Set([
  'agentdb_causal-edge',
  'agentdb_causal-edge-delete',
  'agentdb_causal-node-delete',
  'agentdb_hierarchical-store',
  'agentdb_hierarchical-recall',
  'agentdb_pattern-store',
  'agentdb_pattern-search',
  'agentdb_context-synthesize',
  'agentdb_semantic-route',
  'embeddings_generate',
])
const WRITERS = new Set(['agentdb_causal-edge', 'agentdb_hierarchical-store', 'agentdb_pattern-store'])
const DELETERS = new Set(['agentdb_causal-edge-delete', 'agentdb_causal-node-delete'])

/** The tools this plugin owns: the AgentDB graph and pattern tools its skills name. */
export const isOwn = (name: string, _input?: unknown): boolean => OWN.has(name)

/** The reason a call is refused, or undefined when it may go. Never names or echoes a secret. */
export function verdict(name: string, input: unknown, opts: ModOptions, _calls: Record<string, number>): string | undefined {
  if (WRITERS.has(name) && textsOf(input).some(hasSecret)) {
    return 'ruflo-knowledge-graph: this graph write holds what looks like a secret (a key, token or password). Store a reference to where it lives, not the value.'
  }
  if (opts.confirmDeletes && DELETERS.has(name) && field(input, 'confirm') !== true) {
    return 'ruflo-knowledge-graph: deleting graph nodes or edges cannot be undone. Ask the user, then retry with confirm: true.'
  }
  return undefined
}
