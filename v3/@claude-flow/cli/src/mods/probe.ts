/**
 * What can be known, from outside a Claude Code session, about whether the
 * ruflo mod will load and what it will own (ADR-404). Every finding names its
 * source; nothing here claims a live load it did not see. The one direct
 * evidence of a load is the heartbeat the mod writes at session start.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, resolve } from 'node:path';

import { ENABLE_ENV, MOD_PLUGIN_ID, readRecord, readSettingsFile, settingsFileFor } from './install.js';
import { PROJECTION_RELATIVE } from './policy-projection.js';

export const HANDSHAKE_MARKER = 'RUFLO_MODS_OWNS';
export const HEARTBEAT_RELATIVE = join('.claude-flow', 'mods', 'session.json');
const SEC_DEFAULT_ID = 'cc-plugin-sec-default@builtin';

export type Status = 'pass' | 'warn' | 'fail';
export interface Finding {
  name: string;
  status: Status;
  message: string;
  fix?: string;
}

function readJson(path: string): unknown {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
  } catch {
    return undefined;
  }
}

function get(obj: unknown, ...keys: string[]): unknown {
  return keys.reduce<unknown>((o, k) => (o !== null && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

/** Managed settings, where an organization sets sec-default's options. */
export function managedSettingsPath(os = platform()): string {
  if (os === 'darwin') return '/Library/Application Support/ClaudeCode/managed-settings.json';
  if (os === 'win32') return 'C:\\ProgramData\\ClaudeCode\\managed-settings.json';
  return '/etc/claude-code/managed-settings.json';
}

export interface ProbeInputs {
  projectRoot: string;
  home?: string;
  env?: NodeJS.ProcessEnv;
  managedPath?: string;
}

export function probeMods(inputs: ProbeInputs): Finding[] {
  const root = resolve(inputs.projectRoot);
  const home = inputs.home ?? homedir();
  const env = inputs.env ?? process.env;
  const findings: Finding[] = [];

  // 1. Enabled for this project?
  const files = [settingsFileFor(root, 'local'), settingsFileFor(root, 'project'), join(home, '.claude', 'settings.json')];
  const enabledIn = files.find((f) => {
    try {
      return get(readSettingsFile(f), 'enabledPlugins', MOD_PLUGIN_ID) === true;
    } catch {
      return false;
    }
  });
  findings.push(enabledIn
    ? { name: 'ruflo-mods plugin', status: 'pass', message: `enabled in ${enabledIn}` }
    : { name: 'ruflo-mods plugin', status: 'warn', message: 'not enabled; classic hooks handle every event', fix: 'ruflo mods install' });

  // 2. Function hooks switched on for installed plugins (early access).
  const envOn = env[ENABLE_ENV] === '1';
  const settingsOn = files.some((f) => {
    try {
      return get(readSettingsFile(f), 'env', ENABLE_ENV) === '1';
    } catch {
      return false;
    }
  });
  // Observed on Claude Code 2.1.282 (ADR-404): the server-side rollout switch
  // decides. Served on, an installed mod loaded with ENABLE_ENV unset; served
  // off, it did not load with ENABLE_ENV=1. The variable is reported, never
  // treated as sufficient.
  const rollout = get(readJson(join(home, '.claude.json')), 'cachedGrowthBookFeatures', 'tengu_plugin_hooks_modules');
  const enableMsg = `${ENABLE_ENV} ${envOn ? 'set in this environment' : settingsOn ? 'set in settings env' : 'not set'}`;
  findings.push(rollout === true
    ? { name: 'function hooks', status: 'pass', message: `Claude Code rollout switch cached on; ${enableMsg}` }
    : rollout === false
      ? { name: 'function hooks', status: 'warn', message: `Claude Code serves function hooks OFF for this account (cached); the mod will not load and classic hooks keep every event; ${enableMsg}` }
      : { name: 'function hooks', status: 'warn', message: `rollout switch not cached (unverified whether the mod can load); ${enableMsg}`, fix: `export ${ENABLE_ENV}=1 and start Claude Code once` });

  // 3. Refused by policy?
  const managed = readJson(inputs.managedPath ?? managedSettingsPath());
  const managedOnly = get(managed, 'pluginConfigs', SEC_DEFAULT_ID, 'options', 'allowManagedModsOnly');
  findings.push(managedOnly !== undefined && managedOnly !== false
    ? { name: 'managed policy', status: 'warn', message: 'allowManagedModsOnly is set: Claude Code refuses user mods; classic hooks stay in charge' }
    : { name: 'managed policy', status: 'pass', message: managed === undefined ? 'no managed settings' : 'user mods allowed (allowManagedModsOnly not set)' });

  // 4. Every classic helper a hook could run honours the handshake (the mod's
  // own rule, plugins/ruflo-mods/hooks/session.ts); else the mod stands down.
  const helpers = [...new Set([join(root, '.claude', 'helpers', 'hook-handler.cjs'), join(home, '.claude', 'helpers', 'hook-handler.cjs')])].filter(existsSync);
  const stale = helpers.filter((h) => {
    try {
      return !readFileSync(h, 'utf8').includes(HANDSHAKE_MARKER);
    } catch {
      return true;
    }
  });
  findings.push(helpers.length === 0
    ? { name: 'classic handshake', status: 'pass', message: 'no hook-handler.cjs: the mod owns route and post-edit outright' }
    : stale.length === 0
      ? { name: 'classic handshake', status: 'pass', message: `${helpers.join(', ')} hand route and post-edit to the mod while it runs` }
      : { name: 'classic handshake', status: 'warn', message: `${stale.join(', ')} predate${stale.length === 1 ? 's' : ''} the handshake: the mod stands down and classic hooks keep route/post-edit`, fix: 'ruflo init --upgrade (refresh helpers in the project and in ~/.claude)' });

  // 5. Policy projection.
  const projectionPath = join(root, PROJECTION_RELATIVE);
  const projection = readJson(projectionPath);
  const stateMode = get(readJson(join(root, '.claude-flow', 'policy', 'state.json')), 'mode');
  findings.push(projection !== undefined
    ? { name: 'policy projection', status: 'pass', message: `${get(projection, 'mode')} mode, ${(get(projection, 'rules') as unknown[] | undefined)?.length ?? 0} claude-code rule(s)` }
    : stateMode === 'enforce' || stateMode === 'observe'
      ? { name: 'policy projection', status: 'warn', message: `policy is ${String(stateMode)} but no projection exists (no claude-code.* rules, or state written by an older CLI)`, fix: 'ruflo mods sync-policy' }
      : { name: 'policy projection', status: 'pass', message: 'none (no ruflo policy for Claude Code tools)' });

  // 6. Evidence of a load.
  const beat = readJson(join(root, HEARTBEAT_RELATIVE));
  const startedAt = get(beat, 'startedAt');
  const owned = get(beat, 'owned');
  findings.push(typeof startedAt === 'string'
    ? { name: 'last mod start', status: 'pass', message: `${startedAt}, owning ${Array.isArray(owned) && owned.length ? owned.join(', ') : 'nothing'}` }
    : { name: 'last mod start', status: enabledIn ? 'warn' : 'pass', message: 'the mod has not started in this project' + (enabledIn ? ' (restart Claude Code; check function hooks above)' : '') });

  if (readRecord(root)) findings.push({ name: 'install record', status: 'pass', message: join(root, '.claude-flow', 'mods', 'install.json') });
  return findings;
}
