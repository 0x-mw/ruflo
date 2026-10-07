/**
 * ko-l10n A2: output interception, help/prompt wrapping tests (plan §4.1.6-4.1.8, §7 A2-1..A2-3, A2-7, A2-13).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OutputFormatter } from '@claude-flow/cli-core/output';
import { installOutputI18n } from '../src/i18n/output-hook.js';
import { __setI18nForTest, getLocale } from '../src/i18n/index.js';
import { resetDict } from '../src/i18n/dict.js';
import { displayWidth } from '../src/i18n/width.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'i18n-ko');
const KO_TITLE = 'Swarm Status';
const ESC = '\x1b';

let dictDir = '';
let savedDir: string | undefined;

function writeDict(dir: string, entries: Record<string, string>): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'messages.json'),
    JSON.stringify({ schema: 'ruflo-i18n-dict/1', locale: 'ko', entries }),
  );
}

interface Cap { out: string; err: string; restore: () => void }
function capture(): Cap {
  const cap: Cap = { out: '', err: '', restore: () => undefined };
  const so = vi.spyOn(process.stdout, 'write').mockImplementation(((s: any) => { cap.out += String(s); return true; }) as any);
  const se = vi.spyOn(process.stderr, 'write').mockImplementation(((s: any) => { cap.err += String(s); return true; }) as any);
  cap.restore = () => { so.mockRestore(); se.mockRestore(); };
  return cap;
}

function ko(color = false): OutputFormatter {
  __setI18nForTest({ locale: 'ko' });
  const f = new OutputFormatter({ color });
  installOutputI18n(f);
  return f;
}
function en(color = false): OutputFormatter {
  __setI18nForTest({ locale: 'en' });
  const f = new OutputFormatter({ color });
  installOutputI18n(f);
  return f;
}

beforeEach(() => {
  savedDir = process.env.RUFLO_I18N_DIR;
  dictDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ruflo-i18n-out-'));
  writeDict(dictDir, {
    Initialized: '초기화했습니다',
    Done: '완료',
    Agents: '에이전트',
    Status: '상태',
    Name: '이름',
    'Swarm Status': '스웜 상태',
    'Select topology': '토폴로지 선택',
    'Failed to initialize: {0}': '초기화하지 못했습니다: {0}',
    'Run {0} to start background workers': '백그라운드 워커를 시작하려면 {0}을(를) 실행하세요',
    Mesh: '메시',
    Type: '유형',
    Capabilities: '기능',
    'Directories: {0} created': '디렉터리 {0}개 생성',
    'Swarm ID:  {0}': '스웜 ID:  {0}',
    'Description: {0}': '설명: {0}',
    'Memory Entry': '메모리 항목',
  });
  process.env.RUFLO_I18N_DIR = dictDir;
  resetDict();
});

afterEach(() => {
  if (savedDir === undefined) delete process.env.RUFLO_I18N_DIR;
  else process.env.RUFLO_I18N_DIR = savedDir;
  __setI18nForTest(null);
  vi.restoreAllMocks();
  fs.rmSync(dictDir, { recursive: true, force: true });
});

describe('A2-2 interception rules', () => {
  it('printSuccess translates the message once', () => {
    const f = ko();
    const c = capture();
    f.printSuccess('Initialized');
    c.restore();
    expect(c.out).toBe('[OK] 초기화했습니다\n');
    expect(c.out.split('초기화했습니다').length - 1).toBe(1);
  });

  it('printError translates message and goes to stderr', () => {
    const f = ko();
    const c = capture();
    f.printError('Failed to initialize: disk full', 'Done');
    c.restore();
    expect(c.err).toBe('[ERROR] 초기화하지 못했습니다: disk full\n  완료\n');
    expect(c.out).toBe('');
  });

  it('printJson and JSON strings are byte-identical to the unpatched formatter', () => {
    const data = { Initialized: 'Done', list: ['Agents', 'Status'], n: 1 };
    const plain = new OutputFormatter({ color: false });
    const c0 = capture();
    plain.printJson(data);
    plain.printJson(data, false);
    plain.writeln(JSON.stringify(data));
    plain.writeln('["Done"]');
    c0.restore();
    const f = ko();
    const c1 = capture();
    f.printJson(data);
    f.printJson(data, false);
    f.writeln(JSON.stringify(data));
    f.writeln('["Done"]');
    c1.restore();
    expect(c1.out).toBe(c0.out);
    expect(f.json(data)).toBe(plain.json(data));
  });

  it('table translates headers only and keeps every line the same display width', () => {
    const f = ko();
    const data = [
      { n: 'Done', s: 'Agents' },
      { n: '한글 이름', s: 'Mesh' },
    ];
    const out = f.table({
      columns: [
        { key: 'n', header: 'Name' },
        { key: 's', header: 'Status' },
      ],
      data,
    });
    const lines = out.split('\n');
    expect(lines[1]).toContain('이름');
    expect(lines[1]).toContain('상태');
    // cells untouched (exact dictionary words stay English)
    expect(out).toContain('Done');
    expect(out).toContain('Agents');
    expect(out).toContain('Mesh');
    expect(out).not.toContain('완료');
    const widths = new Set(lines.map((l) => displayWidth(l)));
    expect(widths.size).toBe(1);
  });

  it('ko table equals the original layout for ASCII input when nothing is translated', () => {
    const opts = {
      columns: [
        { key: 'a', header: 'Alpha', align: 'right' as const },
        { key: 'b', header: 'Beta', width: 6 },
      ],
      data: [{ a: 1, b: 'abcdefghij' }, { a: 22, b: 'x' }],
    };
    const plain = new OutputFormatter({ color: false });
    const f = ko();
    expect(f.table(opts)).toBe(plain.table(opts));
    expect(f.table({ ...opts, border: false })).toBe(plain.table({ ...opts, border: false }));
    expect(f.table({ ...opts, maxWidth: 14 })).toBe(plain.table({ ...opts, maxWidth: 14 }));
  });

  it('writeln(table) does not re-translate cell lines', () => {
    const f = ko();
    const c = capture();
    f.writeln(f.table({ columns: [{ key: 'n', header: 'Name' }], data: [{ n: 'Done' }] }));
    f.printTable({ columns: [{ key: 'n', header: 'Name' }], data: [{ n: 'Done' }] });
    c.restore();
    expect(c.out).not.toContain('완료');
    expect(c.out).toContain('이름');
  });

  it('box: title translated, data lines only on exact match, widths aligned', () => {
    const f = ko();
    const out = f.box('Done\nDone: still data\nFailed to initialize: x', KO_TITLE);
    const lines = out.split('\n');
    expect(lines[0]).toContain('스웜 상태');
    expect(lines[1]).toContain('완료');
    expect(lines[2]).toContain('Done: still data');
    // whole-line template (G1): translated, placeholder value kept
    expect(lines[3]).toContain('초기화하지 못했습니다: x');
    expect(new Set(lines.map((l) => displayWidth(l))).size).toBe(1);
  });

  it('box without Korean hits equals the original for ASCII', () => {
    const plain = new OutputFormatter({ color: false });
    const f = ko();
    expect(f.box('line one\nline two', 'Title')).toBe(plain.box('line one\nline two', 'Title'));
    expect(f.box('only')).toBe(plain.box('only'));
  });

  it('list / numberedList items translate once and bullets stay', () => {
    const f = ko();
    const c = capture();
    f.printList(['Done', 'Agents']);
    f.printNumberedList(['Done']);
    c.restore();
    expect(c.out).toBe('  - 완료\n  - 에이전트\n  1. 완료\n');
  });

  it('write skips carriage-return and cursor control sequences', () => {
    const f = ko();
    const c = capture();
    f.write('\rDone');
    f.write(`${ESC}[2KDone`);
    f.write('Done');
    c.restore();
    expect(c.out).toBe('\rDone' + `${ESC}[2KDone` + '완료');
  });

  it('spinner text and setText are translated', () => {
    const f = ko();
    const sp: any = f.createSpinner({ text: 'Initialized' });
    expect(sp.text).toBe('초기화했습니다');
    sp.setText('Done');
    expect(sp.text).toBe('완료');
  });

  it('printDebug/printTrace are not translated', () => {
    const f = ko();
    f.setVerbosity('debug');
    const c = capture();
    f.printDebug('Done');
    f.printTrace('Done');
    c.restore();
    expect(c.err).not.toContain('완료');
    expect(c.err).toContain('Done');
  });

  it('non-string arguments pass through untouched', () => {
    const f = ko();
    const c = capture();
    expect(() => f.writeln(undefined as any)).not.toThrow();
    expect(() => f.printSuccess(42 as any)).not.toThrow();
    c.restore();
  });
});

describe('G1 property-table labels and box templates', () => {
  const propOpts = (rows: Array<Record<string, unknown>>, key = 'property') => ({
    columns: [{ key, header: 'Property' }, { key: 'value', header: 'Value' }],
    data: rows,
  });

  it('property table: label column translated, value column kept even when it is a dictionary key', () => {
    const f = ko();
    const out = f.table(propOpts([{ property: 'Type', value: 'Done' }, { property: 'Capabilities', value: 'Agents' }, { property: 'Other', value: 'Type' }]));
    const lines = out.split('\n');
    expect(lines[3]).toContain('유형');
    expect(lines[3]).toContain('Done');
    expect(lines[4]).toContain('기능');
    expect(lines[4]).toContain('Agents');
    expect(lines[5]).toContain('Other');
    expect(lines[5]).toContain('Type');
    expect(out).not.toContain('완료');
    expect(new Set(lines.map((l) => displayWidth(l))).size).toBe(1);
  });

  it('setting key is a label column too; other keys and non-string labels are untouched', () => {
    const f = ko();
    const s = f.table(propOpts([{ setting: 'Type', value: 1 }], 'setting'));
    expect(s).toContain('유형');
    const o = f.table({ columns: [{ key: 'name', header: 'Name' }], data: [{ name: 'Type' }] });
    expect(o).toContain('Type');
    expect(o).not.toContain('유형');
    expect(() => f.table(propOpts([{ property: 42, value: null }, { property: undefined, value: 'x' }]))).not.toThrow();
  });

  it('property table with format() still formats the (translated) label', () => {
    const f = ko();
    const out = f.table({ columns: [{ key: 'property', header: 'Property', format: (v: unknown) => `<${String(v)}>` }], data: [{ property: 'Type' }] });
    expect(out).toContain('<유형>');
  });

  it('box: template lines translate, values and non-matching lines are kept, no colon split', () => {
    const f = ko();
    const out = f.box('Directories: 12 created\nSwarm ID:  swarm-abc\nError: Done\nType: Done\nunmatched line', 'Summary');
    const lines = out.split('\n');
    expect(lines[1]).toContain('디렉터리 12개 생성');
    expect(lines[2]).toContain('스웜 ID:  swarm-abc');
    expect(lines[3]).toContain('Error: Done');
    expect(lines[4]).toContain('Type: Done');
    expect(lines[5]).toContain('unmatched line');
    expect(out).not.toContain('완료');
    expect(new Set(lines.map((l) => displayWidth(l))).size).toBe(1);
  });

  it('box: captured values are never re-translated even when they equal a dictionary key', () => {
    const f = ko();
    const out = f.box('Swarm ID:  Done\nDescription: Done', 'Summary');
    expect(out).toContain('스웜 ID:  Done');
    expect(out).toContain('설명: Done');
    expect(out).not.toContain('완료');
  });

  it('data boxes (Memory Entry, Task: …) use exact match only: no template on user lines', () => {
    const f = ko();
    const mem = f.box('Description: secret\nDirectories: 3 created\nDone', 'Memory Entry');
    expect(mem).toContain('메모리 항목');
    expect(mem).toContain('Description: secret');
    expect(mem).toContain('Directories: 3 created');
    expect(mem).toContain('완료'); // exact match still applies (T8)
    const task = f.box('Description: secret', 'Task: abc');
    expect(task).toContain('Description: secret');
    expect(task).not.toContain('설명');
    // a regular box with the same line is translated
    expect(f.box('Description: secret', 'Summary')).toContain('설명: secret');
  });

  it('printBox writes the translated template lines once', () => {
    const f = ko();
    const c = capture();
    f.printBox('Directories: 3 created', 'Done');
    c.restore();
    expect(c.out).toContain('디렉터리 3개 생성');
    expect(c.out).toContain('완료');
  });

  it('en: tables and boxes stay byte-identical to the unpatched formatter', () => {
    const f = en();
    const plain = new OutputFormatter({ color: false });
    const t = propOpts([{ property: 'Type', value: 'Done' }]);
    expect(f.table(t)).toBe(plain.table(t));
    expect(f.box('Directories: 12 created', 'Done')).toBe(plain.box('Directories: 12 created', 'Done'));
  });
});

describe('A2-7 ANSI templates with color enabled', () => {
  it('translates a template whose capture holds ANSI', () => {
    const f = ko(true);
    const c = capture();
    f.writeln(`Run ${f.highlight('ruflo daemon start')} to start background workers`);
    c.restore();
    const hl = `${ESC}[36m${ESC}[1mruflo daemon start${ESC}[0m`;
    expect(c.out).toBe(`백그라운드 워커를 시작하려면 ${hl}을(를) 실행하세요\n`);
  });

  it('bold title is translated inside the escape pair', () => {
    const f = ko(true);
    expect(f.bold('Swarm Status')).toBe(`${ESC}[1m스웜 상태${ESC}[0m`);
  });
});

describe('en locale: nothing is patched', () => {
  it('leaves own properties alone and output byte-identical', () => {
    const f = en();
    expect(Object.keys(f)).not.toContain('writeln');
    expect(Object.getOwnPropertySymbols(f).length).toBe(0);
    const plain = new OutputFormatter({ color: false });
    const run = (x: OutputFormatter) => {
      const c = capture();
      x.printSuccess('Initialized');
      x.printList(['Done']);
      x.writeln(x.table({ columns: [{ key: 'n', header: 'Name' }], data: [{ n: 'Done' }] }));
      x.printBox('Done', 'Swarm Status');
      c.restore();
      return c.out + '|' + c.err;
    };
    expect(run(f)).toBe(run(plain));
  });

  it('does not read any dictionary file', () => {
    const spy = vi.spyOn(fs, 'readFileSync');
    const f = en();
    const c = capture();
    f.printSuccess('Initialized');
    c.restore();
    expect(spy).not.toHaveBeenCalled();
  });

  it('install is idempotent on ko and restores nothing twice', () => {
    const f = ko();
    const w = f.writeln;
    installOutputI18n(f);
    expect(f.writeln).toBe(w);
    const c = capture();
    f.printSuccess('Initialized');
    c.restore();
    expect(c.out.split('초기화했습니다').length - 1).toBe(1);
  });
});

describe('A2-3 fault injection stays English and never throws', () => {
  it('corrupted dictionary json', () => {
    fs.writeFileSync(path.join(dictDir, 'messages.json'), '{ not json');
    resetDict();
    const f = ko();
    const c = capture();
    expect(() => f.printSuccess('Initialized')).not.toThrow();
    c.restore();
    expect(c.out).toBe('[OK] Initialized\n');
  });

  it('RUFLO_I18N_DIR pointing to a missing path', () => {
    process.env.RUFLO_I18N_DIR = path.join(dictDir, 'does-not-exist');
    resetDict();
    const f = ko();
    const c = capture();
    expect(() => f.printSuccess('Initialized')).not.toThrow();
    expect(() => f.box('Done', 'Swarm Status')).not.toThrow();
    c.restore();
    expect(c.out).toContain('Initialized');
  });

  it('process.stdout.isTTY getter throwing resolves to en and does not patch', () => {
    __setI18nForTest(null);
    const orig = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    const envSave = { v: process.env.VITEST, n: process.env.NODE_ENV };
    delete process.env.VITEST;
    process.env.NODE_ENV = 'production';
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, get() { throw new Error('boom'); } });
    try {
      expect(getLocale()).toBe('en');
      const f = new OutputFormatter({ color: false });
      expect(() => installOutputI18n(f)).not.toThrow();
      const c = capture();
      f.printSuccess('Initialized');
      c.restore();
      expect(c.out).toBe('[OK] Initialized\n');
    } finally {
      if (orig) Object.defineProperty(process.stdout, 'isTTY', orig);
      else delete (process.stdout as any).isTTY;
      process.env.VITEST = envSave.v;
      if (envSave.n === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = envSave.n;
    }
  });

  it('Object.defineProperty failing mid-install restores everything', () => {
    __setI18nForTest({ locale: 'ko' });
    const f = new OutputFormatter({ color: false });
    const real = Object.defineProperty;
    let calls = 0;
    const spy = vi.spyOn(Object, 'defineProperty').mockImplementation(((o: any, k: any, d: any) => {
      if (o === f && ++calls === 5) throw new TypeError('defineProperty failed');
      return real(o, k, d);
    }) as any);
    expect(() => installOutputI18n(f)).not.toThrow();
    spy.mockRestore();
    expect(Object.keys(f).filter((k) => typeof (f as any)[k] === 'function')).toEqual([]);
    expect(Object.getOwnPropertySymbols(f).length).toBe(0);
    const c = capture();
    f.printSuccess('Initialized');
    c.restore();
    expect(c.out).toBe('[OK] Initialized\n');
  });

  it('a throwing original method does not leave the depth guard raised', () => {
    const f = ko();
    const c = capture();
    const stream = (f as any).outputStream;
    (f as any).outputStream = { write() { throw new Error('io'); } };
    expect(() => f.writeln('Done')).toThrow('io');
    (f as any).outputStream = stream;
    f.writeln('Done');
    c.restore();
    expect(c.out).toContain('완료');
  });
});

describe('A2-13 prompts', () => {
  it('confirm question string and select display lines are translated; return values stay English', async () => {
    writeDict(dictDir, {
      'Select topology': '토폴로지 선택',
      'Pick one': '하나를 고르세요',
      Mesh: '메시',
      'Fully connected': '완전 연결',
    });
    resetDict();
    __setI18nForTest({ locale: 'ko' });
    const asked: string[] = [];
    vi.resetModules();
    vi.doMock('readline', () => {
      const api = {
        createInterface: () => ({
          question: (q: string, cb: (a: string) => void) => { asked.push(q); cb(''); },
          on: () => undefined,
          close: () => undefined,
        }),
      };
      return { ...api, default: api };
    });
    const prompt = await import('../src/prompt.js');
    const idx = await import('../src/i18n/index.js');
    idx.__setI18nForTest({ locale: 'ko' });

    const yes = await prompt.confirm({ message: 'Select topology', default: true });
    expect(yes).toBe(true);
    expect(asked[0]).toContain('토폴로지 선택');

    const c = capture();
    const p = prompt.select({
      message: 'Pick one',
      options: [{ value: 'mesh', label: 'Mesh', hint: 'Fully connected' }],
    });
    await new Promise((r) => setTimeout(r, 10));
    process.stdin.emit('data', Buffer.from('\r'));
    const v = await p;
    c.restore();
    vi.doUnmock('readline');
    expect(v).toBe('mesh');
    expect(c.out).toContain('하나를 고르세요');
    expect(c.out).toContain('메시');
    expect(c.out).toContain('완전 연결');
  });

  it('fixture dictionaries remain loadable by the engine (sanity)', () => {
    expect(fs.existsSync(path.join(FIX, 'help.json'))).toBe(true);
  });
});
