/**
 * What the autopilot checks before it acts (ADR-466 §5): task classification, the Project Anatole gate, the kill flag, the spend
 * windows, the permission preflight and what counts as an effect. Pure apart from `killSeen` and `preflightAll`, which are given the
 * reader and the (optional) permission check. Nothing here widens anything: a task it cannot place is `cls: null` and is parked.
 */
import { missionCostArgv, parseMissionCost } from './mission-cost'
import { KILL_FILE, TOOL_CLASSES, type HardDeny, type ToolClass } from './ap-envelope'
import type { EffectFact, Preflight, TaskFact } from './ap-loop'
import type { AnatoleFacts } from './anatole'
import type { Spend } from './ap-envelope'
import type { ReaderFs } from './files'

/** Words that mean a hard deny. Matching is deliberately broad: a false match only parks a task for a question. */
const DENIES: readonly [HardDeny, RegExp][] = [
  ['publish', /\b(npm\s+publish|publish(es|ed|ing)?\b|pnpm\s+publish|cargo\s+publish|twine|docker\s+push)/i],
  ['release', /\b(gh\s+release|git\s+tag\b.*push|cut\s+a\s+release|create\s+(a\s+)?release|release\s+notes?\s+and\s+tag)/i],
  ['deploy', /\b(deploy(s|ed|ing)?\b|gcloud\s+run\s+deploy|firebase\s+deploy|kubectl\s+apply|terraform\s+apply)/i],
  ['force-push', /(push\s+(--force|-f\b|--force-with-lease)|force[- ]push)/i],
  ['secret-access', /\b(api[_ -]?key|secret|credential|password|private\s+key|\.env\b|gcloud\s+secrets|token)\b/i],
  ['delete-outside-worktree', /\b(rm\s+-rf?\s+(\/|~|\$HOME)|delete\s+(the\s+)?(home|root|\/)|drop\s+database|mkfs|dd\s+of=\/dev)/i],
  ['envelope-edit', /\b(autopilot\s+(envelope|scope|settings)|widen\s+(the\s+)?(envelope|scope)|raise\s+(the\s+)?(spend|budget)\s+(cap|ceiling)|grant\s+(itself|autopilot))/i],
]

/** From least to most privileged: a task that matches several is classified as the most privileged. */
const CLASS_WORDS: readonly [ToolClass, RegExp][] = [
  ['read', /\b(read|review|analy[sz]e|research|audit|inspect|summari[sz]e|investigate|survey|list|explain|document)/i],
  ['test', /\b(test|vitest|jest|lint|typecheck|benchmark|verify|validate|build)\b/i],
  ['edit', /\b(implement|write|fix|refactor|add|edit|update|create|rename|patch|optimi[sz]e|migrate|remove)\b/i],
  ['git-local', /\b(commit|stage|stash)\b/i],
  ['git-branch', /\b(branch|worktree|merge|rebase|cherry-pick)\b/i],
  ['spawn', /\b(spawn|swarm|sub-?agent|delegate)\b/i],
  ['mcp', /\b(mcp|ruflo\s+tool|agentdb|memory_)/i],
  ['network', /\b(fetch|download|curl|http|api\s+call|web\s+search|clone)\b/i],
]

