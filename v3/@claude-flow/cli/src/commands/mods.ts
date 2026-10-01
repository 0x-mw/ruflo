/**
 * `ruflo mods` — opt into running ruflo as a Claude Code mod (ADR-404,
 * Claude Code function hooks, early access).
 *
 * install/uninstall edit one settings file and record what they added;
 * status/doctor report what can be known from outside a session; sync-policy
 * rewrites the policy projection the mod's tool check reads. Classic hooks
 * are never removed: they stay the default and the fallback.
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { installMod, uninstallMod, type Scope } from '../mods/install.js';
import { probeMods, type Finding } from '../mods/probe.js';

function projectRoot(ctx: CommandContext): string {
  return (ctx.flags.projectRoot as string | undefined) ?? (ctx.flags['project-root'] as string | undefined) ?? ctx.cwd ?? process.cwd();
}

function printFindings(findings: Finding[]): void {
  for (const f of findings) {
    const mark = f.status === 'pass' ? output.success('✓') : f.status === 'warn' ? output.warning('!') : output.error('✗');
    output.writeln(`${mark} ${f.name}: ${f.message}`);
    if (f.fix && f.status !== 'pass') output.writeln(output.dim(`    fix: ${f.fix}`));
  }
}

const rootOption = { name: 'project-root', description: 'Project root (default: current directory)', type: 'string' as const };

const installSub: Command = {
  name: 'install',
  description: 'Enable the ruflo-mods plugin for this project (opt-in; classic hooks stay as fallback)',
  options: [
    rootOption,
    { name: 'scope', description: 'local (.claude/settings.local.json, default) | project (.claude/settings.json)', type: 'string', default: 'local' },
    { name: 'dry-run', description: 'Show the settings that would be written', type: 'boolean', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const scope = (ctx.flags.scope as string | undefined) ?? 'local';
    if (scope !== 'local' && scope !== 'project') {
      output.printError(`--scope must be local or project, got ${scope}`);
      return { success: false, exitCode: 1 };
    }
    const root = projectRoot(ctx);
    const result = installMod(root, scope as Scope, (ctx.flags.dryRun === true || ctx.flags['dry-run'] === true));
    if (result.dryRun) {
      output.writeln(`Would write ${result.settingsFile}:`);
      output.printJson(result.next);
      return { success: true, data: result };
    }
    await syncPolicy(root, true);
    output.printSuccess(`ruflo-mods enabled in ${result.settingsFile}${result.backup ? ` (backup: ${result.backup})` : ''}`);
    output.writeln('Restart Claude Code, then run /ruflo-mods in a session to see what the mod owns.');
    output.writeln(output.dim('Early access: Claude Code loads it only where function hooks are on. Run `ruflo mods doctor`.'));
    return { success: true, data: result };
  },
};

const uninstallSub: Command = {
  name: 'uninstall',
  description: 'Remove what `ruflo mods install` added (classic hooks take every event back)',
  options: [rootOption, { name: 'dry-run', description: 'Show what would be removed', type: 'boolean', default: false }],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const result = uninstallMod(projectRoot(ctx), (ctx.flags.dryRun === true || ctx.flags['dry-run'] === true));
    if (!result.removed) {
      output.printWarning('No install record (.claude-flow/mods/install.json): nothing ruflo added to remove.');
      return { success: true, data: result };
    }
    output.printSuccess(`${result.dryRun ? 'Would remove' : 'Removed'} ruflo-mods from ${result.settingsFile}`);
    return { success: true, data: result };
  },
};

function findingsCommand(name: 'status' | 'doctor', description: string): Command {
  return {
    name,
    description,
    options: [rootOption, { name: 'json', description: 'Output as JSON', type: 'boolean', default: false }],
    action: async (ctx: CommandContext): Promise<CommandResult> => {
      const findings = probeMods({ projectRoot: projectRoot(ctx) });
      if (ctx.flags.json) output.printJson(findings);
      else printFindings(findings);
      const failed = findings.some((f) => f.status === 'fail');
      // status reports; doctor gates (warnings are expected while early access is off).
      return { success: !failed, exitCode: name === 'doctor' && failed ? 1 : 0, data: findings };
    },
  };
}

async function syncPolicy(root: string, quiet: boolean): Promise<boolean> {
  try {
    const { loadPolicyState } = await import('../services/policy-runtime.js');
    const { syncPolicyProjection } = await import('../mods/policy-projection.js');
    const result = syncPolicyProjection(root, loadPolicyState(root));
    if (!quiet || result.action !== 'unchanged') output.writeln(`policy projection: ${result.action} (${result.path})`);
    return true;
  } catch (error) {
    output.printWarning(`policy projection not synced: ${(error as Error).message}`);
    return false;
  }
}

const syncPolicySub: Command = {
  name: 'sync-policy',
  description: 'Rewrite the Claude Code policy projection from .claude-flow/policy/state.json',
  options: [rootOption],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const ok = await syncPolicy(projectRoot(ctx), false);
    return { success: ok, exitCode: ok ? 0 : 1 };
  },
};

const statusSub = findingsCommand('status', 'Show whether the mod is enabled, can load, and what it owns');

export const modsCommand: Command = {
  name: 'mods',
  description: 'Run ruflo as a Claude Code mod (function hooks, early access, ADR-404)',
  subcommands: [
    installSub,
    uninstallSub,
    statusSub,
    findingsCommand('doctor', 'Check the mod path; exits 1 only on a failure'),
    syncPolicySub,
  ],
  examples: [
    { command: 'ruflo mods install', description: 'Enable for this project (settings.local.json)' },
    { command: 'ruflo mods doctor', description: 'Function hooks on? Refused by policy? Handshake supported?' },
    { command: 'ruflo mods uninstall', description: 'Remove only what install added' },
  ],
  action: statusSub.action,
};

export default modsCommand;
