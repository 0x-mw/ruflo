import { secretsIn, textsOf } from './screen'
import type { ModOptions } from './options'
import type { Stats } from './status'

const WRITERS = new Set(['memory_store', 'agentdb_pattern-store', 'agentdb_hierarchical-store', 'agentdb_batch'])
const toolOf = (name: string) => (name.startsWith('mcp__') ? name.slice(name.lastIndexOf('__') + 2) : name)

/**
 * The reason a call is refused, or undefined when it may go. Spans, logs and metric labels are stored as memory and outlive the run, so a
 * write holding a secret, a US SSN or a payment card number is refused. Names the rule, never echoes the value.
 */
export function verdict(tool: string, input: unknown, _opts: ModOptions, stats: Stats): string | undefined {
  if (!WRITERS.has(toolOf(tool))) return undefined
  stats.checked++
  const found = textsOf(input).flatMap(secretsIn)
  if (found.length === 0) return undefined
  stats.lastBlock = found[0]
  return 'ruflo-observability: this telemetry write holds what looks like a secret or personal data (a key, token, SSN or card number). Redact it from the span, log or label first.'
}
