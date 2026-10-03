/**
 * The update check and install: at load (and on "check now" in Settings) it reads the manifest published to github.com/ruvnet/ruflo,
 * and for a strictly newer version either asks (Update now, Always auto-update, Not now) or, if the person chose "always", installs
 * without asking, except across a major version. The install is Claude Code's own `claude plugin marketplace update` and `claude
 * plugin update`; this file never downloads or runs the new code itself, never passes `-y` or `--accept-command` (so Claude Code's
 * confirmation for a marketplace-declared command stands), and checks the installed version afterwards instead of assuming it worked.
 * Everything it needs comes in as `UpdateDeps`, so tests/update-flow.spec.ts drives every branch with no host and no network.
 */
import type { Host } from './host'
import {
  APPLYING_KEY,
  bumpKind,
  CHECKED_KEY,
  decide,
  firstLine,
  INSTALLED_KEY,
  installedEntry,
  isBeingApplied,
  isDue,
  LABEL,
  MANIFEST_URL,
  MANUAL_COMMAND,
  needsConfirmation,
  PLUGIN_ID,
  MARKET,
  promptOf,
  UPDATES_KEY,
  versionFromManifest,
  type UpdatesMode,
} from './updates'
import { getBuild } from './build'
import { CONSOLE_VERSION } from './version'
import type { State } from './state'

export type RunResult = { exitCode: number | null; stdout: string; stderr: string }

export type UpdateDeps = {
  nowMs: () => number
  /** A timer on the host's clock; the returned timer can be cancelled. */
  after: Host['after']
  /** The version this session is running. */
  local: string
  isInteractive: boolean
  /** A development checkout (a session loaded from a git worktree) manages itself with git: it is never offered an update. */
  isDevCheckout: () => boolean
  mode: () => UpdatesMode
  setMode: (mode: UpdatesMode) => Promise<void>
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  fetchText: Host['fetchText']
  ask: Host['askChoice']
  run: (argv: readonly string[], timeoutMs: number) => Promise<RunResult>
  toast: (text: string, timeoutMs?: number) => void
}

export type UpdateOutcome = 'skipped' | 'current' | 'declined' | 'installed' | 'unverified' | 'failed'
export type UpdateResult = { outcome: UpdateOutcome; remote?: string; detail: string }

const FETCH_TIMEOUT_MS = 8_000
const STEP_TIMEOUT_MS = 180_000
const LIST_TIMEOUT_MS = 30_000

const skipped = (detail: string): UpdateResult => ({ outcome: 'skipped', detail })

/** The fetch, or a refusal after the timeout (on the host's clock: a mod has no setTimeout): a host that never answers must not hold the session. */
const fetched = (deps: UpdateDeps): Promise<{ ok: boolean; status: number; text: string }> =>
  new Promise((resolve, reject) => {
    const timer = deps.after(FETCH_TIMEOUT_MS, () => reject(new Error('timed out')))

    deps.fetchText(MANIFEST_URL).then(
      response => {
        timer.cancel()
        resolve(response)
      },
      error => {
        timer.cancel()
        reject(error)
      },
    )
  })

async function listInstalled(deps: UpdateDeps) {
  const listed = await deps.run(['claude', 'plugin', 'list', '--json'], LIST_TIMEOUT_MS).catch(() => null)

  return listed === null || listed.exitCode !== 0 ? null : installedEntry(listed.stdout)
}

/** Installs `remote` with Claude Code's own commands, then reads back what is installed. Never throws. */
export async function applyUpdate(deps: UpdateDeps, remote: string): Promise<UpdateResult> {
  await deps.set(APPLYING_KEY, deps.nowMs())

  try {
    const before = await listInstalled(deps)

    if (before === null) return { outcome: 'failed', remote, detail: `${PLUGIN_ID} is not installed from the ruflo marketplace here (a session loaded with --plugin-dir has nothing to update)` }

    const market = await deps.run(['claude', 'plugin', 'marketplace', 'update', MARKET], STEP_TIMEOUT_MS).catch(() => null)

    if (market === null || market.exitCode !== 0) return { outcome: 'failed', remote, detail: `the marketplace did not update: ${firstLine(`${market?.stderr ?? ''}\n${market?.stdout ?? ''}`) || 'no answer'}` }

    // No -y and no --accept-command, ever: a marketplace-declared command is Claude Code's to confirm with a person.
    const updated = await deps.run(['claude', 'plugin', 'update', PLUGIN_ID, '--scope', before.scope], STEP_TIMEOUT_MS).catch(() => null)
    const output = `${updated?.stderr ?? ''}\n${updated?.stdout ?? ''}`

    if (updated !== null && updated.exitCode !== 0 && needsConfirmation(output)) return { outcome: 'failed', remote, detail: `Claude Code wants you to confirm this update itself: run \`${MANUAL_COMMAND}\` in a terminal` }
    if (updated === null || updated.exitCode !== 0) return { outcome: 'failed', remote, detail: `claude plugin update failed: ${firstLine(output) || 'no answer'}` }

    const after = await listInstalled(deps)

    if (after !== null && after.version === remote) {
      await deps.set(INSTALLED_KEY, remote)

      return { outcome: 'installed', remote, detail: `${remote} installed: restart Claude Code, or run /reload-plugins, to load it` }
    }

    return { outcome: 'unverified', remote, detail: `the update ran, but Claude Code lists ${after?.version ?? 'no version'} (expected ${remote}): check /plugin, then restart` }
  } finally {
    await deps.set(APPLYING_KEY, 0).catch(() => undefined)
  }
}

