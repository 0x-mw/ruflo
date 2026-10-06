#!/usr/bin/env node
// 플러그인 화면 미번역 영어 수집기 (계획 §4.4 plugin-coverage, 적대검토 C1, 검증 B2-3 / F1-2b / F3-7).
//   npx tsx scripts/i18n/plugin-coverage.mjs [--json] [--no-write] [--strict] [--plugin console|swarm|mods] [--screens <regex>]
// 하는 일 (실제 ko 렌더 경로를 측정한다):
//   - 각 플러그인이 import 하는 바로 그 translate.ts(질의 없음, 생성 사전 ko-dict*.ts 그대로)에 setLocale('ko') 한 뒤,
//     기록용 kit 을 그 withLocale 로 감싸 뷰에 넘긴다. 뷰가 실제로 화면에 내보내는 최종 문자열(합성 라벨 포함)만 기록하고,
//     한글이 없고 영어 단어가 있으면 미번역으로 센다(영어 단어 포함·한글 없음). 사전에서 다시 번역해 보는 일은 하지 않는다.
//   - 콘솔: VIEWS 전 화면(paneView 전체), 팔레트, 도움말, 확인 대화(pending), 결과 줄, 밴드(barView).
//   - 스웜: paneView 를 RUFLO_RUN 고정 자료(tests/fixtures)로 렌더(보통·좁은·빈·확인·결과·상세).
//   - mods: 화면이 없으므로 샤드의 정적 항목(ko 가 ""인 것 = 미번역)을 소스 파일별로 센다. 콘솔·스웜도 같은 정적 표를 덧붙인다.
//   - 모든 view:* 화면에 공통으로 나오는 틀(탭·푸터·아이콘)은 'frame' 화면 하나로 모으고 다른 화면에서는 뺀다.
//   - 생성 사전(ko-dict*.ts)이 샤드와 다르면(build 를 다시 돌려야 함) warnings 에 적는다. 측정은 생성 사전 기준이다.
// 출력: i18n/ko/plugin-coverage.json 과 표(--json 이면 표 대신 같은 JSON 을 stdout 으로, --no-write 이면 파일은 쓰지 않음).
//   JSON 의 화면별 strings 는 미번역·승인된 null 만 담는다(번역된 것은 개수만).  --top N: 표 아래에 상위 미번역 문자열 N개(기본 30).
// 종료 코드: 0. --strict 이면 승인된 null 밖의 미번역이 있을 때 1. 렌더가 터지면 2.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO } from './lib/ts-resolve.mjs';
import { cmp, stableJson, readJson, listJson, KO_DIR } from './lib/shard-io.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const AS_JSON = flag('--json');
const STRICT = flag('--strict');
const ONLY = opt('--plugin');
const SCREENS = opt('--screens') ? new RegExp(opt('--screens')) : null;
const OUT = path.join(KO_DIR, 'plugin-coverage.json');
const NOW = 5_000;
const TOP = Number(opt('--top') ?? 30);
const warnings = [];

const HANGUL = /[가-힣]/;
const WORD = /[A-Za-z]{2,}/;
const LEAD = /^\s*(?:(?:[✓✔✗✘✖•·⚠ℹ→▸►▶★☆*>?-]|\p{Extended_Pictographic}️?)+\s+)?/u;
const errors = [];

const urlOf = (rel, query = '') => pathToFileURL(path.join(REPO, rel)).href + query;
const load = (rel, query) => import(urlOf(rel, query));

// ---------- 사전 ----------

/** 플러그인 한 개의 샤드들 → { dict: key → ko 문자열, nulls: Set(key), rows: [{source, key, ko}] } */
function dictOf(plugin) {
  const dict = {};
  const nulls = new Set();
  const rows = [];
  for (const rel of listJson(`plugins/${plugin}`)) {
    const sh = readJson(path.join(KO_DIR, rel));
    if (!sh || !Array.isArray(sh.entries)) continue;
    for (const e of sh.entries) {
      if (typeof e.key !== 'string') continue;
      rows.push({ source: sh.source ?? rel, key: e.key, ko: e.ko });
      if (typeof e.ko === 'string' && e.ko !== '') {
        if (!(e.key in dict)) dict[e.key] = e.ko;
      } else if (e.ko === null) nulls.add(e.key);
    }
  }
  return { dict, nulls, rows };
}

const coreOf = (s) => {
  const rest = s.slice((LEAD.exec(s) ?? [''])[0].length);
  return rest.trim();
};

// ---------- 기록용 kit ----------

