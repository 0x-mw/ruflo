/**
 * ko-l10n A1: CLI i18n engine tests (plan §4.1, §7 A1-1..A1-6).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { translate } from '../src/i18n/translate.js';
import { buildDict, compileTemplate, applyTemplate, loadDictFrom, Lru } from '../src/i18n/dict.js';
import { resolveLocale, tr, getLocale, isKo, __setI18nForTest } from '../src/i18n/index.js';
import { displayWidth, padEndW, padStartW, truncateW } from '../src/i18n/width.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'i18n-ko');
const cases = JSON.parse(fs.readFileSync(path.join(FIX, 'normalize-cases.json'), 'utf8')) as {
  dict: Record<string, string>;
  cases: Array<{ id: string; in: string; out: string; scope: string }>;
};

describe('A1-2 normalization fixture table (N1..N25)', () => {
  const dict = buildDict(cases.dict);
  it('has exactly N1..N25 once each', () => {
    expect(cases.cases.map((c) => c.id)).toEqual(Array.from({ length: 25 }, (_, i) => `N${i + 1}`));
  });
  for (const c of cases.cases) {
    it(`${c.id}`, () => {
      expect(translate(c.in, dict)).toBe(c.out);
    });
  }
  it('is idempotent on the fixture outputs (no double translation)', () => {
    for (const c of cases.cases) expect(translate(c.out, dict)).toBe(c.out);
  });
  it('serves repeated lookups from the cache with the same result', () => {
    for (const c of cases.cases) {
      expect(translate(c.in, dict)).toBe(c.out);
      expect(translate(c.in, dict)).toBe(c.out);
    }
  });
});

describe('template rules (§4.1.4)', () => {
  it('rejects non-sequential, adjacent, weak and mismatched templates', () => {
    expect(compileTemplate('Run {1} now please', 'x {1}')).toBeNull();
    expect(compileTemplate('Alpha {0}{1} beta', 'x {0}{1}')).toBeNull();
    expect(compileTemplate('{0} {1}', 'X')).toBeNull();
    expect(compileTemplate('Hi {0}', 'X')).toBeNull();
    expect(compileTemplate('Failed to run {0}', '실패')).toBeNull();
    expect(compileTemplate('Failed to run {0}', '{0} {0}')).toBeNull();
  });
  it('reorders placeholders and keeps ANSI captures byte-exact', () => {
    const t = compileTemplate('Moved {0} into {1}', '{1}로 {0}')!;
    expect(applyTemplate(t, 'Moved \x1b[1ma\x1b[0m into b')).toBe('b로 \x1b[1ma\x1b[0m');
  });
  it('looks captures up by exact match once, without recursion', () => {
    const d = buildDict({ 'Failed to initialize: {0}': '실패: {0}', Done: '완료', 'Moved {0} into {1}': '{1}로 {0}' });
    expect(translate('Failed to initialize: Done', d)).toBe('실패: 완료');
    expect(translate('Moved Done into Done', d)).toBe('완료로 완료');
  });
  it('keeps right-of-colon values untranslated by templates, with or without ANSI (constraint 3)', () => {
    const d = buildDict({ '{0} agents': '에이전트 {0}개', 'Moved {0} into {1}': '{1}로 {0}', Done: '완료' });
    expect(translate('Label: 5 agents', d)).toBe('Label: 5 agents');
    expect(translate('MCP Servers: 5 agents', d)).toBe('MCP Servers: 5 agents');
    expect(translate('Label: \x1b[36m5 agents\x1b[0m', d)).toBe('Label: \x1b[36m5 agents\x1b[0m');
    expect(translate('Label: \x1b[36mMoved a into b\x1b[0m', d)).toBe('Label: \x1b[36mMoved a into b\x1b[0m');
    expect(translate('Label: \x1b[36mDone\x1b[0m', buildDict({ Label: '라벨', Done: '완료' }))).toBe('라벨: \x1b[36m완료\x1b[0m');
  });
  it('bounds backtracking for templates with many placeholders', () => {
    const d = buildDict({ 'Moved {0} into {1} into {2} into {3} finally done': 'x' });
    const input = 'Moved ' + 'a into '.repeat(282) + ' finally done!';
    const t0 = Date.now();
    translate(input, d);
    expect(Date.now() - t0).toBeLessThan(300);
  });
  it('does not drop prototype-named keys', () => {
    const d = buildDict(new Map<string, unknown>([['toString', '문자열'], ['constructor', '생성자']]));
    expect(translate('toString', d)).toBe('문자열');
    expect(translate('constructor', d)).toBe('생성자');
  });
  it('resolveLocale never throws on malformed input', () => {
    expect(resolveLocale({} as never)).toBe('en');
    expect(resolveLocale(null as never)).toBe('en');
  });
  it('prefers the template with the longer static part', () => {
    const d = buildDict({
      'Created agent {0} successfully': 'A {0}',
      'Created agent {0} successfully with {1}': 'B {0} {1}',
    });
    expect(translate('Created agent x successfully with y', d)).toBe('B x y');
  });
  it('LRU evicts oldest', () => {
    const l = new Lru<number>(2);
    l.set('a', 1); l.set('b', 2); l.get('a'); l.set('c', 3);
    expect(l.has('b')).toBe(false);
    expect(l.has('a')).toBe(true);
  });
});

describe('dictionary loading', () => {
  it('loads help.json + messages.json from the fixture dir', () => {
    const d = loadDictFrom(FIX);
    expect(translate('Overview', d)).toBe('개요');
    expect(translate('Done', d)).toBe('완료');
    expect(translate('Moved a into b', d)).toBe('b(으)로 a을(를) 옮겼습니다');
  });
  it('missing or broken files give an empty dictionary without throwing', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-bad-'));
    try {
      fs.writeFileSync(path.join(tmp, 'help.json'), '{ broken');
      fs.writeFileSync(path.join(tmp, 'messages.json'), JSON.stringify({ entries: 5 }));
      expect(translate('Overview', loadDictFrom(tmp))).toBe('Overview');
      expect(translate('Overview', loadDictFrom(path.join(tmp, 'nope')))).toBe('Overview');
      expect(translate('Overview', loadDictFrom(null))).toBe('Overview');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('A1-3 fuzz: translate never throws', () => {
  const dict = loadDictFrom(FIX);
  function rnd(seed: number) {
    let s = seed >>> 0;
    return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  }
  it('10000 random inputs', () => {
    const r = rnd(12345);
    const alphabet = ['a', 'Z', ' ', '\n', '\r\n', ':', ': ', '{0}', '{', '}', '✓', '▸', '?', '-', '🏠', '\uD800', '\uDC00', '\x1b', '\x1b[', '\x1b[3', '\x1b[36m', '\x1b[0m', '가', 'Done', 'Agents', 'Moved ', ' into ', '[default: ', ']', '\u0000', '한'];
    let n = 0;
    for (let i = 0; i < 10000; i++) {
      let input: unknown;
      const k = r();
      if (k < 0.05) input = [undefined, null, 5, {}, [], Symbol.iterator, () => 1, 10n][Math.floor(r() * 8)];
      else if (k < 0.07) input = 'x'.repeat(1024 * 1024) + (r() < 0.5 ? '\x1b[' : '\uD800');
      else {
        let s = '';
        const len = Math.floor(r() * 40);
        for (let j = 0; j < len; j++) s += alphabet[Math.floor(r() * alphabet.length)];
        input = s;
      }
      expect(() => translate(input, dict)).not.toThrow();
      const out = translate(input, dict);
      if (typeof input !== 'string') expect(out).toBe(input);
      n++;
    }
    expect(n).toBe(10000);
  });
  it('tr() never throws either (ko locale)', () => {
    __setI18nForTest({ locale: 'ko', dictDir: FIX });
    try {
      for (const v of ['\uD800', '\x1b[', 'x'.repeat(1024 * 1024), '', undefined, null, 7, {}]) {
        expect(() => tr(v as string)).not.toThrow();
      }
    } finally {
      __setI18nForTest(null);
    }
  });
});

describe('A1-4 locale truth table (§2.3)', () => {
  const base = { env: {} as NodeJS.ProcessEnv, stdoutIsTTY: true, stdinIsTTY: true };
  const L = (args: string[], over: Partial<typeof base> = {}) =>
    resolveLocale({ ...base, ...over, argv: ['node', 'ruflo', ...args] });

  it('rule 1: VITEST / NODE_ENV=test -> en (even RUFLO_LANG=ko)', () => {
    expect(L(['status'], { env: { VITEST: 'true' } })).toBe('en');
    expect(L(['status'], { env: { NODE_ENV: 'test' } })).toBe('en');
    expect(L(['status'], { env: { VITEST: 'true', RUFLO_LANG: 'ko' } })).toBe('en');
  });
  it('rule 2: no args and non-TTY stdin (MCP stdio) -> en', () => {
    expect(L([], { stdinIsTTY: false, env: { RUFLO_LANG: 'ko' } })).toBe('en');
    expect(L([], { stdinIsTTY: true })).toBe('ko');
  });
  it('rule 3: mcp/hooks run -> en unless help-like', () => {
    expect(L(['mcp', 'start'], { env: { RUFLO_LANG: 'ko' } })).toBe('en');
    expect(L(['hooks', 'statusline'], { env: { RUFLO_LANG: 'ko' } })).toBe('en');
    expect(L(['hooks', '--help'])).toBe('ko');
    expect(L(['mcp', '-h'])).toBe('ko');
    expect(L(['mcp'])).toBe('ko');
    expect(L(['mcp'], { stdinIsTTY: false })).toBe('en');
    expect(L(['-v', 'hooks', 'list'])).toBe('en');
  });
  it('rule 4: machine-readable output flags -> en', () => {
    for (const a of [
      ['status', '--json'], ['status', '--format', 'json'], ['status', '--format=json'],
      ['status', '-f', 'json'], ['status', '-o', 'yaml'], ['status', '--output', 'csv'],
      ['status', '--output=ndjson'], ['status', '--format', 'RAW'],
    ]) {
      expect(L(a, { env: { RUFLO_LANG: 'ko' } })).toBe('en');
    }
    expect(L(['status', '--format', 'table'])).toBe('ko');
    expect(L(['status', '-f'])).toBe('ko');
  });
  it('rule 5: RUFLO_LANG decides next', () => {
    expect(L(['status'], { env: { RUFLO_LANG: 'ko' }, stdoutIsTTY: false })).toBe('ko');
    expect(L(['status'], { env: { RUFLO_LANG: 'ko_KR.UTF-8' }, stdoutIsTTY: false })).toBe('ko');
    expect(L(['status'], { env: { RUFLO_LANG: 'EN' } })).toBe('en');
    expect(L(['status'], { env: { RUFLO_LANG: 'fr' } })).toBe('ko');
    expect(L(['status'], { env: { RUFLO_LANG: 'fr' }, stdoutIsTTY: false })).toBe('en');
  });
  it('rule 6: TTY decides last', () => {
    expect(L(['status'])).toBe('ko');
    expect(L(['status'], { stdoutIsTTY: false })).toBe('en');
  });
});

describe('A1-5 en makes no file reads', () => {
  afterEach(() => { vi.restoreAllMocks(); __setI18nForTest(null); });
  it('tr() in en never calls fs.readFileSync', () => {
    __setI18nForTest({ locale: 'en', dictDir: FIX });
    const spy = vi.spyOn(fs, 'readFileSync');
    for (const s of ['Overview', 'Moved a into b', '', 'x']) expect(tr(s)).toBe(s);
    expect(isKo()).toBe(false);
    expect(spy).toHaveBeenCalledTimes(0);
  });
  it('control: ko does read the dictionary (spy works)', () => {
    __setI18nForTest({ locale: 'ko', dictDir: FIX });
    const spy = vi.spyOn(fs, 'readFileSync');
    expect(tr('Overview')).toBe('개요');
    expect(spy.mock.calls.length).toBeGreaterThan(0);
  });
  it('getLocale under vitest resolves to en without reading files', () => {
    __setI18nForTest(null);
    const spy = vi.spyOn(fs, 'readFileSync');
    expect(getLocale()).toBe('en');
    expect(spy).toHaveBeenCalledTimes(0);
  });
});

describe('A1-6 import has no side effects', () => {
  afterEach(() => vi.restoreAllMocks());
  it('importing the i18n modules touches neither process.stdout/stdin nor files', async () => {
    const out = vi.spyOn(process, 'stdout', 'get');
    const inn = vi.spyOn(process, 'stdin', 'get');
    const spies = (['readFileSync', 'existsSync', 'readdirSync', 'statSync', 'openSync', 'writeFileSync'] as const).map((m) =>
      vi.spyOn(fs, m as 'readFileSync'),
    );
    vi.resetModules();
    await import('../src/i18n/index.js');
    await import('../src/i18n/translate.js');
    await import('../src/i18n/dict.js');
    await import('../src/i18n/width.js');
    expect(out).toHaveBeenCalledTimes(0);
    expect(inn).toHaveBeenCalledTimes(0);
    for (const s of spies) expect(s).toHaveBeenCalledTimes(0);
  });
});

describe('width.ts (§4.1.7)', () => {
  it('computes display width', () => {
    expect(displayWidth('abc')).toBe(3);
    expect(displayWidth('한글')).toBe(4);
    expect(displayWidth('a한b')).toBe(4);
    expect(displayWidth('\x1b[31m한\x1b[0m')).toBe(2);
    expect(displayWidth('🏠')).toBe(2);
    expect(displayWidth('é')).toBe(1);
    expect(displayWidth('✓')).toBe(1);
    expect(displayWidth('')).toBe(0);
    expect(displayWidth(undefined as unknown as string)).toBe(0);
  });
  it('pads and truncates by cells', () => {
    expect(padEndW('한', 5)).toBe('한   ');
    expect(padStartW('한', 5)).toBe('   한');
    expect(truncateW('한글한글한글', 7)).toBe('한글...');
    expect(displayWidth(truncateW('한글한글한글', 7))).toBeLessThanOrEqual(7);
    expect(truncateW('abc', 5)).toBe('abc');
  });
});

describe('A1 review fixes: ANSI colon runs', () => {
  const d = () => buildDict({ Status: '상태', Done: '완료', Agent: '에이전트(단수)', Agents: '에이전트' });
  it('colon and space in different runs keep separator bytes', () => {
    expect(translate('\x1b[2mStatus:\x1b[22m Done', d())).toBe('\x1b[2m상태:\x1b[22m 완료');
    expect(translate('Status:\x1b[0m Done', d())).toBe('상태:\x1b[0m 완료');
  });
  it('does not cut the last label character', () => {
    expect(translate('\x1b[2mAgents:\x1b[22m 5', d())).toBe('\x1b[2m에이전트:\x1b[22m 5');
  });
  it('colored side translated when the other side already matched', () => {
    expect(translate('\x1b[1mStatus\x1b[0m: Done', d())).toBe('\x1b[1m상태\x1b[0m: 완료');
    expect(translate('Status: \x1b[36mDone\x1b[0m', d())).toBe('상태: \x1b[36m완료\x1b[0m');
  });
  it('rejects dictionaries with wrong schema or locale', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-'));
    try {
      fs.writeFileSync(path.join(tmp, 'help.json'), JSON.stringify({ schema: 'x', locale: 'ko', entries: { Done: '완료' } }));
      fs.writeFileSync(path.join(tmp, 'messages.json'), JSON.stringify({ schema: 'ruflo-i18n-dict/1', locale: 'ja', entries: { Done: '完了' } }));
      expect(translate('Done', loadDictFrom(tmp, 'ko'))).toBe('Done');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