/**
 * One check. `force` is the person's own "check now": it ignores the daily gate and an off setting (they asked), but not a development
 * checkout. Never throws: every failure is a result, and the console starts whatever happens here.
 */
export async function checkForUpdate(deps: UpdateDeps, options: { force?: boolean } = {}): Promise<UpdateResult> {
  try {
    const force = options.force === true
    const mode = deps.mode()

    if (!deps.isInteractive) return skipped('nobody to ask (not an interactive session)')
    if (mode === 'off' && !force) return skipped('update checks are off')
    if (deps.isDevCheckout()) return skipped('this session runs a development checkout, which updates with git')

    const now = deps.nowMs()

    if (!force && !isDue(await deps.get(CHECKED_KEY), now)) return skipped('checked in the last day')
    if (!force && isBeingApplied(await deps.get(APPLYING_KEY), now)) return skipped('another session is updating')

    const response = await fetched(deps).catch(() => null)

    if (response === null || !response.ok) return { outcome: 'failed', detail: response === null ? 'could not reach GitHub' : `GitHub answered ${response.status}` }

    const remote = versionFromManifest(response.text)

    if (remote === null) return { outcome: 'failed', detail: 'the published manifest is not one of ours' }

    await deps.set(CHECKED_KEY, now)

    const kind = bumpKind(deps.local, remote)

    if (kind === null) return { outcome: 'current', remote, detail: `${deps.local} is the newest published` }
    if ((await deps.get(INSTALLED_KEY)) === remote) return skipped(`${remote} is installed: restart Claude Code to load it`)

    // "Check now" with checks off still asks: the person asked, but off means nothing is installed without them.
    const decision = decide(mode === 'off' ? 'ask' : mode, kind)

    if (decision === 'ask') {
      const prompt = promptOf(deps.local, remote, kind)
      const choice = await deps.ask(prompt.question, prompt.options).catch(() => null)

      if (choice === LABEL.always && kind !== 'major') await deps.setMode('auto')
      else if (choice !== LABEL.now) return { outcome: 'declined', remote, detail: `${remote} is available; not now` }
    } else {
      deps.toast(`Updating ruflo-console to ${remote}…`)
    }

    const result = await applyUpdate(deps, remote)

    deps.toast(result.outcome === 'installed' ? `ruflo-console ${result.detail}` : `ruflo-console update: ${result.detail}`, result.outcome === 'installed' ? 10_000 : 8_000)

    return result
  } catch (error) {
    return { outcome: 'failed', detail: firstLine(error instanceof Error ? error.message : String(error)) || 'the check failed' }
  }
}

/** The real dependencies: the host's storage, fetch, dialog and process runner, this session's mode, and the running version. */
export function updateDeps(state: State, host: Host): UpdateDeps {
  return {
    nowMs: () => Date.now(),
    after: (ms, fn) => host.after(ms, fn),
    local: CONSOLE_VERSION,
    isInteractive: state.isInteractive,
    isDevCheckout: () => getBuild() !== '',
    mode: () => state.updates,
    setMode: async mode => {
      state.updates = mode
      await host.storeSet(UPDATES_KEY, mode)
      host.invalidate()
    },
    get: key => host.storeGet(key),
    set: (key, value) => host.storeSet(key, value),
    fetchText: url => host.fetchText(url),
    ask: (question, options) => host.askChoice(question, options),
    run: async (argv, timeoutMs) => {
      const result = await host.run(argv, timeoutMs)

      return { exitCode: result.exitCode ?? null, stdout: result.stdout, stderr: result.stderr }
    },
    toast: (text, timeoutMs) => host.toast(text, timeoutMs),
  }
}

/** Runs a check with the real dependencies and leaves its outcome in a line for Settings. */
export async function runUpdateCheck(state: State, host: Host, options: { force?: boolean } = {}): Promise<UpdateResult> {
  const result = await checkForUpdate(updateDeps(state, host), options)

  state.updateNote = result.detail
  // A declined version stays on the band as a link to Settings; installing it, or finding nothing newer, clears it. A skipped
  // check says nothing about it either way.
  if (result.outcome === 'declined') state.updateAvailable = result.remote ?? ''
  else if (result.outcome === 'installed' || result.outcome === 'current' || result.outcome === 'unverified') state.updateAvailable = ''
  host.invalidate()

  return result
}