function recorder(bucket) {
  const add = (value, kind) => {
    if (typeof value === 'string') {
      if (value !== '' && value.length <= 2000) bucket.set(`${kind}\u0000${value}`, { text: value, kind });
    } else if (Array.isArray(value)) for (const v of value) add(v, kind);
  };
  const el = (type) => (props) => ({ type, props });
  return {
    Box: el('Box'),
    Text: (props) => (add(props?.children, 'text'), { type: 'Text', props }),
    Button: (props) => (add(props?.label, 'button'), add(props?.children, 'button'), { type: 'Button', props }),
    Input: (props) => {
      add(props?.label, 'input');
      add(props?.placeholder, 'input');
      add(props?.submitLabel, 'input');
      return { type: 'Input', props };
    },
  };
}

/** 어떤 속성을 불러도 자기 자신이고 호출도 되는 Proxy: 뷰가 act 안으로 손을 뻗어도 TypeError 가 나지 않는다. */
const proxy = (() => {
  const handler = { get: (_t, key) => (key === 'then' ? undefined : p), apply: () => undefined };
  const p = new Proxy(() => undefined, handler);
  return p;
})();

const memoryFs = (files) => ({
  read: async (p) => files[p] ?? Promise.reject(new Error('ENOENT')),
  stat: async (p) => (files[p] !== undefined ? { mtimeMs: 1, size: files[p].length } : Promise.reject(new Error('ENOENT'))),
  list: async () => Promise.reject(new Error('ENOENT')),
});

// ---------- 번역 판정 ----------

/** 플러그인이 쓰는 translate.ts 인스턴스(질의 없음)를 ko 로 켠다. 생성 사전이 샤드와 다르면 경고를 남긴다. */
async function runtimeFor(plugin, { dict }) {
  const base = `plugins/ruflo-${plugin}/hooks/i18n`;
  const tr = await load(`${base}/translate.ts`);
  const koMod = await load(`${base}/ko-dict.ts`);
  const gen = koMod.KO ?? {};
  const keys = new Set([...Object.keys(gen), ...Object.keys(dict)]);
  let diff = 0;
  for (const k of keys) if (gen[k] !== dict[k]) diff++;
  if (diff > 0) warnings.push(`ruflo-${plugin}: 생성 사전(ko-dict*.ts)이 샤드와 ${diff}개 키에서 다릅니다(생성 ${Object.keys(gen).length}개 / 샤드 ${Object.keys(dict).length}개). node scripts/i18n/build.mjs 후 다시 재세요`);
  tr.setLocale('ko');
  return tr;
}

/** 이미 번역을 거친 최종 문자열 목록 → 판정. 한글이 없고 영어 단어가 있으면 미번역(승인된 null 이면 따로 센다). */
function judge(map, nulls) {
  const out = [];
  for (const { text, kind } of map.values()) {
    if (!WORD.test(text)) continue;
    const status = HANGUL.test(text) ? 'translated' : nulls.has(coreOf(text)) || nulls.has(text) ? 'approved-null' : 'untranslated';
    out.push({ text, kind, status });
  }
  return out.sort((a, b) => cmp(a.status, b.status) || cmp(a.text, b.text));
}

// ---------- 콘솔 ----------

