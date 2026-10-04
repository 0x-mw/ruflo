import { hasSecret } from './screen'

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

/** The tool's short name: `mcp__<server>__<tool>` to `<tool>`. */
export const shortName = (name: string) => (name.startsWith('mcp__') && name.lastIndexOf('__') > 5 ? name.slice(name.lastIndexOf('__') + 2) : name)

const field = (input: unknown, key: string): string => {
  const v = typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[key] : undefined
  return typeof v === 'string' ? v : ''
}

const PUBLISH = new Set(['x_federation_publish', 'x_federation_channel_publish'])

/** The label of a federation publish, else undefined: the guard only watches calls that put content on the swarm. */
export function watched(tool: string, _input: unknown): string | undefined {
  const t = shortName(tool)
  return PUBLISH.has(t) ? t.replace('x_federation_', '').replace('_', ' ') : undefined
}

/** The reason a publish is refused, or undefined when it may go. Never names or echoes the secret. */
export function verdict(tool: string, input: unknown): string | undefined {
  if (watched(tool, input) === undefined) return undefined
  return textsOf(input).some(hasSecret)
    ? 'ruflo-x-gateway: this message holds what looks like a secret (a key, token or password). The swarm is shared and signed messages are permanent; send a reference, not the value.'
    : undefined
}
