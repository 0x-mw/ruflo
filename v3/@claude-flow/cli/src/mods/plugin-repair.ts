/**
 * After `ruflo mods install` writes settings, make the plugin resolvable the
 * way a person would (ADR-404): refresh (or add) the `ruflo` marketplace
 * clone, then `claude plugin install ruflo-mods@ruflo --scope <scope>`.
 *
 * Fixed argv through execFile, never a shell; each step bounded. The `add`
 * step passes `--scope` so the marketplace is declared in the same settings
 * file install already wrote, not in user settings. `~/.claude.json` is never
 * touched by ruflo. No `-y`: a marketplace-declared command is never accepted
 * on a person's behalf.
 */

import { execFile } from 'node:child_process';

import { findClaudeInstalls } from './claude-installs.js';
import { MARKETPLACE_NAME, MOD_PLUGIN_ID, type Scope } from './install.js';

export const MARKETPLACE_TIMEOUT_MS = 150_000; // Claude Code's own clone timeout is 120s
export const INSTALL_TIMEOUT_MS = 60_000;

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type Exec = (file: string, args: readonly string[], opts: { cwd: string; timeout: number; env: NodeJS.ProcessEnv }) => Promise<ExecResult>;

export const nodeExec: Exec = (file, args, opts) =>
  new Promise((done) => {
    execFile(file, [...args], { ...opts, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      // error.code is the exit status, or a string (ENOENT, ...) when it never ran; a timeout kills it.
      const status = (error as { code?: unknown } | null)?.code;
      const code = !error ? 0 : typeof status === 'number' && status !== 0 ? status : 1;
      done({ code, stdout: String(stdout), stderr: String(stderr) || (error ? error.message : '') });
    });
  });

/** The `claude` a shell would run, when it can be exec'd without a shell. */
export function findClaudeBinary(env: NodeJS.ProcessEnv, home: string): string | null {
  const first = findClaudeInstalls(env, home, () => null)[0];
  if (!first) return null;
  // A .cmd shim needs a shell to run; ruflo never uses one.
  return process.platform === 'win32' && !first.path.toLowerCase().endsWith('.exe') ? null : first.path;
}

export interface RepairStep {
  argv: string[];
  ok: boolean;
  output: string;
}

export interface RepairOptions {
  projectRoot: string;
  scope: Scope;
  /** The marketplace is in known_marketplaces.json: update it, else add it. */
  marketplaceKnown: boolean;
  claude: string;
  exec?: Exec;
  env?: NodeJS.ProcessEnv;
}

export function repairArgv(scope: Scope, marketplaceKnown: boolean): string[][] {
  return [
    marketplaceKnown
      ? ['plugin', 'marketplace', 'update', MARKETPLACE_NAME]
      : ['plugin', 'marketplace', 'add', 'ruvnet/ruflo', '--scope', scope],
    ['plugin', 'install', MOD_PLUGIN_ID, '--scope', scope],
  ];
}

/** Runs the steps in order and stops at the first failure. */
export async function repairPluginInstall(opts: RepairOptions): Promise<{ ok: boolean; steps: RepairStep[] }> {
  const exec = opts.exec ?? nodeExec;
  const env = opts.env ?? process.env;
  const steps: RepairStep[] = [];
  for (const argv of repairArgv(opts.scope, opts.marketplaceKnown)) {
    const timeout = argv[1] === 'marketplace' ? MARKETPLACE_TIMEOUT_MS : INSTALL_TIMEOUT_MS;
    let result: ExecResult;
    try {
      result = await exec(opts.claude, argv, { cwd: opts.projectRoot, timeout, env });
    } catch (error) {
      result = { code: 1, stdout: '', stderr: (error as Error).message };
    }
    const ok = result.code === 0;
    steps.push({ argv, ok, output: `${result.stdout}${result.stderr}`.trim() });
    if (!ok) return { ok: false, steps };
  }
  return { ok: true, steps };
}
