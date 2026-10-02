/**
 * Whether Claude Code can actually resolve the ruflo-mods plugin (ADR-404).
 *
 * `enabledPlugins["ruflo-mods@ruflo"] = true` in settings is only a request.
 * Claude Code loads the plugin from its own install record
 * (`<config>/plugins/installed_plugins.json`, pointing into `plugins/cache/`),
 * and installs it from its local clone of the `ruflo` marketplace
 * (`known_marketplaces.json` → `installLocation`). A clone from before
 * ruflo-mods shipped has no `plugins/ruflo-mods`, and Claude Code then skips
 * the enabled plugin without a word: `/ruflo-mods` is an unknown command.
 *
 * Read-only. The config directory is `CLAUDE_CONFIG_DIR` when set, else
 * `~/.claude`, as Claude Code itself resolves it.
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { MARKETPLACE_NAME, MOD_PLUGIN_ID, type Scope } from './install.js';
import type { Finding } from './probe.js';

export const MOD_PLUGIN_MANIFEST = join('plugins', 'ruflo-mods', '.claude-plugin', 'plugin.json');

/** The two filesystem reads detection needs; injectable for tests. */
export interface ReadFs {
  exists(path: string): boolean;
  readText(path: string): string | undefined;
}

export const nodeReadFs: ReadFs = {
  exists: (p) => existsSync(p),
  readText: (p) => {
    try {
      return readFileSync(p, 'utf8');
    } catch {
      return undefined;
    }
  },
};

export function claudeConfigDir(env: NodeJS.ProcessEnv, home: string): string {
  return env.CLAUDE_CONFIG_DIR || join(home, '.claude');
}

function readJson(fs: ReadFs, path: string): unknown {
  const text = fs.readText(path);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export interface MarketplaceState {
  /** Listed in known_marketplaces.json (so `marketplace update ruflo` works). */
  known: boolean;
  /** The local clone, when one exists on disk. */
  location: string | null;
  /** The clone carries plugins/ruflo-mods. */
  hasMod: boolean;
}

export function marketplaceState(configDir: string, fs: ReadFs = nodeReadFs): MarketplaceState {
  const known = readJson(fs, join(configDir, 'plugins', 'known_marketplaces.json'));
  const entry = isRecord(known) ? known[MARKETPLACE_NAME] : undefined;
  const declared = isRecord(entry) && typeof entry.installLocation === 'string' ? entry.installLocation : undefined;
  const candidates = [declared, join(configDir, 'plugins', 'marketplaces', MARKETPLACE_NAME)].filter((p): p is string => !!p);
  const location = candidates.find((p) => fs.exists(p)) ?? null;
  return { known: isRecord(entry), location, hasMod: location !== null && fs.exists(join(location, MOD_PLUGIN_MANIFEST)) };
}

export interface InstalledState {
  installed: boolean;
  scope?: string;
  installPath?: string;
}

function sameDir(a: string, b: string): boolean {
  if (resolve(a) === resolve(b)) return true;
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

/** Installed for this project: user scope anywhere, local/project scope for this root; its cache dir present. */
export function installedState(projectRoot: string, configDir: string, fs: ReadFs = nodeReadFs): InstalledState {
  const record = readJson(fs, join(configDir, 'plugins', 'installed_plugins.json'));
  const plugins = isRecord(record) && isRecord(record.plugins) ? record.plugins : undefined;
  const entries = plugins && Array.isArray(plugins[MOD_PLUGIN_ID]) ? (plugins[MOD_PLUGIN_ID] as unknown[]) : [];
  for (const e of entries) {
    if (!isRecord(e) || typeof e.installPath !== 'string' || !fs.exists(e.installPath)) continue;
    const forHere = e.scope === 'user' || (typeof e.projectPath === 'string' && sameDir(e.projectPath, projectRoot));
    if (forHere) return { installed: true, scope: String(e.scope), installPath: e.installPath };
  }
  return { installed: false };
}

/** The exact commands that make the plugin resolvable, for a person to run. */
export function repairCommands(projectRoot: string, scope: Scope | 'user', known: boolean): string[] {
  return [
    `cd ${JSON.stringify(resolve(projectRoot))}`,
    known ? `claude plugin marketplace update ${MARKETPLACE_NAME}` : `claude plugin marketplace add ruvnet/ruflo --scope ${scope}`,
    `claude plugin install ${MOD_PLUGIN_ID} --scope ${scope}`,
  ];
}

/**
 * The two resolvability findings. A missing install record is the failure
 * Claude Code hides; a stale clone fails only while nothing is installed
 * (an install already in the plugin cache still loads).
 */
export function resolveFindings(projectRoot: string, scope: Scope | 'user', configDir: string, fs: ReadFs = nodeReadFs): Finding[] {
  const market = marketplaceState(configDir, fs);
  const installed = installedState(projectRoot, configDir, fs);
  const fix = repairCommands(projectRoot, scope, market.known).join(' && ');
  const findings: Finding[] = [];

  if (market.hasMod) {
    findings.push({ name: 'ruflo marketplace', status: 'pass', message: `${market.location} has ruflo-mods` });
  } else {
    const message = market.location
      ? `${market.location} is stale: it predates ruflo-mods (no ${MOD_PLUGIN_MANIFEST}), so Claude Code cannot install the plugin`
      : `no local clone of the ${MARKETPLACE_NAME} marketplace under ${join(configDir, 'plugins')}`;
    findings.push({ name: 'ruflo marketplace', status: installed.installed ? 'warn' : 'fail', message, fix });
  }

  findings.push(installed.installed
    ? { name: 'ruflo-mods installed', status: 'pass', message: `${installed.scope} scope, ${installed.installPath}` }
    : {
      name: 'ruflo-mods installed',
      status: 'fail',
      message: `not installed for this project (${join(configDir, 'plugins', 'installed_plugins.json')}): Claude Code skips an enabled plugin it cannot resolve, and /ruflo-mods is an unknown command`,
      fix,
    });
  return findings;
}
