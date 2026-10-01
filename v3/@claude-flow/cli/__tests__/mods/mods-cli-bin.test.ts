/**
 * ADR-404 — the CLI surface through the built binary: `init --mods`,
 * `doctor --component mods`, and `mods status|uninstall`. Skipped where the
 * CLI is not built, as the other bin-level tests are (#2952).
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { delimiter, join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI_BIN = fileURLToPath(new URL('../../bin/cli.js', import.meta.url));
const CLI_BUILT = existsSync(CLI_BIN);

function isolated() {
  const home = mkdtempSync(join(tmpdir(), 'ruflo-mods-bin-home-'));
  const cwd = mkdtempSync(join(tmpdir(), 'ruflo-mods-bin-'));
  const bin = join(home, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'codex'), '#!/bin/sh\nexit 1\n');
  chmodSync(join(bin, 'codex'), 0o755);
  const env = { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: join(home, '.codex'), PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`, CI: '1' };
  const run = (...args: string[]) => execFileSync(process.execPath, [CLI_BIN, ...args], { cwd, env, encoding: 'utf8', timeout: 120_000 });
  return { home, cwd, run, done: () => { rmSync(home, { recursive: true, force: true }); rmSync(cwd, { recursive: true, force: true }); } };
}

describe.skipIf(!CLI_BUILT)('ADR-404 mods through the built CLI', () => {
  it('init --mods enables the plugin beside the classic hooks; doctor and mods status report it', () => {
    const t = isolated();
    try {
      t.run('init', '--mods', '--no-signup', '--no-global', '--no-codex-detect');
      const local = JSON.parse(readFileSync(join(t.cwd, '.claude', 'settings.local.json'), 'utf8'));
      expect(local.enabledPlugins['ruflo-mods@ruflo']).toBe(true);
      // Classic hooks are untouched: still the default and the fallback.
      const shared = JSON.parse(readFileSync(join(t.cwd, '.claude', 'settings.json'), 'utf8'));
      expect(JSON.stringify(shared.hooks.UserPromptSubmit)).toContain('hook-handler.cjs');

      expect(t.run('doctor', '--component', 'mods')).toContain('ruflo mods (ADR-404)');
      const status = JSON.parse(t.run('mods', 'status', '--json').replace(/^[^[]*/, ''));
      expect(status.find((f: { name: string }) => f.name === 'ruflo-mods plugin').status).toBe('pass');

      t.run('mods', 'uninstall');
      expect(JSON.parse(readFileSync(join(t.cwd, '.claude', 'settings.local.json'), 'utf8'))).toEqual({});
    } finally {
      t.done();
    }
  });

  it('bare init does not enable the mod (opt-in)', () => {
    const t = isolated();
    try {
      t.run('init', '--no-signup', '--no-global', '--no-codex-detect');
      expect(existsSync(join(t.cwd, '.claude', 'settings.local.json'))).toBe(false);
      expect(t.run('doctor', '--component', 'mods')).toContain('not enabled; classic hooks handle every event');
    } finally {
      t.done();
    }
  });
});
