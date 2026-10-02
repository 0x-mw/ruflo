/**
 * Turn the ruflo mods on for a project (ADR-404): merge the settings, sync the
 * policy projection, then make the plugins loadable with `claude`. One path
 * for `ruflo mods install`, `ruflo init` and `ruflo init upgrade --mods`.
 */

import { homedir } from 'node:os';

import { output } from '../output.js';
import { installMod, MOD_PLUGINS, type Added, type InstallResult, type ModPlugin, type Scope } from './install.js';
import { findClaudeBinary, installArgv, marketplaceArgv, repairPluginInstall, type Exec } from './plugin-repair.js';
import { claudeConfigDir, marketplaceState, repairCommands, resolveFindings } from './plugin-resolve.js';

export interface ApplyOptions {
  scope: Scope;
  dryRun?: boolean;
  /** Run `claude plugin marketplace …` and `claude plugin install …` (default true). */
  pluginInstall?: boolean;
  /**
   * Skip the `claude` step under a test runner or CI (VITEST / CI set): an
   * init there must never clone from GitHub into whatever config dir is live.
   */
  skipInTestEnv?: boolean;
  /** Injectable for tests. */
  exec?: Exec;
}

export interface ApplyResult {
  install: InstallResult;
  /** Whether every required plugin was left loadable (true when the step was skipped by request). */
  resolvable: boolean;
  /** Why the `claude` step did not run, when it did not. */
  skipped?: string;
}

/** One line per thing a run added; empty on a re-run. */
export function describeAdded(added: Added): string[] {
  return [
    ...added.plugins.map((id) => `enabledPlugins["${id}"] = true`),
    ...(added.marketplace ? ['extraKnownMarketplaces.ruflo = github ruvnet/ruflo'] : []),
    ...(added.env ? ['env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS = "1"'] : []),
  ];
}

/** What default-on means, said exactly (ADR-404 amendment). */
export const LOAD_NOTE = [
  'ruflo-mods and ruflo-console run only where Claude Code function hooks are on: with them off, or the rollout switch off, they do nothing and the classic hooks keep every event.',
  "ruflo-swarm's commands, skills and agents load regardless; its live pane needs function hooks.",
];

async function syncPolicyQuietly(root: string): Promise<void> {
  try {
    const { loadPolicyState } = await import('../services/policy-runtime.js');
    const { syncPolicyProjection } = await import('./policy-projection.js');
    const result = syncPolicyProjection(root, loadPolicyState(root));
    if (result.action !== 'unchanged') output.writeln(`policy projection: ${result.action} (${result.path})`);
  } catch (error) {
    output.printWarning(`policy projection not synced: ${(error as Error).message}`);
  }
}

function printManual(root: string, scope: Scope, known: boolean, plugins: readonly ModPlugin[]): void {
  output.writeln('Run these to make the plugins loadable:');
  for (const line of repairCommands(root, scope, known, plugins)) output.writeln(`  ${line}`);
}

export async function applyMods(root: string, opts: ApplyOptions): Promise<ApplyResult> {
  const install = installMod(root, opts.scope, opts.dryRun === true);
  const configDir = claudeConfigDir(process.env, homedir());
  const known = marketplaceState(configDir).known;
  const lines = describeAdded(install.added);
  // Only what is enabled in the file: `claude plugin install` would flip a
  // plugin someone set to false back to true.
  const enabled = (install.next.enabledPlugins ?? {}) as Record<string, unknown>;
  const plugins = MOD_PLUGINS.filter((p) => enabled[p.id] === true);

  if (install.dryRun) {
    output.writeln(`Would write ${install.settingsFile}:`);
    output.printJson(install.next);
    if (opts.pluginInstall !== false) {
      output.writeln('Would run:');
      for (const argv of [marketplaceArgv(opts.scope, known), ...plugins.map((p) => installArgv(p.id, opts.scope))]) output.writeln(`  claude ${argv.join(' ')}`);
    }
    return { install, resolvable: true };
  }

  await syncPolicyQuietly(root);
  if (lines.length) {
    output.printSuccess(`ruflo mods enabled in ${install.settingsFile}${install.backup ? ` (backup: ${install.backup})` : ''}`);
    for (const line of lines) output.writeln(`  + ${line}`);
  } else {
    output.printSuccess(`ruflo mods already enabled in ${install.settingsFile} (nothing changed)`);
  }
  for (const line of LOAD_NOTE) output.writeln(output.dim(line));

  if (opts.pluginInstall === false) return { install, resolvable: true, skipped: '--no-plugin-install' };
  if (opts.skipInTestEnv && (process.env.VITEST || process.env.CI)) {
    output.writeln(output.dim(`claude plugin step skipped (${process.env.VITEST ? 'VITEST' : 'CI'} set).`));
    printManual(root, opts.scope, known, plugins);
    return { install, resolvable: false, skipped: 'test or CI environment' };
  }
  const claude = findClaudeBinary(process.env, homedir());
  if (!claude) {
    output.printWarning('No runnable claude binary on PATH: the plugins are enabled in settings, not installed.');
    printManual(root, opts.scope, known, plugins);
    return { install, resolvable: false, skipped: 'no claude on PATH' };
  }

  const repair = await repairPluginInstall({ projectRoot: root, scope: opts.scope, configDir, claude, plugins, exec: opts.exec });
  for (const step of repair.steps) {
    const mark = step.state === 'ok' ? output.success('✓') : step.state === 'pending' ? output.warning('…') : output.error('✗');
    output.writeln(`${mark} claude ${step.argv.join(' ')}${step.state === 'pending' ? ' (pending: not in the ruflo marketplace yet)' : ''}`);
    if (step.state === 'failed' && step.output) output.writeln(output.dim(`    ${step.output.split('\n').slice(-3).join('\n    ')}`));
  }
  const failed = resolveFindings(root, opts.scope, configDir, undefined, plugins.map((p) => p.id)).filter((f) => f.status === 'fail');
  if (repair.ok && failed.length === 0) return { install, resolvable: true };
  for (const f of failed) output.writeln(`${output.error('✗')} ${f.name}: ${f.message}`);
  printManual(root, opts.scope, marketplaceState(configDir).known, plugins);
  return { install, resolvable: false };
}
