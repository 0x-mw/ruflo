/**
 * `ruflo mods install|uninstall` (ADR-404): enable the ruflo-mods plugin for
 * one project, opt-in, and take back exactly what was added.
 *
 * Writes three keys of a Claude Code settings file (`.claude/settings.local.json`
 * by default, so the early-access feature is one person's choice, not the
 * repository's): `enabledPlugins["ruflo-mods@ruflo"]`, the `ruflo` entry of
 * `extraKnownMarketplaces` when absent, and `env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS`.
 * What was added is recorded in `.claude-flow/mods/install.json`, so uninstall
 * removes those and nothing a person set themselves. Classic hooks are never
 * touched: they stay the fallback (the mod takes an event over at runtime only).
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

export const MOD_PLUGIN_ID = 'ruflo-mods@ruflo';
export const MARKETPLACE_NAME = 'ruflo';
export const MARKETPLACE_SOURCE = { source: { source: 'github', repo: 'ruvnet/ruflo' } } as const;
export const ENABLE_ENV = 'CLAUDE_CODE_ENABLE_FUNCTION_HOOKS';
export const INSTALL_RECORD = join('.claude-flow', 'mods', 'install.json');

export type Scope = 'local' | 'project';

export interface InstallRecord {
  version: 1;
  settingsFile: string;
  installedAt: string;
  added: { plugin: boolean; marketplace: boolean; env: boolean };
}

type Settings = Record<string, unknown> & {
  enabledPlugins?: Record<string, unknown>;
  extraKnownMarketplaces?: Record<string, unknown>;
  env?: Record<string, unknown>;
};

export function settingsFileFor(projectRoot: string, scope: Scope): string {
  return join(resolve(projectRoot), '.claude', scope === 'local' ? 'settings.local.json' : 'settings.json');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Reads a settings file; absent is `{}`, anything unparseable throws (never overwritten). */
export function readSettingsFile(path: string): Settings {
  if (!existsSync(path)) return {};
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!isRecord(parsed)) throw new Error(`${path} is not a JSON object`);
  return parsed as Settings;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
}

/** The settings after install, and what install added (pure). */
export function withModEnabled(settings: Settings): { next: Settings; added: InstallRecord['added'] } {
  const next: Settings = { ...settings };
  const plugins = isRecord(settings.enabledPlugins) ? { ...settings.enabledPlugins } : {};
  const markets = isRecord(settings.extraKnownMarketplaces) ? { ...settings.extraKnownMarketplaces } : {};
  const env = isRecord(settings.env) ? { ...settings.env } : {};
  const added = {
    plugin: plugins[MOD_PLUGIN_ID] !== true,
    marketplace: !(MARKETPLACE_NAME in markets),
    env: env[ENABLE_ENV] !== '1',
  };
  plugins[MOD_PLUGIN_ID] = true;
  if (added.marketplace) markets[MARKETPLACE_NAME] = MARKETPLACE_SOURCE;
  env[ENABLE_ENV] = '1';
  next.enabledPlugins = plugins;
  next.extraKnownMarketplaces = markets;
  next.env = env;
  return { next, added };
}

/** The settings after uninstall: only what the record says install added (pure). */
export function withModRemoved(settings: Settings, added: InstallRecord['added']): Settings {
  const next: Settings = { ...settings };
  const drop = (key: 'enabledPlugins' | 'extraKnownMarketplaces' | 'env', name: string) => {
    const section = next[key];
    if (!isRecord(section)) return;
    const copy = { ...section };
    delete copy[name];
    if (Object.keys(copy).length === 0) delete next[key];
    else next[key] = copy;
  };
  if (added.plugin) drop('enabledPlugins', MOD_PLUGIN_ID);
  if (added.marketplace) drop('extraKnownMarketplaces', MARKETPLACE_NAME);
  if (added.env) drop('env', ENABLE_ENV);
  return next;
}

export interface InstallResult {
  settingsFile: string;
  backup?: string;
  added: InstallRecord['added'];
  dryRun: boolean;
  next: Settings;
}

export function installMod(projectRoot: string, scope: Scope, dryRun = false): InstallResult {
  const settingsFile = settingsFileFor(projectRoot, scope);
  const current = readSettingsFile(settingsFile);
  const { next, added } = withModEnabled(current);
  if (dryRun) return { settingsFile, added, dryRun, next };

  let backup: string | undefined;
  if (existsSync(settingsFile)) {
    backup = `${settingsFile}.bak-ruflo-mods-${Date.now()}`;
    copyFileSync(settingsFile, backup);
  }
  writeJson(settingsFile, next);
  const recordPath = join(resolve(projectRoot), INSTALL_RECORD);
  const previous = readRecord(projectRoot);
  // A second install keeps the first record's claims: what ruflo added once
  // is still ruflo's to remove.
  const merged = previous && previous.settingsFile === settingsFile
    ? { plugin: previous.added.plugin || added.plugin, marketplace: previous.added.marketplace || added.marketplace, env: previous.added.env || added.env }
    : added;
  const record: InstallRecord = { version: 1, settingsFile, installedAt: new Date().toISOString(), added: merged };
  writeJson(recordPath, record);
  return { settingsFile, backup, added: merged, dryRun, next };
}

export function readRecord(projectRoot: string): InstallRecord | null {
  const path = join(resolve(projectRoot), INSTALL_RECORD);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as InstallRecord;
    return parsed && parsed.version === 1 && typeof parsed.settingsFile === 'string' && isRecord(parsed.added) ? parsed : null;
  } catch {
    return null;
  }
}

export function uninstallMod(projectRoot: string, dryRun = false): { settingsFile?: string; removed: boolean; dryRun: boolean } {
  const record = readRecord(projectRoot);
  if (!record) return { removed: false, dryRun };
  // The record names the file; never follow it outside this project.
  const root = resolve(projectRoot);
  if (!resolve(record.settingsFile).startsWith(join(root, '.claude') + sep)) {
    throw new Error(`install record names a settings file outside ${root}/.claude: ${record.settingsFile}`);
  }
  if (dryRun) return { settingsFile: record.settingsFile, removed: true, dryRun };
  if (existsSync(record.settingsFile)) {
    writeJson(record.settingsFile, withModRemoved(readSettingsFile(record.settingsFile), record.added));
  }
  unlinkSync(join(root, INSTALL_RECORD));
  return { settingsFile: record.settingsFile, removed: true, dryRun };
}
