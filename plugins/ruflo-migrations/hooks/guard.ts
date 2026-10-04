import { secretsIn, textsOf } from './screen'
import type { ModOptions } from './options'
import type { Stats } from './status'

const WRITERS = new Set(['memory_store', 'agentdb_pattern-store', 'agentdb_hierarchical-store', 'agentdb_batch'])
const toolOf = (name: string) => (name.startsWith('mcp__') ? name.slice(name.lastIndexOf('__') + 2) : name)

/**
 * The reason a call is refused, or undefined when it may go. Migration SQL and connection strings are routinely pasted into memory, so a
 * memory write holding a secret or a database URL with an inline password is refused. Names the rule, never echoes the value.
 */
export function verdict(tool: string, input: unknown, _opts: ModOptions, stats: Stats): string | undefined {
  if (!WRITERS.has(toolOf(tool))) return undefined
  stats.checked++
  const found = textsOf(input).flatMap(secretsIn)
  if (found.length === 0) return undefined
  stats.lastBlock = found[0]
  return 'ruflo-migrations: this memory write holds what looks like a secret or a database URL with a password. Store the migration name and a reference to where the credential lives, not the value.'
}
