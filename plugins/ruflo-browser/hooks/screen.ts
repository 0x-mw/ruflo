/**
 * Pure text screening for the ruflo-browser mod (ADR-445 pattern, copied from ruflo-agentdb). Finds secret shapes so none is sent out.
 * Findings are NAMES only: the matched text is never returned, logged or counted by value.
 */

const SECRETS: readonly (readonly [string, RegExp])[] = [
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['aws access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['github token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['google api key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['anthropic or openai key', /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{24,}/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ['bearer token', /\bBearer\s+[A-Za-z0-9._~+/=-]{24,}/],
  ['nostr secret key', /\bnsec1[02-9ac-hj-np-z]{50,}/],
  ['key assignment', /\b(?:api[_-]?key|secret|token|passw(?:or)?d|credential)s?["']?\s*[:=]\s*["']?[A-Za-z0-9/+=_.-]{16,}/i],
]

// C0/C1 controls (keeping tab and newline), DEL, zero-width and bidi override characters.
const INVISIBLE = new RegExp('[\\u0000-\\u0008\\u000b-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2064\\ufeff]', 'g')

const bare = (text: string) => (text.length > 20_000 ? text.slice(0, 20_000) : text).replace(INVISIBLE, '')

/** Names of every secret shape found in `text`. Cost is linear in the capped input. */
export const secretsIn = (text: string): string[] => SECRETS.filter(([, re]) => re.test(bare(text))).map(([name]) => name)

export const hasSecret = (text: string) => secretsIn(text).length > 0

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

const CRED_KEY = /^(?:pass(?:word|wd)?|secret(?:_?key)?|api_?key|(?:access_?|auth_?|bearer_?)?token|private_?key|nsec|authorization|credentials?)$/i

/** True when any object key (to a bounded depth) names a credential and holds a non-empty string. The value is never read out. */
export function hasCredentialField(input: unknown, depth = 0): boolean {
  if (depth > 6 || typeof input !== 'object' || input === null) return false
  if (Array.isArray(input)) return input.slice(0, 200).some(v => hasCredentialField(v, depth + 1))
  return Object.entries(input).slice(0, 200).some(([k, v]) => (CRED_KEY.test(k) && typeof v === 'string' && v.trim() !== '') || hasCredentialField(v, depth + 1))
}

/** `mcp__<server>__<tool>` into its two halves; tool names never hold a double underscore. Undefined for a non-MCP tool. */
export function splitName(name: string): { server: string; tool: string } | undefined {
  if (!name.startsWith('mcp__')) return undefined
  const at = name.lastIndexOf('__')
  return at > 5 ? { server: name.slice(5, at), tool: name.slice(at + 2) } : undefined
}
