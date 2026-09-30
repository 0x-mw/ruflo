/**
 * #3555 — the keyword router helper is CommonJS, so it must ship as `.cjs`.
 *
 * Shipped as `router.js`, Node treats it as ESM in any project whose
 * package.json declares `"type":"module"`. `require` is then undefined, the
 * helper throws on load, and `hook-handler.cjs` silently prints
 * "Router not available, using default routing" — disabling ADR-389's fix in
 * exactly the projects most new Node code uses.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { CRITICAL_HELPERS } from '../src/init/helper-refresh.js';
import { generateHelpers, generateHookHandler } from '../src/init/helpers-generator.js';

const PKG_HELPERS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '.claude', 'helpers');
const PROMPT = 'sync and review latest issues';

/** A throwaway project whose package.json makes every `.js` file ESM. */
function esmProject(): { cwd: string; helpersDir: string } {
  const cwd = mkdtempSync(join(tmpdir(), 'router-esm-3555-'));
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'esm-probe', type: 'module' }));
  const helpersDir = join(cwd, '.claude', 'helpers');
  mkdirSync(helpersDir, { recursive: true });
  return { cwd, helpersDir };
}

function node(cwd: string, args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, args, {
    cwd,
    input: '',
    encoding: 'utf-8',
    timeout: 20_000,
    env: { ...process.env, ...env },
  });
}

describe('#3555 — router helper loads in "type":"module" projects', () => {
  it('the package ships router.cjs and lists it as a critical helper', () => {
    expect(CRITICAL_HELPERS).toContain('router.cjs');
    expect(CRITICAL_HELPERS).not.toContain('router.js');
    expect(() => readFileSync(join(PKG_HELPERS_DIR, 'router.cjs'))).not.toThrow();
  });

  it('the generators emit router.cjs and a hook-handler that requires it', () => {
    const helpers = generateHelpers({ components: { helpers: true } } as never);
    expect(Object.keys(helpers)).toContain('router.cjs');
    expect(Object.keys(helpers)).not.toContain('router.js');
    expect(generateHookHandler()).toContain("path.join(helpersDir, 'router.cjs')");
    expect(generateHookHandler()).not.toContain("path.join(helpersDir, 'router.js')");
  });

  it('control: a .js copy of the same router throws in an ESM project (the reported failure)', () => {
    const { cwd, helpersDir } = esmProject();
    writeFileSync(join(helpersDir, 'router.js'), readFileSync(join(PKG_HELPERS_DIR, 'router.cjs')));
    const r = node(cwd, ['.claude/helpers/router.js', PROMPT]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/require is not defined/);
  });

  it('router.cjs routes the prompt to reviewer when run directly in an ESM project', () => {
    const { cwd, helpersDir } = esmProject();
    writeFileSync(join(helpersDir, 'router.cjs'), readFileSync(join(PKG_HELPERS_DIR, 'router.cjs')));
    const r = node(cwd, ['.claude/helpers/router.cjs', PROMPT]);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).agent).toBe('reviewer');
  });

  it('the packaged hook-handler routes through router.cjs in an ESM project', () => {
    const { cwd, helpersDir } = esmProject();
    for (const name of ['hook-handler.cjs', 'router.cjs']) {
      writeFileSync(join(helpersDir, name), readFileSync(join(PKG_HELPERS_DIR, name)));
    }
    const r = node(cwd, ['.claude/helpers/hook-handler.cjs', 'route'], { PROMPT });
    expect(r.stdout).not.toContain('Router not available');
    expect(r.stdout).toContain('Primary Recommendation');
    expect(r.stdout).toMatch(/Agent: reviewer/);
  });
});
