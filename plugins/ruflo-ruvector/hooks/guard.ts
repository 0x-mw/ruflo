import { hasSecret } from './screen'
import { isWriter } from './tools'
import { textsOf } from './screen'
export { textsOf }

/** The reason a call is refused, or undefined when it may go. Never names or echoes the secret. */
export function verdict(tool: string, input: unknown): string | undefined {
  if (!isWriter(tool)) return undefined
  return textsOf(input).some(hasSecret)
    ? 'ruflo-ruvector: this call holds what looks like a secret (a key, token or password). Keep secrets out of the vector store and the shared brain; store a reference instead.'
    : undefined
}
