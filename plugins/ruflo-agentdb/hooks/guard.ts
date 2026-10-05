import { hasSecret } from './screen'
import { isWriter } from './tools'
import { textsOf } from './screen'
export { textsOf }

/** The reason a memory write is refused, or undefined when it may go. Never names or echoes the secret. */
export function verdict(tool: string, input: unknown): string | undefined {
  if (!isWriter(tool)) return undefined
  return textsOf(input).some(hasSecret)
    ? 'ruflo-agentdb: this memory write holds what looks like a secret (a key, token or password). Store a reference to where it lives, not the value.'
    : undefined
}
