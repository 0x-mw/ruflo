/**
 * The `skills` CLI (vercel-labs/skills, skills.sh) as fixed argv, and readers for what it prints. Read against skills
 * 1.7.0's source: `ls --json` prints an array of `{ name, path, scope, agents, source, sourceUrl, sourceType }`; `find`
 * has no JSON, so its coloured text is read line by line (`source@name 3.7M installs`, then `└ https://skills.sh/…`).
 * Every string here is another program's, or the person's, so each one is checked before it can become an argv element.
 */
import type { Outcome } from '../state'
import { jsonAfter } from './cli'
import { plain, recordOf, stringOf } from './parse'

/** `npx -y skills`: downloads the CLI on first use, so every run here reaches the network. */
export const SKILLS = ['npx', '-y', 'skills'] as const

export type Scope = 'project' | 'global'

export type InstalledSkill = { name: string; path: string; scope: Scope; agents: string[]; source?: string }
export type FoundSkill = { id: string; installs?: string; url?: string }

/** What the skills view holds between renders: the lists, the last search, and what is running now. */
export type SkillsState = {
  installed: InstalledSkill[] | null
  /** Why a list could not be read, by scope; a failing scope never blanks the other. */
  listErrors: Partial<Record<Scope, string>>
  listedAtMs: number
  isListing: boolean
  /** The search field's text, and the query the shown results answer. */
  searchDraft: string
  query: string
  found: FoundSkill[] | null
  findError: string | null
  isFinding: boolean
  createDraft: string
  /** The change running now (its label), and the create the last Enter asked about: Enter on it again confirms. */
  busy: string | null
  asked: { key: string; label: string } | null
  /** How the last change went, kept for the view after the footer lets it go. */
  last: Outcome | null
}

export const emptySkills = (): SkillsState => ({
  installed: null,
  listErrors: {},
  listedAtMs: 0,
  isListing: false,
  searchDraft: '',
  query: '',
  found: null,
  findError: null,
  isFinding: false,
  createDraft: '',
  busy: null,
  asked: null,
  last: null,
})

const TYPED = /^[A-Za-z0-9@/._ -]+$/
const SKILL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9._-]+)*@[A-Za-z0-9][A-Za-z0-9._:-]*$/
const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
/** A new skill's folder: `init` joins it onto the project, so no slash and no leading dot (`../x` would escape). */
const NEW_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/

export const MAX_QUERY = 64
export const MAX_NAME = 64

/** Text the person typed, trimmed, or null: empty, too long, a character outside [A-Za-z0-9@/._ -], or a leading -. */
export function typedOf(value: string, max = MAX_QUERY): string | null {
  const text = value.trim()

  return text === '' || text.length > max || !TYPED.test(text) || text.startsWith('-') ? null : text
}

export const skillIdOf = (value: unknown): string | null => (typeof value === 'string' && value.length <= 128 && SKILL_ID.test(value) ? value : null)
export const skillNameOf = (value: unknown): string | null => (typeof value === 'string' && value.length <= 128 && SKILL_NAME.test(value) ? value : null)

/** The name a new skill may take, or null. */
export function newNameOf(value: string): string | null {
  const text = typedOf(value, MAX_NAME)

  return text !== null && NEW_NAME.test(text) ? text : null
}

/**
 * The search field's words as `find` argv: `owner:<name>` anywhere in it becomes `--owner <name>`, the rest is the query
 * as one element. Null when the text would not pass `typedOf`, or names no query.
 */
export function findArgv(value: string): readonly string[] | null {
  const words = value.trim().split(/\s+/)
  const owners = words.filter(word => word.startsWith('owner:')).map(word => word.slice(6))
  const query = typedOf(words.filter(word => !word.startsWith('owner:')).join(' '))
  const owner = owners[0]

  if (query === null || owners.length > 1 || (owner !== undefined && !OWNER.test(owner))) return null

  return [...SKILLS, 'find', query, ...(owner !== undefined ? ['--owner', owner] : [])]
}

export const listArgv = (scope: Scope): readonly string[] => [...SKILLS, 'ls', ...(scope === 'global' ? ['-g'] : []), '--json']
export const addArgv = (id: string, scope: Scope): readonly string[] => [...SKILLS, 'add', id, ...(scope === 'global' ? ['-g'] : []), '-y']
export const removeArgv = (name: string, scope: Scope): readonly string[] => [...SKILLS, 'remove', name, ...(scope === 'global' ? ['-g'] : []), '-y']
/** With the scope named, so `update` never stops at its project-or-global prompt. */
export const updateArgv = (name: string, scope: Scope): readonly string[] => [...SKILLS, 'update', name, scope === 'global' ? '-g' : '-p', '-y']
export const initArgv = (name: string): readonly string[] => [...SKILLS, 'init', name]

/** `skills ls [-g] --json`: the installed skills, or null when the output is not a JSON array. */
export function parseInstalled(stdout: string, scope: Scope): InstalledSkill[] | null {
  const value = jsonAfter(stdout)

  if (!Array.isArray(value)) return null

  return value.slice(0, 200).flatMap(entry => {
    const skill = recordOf(entry)
    const name = stringOf(skill?.name, 128)
    const path = stringOf(skill?.path, 300)

    if (skill === null || name === undefined || path === undefined) return []

    const agents = (Array.isArray(skill.agents) ? skill.agents : []).slice(0, 20).flatMap(agent => stringOf(agent, 30) ?? [])
    const source = stringOf(skill.source, 120)

    return [{ name, path, scope: skill.scope === 'global' || skill.scope === 'project' ? skill.scope : scope, agents, ...(source !== undefined && { source }) }]
  })
}

/**
 * `skills find <query>`: each result is a line `source@name[ N installs]` followed by `└ <url>`. Split into lines first
 * (`plain` folds newlines away), then strip colour from each. A line that is not a skill id is passed over.
 */
export function parseFind(stdout: string): FoundSkill[] {
  const lines = stdout.slice(0, 200_000).split('\n').map(line => plain(line, 300))
  const out: FoundSkill[] = []

  lines.forEach((line, i) => {
    const match = /^(\S+)(?:\s+([\d.]+[KM]?)\s+installs?)?$/.exec(line)
    const id = skillIdOf(match?.[1])

    if (match === null || id === null || out.length >= 30) return

    const next = /^└\s*(https:\/\/\S+)$/.exec(lines[i + 1] ?? '')?.[1]

    out.push({ id, ...(match[2] !== undefined && { installs: match[2] }), ...(next !== undefined && { url: next }) })
  })

  return out
}

/** The skill's own name in an `owner/repo@skill` id: what `ls` lists once it is added. */
export const nameInId = (id: string): string => id.slice(id.lastIndexOf('@') + 1)
