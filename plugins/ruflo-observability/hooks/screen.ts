/**
 * Pure text screening for the ruflo-observability mod (ADR-445 pattern). Findings are NAMES only: the matched text is never returned, logged or
 * counted by value, so a deny reason cannot leak what it caught.
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
  ['key assignment', /\b[A-Za-z0-9_-]*(?:api[_-]?key|secret|token|passw(?:or)?d|credential)s?["']?\s*[:=]\s*["']?[A-Za-z0-9/+=_.-]{16,}/i],
  ['us ssn', /\b\d{3}-\d{2}-\d{4}\b/],
  ['payment card number', /\b\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{4}\b/],
]

// C0/C1 controls (keeping tab and newline), DEL, zero-width and bidi override characters.
const INVISIBLE = new RegExp('[\\u0000-\\u0008\\u000b-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2064\\ufeff]', 'g')

const bare = (text: string) => (text.length > 20_000 ? text.slice(0, 20_000) : text).replace(INVISIBLE, '')

/** Names of every secret shape found in `text`. Cost is linear in the capped input. */
export const secretsIn = (text: string): string[] => {
  const bounded = bare(text)
  return SECRETS.filter(([, re]) => re.test(bounded)).map(([name]) => name)
}

export const hasSecret = (text: string) => secretsIn(text).length > 0

/** Every string in a tool's input, to a bounded depth and size: what the guard reads. */
export function textsOf(input: unknown, budget = { left: 20_000 }, depth = 0): string[] {
  if (budget.left <= 0 || depth > 6) return []
  if (typeof input === 'string') {
    budget.left -= input.length
    return [input]
  }
  if (Array.isArray(input)) return input.slice(0, 200).flatMap(v => textsOf(v, budget, depth + 1))
  if (typeof input === 'object' && input !== null) {
    // A string field is also read as `name=value`, so {api_secret: '...'} trips the key-assignment rule like a pasted line would.
    return Object.entries(input)
      .slice(0, 200)
      .flatMap(([k, v]) => (typeof v === 'string' ? textsOf(`${k}=${v}`, budget, depth + 1) : textsOf(v, budget, depth + 1)))
  }
  return []
}
