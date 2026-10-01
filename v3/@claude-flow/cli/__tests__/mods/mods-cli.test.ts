/**
 * ADR-404 — `ruflo mods install|uninstall|status|doctor|sync-policy`, the
 * policy projection the mod reads, and the doctor probe.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { installMod, uninstallMod, withModEnabled, withModRemoved, ENABLE_ENV, MOD_PLUGIN_ID } from '../../src/mods/install.js';
import { projectionOf, syncPolicyProjection, PROJECTION_RELATIVE } from '../../src/mods/policy-projection.js';
import { probeMods } from '../../src/mods/probe.js';
import { findClaudeInstalls, judgeInstalls, versionLess } from '../../src/mods/claude-installs.js';
import { modsCommand } from '../../src/commands/mods.js';
import { setPolicyMode, upsertPolicyRule } from '../../src/services/policy-runtime.js';
import { parseProjection } from '../../../../../plugins/ruflo-mods/hooks/guard/policy';

let root: string;
let home: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ruflo-mods-cli-'));
  home = mkdtempSync(join(tmpdir(), 'ruflo-mods-cli-home-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const finding = (name: string, env: NodeJS.ProcessEnv = {}, managedPath = join(home, 'none.json')) =>
  probeMods({ projectRoot: root, home, env, managedPath, installs: [] }).find((f) => f.name === name)!;

describe('ADR-404 mods install / uninstall', () => {
  it('enables the plugin, the marketplace and the early-access switch in settings.local.json', () => {
    const r = installMod(root, 'local');
    const s = read(join(root, '.claude', 'settings.local.json'));
    expect(s.enabledPlugins[MOD_PLUGIN_ID]).toBe(true);
    expect(s.extraKnownMarketplaces.ruflo.source).toEqual({ source: 'github', repo: 'ruvnet/ruflo' });
    expect(s.env[ENABLE_ENV]).toBe('1');
    expect(r.added).toEqual({ plugin: true, marketplace: true, env: true });
  });

  it('keeps everything a person set, backs up, and uninstall removes only what install added', () => {
    const file = join(root, '.claude', 'settings.json');
    mkdirSync(join(root, '.claude'), { recursive: true });
    const before = { hooks: { Stop: [] }, env: { KEEP: 'x' }, extraKnownMarketplaces: { ruflo: { source: { source: 'directory', path: '/mine' } } }, enabledPlugins: { other: true } };
    writeFileSync(file, JSON.stringify(before));
    const r = installMod(root, 'project');
    expect(r.backup && existsSync(r.backup)).toBe(true);
    expect(read(file).extraKnownMarketplaces.ruflo.source.source).toBe('directory'); // never replaced
    uninstallMod(root);
    expect(read(file)).toEqual(before);
    expect(existsSync(join(root, '.claude-flow', 'mods', 'install.json'))).toBe(false);
  });

  it('a second install keeps the first record of what ruflo added', () => {
    installMod(root, 'local');
    installMod(root, 'local');
    uninstallMod(root);
    expect(read(join(root, '.claude', 'settings.local.json'))).toEqual({});
  });

  it('dry run writes nothing', () => {
    const r = installMod(root, 'local', true);
    expect(r.next.enabledPlugins).toEqual({ [MOD_PLUGIN_ID]: true });
    expect(existsSync(join(root, '.claude'))).toBe(false);
  });

  it('refuses to overwrite a settings file it cannot parse', () => {
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, '.claude', 'settings.local.json'), '{ broken');
    expect(() => installMod(root, 'local')).toThrow();
    expect(readFileSync(join(root, '.claude', 'settings.local.json'), 'utf8')).toBe('{ broken');
  });

  it('never follows an install record outside the project .claude folder', () => {
    mkdirSync(join(root, '.claude-flow', 'mods'), { recursive: true });
    for (const target of [join(home, 'settings.json'), join(root, '.claude-flow', 'x.json'), join(root, '.claude', '..', '..', 'evil.json')]) {
      writeFileSync(join(root, '.claude-flow', 'mods', 'install.json'), JSON.stringify({ version: 1, settingsFile: target, installedAt: 'x', added: { plugin: true, marketplace: true, env: true } }));
      expect(() => uninstallMod(root)).toThrow(/outside/);
    }
  });

  it('pure halves round-trip', () => {
    const s = { enabledPlugins: { [MOD_PLUGIN_ID]: true } };
    const { next, added } = withModEnabled(s);
    expect(added.plugin).toBe(false);
    expect(withModRemoved(next, added)).toEqual(s);
  });
});

describe('ADR-404 policy projection', () => {
  const ccRule = { id: 'no-push', effect: 'deny' as const, actions: ['claude-code.tool.Bash'], resources: ['git push*'] };
  const mcpRule = { id: 'mcp', effect: 'deny' as const, actions: ['mcp.tool.call'] };
  const starRule = { id: 'star', effect: 'deny' as const, actions: ['*'] };

  it('projects only explicit claude-code rules, and nothing in legacy mode', () => {
    expect(projectionOf({ mode: 'legacy', rules: [ccRule] })).toBeNull();
    expect(projectionOf({ mode: 'enforce', rules: [mcpRule, starRule] })).toBeNull();
    expect(projectionOf({ mode: 'enforce', rules: [mcpRule, ccRule, starRule], }, 5)).toEqual({ version: 1, mode: 'enforce', generatedAt: 5, rules: [ccRule] });
  });

  it('what the CLI writes is what the mod parses', () => {
    syncPolicyProjection(root, { mode: 'observe', rules: [ccRule] });
    const text = readFileSync(join(root, PROJECTION_RELATIVE), 'utf8');
    expect(parseProjection(text)).toEqual({ mode: 'observe', rules: [ccRule] });
    expect(syncPolicyProjection(root, { mode: 'legacy', rules: [] }).action).toBe('removed');
    expect(existsSync(join(root, PROJECTION_RELATIVE))).toBe(false);
  });

  it('every policy state write keeps the projection in step (real policy runtime)', async () => {
    mkdirSync(join(root, '.claude-flow'), { recursive: true });
    await upsertPolicyRule({ ...ccRule }, root);
    expect(existsSync(join(root, PROJECTION_RELATIVE))).toBe(false); // legacy: nothing to project
    await setPolicyMode('observe', root);
    expect(read(join(root, PROJECTION_RELATIVE))).toMatchObject({ mode: 'observe', rules: [{ id: 'no-push' }] });
    await setPolicyMode('legacy', root);
    expect(existsSync(join(root, PROJECTION_RELATIVE))).toBe(false);
  });
});

describe('ADR-404 mods probe and doctor', () => {
  it('reports not enabled as a pass: classic hooks are the default', () => {
    expect(finding('ruflo-mods plugin').status).toBe('warn');
    expect(finding('last mod start').status).toBe('pass');
  });

  it('the rollout switch decides; the enable variable is reported, never sufficient', () => {
    expect(finding('function hooks').status).toBe('warn');
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ cachedGrowthBookFeatures: { tengu_plugin_hooks_modules: false } }));
    const f = finding('function hooks', { [ENABLE_ENV]: '1' });
    expect(f.status).toBe('warn');
    expect(f.message).toContain('serves function hooks OFF');
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ cachedGrowthBookFeatures: { tengu_plugin_hooks_modules: true } }));
    expect(finding('function hooks', {}).status).toBe('pass'); // observed: loads with the variable unset while served on
  });

  it('reports a refusal by allowManagedModsOnly', () => {
    const managed = join(home, 'managed.json');
    writeFileSync(managed, JSON.stringify({ pluginConfigs: { 'cc-plugin-sec-default@builtin': { options: { allowManagedModsOnly: true } } } }));
    expect(finding('managed policy', {}, managed)).toMatchObject({ status: 'warn' });
    expect(finding('managed policy', {}, managed).message).toContain('allowManagedModsOnly');
  });

  it('reports whether the helper honours the handshake', () => {
    mkdirSync(join(root, '.claude', 'helpers'), { recursive: true });
    writeFileSync(join(root, '.claude', 'helpers', 'hook-handler.cjs'), '// old');
    expect(finding('classic handshake').status).toBe('warn');
    writeFileSync(join(root, '.claude', 'helpers', 'hook-handler.cjs'), '// RUFLO_MODS_OWNS');
    expect(finding('classic handshake').status).toBe('pass');
  });

  it('reads the heartbeat the mod writes as the evidence of a load', () => {
    installMod(root, 'local');
    expect(finding('last mod start').status).toBe('warn');
    mkdirSync(join(root, '.claude-flow', 'mods'), { recursive: true });
    writeFileSync(join(root, '.claude-flow', 'mods', 'session.json'), JSON.stringify({ startedAt: '2026-10-01T00:00:00Z', owned: ['route'] }));
    expect(finding('last mod start')).toMatchObject({ status: 'pass', message: '2026-10-01T00:00:00Z, owning route' });
  });

  it('warns when policy is enforced but nothing is projected', () => {
    mkdirSync(join(root, '.claude-flow', 'policy'), { recursive: true });
    writeFileSync(join(root, '.claude-flow', 'policy', 'state.json'), JSON.stringify({ mode: 'enforce' }));
    expect(finding('policy projection')).toMatchObject({ status: 'warn', fix: 'ruflo mods sync-policy' });
  });

  it('the command runs install, status, doctor and uninstall', async () => {
    const sub = (name: string) => modsCommand.subcommands!.find((s) => s.name === name)!;
    const ctx = (flags: Record<string, unknown> = {}) => ({ args: [], flags: { projectRoot: root, ...flags }, cwd: root, interactive: false }) as any;
    expect((await sub('install').action!(ctx())).success).toBe(true);
    expect((await sub('install').action!(ctx({ scope: 'global' }))).success).toBe(false);
    const doctor = await sub('doctor').action!(ctx({ json: true }));
    expect(doctor.exitCode).toBe(0);
    expect((await sub('uninstall').action!(ctx())).success).toBe(true);
    expect(read(join(root, '.claude', 'settings.local.json'))).toEqual({});
  });
});

describe('ADR-404 claude installs', () => {
  const at = (path: string, version: string | null) => ({ path, version });

  it('mods on by default from 2.1.287; the env var for 2.1.277..2.1.286; older predates mods', () => {
    expect(judgeInstalls([at('/home/u/.local/bin/claude', '2.1.287')], false)).toMatchObject({ status: 'pass' });
    expect(judgeInstalls([at('/c', '2.1.282')], false)).toMatchObject({ status: 'warn', message: expect.stringContaining('need CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 (not set)') });
    expect(judgeInstalls([at('/c', '2.1.282')], true)).toMatchObject({ status: 'pass' });
    expect(judgeInstalls([at('/c', '2.1.107')], true)).toMatchObject({ status: 'warn', message: expect.stringContaining('predates mods') });
    expect(judgeInstalls([], false).status).toBe('warn');
  });

  it('flags a mixed install: a stale claude first on PATH, or beside the current one', () => {
    const shadowed = judgeInstalls([at('/usr/bin/claude', '2.1.107'), at('/home/u/.local/bin/claude', '2.1.287')], false);
    expect(shadowed.status).toBe('warn');
    expect(shadowed.message).toContain('predates mods');
    expect(shadowed.message).toContain('also installed: /home/u/.local/bin/claude (2.1.287)');
    const beside = judgeInstalls([at('/home/u/.local/bin/claude', '2.1.287'), at('/usr/bin/claude', '2.1.107')], false);
    expect(beside).toMatchObject({ status: 'warn', message: expect.stringContaining('a stale one can shadow') });
  });

  it('versionLess compares numerically', () => {
    expect(versionLess('2.1.107', '2.1.287')).toBe(true);
    expect(versionLess('2.1.287', '2.1.287')).toBe(false);
    expect(versionLess('2.10.0', '2.9.9')).toBe(false);
  });

  it('finds every claude on PATH in order, de-duplicated by real path', () => {
    const a = mkdtempSync(join(tmpdir(), 'ruflo-mods-path-a-'));
    const b = mkdtempSync(join(tmpdir(), 'ruflo-mods-path-b-'));
    try {
      writeFileSync(join(a, 'claude'), '');
      writeFileSync(join(b, 'claude'), '');
      const found = findClaudeInstalls({ PATH: [a, b, a].join(':') }, join(a, 'nohome'), (p) => (p.startsWith(a) ? '2.1.107' : '2.1.287'));
      expect(found).toEqual([at(join(a, 'claude'), '2.1.107'), at(join(b, 'claude'), '2.1.287')]);
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });
});
