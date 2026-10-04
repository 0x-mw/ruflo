import type { ToolInfo } from 'claude-code'

import type { Source } from './options'

/** A memory-read tool found among the connected ones, split into what `$.mcp.call` takes. */
export type Reader = { readonly label: string; readonly server: string; readonly tool: string; readonly args: (query: string, limit: number) => Record<string, unknown> }

const READERS = [
  { suffix: 'agentdb_hierarchical-recall', label: 'agentdb', args: (query: string, limit: number) => ({ query, topK: limit }) },
  { suffix: 'agentdb_pattern-search', label: 'agentdb', args: (query: string, limit: number) => ({ query, topK: limit }) },
  { suffix: 'hooks_recall', label: 'ruvector', args: (query: string, limit: number) => ({ query, top_k: limit }) },
] as const

/** `mcp__<server>__<tool>` into its two halves; tool names never hold a double underscore. */
export function splitName(name: string): { server: string; tool: string } | undefined {
  if (!name.startsWith('mcp__')) return undefined
  const at = name.lastIndexOf('__')
  return at > 5 ? { server: name.slice(5, at), tool: name.slice(at + 2) } : undefined
}

/** Every connected reader allowed by `source`, in preference order (hierarchical recall, pattern search, ruvector recall). */
export function pickReaders(tools: readonly ToolInfo[], source: Source): Reader[] {
  if (source === 'none') return []
  const found: Reader[] = []
  for (const reader of READERS) {
    if (source !== 'auto' && source !== reader.label) continue
    const hit = tools.find(t => t.mcp && splitName(t.name)?.tool === reader.suffix)
    const parts = hit && splitName(hit.name)
    if (parts) found.push({ label: reader.label, server: parts.server, tool: parts.tool, args: reader.args })
  }
  return found
}

/** The tools that put text into memory. A write through any of them is screened by the guard. */
const WRITERS = new Set([
  'agentdb_hierarchical-store',
  'agentdb_pattern-store',
  'agentdb_batch',
  'agentdb_causal-edge',
  'memory_store',
  'hooks_remember',
  'hooks_intelligence_pattern-store',
])

export const isWriter = (name: string) => WRITERS.has(splitName(name)?.tool ?? name)
