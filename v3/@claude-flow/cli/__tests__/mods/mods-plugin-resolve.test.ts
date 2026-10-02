/**
 * ADR-404 — whether Claude Code can resolve the enabled ruflo-mods plugin
 * (stale marketplace clone, nothing installed), and the repair `mods install`
 * runs. Mock-first: a fake filesystem and a fake execFile; nothing here reads
 * the real ~/.claude or runs a real claude.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';

import {
  claudeConfigDir,
  installedState,
  marketplaceState,
  repairCommands,
  resolveFindings,
  MOD_PLUGIN_MANIFEST,
  type ReadFs,
} from '../../src/mods/plugin-resolve.js';
import { repairArgv, repairPluginInstall, INSTALL_TIMEOUT_MS, MARKETPLACE_TIMEOUT_MS, type Exec } from '../../src/mods/plugin-repair.js';
import { probeMods } from '../../src/mods/probe.js';

const CFG = '/cfg';
const ROOT = '/work/proj';
const CLONE = join(CFG, 'plugins', 'marketplaces', 'ruflo');
const CACHE = join(CFG, 'plugins', 'cache', 'ruflo', 'ruflo-mods', '0.1.0');

/** A fake filesystem: paths that exist, and the text of the JSON files among them. */
function fakeFs(files: Record<string, unknown>, dirs: string[] = []): ReadFs {
  const exists = new Set([...Object.keys(files), ...dirs]);
  return {
    exists: (p) => exists.has(p),
    readText: (p) => (p in files ? (typeof files[p] === 'string' ? (files[p] as string) : JSON.stringify(files[p])) : undefined),
  };
}

const known = { [join(CFG, 'plugins', 'known_marketplaces.json')]: { ruflo: { source: { source: 'github', repo: 'ruvnet/ruflo' }, installLocation: CLONE } } };
const freshClone = { [join(CLONE, MOD_PLUGIN_MANIFEST)]: '{"name":"ruflo-mods"}' };
const installedHere = (entry: Record<string, unknown> = {}) => ({
  [join(CFG, 'plugins', 'installed_plugins.json')]: { version: 2, plugins: { 'ruflo-mods@ruflo': [{ scope: 'local', installPath: CACHE, projectPath: ROOT, ...entry }] } },
});

describe('ADR-404 plugin resolution: marketplace clone', () => {
  it('a missing clone: not known, no location', () => {
    expect(marketplaceState(CFG, fakeFs({}))).toEqual({ known: false, location: null, hasMod: false });
  });

  it('a stale clone (predates ruflo-mods) is found but has no plugin', () => {
    expect(marketplaceState(CFG, fakeFs(known, [CLONE]))).toEqual({ known: true, location: CLONE, hasMod: false });
  });

  it('a fresh clone carries plugins/ruflo-mods/.claude-plugin/plugin.json', () => {
    expect(marketplaceState(CFG, fakeFs({ ...known, ...freshClone }, [CLONE]))).toEqual({ known: true, location: CLONE, hasMod: true });
  });

  it('follows installLocation from known_marketplaces.json, else the default clone path', () => {
    const elsewhere = '/elsewhere/ruflo';
    const fs = fakeFs({ [join(CFG, 'plugins', 'known_marketplaces.json')]: { ruflo: { installLocation: elsewhere } }, [join(elsewhere, MOD_PLUGIN_MANIFEST)]: '{}' }, [elsewhere]);
    expect(marketplaceState(CFG, fs)).toMatchObject({ location: elsewhere, hasMod: true });
    expect(marketplaceState(CFG, fakeFs({}, [CLONE]))).toMatchObject({ known: false, location: CLONE });
  });

  it('respects CLAUDE_CONFIG_DIR', () => {
    expect(claudeConfigDir({ CLAUDE_CONFIG_DIR: '/x' }, '/home/u')).toBe('/x');
    expect(claudeConfigDir({}, '/home/u')).toBe(join('/home/u', '.claude'));
  });
});

describe('ADR-404 plugin resolution: installed for this project', () => {
  it('local scope counts only for its own project, and only while its cache dir exists', () => {
    expect(installedState(ROOT, CFG, fakeFs(installedHere(), [CACHE]))).toMatchObject({ installed: true, scope: 'local' });
    expect(installedState('/work/other', CFG, fakeFs(installedHere(), [CACHE])).installed).toBe(false);
    expect(installedState(ROOT, CFG, fakeFs(installedHere())).installed).toBe(false);
  });

  it('user scope counts everywhere', () => {
    expect(installedState('/anywhere', CFG, fakeFs(installedHere({ scope: 'user', projectPath: undefined }), [CACHE])).installed).toBe(true);
  });

  it('no record, or a malformed one, is not installed', () => {
    expect(installedState(ROOT, CFG, fakeFs({})).installed).toBe(false);
    expect(installedState(ROOT, CFG, fakeFs({ [join(CFG, 'plugins', 'installed_plugins.json')]: '{ broken' })).installed).toBe(false);
  });
});

