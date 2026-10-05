/**
 * Pure text screening for the ruflo-business-pods mod (ADR-445 pattern, copied from ruflo-agentdb). Finds secret shapes so none is sent out.
 * Findings are NAMES only: the matched text is never returned, logged or counted by value.
 */

// BEGIN SHARED SCREEN (generated from plugins/ruflo-agentdb/hooks/screen.ts by scripts/sync-mod-screen.mjs; do not edit in a copy)
export type Rules = readonly (readonly [string, RegExp])[]

/** The secret shapes every mod screens for. A plugin adds its own after these, outside the markers. */
export const COMMON_SECRETS: Rules = [
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['aws access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['github token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['google api key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['anthropic or openai key', /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{24,}/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ['bearer token', /\bBearer\s+[A-Za-z0-9._~+/=-]{24,}/],
]

export const INJECTION: Rules = [
  ['override instructions', /\b(?:ignore|disregard|forget|override)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|all|any|system)\b[^.\n]{0,30}\b(?:instructions?|rules?|prompts?|guidelines?)\b/i],
  ['role reassignment', /\byou are (?:now|no longer)\b|\bact as (?:an? )?(?:unrestricted|jailbroken)\b/i],
  ['new instructions', /\b(?:new|updated|real) (?:system )?instructions?\s*:/i],
  ['fake role tags', /<\/?\s*(?:system|assistant|developer|instructions?)\s*>|^\s*(?:system|assistant)\s*:/im],
  ['concealment', /\bdo not (?:tell|inform|mention|reveal)[^.\n]{0,30}\b(?:user|human|operator)\b/i],
  ['exfiltration', /\b(?:exfiltrate|send|post|upload)\b[^.\n]{0,50}\b(?:secrets?|credentials?|tokens?|api keys?|\.env)\b/i],
  ['shell pipe', /\b(?:curl|wget)\b[^|\n]{0,200}\|\s*(?:sudo\s+)?(?:ba|z)?sh\b/i],
]

// C0/C1 controls (keeping tab and newline), DEL, zero-width and bidi override characters; built with escapes, never raw.
const INVISIBLE = new RegExp('[\\u0000-\\u0008\\u000b-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2064\\ufeff]', 'g')

/** Input capped at 20k characters with invisible characters removed, so none can hide a secret or a phrase. */
export const bare = (text: string) => (text.length > 20_000 ? text.slice(0, 20_000) : text).replace(INVISIBLE, '')

/** Names of the rules that match `text` (already `bare`d). */
export const names = (rules: Rules, text: string) => rules.filter(([, re]) => re.test(text)).map(([name]) => name)

export type Findings = { readonly secrets: readonly string[]; readonly injection: readonly string[] }

/** Names of every secret shape in `secrets` and every injection phrase found in `text`. Cost is linear in the capped input. */
export function screenWith(secrets: Rules, text: string): Findings {
  const bounded = bare(text)
  return { secrets: names(secrets, bounded), injection: names(INJECTION, bounded) }
}

export const hasSecretIn = (secrets: Rules, text: string) => names(secrets, bare(text)).length > 0

/** Makes stored text safe to show: no control or bidi characters, whitespace collapsed, at most `max` characters. */
export function tidy(text: string, max: number): string {
  const flat = text.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, Math.max(0, max - 1))}…` : flat
}
// END SHARED SCREEN

const SECRETS: Rules = [
  ...COMMON_SECRETS,
  ['nostr secret key', /\bnsec1[02-9ac-hj-np-z]{50,}/],
  ['key assignment', /\b(?:api[_-]?key|secret|token|passw(?:or)?d|credential)s?["']?\s*[:=]\s*["']?[A-Za-z0-9/+=_.-]{16,}/i],
]

/** Names of every secret shape found in `text`. Cost is linear in the capped input. */
export const secretsIn = (text: string): string[] => names(SECRETS, bare(text))

export const hasSecret = (text: string) => hasSecretIn(SECRETS, text)

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