async function consoleCapture(rt) {
  const C = 'plugins/ruflo-console';
  const { newState, VIEWS } = await load(`${C}/hooks/state.ts`);
  const { paneView } = await load(`${C}/hooks/views/pane.ts`);
  const { readSnapshot } = await load(`${C}/hooks/data/snapshot.ts`);
  const { secMemo } = await load(`${C}/hooks/secure.ts`);
  const { barView } = await load(`${C}/hooks/views/bar.ts`);
  const { TOPICS } = await load(`${C}/hooks/help-topics.ts`);
  const { RUFLO_FILES } = await load(`${C}/tests/fixtures/ruflo-run.ts`);

  const files = {
    ...Object.fromEntries(Object.entries(RUFLO_FILES).map(([p, text]) => [`/work/${p}`, text])),
    '/home/dev/.claude/plugins/known_marketplaces.json': JSON.stringify({ ruflo: { installLocation: '/home/dev/m/ruflo' } }),
    '/home/dev/m/ruflo/.claude-plugin/marketplace.json': JSON.stringify({ plugins: [{ name: 'ruflo-core' }, { name: 'ruflo-swarm' }] }),
  };
  const snapshot = await readSnapshot(memoryFs(files), new Map(), '/work', '/home/dev', {}, 0);

  const mk = (kind, look) => {
    const state = newState({});
    state.options.look = look;
    if (kind === 'busy') {
      state.snapshot = snapshot;
      state.usage = { costUsd: 19.81, contextPercent: 40 };
      state.updateAvailable = '0.27.0';
      state.events.push({ atMs: 1_000, kind: 'claims', text: 'claude: Bash' });
      secMemo(state).findings = { source: 'scan', counts: { critical: 1, high: 235, medium: 60, low: 0 }, atMs: 0 };
      state.terminal.runs.set('codex', { label: 'codex', startedAtMs: 0, stop: () => undefined });
      state.pane.isFocused = true;
    }
    return state;
  };

  const shots = new Map(); // 화면 이름 → Map(문자열)
  const bucketOf = (name) => (shots.has(name) || shots.set(name, new Map()), shots.get(name));
  const draw = (name, state, columns) => {
    if (SCREENS && !SCREENS.test(name)) return;
    const kit = rt.withLocale(recorder(bucketOf(name)));
    try {
      paneView({ kit, state, nowMs: NOW, columns, pictures: new Map(), act: proxy });
    } catch (e) {
      errors.push(`console ${name} @${columns}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const CONFIGS = [['plain', 60], ['plain', 120], ['bbs', 120]];

  for (const [look, columns] of CONFIGS) {
    for (const kind of ['empty', 'busy']) {
      for (const view of VIEWS) {
        const s = mk(kind, look);
        s.view = view.id;
        draw(`view:${view.id}`, s, columns);
      }
      // 팔레트
      for (const [context, query] of [['all', ''], ['selection', ''], ['all', 'swarm']]) {
        const s = mk(kind, look);
        s.palette = { isOpen: true, query, index: 0, context };
        draw('palette', s, columns);
      }
      // 도움말: 색인, 답변, 각 주제
      {
        const s = mk(kind, look);
        s.isHelp = true;
        draw('help:index', s, columns);
        s.help = { query: 'swarm', topic: null };
        draw('help:answer', s, columns);
        s.help = { query: 'zzzzqq', topic: null };
        draw('help:answer', s, columns);
      }
      for (const topic of TOPICS) {
        const s = mk(kind, look);
        s.isHelp = true;
        s.help = { query: '', topic: topic.id };
        draw(`help:${topic.id}`, s, columns);
      }
      // 확인 대화: 같은 쪽에서 낸 ask, 다른 쪽에서 낸 ask(안내 한 줄), Claude 의 ask
      const asks = [
        [{ label: 'run swarm init', args: ['swarm', 'init'], expect: 'a swarm store appears', askedAtMs: 0, shows: 'ruflo swarm init --topology mesh', view: 'overview' }, 'overview'],
        [{ label: 'start models run', args: ['x'], expect: 'done', askedAtMs: 0, note: 'models: this spends money', declared: 'spend', view: 'overview' }, 'overview'],
        [{ label: 'run swarm init', args: ['swarm', 'init'], expect: 'a swarm store appears', askedAtMs: 0, view: 'cost' }, 'overview'],
        [{ label: 'write a file', args: ['y'], expect: 'file written', askedAtMs: 0, source: 'claude', kind: 'write', view: 'overview' }, 'overview'],
      ];
      for (const [pending, view] of asks) {
        const s = mk(kind, look);
        s.view = view;
        s.pending = pending;
        draw('confirm', s, columns);
      }
      // 결과 줄(footer outcome)
      {
        const s = mk(kind, look);
        s.outcome = { label: 'swarm init', ok: true, verified: 'yes', detail: 'swarm store written', atMs: 4_000, lines: ['topology hierarchical', 'agents 3'] };
        draw('outcome', s, columns);
        s.outcome = { label: 'swarm init', ok: false, verified: 'no', detail: 'exit 1', atMs: 4_000 };
        draw('outcome', s, columns);
      }
    }
  }

  // 밴드
  if (!SCREENS || SCREENS.test('band')) {
    const bucket = bucketOf('band');
    for (const kind of ['empty', 'busy']) {
      for (const columns of [60, 120]) {
        try {
          barView(rt.withLocale(recorder(bucket)), mk(kind, 'plain'), columns, null, () => {}, () => {}, () => {});
        } catch (e) {
          errors.push(`console band @${columns}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }

  return shots;
}

/** 틀(탭·푸터·내비)로 보이는 문자열을 frame 으로 옮기고 다른 화면에서 뺀다: 모든 view:* 화면에 공통이거나, 전체 화면(band 제외)의 절반 이상에 나오는 것. */
function splitFrame(shots) {
  const views = [...shots.entries()].filter(([n]) => n.startsWith('view:'));
  if (views.length === 0) return;
  const common = new Map(views[0][1]);
  for (const [, map] of views) for (const k of [...common.keys()]) if (!map.has(k)) common.delete(k);
  const body = [...shots.entries()].filter(([n]) => n !== 'band');
  const seen = new Map();
  for (const [, map] of body) for (const k of map.keys()) seen.set(k, (seen.get(k) ?? 0) + 1);
  for (const [k, n] of seen) {
    if (n * 2 < body.length) continue;
    for (const [, map] of body) if (map.has(k)) common.set(k, map.get(k));
  }
  for (const [, map] of shots) for (const k of common.keys()) map.delete(k);
  shots.set('frame', common);
}

// ---------- 스웜 ----------

async function swarmCapture(rt) {
  const S = 'plugins/ruflo-swarm';
  // 스웜 뷰는 고전 JSX(h)로 쓰였다: 호스트의 h 를 흉내 낸다.
  globalThis.h = (type, props, ...children) => (typeof type === 'function' ? type({ ...(props ?? {}), children: children.length === 1 ? children[0] : children }) : { type, props: { ...(props ?? {}), children } });
  globalThis.Fragment = (props) => props.children;
  const { paneView } = await load(`${S}/hooks/views/pane.tsx`);
  const { paneModelOf } = await load(`${S}/hooks/views/model.ts`);
  const { newState } = await load(`${S}/hooks/state.ts`);
  const { newActivity } = await load(`${S}/hooks/model/members.ts`);
  const { readSnapshot } = await load(`${S}/hooks/reader/snapshot.ts`);
  const { RUFLO_RUN } = await load(`${S}/tests/fixtures/ruflo-run.ts`);

  const fsx = { read: async (p) => RUFLO_RUN[p] ?? Promise.reject(new Error('ENOENT')), stat: async (p) => (RUFLO_RUN[p] !== undefined ? { mtimeMs: 1, size: RUFLO_RUN[p].length } : undefined) };
  const snapshot = await readSnapshot(fsx, new Map(), NOW);

  const shots = new Map();
  const bucketOf = (n) => (shots.has(n) || shots.set(n, new Map()), shots.get(n));
  const draw = (name, state, columns, rows = 30) => {
    if (SCREENS && !SCREENS.test(name)) return;
    try {
      const model = paneModelOf(state, columns, rows, NOW);
      paneView(rt.withLocale(recorder(bucketOf(name))), model, proxy);
    } catch (e) {
      errors.push(`swarm ${name} @${columns}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const mk = (withSnapshot) => {
    const s = newState({}, newActivity());
    if (withSnapshot) s.snapshot = snapshot;
    return s;
  };
  for (const columns of [120, 70]) {
    draw('pane', mk(true), columns);
    draw('pane:empty', mk(false), columns);
    {
      const s = mk(true);
      s.confirm = { label: 'steal task-1', spec: { argv: ['x'] }, askedAtMs: 0 };
      draw('pane:confirm', s, columns);
    }
    {
      const s = mk(true);
      s.outcome = { label: 'claim task-1', ok: true, verified: 'yes', detail: 'claimed', atMs: 4_000 };
      draw('pane:outcome', s, columns);
      s.outcome = { label: 'claim task-1', ok: false, verified: 'no', detail: 'exit 1', atMs: 4_000 };
      draw('pane:outcome', s, columns);
    }
    {
      const s = mk(true);
      s.detail = { title: 'logs: coder', lines: ['no log lines yet'] };
      draw('pane:detail', s, columns);
    }
  }
  const narrow = mk(true);
  draw('pane:narrow', narrow, 40);
  return shots;
}

// ---------- 정적(샤드) 표 ----------

function staticScreens(rows) {
  const by = new Map();
  for (const r of rows) {
    const key = `static:${String(r.source).replace(/^plugins\/ruflo-[a-z]+\/(hooks\/)?/, '')}`;
    const o = by.get(key) ?? { total: 0, translated: 0, untranslated: 0, approvedNull: 0, strings: [] };
    if (!WORD.test(r.key)) continue;
    o.total++;
    const status = typeof r.ko === 'string' && r.ko !== '' ? 'translated' : r.ko === null ? 'approved-null' : 'untranslated';
    if (status === 'translated') o.translated++;
    else if (status === 'approved-null') o.approvedNull++;
    else {
      o.untranslated++;
      o.strings.push({ text: r.key, kind: 'static', status });
    }
    by.set(key, o);
  }
  return by;
}

// ---------- 본체 ----------

function summarize(list) {
  const c = { total: list.length, translated: 0, untranslated: 0, approvedNull: 0 };
  for (const s of list) {
    if (s.status === 'translated') c.translated++;
    else if (s.status === 'approved-null') c.approvedNull++;
    else c.untranslated++;
  }
  return c;
}

const result = { schema: 'ruflo-i18n-plugin-coverage/2', measure: 'final-render (translate.ts instance used by the views, ko locale, generated dictionary)', plugins: {}, totals: { total: 0, translated: 0, untranslated: 0, approvedNull: 0 }, warnings, errors };

for (const plugin of ['console', 'swarm', 'mods']) {
  if (ONLY && ONLY !== plugin) continue;
  const name = `ruflo-${plugin}`;
  const d = dictOf(name);
  const screens = {};
  if (plugin !== 'mods') {
    let shots;
    try {
      const rt = await runtimeFor(plugin, d);
      shots = plugin === 'console' ? await consoleCapture(rt) : await swarmCapture(rt);
    } catch (e) {
      errors.push(`${plugin}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
      shots = new Map();
    }
    if (plugin === 'console') splitFrame(shots);
    for (const [screen, map] of [...shots.entries()].sort((a, b) => cmp(a[0], b[0]))) {
      const all = judge(map, d.nulls);
      screens[screen] = { ...summarize(all), strings: all.filter((x) => x.status !== 'translated') };
    }
  }
  for (const [screen, o] of [...staticScreens(d.rows).entries()].sort((a, b) => cmp(a[0], b[0]))) screens[screen] = o;
  result.plugins[name] = { dictEntries: Object.keys(d.dict).length, nullKeys: d.nulls.size, screens };
  for (const [screen, o] of Object.entries(screens)) {
    if (screen.startsWith('static:')) continue; // 합계는 렌더된 화면만(정적 표는 따로 보고)
    for (const k of ['total', 'translated', 'untranslated', 'approvedNull']) result.totals[k] += o[k];
  }
}

if (!flag('--no-write')) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, stableJson(result));
}

if (AS_JSON) {
  process.stdout.write(stableJson(result));
} else {
  const pad = (s, n) => String(s).padEnd(n);
  const num = (s, n) => String(s).padStart(n);
  for (const [name, p] of Object.entries(result.plugins)) {
    console.log(`\n${name}  (사전 ${p.dictEntries}개, null 승인 ${p.nullKeys}개)`);
    console.log(`${pad('screen', 34)}${num('strings', 9)}${num('ko', 8)}${num('untrans', 9)}${num('null-ok', 9)}`);
    for (const [screen, o] of Object.entries(p.screens)) console.log(`${pad(screen, 34)}${num(o.total, 9)}${num(o.translated, 8)}${num(o.untranslated, 9)}${num(o.approvedNull, 9)}`);
  }
  const T = result.totals;
  // 상위 미번역 문자열: 같은 문자열이 나온 화면 수로 정렬
  const tally = new Map();
  for (const [pn, p] of Object.entries(result.plugins)) {
    for (const [screen, o] of Object.entries(p.screens)) {
      if (screen.startsWith('static:')) continue;
      for (const x of o.strings) {
        if (x.status !== 'untranslated') continue;
        const v = tally.get(x.text) ?? { n: 0, at: [] };
        tally.set(x.text, v);
        v.n++;
        v.at.push(`${pn.replace('ruflo-', '')}/${screen}`);
      }
    }
  }
  const top = [...tally.entries()].sort((a, b) => b[1].n - a[1].n || cmp(a[0], b[0])).slice(0, TOP);
  console.log(`\n상위 미번역 문자열 ${top.length}개 (화면 수 순):`);
  for (const [text, v] of top) console.log(`  ${String(v.n).padStart(3)}  ${JSON.stringify(text)}  [${v.at.slice(0, 3).join(', ')}${v.at.length > 3 ? ', …' : ''}]`);
  console.log(`\nTOTAL (rendered screens)  strings ${T.total}  translated ${T.translated}  untranslated ${T.untranslated}  approved-null ${T.approvedNull}`);
  if (warnings.length > 0) console.log(`\nwarnings:\n  ${warnings.join('\n  ')}`);
  if (errors.length > 0) console.log(`\nrender errors (${errors.length}):\n  ${errors.slice(0, 20).join('\n  ')}`);
  if (!flag('--no-write')) console.log(`\n-> ${path.relative(REPO, OUT)}`);
}

// process.exit() 은 파이프로 나가는 stdout 을 자르므로 종료 코드만 지정한다.
process.exitCode = errors.length > 0 ? 2 : STRICT && result.totals.untranslated > 0 ? 1 : 0;