// eslint-disable-next-line no-control-regex
const PATH = /(?:^|[\s"'`(])(\/(?:[A-Za-z0-9._@-]+\/)*[A-Za-z0-9._@-]+)/

/** A task's text as the facts the loop needs. The class is the most privileged one the words suggest; none is `null`, never a default. */
export function classifyTask(id: string, title: string, requirement = ''): TaskFact {
  const text = `${title}\n${requirement}`
  const hardDeny = DENIES.find(([, pattern]) => pattern.test(text))?.[0] ?? null
  const hits = CLASS_WORDS.filter(([, pattern]) => pattern.test(text)).map(([cls]) => cls)
  const cls = hits.length === 0 ? null : (hits.at(-1) as ToolClass)
  const path = PATH.exec(text)?.[1] ?? null

  return { id, title: title.slice(0, 160), cls, hardDeny, path }
}

/** Anatole's state for the gate: `on` only when its status says a mode other than off, `off` when it says off, else `absent`. */
export function anatoleFact(facts: AnatoleFacts | undefined): 'on' | 'off' | 'absent' {
  const mode = facts?.status?.mode ?? facts?.modeOverride ?? null

  if (facts === undefined || !facts.present || mode === null) return 'absent'

  return mode === 'off' ? 'off' : 'on'
}

/** True when the kill flag exists. A stat that throws means no flag (a missing file is how stat says it). Checked on every tick. */
export async function killSeen(fs: Pick<ReaderFs, 'stat'>, cwd: string): Promise<boolean> {
  try {
    return (await fs.stat(`${cwd.replace(/\/+$/, '')}/${KILL_FILE}`)) !== undefined
  } catch {
    return false
  }
}

export type SpendWindows = { hour: readonly string[] | null; day: readonly string[] | null; total: readonly string[] | null }

/** The three ledger commands (last hour, last 24 hours, since the start) for the project; null where a path check refuses. */
export function spendArgvs(root: string, startMs: number, nowMs: number, project: string): SpendWindows {
  return { hour: missionCostArgv(root, nowMs - 3_600_000, null, project), day: missionCostArgv(root, nowMs - 86_400_000, null, project), total: missionCostArgv(root, startMs, null, project) }
}

/** The three ledger outputs as spend. Any window that did not parse, or whose total is unknown (unpriced rows), makes the whole reading null: unknown is not zero. */
export function spendOf(out: { hour: string; day: string; total: string }): Spend | null {
  const [hour, day, total] = [parseMissionCost(out.hour), parseMissionCost(out.day), parseMissionCost(out.total)]

  if (hour?.usd == null || day?.usd == null || total?.usd == null) return null

  return { hourUsd: hour.usd, dayUsd: day.usd, totalUsd: total.usd }
}

/** The engine's own permission check, when the host offers one (`$.tool.check`). Absent in this console today: said, never faked. */
export type ToolCheck = (tool: string) => Promise<{ decision?: string } | string | undefined>

/** The tool a class is checked through. A class whose representative tool the person's settings would block is parked, never tried. */
export const PREFLIGHT_TOOL: Record<ToolClass, string> = { read: 'Read', test: 'Bash', edit: 'Edit', 'git-local': 'Bash', 'git-branch': 'Bash', spawn: 'Agent', mcp: 'mcp__claude-flow__task_update', network: 'WebFetch' }

export async function preflightAll(check: ToolCheck | undefined): Promise<Record<string, Preflight>> {
  const out: Record<string, Preflight> = {}

  for (const cls of TOOL_CLASSES) {
    if (check === undefined) {
      out[cls] = 'unwired'
      continue
    }

    try {
      const answer = await check(PREFLIGHT_TOOL[cls])
      const decision = typeof answer === 'string' ? answer : answer?.decision

      out[cls] = decision === 'allow' ? 'allow' : decision === 'deny' ? 'deny' : decision === 'ask' ? 'ask' : 'unwired'
    } catch {
      out[cls] = 'unwired'
    }
  }

  return out
}

/** A step's effect. The ruflo task store's status is a CLAIM (its swarm execution is a known no-op): `done` needs the person's own verify commands to pass; with none the step is `done-unverified` and says so everywhere. */
export function effectOf(storeStatus: string | undefined, verify: { ran: number; failed: number }): EffectFact {
  if (storeStatus === 'failed' || storeStatus === 'cancelled') return 'failed'
  if (storeStatus !== 'completed') return 'unknown'
  if (verify.failed > 0) return 'failed'

  return verify.ran === 0 ? 'done-unverified' : 'done'
}
