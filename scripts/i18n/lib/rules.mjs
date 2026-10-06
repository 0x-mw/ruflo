// 키 정규화·제외 규칙·조회 기준 구현 (계획 §4.1.3~4.1.5, §4.1.9). 의존성 없음.
// - 추출기(extract.mjs)가 원문 리터럴을 사전 키로 바꿀 때 쓴다.
// - translate() 는 런타임 조회 알고리즘의 참조 구현이다. `--selftest` 가 §4.1.9 픽스처 표와 맞는지 확인한다.
//   (A1 의 src/i18n/translate.ts, C1a 의 plugin-translate.ts 와 같은 표에서 같은 결과를 내야 한다: F1-11)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 추출기가 템플릿 자리표시를 표시하는 센티넬(사설 영역 문자). */
export const PH = '';

const HANGUL_RE = /[가-힣]/;
export const hasHangul = (s) => HANGUL_RE.test(s);

const SYM = '[✓✔✗✘✖•·⚠ℹ→▸►▶★☆*>?\\-]';
// 앞에서 떼는 것: ^\s* 뒤의 기호 묶음 + 공백 (§4.1.3 규칙 5)
const LEAD_RE = new RegExp(`^(\\s*)((?:${SYM}|\\p{Extended_Pictographic}\\uFE0F?)+\\s+)?`, 'u');
const ANSI_SPLIT = /(\u001b\[[0-9;?]*[A-Za-z])/;
const ANSI_ANY = /\u001b\[[0-9;?]*[A-Za-z]/;
const SEP_TOKENS = [': ', ' — ', ' - ', '= '];

function trimEndWs(s) {
  let i = s.length;
  while (i > 0 && /\s/.test(s[i - 1])) i--;
  return i;
}

/** 규칙 5: 앞뒤 분리. core 가 비면 분리하지 않는다. */
export function splitAffix(s) {
  const m = LEAD_RE.exec(s);
  const lead = m ? m[0] : '';
  const rest = s.slice(lead.length);
  const end = trimEndWs(rest);
  const core = rest.slice(0, end);
  if (!core) return { lead: '', core: s, trail: '' };
  return { lead, core, trail: rest.slice(end) };
}

// ---------------------------------------------------------------------------
// 템플릿 (§4.1.4)
// ---------------------------------------------------------------------------

const PLACEHOLDER_RE = /\{(\d+)\}/g;
const letterCount = (s) => (s.match(/[A-Za-z]/g) || []).length;

/** 키를 정적 조각·번호로 분해한다. 형식 위반이면 null. */
export function parseTemplateKey(key) {
  if (typeof key !== 'string' || !/\{\d+\}/.test(key)) return null;
  const parts = key.split(/\{(\d+)\}/);
  const idx = [];
  for (let i = 1; i < parts.length; i += 2) idx.push(Number(parts[i]));
  // {0} 부터 연속 번호, 각 1회
  for (let i = 0; i < idx.length; i++) if (idx[i] !== i) return null;
  const statics = [];
  for (let i = 0; i < parts.length; i += 2) statics.push(parts[i]);
  // 인접 자리표시 금지(안쪽 정적 조각이 비면 안 된다)
  for (let i = 1; i < statics.length - 1; i++) if (statics[i] === '') return null;
  return { statics, count: idx.length };
}

/** 템플릿 자격: 정적 영문자 합계 6자 이상, 연속 영문자 4자 이상 앵커. */
export function templateQualifies(key) {
  const p = parseTemplateKey(key);
  if (!p) return false;
  const total = p.statics.reduce((n, s) => n + letterCount(s), 0);
  if (total < 6) return false;
  return p.statics.some((s) => /[A-Za-z]{4,}/.test(s));
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function compileTemplate(key, ko) {
  if (!templateQualifies(key)) return null;
  const { statics, count } = parseTemplateKey(key);
  const koP = parseTemplateKey(ko);
  // 번역문에는 같은 자리표시 집합이 각 1회씩 있어야 한다(순서는 자유)
  const koIdx = [...ko.matchAll(PLACEHOLDER_RE)].map((m) => Number(m[1])).sort((a, b) => a - b);
  if (koIdx.length !== count || koIdx.some((v, i) => v !== i)) return null;
  void koP;
  let src = '^';
  for (let i = 0; i < statics.length; i++) {
    src += escapeRe(statics[i]);
    if (i < count) {
      let cap;
      if (i === 0 && statics[0] === '') {
        const after = statics[1] ?? '';
        cap = SEP_TOKENS.some((t) => after.startsWith(t)) ? '([\\s\\S]+)' : '(\\S+)';
      } else if (i === count - 1 && statics[statics.length - 1] === '') {
        const before = statics[i] ?? '';
        cap = SEP_TOKENS.some((t) => before.endsWith(t)) ? '([\\s\\S]+)' : '(\\S+)';
      } else {
        cap = '([\\s\\S]+?)';
      }
      src += cap;
    }
  }
  src += '$';
  const longest = statics.reduce((a, b) => (b.length > a.length ? b : a), '');
  return {
    key,
    ko,
    re: new RegExp(src),
    longest,
    staticLen: statics.reduce((n, s) => n + s.length, 0),
  };
}

/** 사전 객체({키: 번역}) → 조회 구조. null·빈 값은 번역 없음으로 본다. */
export function buildDict(entries) {
  const exact = new Map();
  const templates = [];
  for (const [k, v] of Object.entries(entries || {})) {
    if (typeof v !== 'string' || v === '') continue;
    if (/\{\d+\}/.test(k)) {
      const t = compileTemplate(k, v);
      if (t) templates.push(t);
      else exact.set(k, v); // 자격 미달 템플릿은 템플릿으로는 쓰지 않는다(정확 일치만 남김)
    } else {
      exact.set(k, v);
    }
  }
  templates.sort((a, b) => b.staticLen - a.staticLen);
  return { exact, templates };
}

function matchTemplate(str, d) {
  for (const t of d.templates) {
    if (!str.includes(t.longest)) continue;
    const m = t.re.exec(str);
    if (!m) continue;
    return t.ko.replace(PLACEHOLDER_RE, (_, i) => m[Number(i) + 1] ?? '');
  }
  return null;
}

// ---------------------------------------------------------------------------
// 조회 (§4.1.3)
// ---------------------------------------------------------------------------

/** 정확 일치 → 규칙 5(core 정확 일치) → 템플릿 a)·b). 못 찾으면 null. */
function lookupWithAffix(str, d, allowTemplate) {
  const ex = d.exact.get(str);
  if (ex !== undefined) return ex;
  const { lead, core, trail } = splitAffix(str);
  if (core !== str) {
    const e2 = d.exact.get(core);
    if (e2 !== undefined) return lead + e2 + trail;
  }
  if (allowTemplate) {
    const t1 = matchTemplate(core, d);
    if (t1 !== null) return lead + t1 + trail;
    if (core !== str) {
      const t2 = matchTemplate(str, d);
      if (t2 !== null) return t2;
    }
  }
  return null;
}

function lookupRightExact(str, d) {
  const ex = d.exact.get(str);
  if (ex !== undefined) return ex;
  const { lead, core, trail } = splitAffix(str);
  if (core !== str) {
    const e2 = d.exact.get(core);
    if (e2 !== undefined) return lead + e2 + trail;
  }
  return null;
}

function unitNoAnsi(u, d) {
  const direct = lookupWithAffix(u, d, true);
  if (direct !== null) return direct;
  const { lead, core, trail } = splitAffix(u);
  const at = core.indexOf(': ');
  if (at > 0 && at + 2 < core.length) {
    const L = core.slice(0, at);
    const R = core.slice(at + 2);
    const L2 = lookupWithAffix(L, d, true);
    const R2 = lookupRightExact(R, d);
    if (L2 !== null || R2 !== null) return lead + (L2 ?? L) + ': ' + (R2 ?? R) + trail;
  }
  return u;
}

function unit(u, d) {
  if (u === '' || hasHangul(u)) return u;
  const r = unitNoAnsi(u, d);
  if (r !== u) return r;
  if (ANSI_ANY.test(u)) {
    const parts = u.split(ANSI_SPLIT);
    let changed = false;
    for (let i = 0; i < parts.length; i += 2) {
      if (!parts[i] || hasHangul(parts[i])) continue;
      const t = unitNoAnsi(parts[i], d);
      if (t !== parts[i]) {
        parts[i] = t;
        changed = true;
      }
    }
    if (changed) return parts.join('');
  }
  return u;
}

/** 런타임 조회의 참조 구현. 어떤 입력에도 throw 하지 않는다. */
export function translate(s, d) {
  try {
    if (typeof s !== 'string' || s.length === 0 || s.length > 2000) return s;
    const t = s.trim();
    if (t[0] === '{' || t[0] === '[') {
      try {
        JSON.parse(t);
        return s;
      } catch { /* JSON 아님 */ }
    }
    const ex = d.exact.get(s);
    if (ex !== undefined) return ex;
    // 3. 원문 전체 템플릿(ANSI 허용)
    const { lead, core, trail } = splitAffix(s);
    const ta = matchTemplate(core, d);
    if (ta !== null) return lead + ta + trail;
    const tb = matchTemplate(s, d);
    if (tb !== null) return tb;
    // 4. 다중 행
    if (s.includes('\n')) {
      return s
        .split(/(\r?\n)/)
        .map((part, i) => (i % 2 === 1 ? part : unit(part, d)))
        .join('');
    }
    return unit(s, d);
  } catch {
    return s;
  }
}

// ---------------------------------------------------------------------------
// 키 정규화·제외 규칙 (§4.1.5)
// ---------------------------------------------------------------------------

const SHELLISH = /^(npx|npm|pnpm|ruflo|claude-flow|claude|node|git|cd|export|curl)\b/;
// 계획 §4.1.5 목록을 넘어서 추출기가 추가로 거르는 명령 꼴(검사기는 계획 목록만 오류로 본다 — 더 많이 거르는 것은 안전)
const SHELLISH_EXTRA = /^(rm|mkdir|cp|mv|sudo|brew|apt-get|apt|pip3?|python3?|bash|docker|pkill|openssl|tsx|yarn|bun|chmod|chown|sqlite3|ssh|scp|tar|unzip|wget)\s+[-./~$\w]/;
const SLASH_CMD = /^\/[\w:.-]+(\s+\S+){0,2}$/;
const FLAG_ONLY = /^--?[A-Za-z][\w-]*(=\S*)?(\s+\S+)?$/;
const MCP_TOOL = /^mcp__\S+$/;
const KEBAB_ID = /^[a-z][a-z0-9]*([-_.:][a-z0-9]+)+$/;
const CAMEL_ID = /^[a-z]+[A-Z][A-Za-z0-9]*$/;
const STATUS_TAG = /^\[[A-Z0-9 _-]+\]$/;
const LOWER_WORD = /^[a-z0-9][a-z0-9._:/@+-]*$/;

function isUrlOrPath(k) {
  if (/\s/.test(k)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\/\S*$/i.test(k)) return true;
  if (/^(\/|\.\/|\.\.\/|~\/)\S*$/.test(k)) return true;
  if (/^[\w.@{}*-]+(\/[\w.@{}*-]+)+\/?$/.test(k) && (/[.{]/.test(k) || (k.match(/\//g) || []).length >= 2)) return true;
  return false;
}

/**
 * 키가 제외 대상인지 판정한다. 반환: 제외 사유 문자열 또는 null.
 * scope: 'cli-help' | 'cli-messages' | 'plugins'
 */
export function excludeReason(key, { scope = 'cli-messages', ui = false } = {}) {
  if (hasHangul(key)) return 'hangul';
  if (letterCount(key) < 2) return 'letters<2';
  const stripped = key.replace(PLACEHOLDER_RE, '').replace(/[^A-Za-z]/g, '');
  if (stripped.length === 0) return 'placeholder-only';
  if (SHELLISH.test(key)) return 'shell-command';
  if (STATUS_TAG.test(key)) return 'status-tag';
  if (isUrlOrPath(key)) return 'url-or-path';
  if (SHELLISH_EXTRA.test(key)) return 'shell-command';
  if (SLASH_CMD.test(key) || FLAG_ONLY.test(key) || MCP_TOOL.test(key)) return 'command-or-flag';
  if (scope !== 'cli-help' && (KEBAB_ID.test(key) || CAMEL_ID.test(key))) return 'identifier';
  if (LOWER_WORD.test(key)) {
    if (scope === 'cli-messages') return 'lower-token';
    if (scope === 'plugins' && !ui) return 'lower-token-nonui';
  }
  return null;
}

/** 소문자 한 단어(식별자 위험): 플러그인 UI 문맥에서는 허용하되 검사기가 경고한다. */
export const isLowerToken = (key) => LOWER_WORD.test(key);

/**
 * 원문 텍스트(자리표시는 PH)를 사전 키 목록으로 바꾼다.
 * 반환: { keys: [{key, kind}], weak: [키], dropped: [{key, reason}] }
 *  - 줄(\n)과 정적 ANSI 시퀀스 경계에서 조각내어 각각 키로 만든다(런타임 규칙 4·8과 같은 단위).
 *  - 약한 템플릿은 키로 내지 않는다. 단 `Label: {0}` 꼴이면 Label 을 단순 키로 낸다(콜론 분할 좌변).
 */
export function keysFromText(text, opts = {}) {
  const out = { keys: [], weak: [], dropped: [] };
  if (typeof text !== 'string' || text.length === 0) return out;
  const segs = text.split(/\r?\n|\u001b\[[0-9;?]*[A-Za-z]/);
  const seen = new Set();
  const push = (key, kind) => {
    if (seen.has(key)) return;
    seen.add(key);
    out.keys.push({ key, kind });
  };
  const consider = (key) => {
    const why = excludeReason(key, opts);
    if (why) {
      out.dropped.push({ key, reason: why });
      return false;
    }
    return true;
  };
  for (let seg of segs) {
    if (!seg) continue;
    seg = seg.replace(new RegExp(`${PH}+`, 'g'), PH);
    const { core } = splitAffix(seg);
    if (!core || !core.trim()) continue;
    let n = 0;
    const key = core.replace(new RegExp(PH, 'g'), () => `{${n++}}`);
    if (n === 0) {
      if (consider(key)) push(key, 'text');
      continue;
    }
    if (!consider(key)) continue;
    if (templateQualifies(key)) {
      push(key, 'template');
      continue;
    }
    out.weak.push(key);
    const m = /^(.+?):\s+\{0\}$/.exec(key);
    if (m && !/\{\d+\}/.test(m[1]) && consider(m[1])) push(m[1], 'text');
  }
  return out;
}

// ---------------------------------------------------------------------------
// 셀프테스트 (B1-3): `rules.mjs --selftest [normalize-cases.json]`
// ---------------------------------------------------------------------------

const ESC = '\u001b';

export const BUILTIN_FIXTURE = {
  dict: {
    Initialized: '초기화했습니다',
    Agents: '에이전트',
    Overview: '개요',
    store: '저장',
    Done: '완료',
    'Swarm Status': '스웜 상태',
    'Select topology': '토폴로지 선택',
    'MCP Servers': 'MCP 서버',
    'No MCP config found': 'MCP 설정을 찾지 못했습니다',
    'Failed to initialize: {0}': '초기화하지 못했습니다: {0}',
    'Moved {0} into {1}': '{1}(으)로 {0}을(를) 옮겼습니다',
    'Run {0} to start background workers': '백그라운드 워커를 시작하려면 {0}을(를) 실행하세요',
    '{0} agents': '에이전트 {0}개',
    '[default: {0}]': '[기본값: {0}]',
    '{0} {1}': 'X',
    'Hi {0}': 'X',
  },
  cases: [
    { id: 'N1', in: 'Initialized', out: '초기화했습니다', scope: 'all' },
    { id: 'N2', in: '  ✓ Initialized', out: '  ✓ 초기화했습니다', scope: 'all' },
    { id: 'N3', in: 'Agents  ', out: '에이전트  ', scope: 'all' },
    { id: 'N4', in: '? Select topology', out: '? 토폴로지 선택', scope: 'all' },
    { id: 'N5', in: '▸ store', out: '▸ 저장', scope: 'all' },
    { id: 'N6', in: 'Failed to initialize: disk full', out: '초기화하지 못했습니다: disk full', scope: 'all' },
    { id: 'N7', in: 'Moved a into b', out: 'b(으)로 a을(를) 옮겼습니다', scope: 'all' },
    {
      id: 'N8',
      in: `Run ${ESC}[36mruflo daemon start${ESC}[0m to start background workers`,
      out: `백그라운드 워커를 시작하려면 ${ESC}[36mruflo daemon start${ESC}[0m을(를) 실행하세요`,
      scope: 'cli',
    },
    { id: 'N9', in: `${ESC}[1mSwarm Status${ESC}[0m`, out: `${ESC}[1m스웜 상태${ESC}[0m`, scope: 'cli' },
    { id: 'N10', in: 'MCP Servers: No MCP config found', out: 'MCP 서버: MCP 설정을 찾지 못했습니다', scope: 'all' },
    { id: 'N11', in: 'MCP Servers: some user value', out: 'MCP 서버: some user value', scope: 'all' },
    { id: 'N12', in: '2: 🏠 Overview', out: '2: 🏠 개요', scope: 'all' },
    { id: 'N13', in: 'Swarm Status\nunknown line\n  Done', out: '스웜 상태\nunknown line\n  완료', scope: 'all' },
    { id: 'N14', in: '스웜 상태\nDone', out: '스웜 상태\n완료', scope: 'all' },
    { id: 'N15', in: ' [default: 5]', out: ' [기본값: 5]', scope: 'all' },
    { id: 'N16', in: '{"a":1}', out: null, scope: 'all' },
    { id: 'N17', in: '[1, 2]', out: null, scope: 'all' },
    { id: 'N18', in: 'a b', out: null, scope: 'all' },
    { id: 'N19', in: 'Hi there', out: null, scope: 'all' },
    { id: 'N20', in: '5 agents', out: '에이전트 5개', scope: 'all' },
    { id: 'N21', in: 'Selected 5 agents', out: null, scope: 'all' },
    { id: 'N22', in: '', out: '', scope: 'all' },
    { id: 'N23', in: { repeat: ['x', 2001] }, out: null, scope: 'all' },
    { id: 'N24', in: 'Unknown sentence', out: null, scope: 'all' },
    { id: 'N25', in: '\uD800 broken', out: null, scope: 'all' },
  ],
  // B1 키 정규화 사례 (원문 리터럴 → 키). 자리표시는 PH 로 쓴다.
  keyCases: [
    { id: 'K1', in: '  ✓ Initialized\n', scope: 'cli-messages', out: ['Initialized'] },
    { id: 'K2', in: `  Agents: ${PH}`, scope: 'cli-messages', out: ['Agents: {0}'] },
    { id: 'K3', in: `? ${PH}`, scope: 'cli-messages', out: [] },
    { id: 'K4', in: 'running', scope: 'cli-messages', out: [] },
    { id: 'K5', in: 'running', scope: 'plugins', ui: true, out: ['running'] },
    { id: 'K6', in: `${PH} Initialized ${PH}`, scope: 'cli-messages', out: ['{0} Initialized {1}'] },
  ],
};

function materialize(v) {
  if (v && typeof v === 'object' && Array.isArray(v.repeat)) return String(v.repeat[0]).repeat(Number(v.repeat[1]));
  return v;
}

const isSame = (out) => out === null || out === undefined || out === '@same' || (typeof out === 'string' && out.startsWith('그대로'));

export function runSelftest(fixture, { quiet = false } = {}) {
  const d = buildDict(fixture.dict);
  let fail = 0;
  let pass = 0;
  const log = (...a) => { if (!quiet) console.log(...a); };
  for (const c of fixture.cases || []) {
    const input = materialize(c.in);
    const want = isSame(c.out) ? input : c.out;
    let got;
    try {
      got = translate(input, d);
    } catch (e) {
      got = `THROW ${e}`;
    }
    if (got === want) {
      pass++;
      log(`PASS ${c.id}`);
    } else {
      fail++;
      console.log(`FAIL ${c.id}: in=${JSON.stringify(input).slice(0, 80)} want=${JSON.stringify(want).slice(0, 80)} got=${JSON.stringify(got).slice(0, 80)}`);
    }
  }
  for (const c of fixture.keyCases || BUILTIN_FIXTURE.keyCases) {
    const r = keysFromText(c.in, { scope: c.scope, ui: !!c.ui });
    const got = r.keys.map((k) => k.key);
    if (JSON.stringify(got) === JSON.stringify(c.out)) {
      pass++;
      log(`PASS ${c.id}`);
    } else {
      fail++;
      console.log(`FAIL ${c.id}: want=${JSON.stringify(c.out)} got=${JSON.stringify(got)}`);
    }
  }
  return { pass, fail };
}

function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf('--selftest');
  if (at < 0) {
    console.error('usage: rules.mjs --selftest [normalize-cases.json]');
    process.exit(2);
  }
  const file = args[at + 1];
  let fixture = BUILTIN_FIXTURE;
  if (file) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
    } catch (e) {
      console.error(`NORMALIZE: 픽스처를 읽지 못했습니다: ${file} (${e.message})`);
      process.exit(2);
    }
    fixture = { dict: raw.dict, cases: raw.cases, keyCases: raw.keyCases || BUILTIN_FIXTURE.keyCases };
  }
  const base = runSelftest(BUILTIN_FIXTURE, { quiet: true });
  const { pass, fail } = file ? runSelftest(fixture) : { pass: base.pass, fail: base.fail };
  console.log(`rules selftest: ${pass} pass, ${fail} fail${file ? ` (fixture ${file})` : ' (builtin)'}${file ? `; builtin ${base.pass}/${base.pass + base.fail}` : ''}`);
  process.exit(fail || (file && base.fail) ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
