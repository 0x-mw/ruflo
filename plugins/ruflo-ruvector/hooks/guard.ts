import { hasSecret } from './screen'
import { isWriter } from './tools'

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

/** The reason a call is refused, or undefined when it may go. Never names or echoes the secret. */
export function verdict(tool: string, input: unknown): string | undefined {
  if (!isWriter(tool)) return undefined
  return textsOf(input).some(hasSecret)
    ? 'ruflo-ruvector: this call holds what looks like a secret (a key, token or password). Keep secrets out of the vector store and the shared brain; store a reference instead.'
    : undefined
}