describe('ADR-404 plugin resolution: findings', () => {
  const byName = (findings: ReturnType<typeof resolveFindings>) => Object.fromEntries(findings.map((f) => [f.name, f]));

  it('the reported bug: stale clone, nothing installed — both FAIL with the exact commands', () => {
    const f = byName(resolveFindings(ROOT, 'local', CFG, fakeFs(known, [CLONE])));
    expect(f['ruflo marketplace']).toMatchObject({ status: 'fail', message: expect.stringContaining('is stale') });
    expect(f['ruflo-mods installed'].status).toBe('fail');
    expect(f['ruflo-mods installed'].fix).toBe(`cd "${ROOT}" && claude plugin marketplace update ruflo && claude plugin install ruflo-mods@ruflo --scope local`);
  });

  it('missing clone: the fix adds the marketplace at the same scope', () => {
    const f = byName(resolveFindings(ROOT, 'project', CFG, fakeFs({})));
    expect(f['ruflo marketplace']).toMatchObject({ status: 'fail', message: expect.stringContaining('no local clone') });
    expect(f['ruflo marketplace'].fix).toContain('claude plugin marketplace add ruvnet/ruflo --scope project');
  });

  it('fresh clone but not installed: marketplace passes, install fails', () => {
    const f = byName(resolveFindings(ROOT, 'local', CFG, fakeFs({ ...known, ...freshClone }, [CLONE])));
    expect(f['ruflo marketplace'].status).toBe('pass');
    expect(f['ruflo-mods installed'].status).toBe('fail');
  });

  it('installed from the cache with a stale clone still loads: warn, not fail', () => {
    const f = byName(resolveFindings(ROOT, 'local', CFG, fakeFs({ ...known, ...installedHere() }, [CLONE, CACHE])));
    expect(f['ruflo marketplace'].status).toBe('warn');
    expect(f['ruflo-mods installed'].status).toBe('pass');
  });

  it('fresh and installed: all pass', () => {
    const findings = resolveFindings(ROOT, 'local', CFG, fakeFs({ ...known, ...freshClone, ...installedHere() }, [CLONE, CACHE]));
    expect(findings.every((x) => x.status === 'pass')).toBe(true);
  });

  it('repairCommands quotes the project root', () => {
    expect(repairCommands('/a b/c', 'local', true)[0]).toBe('cd "/a b/c"');
  });
});

describe('ADR-404 mods status distinguishes enabled-in-settings from resolvable', () => {
  it('probeMods adds the resolution findings only once the plugin is enabled', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const root = mkdtempSync(join(tmpdir(), 'ruflo-mods-resolve-'));
    try {
      const probe = () => probeMods({ projectRoot: root, home: root, env: {}, managedPath: join(root, 'none'), installs: [], configDir: CFG, fs: fakeFs(known, [CLONE]) });
      expect(probe().map((f) => f.name)).not.toContain('ruflo-mods installed');
      mkdirSync(join(root, '.claude'), { recursive: true });
      writeFileSync(join(root, '.claude', 'settings.local.json'), JSON.stringify({ enabledPlugins: { 'ruflo-mods@ruflo': true } }));
      const findings = probe();
      expect(findings.find((f) => f.name === 'ruflo-mods plugin')!.message).toMatch(/^enabled in settings/);
      expect(findings.find((f) => f.name === 'ruflo-mods installed')).toMatchObject({ status: 'fail', fix: expect.stringContaining('--scope local') });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('ADR-404 repair on install', () => {
  type Call = { file: string; args: readonly string[]; cwd: string; timeout: number };
  const fakeExec = (codes: number[]) => {
    const calls: Call[] = [];
    const exec: Exec = async (file, args, opts) => {
      calls.push({ file, args, cwd: opts.cwd, timeout: opts.timeout });
      const code = codes[calls.length - 1] ?? 0;
      return { code, stdout: code === 0 ? 'ok' : '', stderr: code === 0 ? '' : 'Marketplace not reachable' };
    };
    return { exec, calls };
  };

  it('known marketplace: update, then install at the scope, fixed argv in the project dir', async () => {
    const { exec, calls } = fakeExec([0, 0]);
    const r = await repairPluginInstall({ projectRoot: ROOT, scope: 'local', marketplaceKnown: true, claude: '/bin/claude', exec, env: {} });
    expect(r.ok).toBe(true);
    expect(calls).toEqual([
      { file: '/bin/claude', args: ['plugin', 'marketplace', 'update', 'ruflo'], cwd: ROOT, timeout: MARKETPLACE_TIMEOUT_MS },
      { file: '/bin/claude', args: ['plugin', 'install', 'ruflo-mods@ruflo', '--scope', 'local'], cwd: ROOT, timeout: INSTALL_TIMEOUT_MS },
    ]);
  });

  it('unknown marketplace: add it at the same scope (never user settings), never with -y', () => {
    const [add, install] = repairArgv('project', false);
    expect(add).toEqual(['plugin', 'marketplace', 'add', 'ruvnet/ruflo', '--scope', 'project']);
    expect([...add!, ...install!]).not.toContain('-y');
  });

  it('stops at the first failure and reports it', async () => {
    const { exec, calls } = fakeExec([1]);
    const r = await repairPluginInstall({ projectRoot: ROOT, scope: 'local', marketplaceKnown: true, claude: '/bin/claude', exec, env: {} });
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(1);
    expect(r.steps[0]).toMatchObject({ ok: false, output: 'Marketplace not reachable' });
  });

  it('an exec that throws is a failed step, not a crash', async () => {
    const exec: Exec = async () => {
      throw new Error('spawn ENOENT');
    };
    const r = await repairPluginInstall({ projectRoot: ROOT, scope: 'local', marketplaceKnown: false, claude: '/missing', exec, env: {} });
    expect(r).toMatchObject({ ok: false, steps: [{ ok: false, output: 'spawn ENOENT' }] });
  });
});
