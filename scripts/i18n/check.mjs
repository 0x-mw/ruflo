#!/usr/bin/env node
// 번역 검사기 (계획 §4.4). 오류 코드표는 같은 절을 따른다.
//   node scripts/i18n/check.mjs [--strict] [--shard <샤드…>] [--frontmatter-diff <rev>] [--applied]
//        [--lang-ratio <파일> --max-en 0.2] [--pg-descriptions <dir>] [--count-hangul <파일>] [--selftest]
//        [--repo <dir>] [--verbose]
// 종료 코드: 오류 0 이면 0, 오류가 있으면 1, 사용·환경 문제(도구 없음 등)는 2.
// --strict 없이 돌리면 번역 진행 중에 늘 걸리는 코드(MISSING·NULL_RATIO)와 생성물 코드(STALE_DICT·PLUGIN_COPY)는 경고로만 낸다.
// --shard 를 주면 그 샤드만 검사하고 생성물·파일 검사는 건너뛴다(번역 배치 완료 조건용).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { REPO as DEFAULT_REPO, loadYaml } from './lib/ts-resolve.mjs';
import { cmp, readJson } from './lib/shard-io.mjs';
import { excludeReason, hasHangul, isLowerToken, parseTemplateKey, templateQualifies, runSelftest, BUILTIN_FIXTURE } from './lib/rules.mjs';
import { parseFrontmatter, frontmatterSource, readDescriptionValue, diffFrontmatter, descriptionAtCol0, setDescription, addSynthFrontmatter } from './lib/frontmatter.mjs';
import { marketplaceTargets, pluginTargets, diffOutsideAllowed, setStrings } from './lib/json-scan.mjs';
import { plan, diffPlan, GEN_HEADER, TEMPLATE_REL, LINE_MAX } from './build.mjs';

const NULL_RATIO_MAX = 0.05;
const SCHEMA_ID = 'ruflo-i18n-shard/1';
const TARGETS = new Set(['cli-help', 'cli-messages', 'plugins']);
const STYLES = new Set(['plain', 'double', 'single', 'block', 'json', 'synth']);
const SOFT = new Set(['MISSING', 'NULL_RATIO', 'STALE_DICT', 'PLUGIN_COPY']); // strict 가 아니면 경고
const WARN_ONLY = new Set(['WEAK_TEMPLATE', 'GLOSSARY', 'XDOMAIN', 'LOWER_TOKEN', 'IDENT_SOFT']);

const R3 = /from ['"]node:|\bBuffer\b|\bimport\(|require\(/;
// 플러그인 smoke 의 정적 검사(console 9, mods 4·5·7·12): $.ui. $.env. $.http. $.process. $.model. $.mcp. $.fs. 와 on(' 이벤트 등록.
const R_SMOKE_API = /\$\.(?:ui|env|http|process|model|mcp|fs)\.|\bon\('/;
const R10 = /(api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{8,}/i;

// ---------------------------------------------------------------------------
// 식별자 추출 (IDENT, R-15)
// ---------------------------------------------------------------------------

const COMPLEX_TOKEN = /^[\w][\w.:/@-]*[\w]$/;
// 영어 복합어: ident-tokens 에 있어도 산문 속에서는 강제하지 않는다(식별자 문맥이어도 강제하지 않음).
const COMPOUND_STOP = new Set(['real-time', 'read-only', 'write-only', 'built-in', 'follow-up', 'up-to-date', 'step-by-step', 'long-term', 'short-term', 'high-level', 'low-level', 'end-to-end', 'on-demand', 'opt-in', 'opt-out', 'trade-off', 'fine-grained', 'well-known', 'pre-built', 'multi-agent', 'time-based', 'self-healing', 'self-learning', 'run-time', 'non-zero']);
const LIST_SKIP = new Set(['etc', 'e.g', 'i.e', 'eg', 'ie']);

const trimTail = (s) => s.replace(/[.,;:)]+$/, '');

/** 슬래시 명령 토큰 정리 (MEDIUM-3). */
function slashToken(raw) {
  const parts = raw.replace(/:$/, '').split(':');
  if (parts.length >= 2) return raw.replace(/[:.]+$/, '');
  return raw; // 단독 네임스페이스('/ruflo:')만 끝 ':' 유지
}

/**
 * 키 안에서 번역문에 그대로 남아야 하는 식별자들을 강도별로 나눈다.
 *  hard: 항상 강제(IDENT 오류). soft: 산문일 수 있어 경고(IDENT_SOFT).
 */
export function identsClassified(key, tokens = []) {
  const hard = new Set();
  const soft = new Set();
  const add = (s) => {
    if (s && s.length >= 2) hard.add(s);
  };
  for (const m of key.matchAll(/`([^`\n]+)`/g)) add(m[1]);
  for (const m of key.matchAll(/https?:\/\/[^\s)'"`>\]]+/g)) add(m[0].replace(/[.,;:]+$/, ''));
  for (const m of key.matchAll(/\bmcp__[\w-]+(?:__[\w-]+)*/g)) add(m[0]);
  for (const m of key.matchAll(/(?<![\w-])--[a-zA-Z][\w-]*(?:=[^\s,;)\]'"`]+)?/g)) add(m[0].replace(/[.,;:)]+$/, ''));
  for (const m of key.matchAll(/(?<=^|[\s(\[,'"`])-[a-zA-Z](?![\w-])/g)) add(m[0]);
  for (const m of key.matchAll(/(?<![\w/.-])(?:~\/|\.{1,2}\/|\/)?[\w.@*{}~-]+(?:\/[\w.@*{}~-]+)+\/?/g)) {
    const t = trimTail(m[0]);
    const rooted = /^(~\/|\.{1,2}\/|\/)/.test(t);
    const dotted = /(^|\/)\.[\w-]+/.test(t) || /\.\w{1,5}(\/|$)/.test(t);
    const slashes = (t.match(/\//g) || []).length;
    if (rooted || dotted) add(t);
    else if (slashes >= 2) (/[._@~*{}]/.test(t) ? add(t) : soft.add(t));
  }
  for (const m of key.matchAll(/(?<=^|[\s(\[`'"])\/[a-z][\w-]*(?::[\w-]+)*:?(?![\w/])/g)) add(slashToken(m[0]));
  for (const m of key.matchAll(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g)) add(m[0]);
  for (const m of key.matchAll(/\b\d+(?:\.\d+)?(?:ms|µs|KB|MB|GB|TB)(?![A-Za-z0-9])|\b\d+(?:\.\d+)?%/g)) add(m[0]);
  // 초·분·시·일 단위(5s, 15m, 12h, 3d)는 '5초' 처럼 현지화하는 것이 자연스러울 수 있어 경고로만 둔다
  for (const m of key.matchAll(/\b\d+(?:\.\d+)?[smhd](?![A-Za-z0-9])/g)) soft.add(m[0]);
  for (const m of key.matchAll(/\b[\w-]+\.(?:md|json|ya?ml|ts|m?js|db|sh|toml)\b/g)) {
    if (m.index === 0 && /^[A-Z][a-z]/.test(m[0])) soft.add(m[0]); // 문장 첫머리의 대문자 파일명은 대소문자가 바뀔 수 있다
    else add(m[0]);
  }
  for (const m of key.matchAll(/@[\w-]+\/[\w.-]+/g)) add(trimTail(m[0]));
  for (const m of key.matchAll(/\bv?\d+\.\d+\.\d+\b/g)) add(m[0]);
  for (const m of key.matchAll(/[\w.:/-]+(?:\s*\|\s*[\w.:/-]+)+/g)) for (const it of m[0].split(/\s*\|\s*/)) add(it);
  const complexItem = (s) => /[-_.\d]/.test(s) || tokens.includes(s);
  for (const m of key.matchAll(/[:(\[]\s*([a-z0-9][\w.-]*(?:, [a-z0-9][\w.-]*)+)(?=\s*[)\].]?\s*$)/g)) {
    const items = m[1].split(', ').map((s) => s.replace(/[.,;:]+$/, '')).filter((s) => s && !LIST_SKIP.has(s.toLowerCase()));
    if (items.length >= 2 && items.every(complexItem)) items.forEach(add);
  }
  for (const m of key.matchAll(/(?<=^|[\s(:\[])(['"])([^'"\s]{1,40})\1(?![\w])/g)) if (/[A-Za-z0-9]/.test(m[2])) add(m[2]);
  for (const m of key.matchAll(/(?<=^|[\s(:\[])(['"])((?:ruflo|npx|claude|\/)[^'"\n]{1,80})\1(?![\w])/g)) add(m[2]);
  for (const t of tokens) {
    if (t.length < 3 || !COMPLEX_TOKEN.test(t) || /^[a-z]+$/.test(t)) continue;
    const i = key.indexOf(t);
    if (i < 0) continue;
    const b = key[i - 1];
    const a = key[i + t.length];
    if (!((b === undefined || !/[\w-]/.test(b)) && (a === undefined || !/[\w-]/.test(a)))) continue;
    if (!/^[a-z]+(?:-[a-z]+)+$/.test(t)) {
      add(t); // 점·밑줄·숫자·경로가 든 토큰은 문맥과 무관하게 식별자
      continue;
    }
    if (COMPOUND_STOP.has(t)) continue;
    const before = key.slice(0, i);
    const inCtx = /(?:^|[\s(\[])--[\w-]+(?:=|\s+)$/.test(before) || /['"`]$/.test(before) || /:\s*$/.test(before);
    if (inCtx) add(t);
    else soft.add(t);
  }
  for (const h of hard) soft.delete(h);
  return { hard: [...hard], soft: [...soft] };
}

/** 키 안에서 번역문에 그대로 남아야 하는 식별자들(강제 대상). */
export function identsOf(key, tokens = []) {
  return identsClassified(key, tokens).hard;
}

// ---------------------------------------------------------------------------
// 용어집 금지 변형
// ---------------------------------------------------------------------------

export function parseGlossaryBans(text) {
  const bans = [];
  const line = text.split(/\r?\n/).find((l) => l.includes('금지 변형'));
  if (!line) return bans;
  const body = line.slice(line.indexOf(':', line.indexOf('금지 변형')) + 1).trim().replace(/\.$/, '');
  for (const part of body.split(',')) {
    const m = /^\s*([A-Za-z][\w-]*)\s*→\s*(.+?)\s*$/.exec(part);
    if (m) bans.push({ term: m[1].toLowerCase(), variants: m[2].split('·').map((s) => s.trim()).filter(Boolean) });
  }
  return bans;
}

// ---------------------------------------------------------------------------
// 샤드 읽기
// ---------------------------------------------------------------------------

function listJsonAbs(dirAbs) {
  const out = [];
  const walk = (d) => {
    let names;
    try {
      names = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of names) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.json')) out.push(p);
    }
  };
  walk(dirAbs);
  return out;
}

const posix = (p) => p.split(path.sep).join('/');

function unitOf(rel) {
  if (rel.startsWith('cli/help/')) return { unit: 'cli', target: 'cli-help' };
  if (rel.startsWith('cli/messages/')) return { unit: 'cli', target: 'cli-messages' };
  const m = /^plugins\/([^/]+)\//.exec(rel);
  if (m) return { unit: m[1], target: 'plugins' };
  if (rel.startsWith('descriptions/')) return { unit: 'descriptions', target: 'descriptions' };
  return { unit: rel, target: null };
}

function loadShards(koDir) {
  const out = [];
  for (const sub of ['cli/help', 'cli/messages', 'plugins', 'descriptions']) {
    for (const abs of listJsonAbs(path.join(koDir, sub))) {
      const rel = posix(path.relative(koDir, abs));
      let doc = null;
      let parseError = null;
      try {
        doc = JSON.parse(fs.readFileSync(abs, 'utf8'));
      } catch (e) {
        parseError = String(e.message || e);
      }
      out.push({ rel, doc, parseError, ...unitOf(rel) });
    }
  }
  return out.sort((a, b) => cmp(a.rel, b.rel));
}

// ---------------------------------------------------------------------------
// 검사 본체
// ---------------------------------------------------------------------------

/**
 * @param {object} o
 * @param {string} [o.repo]
 * @param {boolean} [o.strict]
 * @param {string[]|null} [o.shards]   ko 기준 상대 경로. 있으면 그 샤드만 검사
 * @param {boolean} [o.applied]
 * @param {{changed: string[], origOf: (rel:string)=>string|null|undefined}|null} [o.fmDiff]
 * @returns {{issues: Array, counts: object, nullRatios: object}}
 */
export function runChecks(o = {}) {
  const repo = o.repo || DEFAULT_REPO;
  const koDir = path.join(repo, 'i18n/ko');
  const only = o.shards ? new Set(o.shards) : null;
  const issues = [];
  const push = (code, where, msg) => {
    let level = WARN_ONLY.has(code) ? 'warn' : 'error';
    if (!o.strict && SOFT.has(code)) level = 'warn';
    issues.push({ code, level, where, msg });
  };
  const selected = (rel) => !only || only.has(rel);

  const tokensDoc = readJson(path.join(koDir, 'ident-tokens.json'));
  const tokens = tokensDoc && Array.isArray(tokensDoc.tokens) ? tokensDoc.tokens : [];
  let bans = [];
  try {
    bans = parseGlossaryBans(fs.readFileSync(path.join(koDir, 'glossary.md'), 'utf8'));
  } catch { /* 용어집 없음 */ }

  const shards = loadShards(koDir);
  if (only) for (const r of only) if (!shards.some((s) => s.rel === r)) push('SCHEMA', r, '샤드 파일을 찾지 못했습니다');

  // 키 → 단위별 번역 (XDOMAIN), 단위 안 중복 (SCHEMA)
  const seenInUnit = new Map(); // unit → Map(key → rel)
  const byKey = new Map(); // key → Map(unit → {ko, rel})
  const nullStats = {}; // target → {total, nulls}

  const bump = (target, isNull) => {
    const s = (nullStats[target] ||= { total: 0, nulls: 0 });
    s.total++;
    if (isNull) s.nulls++;
  };

  for (const sh of shards) {
    const sel = selected(sh.rel);
    if (sh.parseError) {
      if (sel) push('SCHEMA', sh.rel, `JSON 파싱 실패: ${sh.parseError}`);
      continue;
    }
    const doc = sh.doc;
    if (sh.target === 'descriptions') {
      if (!sel) continue;
      if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
        push('SCHEMA', sh.rel, '객체가 아닙니다');
        continue;
      }
      for (const [k, v] of Object.entries(doc)) {
        const w = `${sh.rel} ${k}`;
        if (!v || typeof v !== 'object' || typeof v.en !== 'string' || !(typeof v.ko === 'string' || v.ko === null) || typeof v.synth !== 'boolean' || !STYLES.has(v.style)) {
          push('SCHEMA', w, '{en, ko, synth, style} 형식이 아닙니다');
          continue;
        }
        bump('descriptions', v.ko === null);
        if (v.ko === '') push('MISSING', w, '미번역(ko 가 빈 문자열)');
        if (typeof v.ko === 'string' && v.ko !== '') descriptionChecks(push, w, k, v, tokens, bans);
      }
      continue;
    }
    // 일반 샤드
    if (!doc || doc.schema !== SCHEMA_ID) {
      if (sel) push('SCHEMA', sh.rel, `schema 가 ${SCHEMA_ID} 가 아닙니다`);
      continue;
    }
    if (sel) {
      if (!TARGETS.has(doc.target) || doc.target !== sh.target) push('SCHEMA', sh.rel, `target(${doc.target})이 경로와 맞지 않습니다(기대 ${sh.target})`);
      if (typeof doc.source !== 'string') push('SCHEMA', sh.rel, 'source 가 문자열이 아닙니다');
      if (!Array.isArray(doc.entries)) push('SCHEMA', sh.rel, 'entries 가 배열이 아닙니다');
      if (doc.obsolete !== undefined && !Array.isArray(doc.obsolete)) push('SCHEMA', sh.rel, 'obsolete 가 배열이 아닙니다');
    }
    if (!Array.isArray(doc.entries)) continue;
    const unitKeys = seenInUnit.get(sh.unit) || new Map();
    seenInUnit.set(sh.unit, unitKeys);
    doc.entries.forEach((e, i) => {
      const w = `${sh.rel}#${i}`;
      if (!e || typeof e.key !== 'string' || e.key === '') {
        if (sel) push('SCHEMA', w, 'key 가 비어 있거나 문자열이 아닙니다');
        return;
      }
      const prior = unitKeys.get(e.key);
      if (prior) {
        if (sel || selected(prior)) push('SCHEMA', w, `같은 런타임 단위(${sh.unit}) 안에서 키가 중복됩니다(앞선 곳 ${prior}): ${short(e.key)}`);
      } else unitKeys.set(e.key, sh.rel);
      if (typeof e.ko === 'string' && e.ko !== '') {
        const m = byKey.get(e.key) || new Map();
        if (!m.has(sh.unit)) m.set(sh.unit, { ko: e.ko, rel: sh.rel });
        byKey.set(e.key, m);
      }
      if (!sel) return;
      if (!(typeof e.ko === 'string' || e.ko === null)) return void push('SCHEMA', w, 'ko 가 문자열도 null 도 아닙니다');
      if (e.kind !== 'text' && e.kind !== 'template') push('SCHEMA', w, `kind(${e.kind})가 text|template 이 아닙니다`);
      if (!Array.isArray(e.ctx) || e.ctx.some((c) => typeof c !== 'string')) push('SCHEMA', w, 'ctx 가 문자열 배열이 아닙니다');
      bump(sh.target, e.ko === null);
      entryChecks(push, w, sh.target, e, tokens, bans);
    });
  }

  // XDOMAIN
  for (const [key, m] of byKey) {
    if (m.size < 2) continue;
    const vals = new Set([...m.values()].map((v) => v.ko));
    if (vals.size < 2) continue;
    const rels = [...m.values()].map((v) => v.rel);
    if (only && !rels.some(selected)) continue;
    push('XDOMAIN', rels.join(' | '), `단위가 다른데 번역이 다릅니다: ${short(key)}`);
  }

  // NULL_RATIO
  const nullRatios = {};
  for (const [t, s] of Object.entries(nullStats)) {
    const ratio = s.total ? s.nulls / s.total : 0;
    nullRatios[t] = { total: s.total, nulls: s.nulls, ratio: Number(ratio.toFixed(4)) };
    if (ratio > NULL_RATIO_MAX) push('NULL_RATIO', t, `null 비율 ${(ratio * 100).toFixed(1)}% (${s.nulls}/${s.total}) 가 상한 ${NULL_RATIO_MAX * 100}% 를 넘습니다`);
  }

  if (!only) globalChecks({ repo, koDir, shards, o, push });
  return { issues, nullRatios };
}

const short = (s) => (s.length > 70 ? `${s.slice(0, 67)}...` : s).replace(/\n/g, '\\n');

function placeholdersOf(s) {
  return [...s.matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1]));
}

function entryChecks(push, w, target, e, tokens, bans) {
  const key = e.key;
  if (hasHangul(key)) push('HANGUL_KEY', w, `키에 한글이 있습니다: ${short(key)}`);
  else {
    const why = excludeReason(key, { scope: target, ui: target === 'plugins' });
    if (why) push('EXCLUDED_KEY', w, `제외 대상 키입니다(${why}): ${short(key)}`);
    else if (target === 'plugins' && isLowerToken(key)) push('LOWER_TOKEN', w, `소문자 한 단어 키(문맥 확인): ${short(key)}`);
  }
  const hasPh = /\{\d+\}/.test(key);
  if (hasPh) {
    if (!parseTemplateKey(key)) push('PLACEHOLDER', w, `자리표시가 {0} 부터 연속·각 1회·비인접이어야 합니다: ${short(key)}`);
    else if (!templateQualifies(key)) push('WEAK_TEMPLATE', w, `템플릿 자격 미달(런타임이 무시): ${short(key)}`);
  }
  if (typeof e.ko !== 'string') return;
  if (e.ko === '') return void push('MISSING', w, `미번역: ${short(key)}`);
  valueChecks(push, w, key, e.ko, tokens, bans, hasPh);
}

function valueChecks(push, w, key, ko, tokens, bans, checkPh = true) {
  if (checkPh) {
    const a = placeholdersOf(key).sort((x, y) => x - y).join(',');
    const b = placeholdersOf(ko).sort((x, y) => x - y).join(',');
    if (a !== b) push('PLACEHOLDER', w, `자리표시 집합이 다릅니다(키 [${a}] / 번역 [${b}]): ${short(key)}`);
  }
  const cls = identsClassified(key, tokens);
  const missing = cls.hard.filter((id) => !ko.includes(id));
  if (missing.length) push('IDENT', w, `번역문에 식별자가 없습니다: ${missing.map((m) => JSON.stringify(m)).join(', ')} (키 ${short(key)})`);
  const softMissing = cls.soft.filter((id) => !ko.includes(id));
  if (softMissing.length) push('IDENT_SOFT', w, `산문일 수 있는 토큰이 번역문에 없습니다(확인): ${softMissing.map((m) => JSON.stringify(m)).join(', ')} (키 ${short(key)})`);
  const lk = key.toLowerCase();
  for (const b of bans) {
    if (!new RegExp(`\\b${b.term}`).test(lk)) continue;
    const hit = b.variants.find((v) => ko.includes(v));
    if (hit) push('GLOSSARY', w, `용어집 금지 변형 '${hit}' (${b.term}): ${short(ko)}`);
  }
}

function descriptionChecks(push, w, k, v, tokens, bans) {
  valueChecks(push, w, v.en, v.ko, tokens, bans, false);
  if (/\/SKILL\.md$/.test(k) && v.ko.length > 1024) push('DESC_LEN', w, `스킬 description 이 1024자를 넘습니다(${v.ko.length})`);
  if (v.style !== 'block' && /\n/.test(v.ko)) push('DESC_LEN', w, '블록이 아닌 description 에 개행이 있습니다');
  if ((k.startsWith('marketplace:') || (k.startsWith('plugin:') && !k.includes('#'))) && v.ko.length < 10) push('DESC_LEN', w, `plugin description 이 10자 미만입니다(${v.ko.length})`);
}

// ---------------------------------------------------------------------------
// 전체 검사(샤드 한정이 아닐 때)
// ---------------------------------------------------------------------------

function globalChecks({ repo, koDir, shards, o, push }) {
  // 생성물
  const p = plan({ repo });
  const d = diffPlan(p);
  for (const [name, s] of Object.entries(p.stats.plugins)) if (s.error) push('PLUGIN_COPY', name, s.error);
  for (const rel of d.changed) {
    if (rel.endsWith('/translate.ts')) push('PLUGIN_COPY', rel, '정본+헤더와 다르거나 없습니다');
    else push('STALE_DICT', rel, '생성물이 샤드와 다르거나 없습니다');
  }
  for (const rel of d.removed) push('STALE_DICT', rel, '더 이상 필요 없는 청크 파일입니다');

  // SMOKE_REGEX: 생성 텍스트와 디스크의 플러그인 i18n TS 전부, 정본
  const texts = new Map();
  for (const [rel, text] of p.files) if (rel.endsWith('.ts')) texts.set(rel, text);
  const pluginsDir = path.join(repo, 'plugins');
  try {
    for (const pl of fs.readdirSync(pluginsDir)) {
      const dir = path.join(pluginsDir, pl, 'hooks/i18n');
      let names = [];
      try {
        names = fs.readdirSync(dir);
      } catch { /* 없음 */ }
      for (const n of names) if (n.endsWith('.ts')) texts.set(`plugins/${pl}/hooks/i18n/${n}`, fs.readFileSync(path.join(dir, n), 'utf8'));
    }
  } catch { /* plugins 없음 */ }
  try {
    texts.set(TEMPLATE_REL, fs.readFileSync(path.join(repo, TEMPLATE_REL), 'utf8'));
  } catch { /* 정본 없음은 plan 이 보고 */ }
  for (const [rel, text] of [...texts].sort((a, b) => cmp(a[0], b[0]))) {
    const lines = text.split('\n');
    const n = text.endsWith('\n') ? lines.length - 1 : lines.length;
    if (n > LINE_MAX) push('SMOKE_REGEX', rel, `${n}줄 > ${LINE_MAX}줄`);
    lines.forEach((l, i) => {
      if (R3.test(l)) push('SMOKE_REGEX', `${rel}:${i + 1}`, `console smoke 3 정규식 적중: ${short(l.trim())}`);
      if (R10.test(l)) push('SMOKE_REGEX', `${rel}:${i + 1}`, `console smoke 10 정규식 적중: ${short(l.trim())}`);
      if (R_SMOKE_API.test(l)) push('SMOKE_REGEX', `${rel}:${i + 1}`, `console 9·mods 4/5/7/12 정규식 적중($.x. 또는 on('): ${short(l.trim())}`);
    });
  }

  // 파일 쪽: YAML, JSON, FM_DIFF, APPLIED
  const descShards = shards.filter((s) => s.target === 'descriptions' && s.doc && !s.parseError);
  const entries = [];
  for (const s of descShards) for (const [k, v] of Object.entries(s.doc)) if (v && typeof v === 'object') entries.push({ key: k, v, shard: s.rel });

  let baseline = new Set();
  try {
    baseline = new Set(fs.readFileSync(path.join(koDir, 'baseline-yaml-errors.txt'), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
  } catch { /* 없음 */ }

  const mdEntries = entries.filter((e) => !/^(marketplace|plugin):/.test(e.key));
  let YAML = null;
  const needYaml = () => (YAML ||= loadYaml());
  for (const e of mdEntries) {
    if (baseline.has(e.key)) continue;
    let text;
    try {
      text = fs.readFileSync(path.join(repo, e.key), 'utf8');
    } catch {
      continue;
    }
    const fm = parseFrontmatter(text);
    if (!fm) continue;
    if (fm.error) {
      push('YAML', e.key, fm.error);
      continue;
    }
    try {
      needYaml().parse(frontmatterSource(fm));
    } catch (err) {
      push('YAML', e.key, String(err.message || err).split('\n')[0]);
    }
  }

  const jsonFiles = [];
  if (fs.existsSync(path.join(repo, '.claude-plugin/marketplace.json'))) jsonFiles.push('.claude-plugin/marketplace.json');
  try {
    for (const pl of fs.readdirSync(pluginsDir).sort(cmp)) if (fs.existsSync(path.join(pluginsDir, pl, '.claude-plugin/plugin.json'))) jsonFiles.push(`plugins/${pl}/.claude-plugin/plugin.json`);
  } catch { /* 없음 */ }
  for (const rel of jsonFiles) {
    try {
      JSON.parse(fs.readFileSync(path.join(repo, rel), 'utf8').replace(/^﻿/, ''));
    } catch (err) {
      push('JSON', rel, `파싱 실패: ${String(err.message || err)}`);
    }
  }

  if (o.fmDiff) {
    for (const rel of o.fmDiff.changed) {
      let cur;
      try {
        cur = fs.readFileSync(path.join(repo, rel), 'utf8');
      } catch {
        continue;
      }
      const orig = o.fmDiff.origOf(rel);
      if (orig === null || orig === undefined) continue;
      if (rel.endsWith('.md')) {
        if (baseline.has(rel)) push('FM_DIFF', rel, '원본에서 이미 깨진 머리말 파일은 손대면 안 됩니다');
        for (const m of diffFrontmatter(orig, cur)) push('FM_DIFF', rel, m);
        if (!descriptionAtCol0(cur)) push('FM_DIFF', rel, 'description: 이 0열에 있지 않습니다');
      } else if (rel.endsWith('.json')) {
        try {
          for (const m of diffOutsideAllowed(orig, cur)) push('JSON', rel, `허용 필드 밖 변경: ${m}`);
        } catch (err) {
          push('JSON', rel, `비교 실패: ${String(err.message || err)}`);
        }
      }
    }
  }

  if (o.applied) {
    for (const e of entries) {
      if (typeof e.v.ko !== 'string' || e.v.ko === '') continue;
      const mk = /^marketplace:/.test(e.key);
      const pj = /^plugin:/.test(e.key);
      let cur = null;
      try {
        if (mk) {
          const t = marketplaceTargets(fs.readFileSync(path.join(repo, '.claude-plugin/marketplace.json'), 'utf8')).get(e.key);
          cur = t ? t.value : null;
        } else if (pj) {
          const name = e.key.slice('plugin:'.length).split('#')[0];
          const text = fs.readFileSync(path.join(repo, `plugins/${name}/.claude-plugin/plugin.json`), 'utf8');
          const t = pluginTargets(text, name).get(e.key);
          cur = t ? t.value : null;
        } else {
          const text = fs.readFileSync(path.join(repo, e.key), 'utf8');
          const fm = parseFrontmatter(text);
          if (fm && !fm.error && fm.hasDesc) {
            try {
              const v = needYaml().parse(frontmatterSource(fm)).description;
              cur = typeof v === 'string' ? v.replace(/\n+$/, '') : null;
            } catch {
              cur = readDescriptionValue(text);
            }
          }
        }
      } catch {
        push('APPLIED', e.key, '대상 파일을 읽지 못했습니다');
        continue;
      }
      if (cur !== e.v.ko.replace(/\n+$/, '')) push('APPLIED', e.key, `번역이 있는데 파일 값이 다릅니다(파일: ${short(String(cur))})`);
    }
  }
}

// ---------------------------------------------------------------------------
// 부가 모드
// ---------------------------------------------------------------------------

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '');

/** --lang-ratio: 영문자가 있는 줄 중 "한글 없이 2글자 이상 영어 단어가 3개 이상인 줄"의 비율. */
export function langRatio(text) {
  const lines = stripAnsi(text).split('\n');
  const letterLines = lines.filter((l) => /[A-Za-z]/.test(l));
  const english = letterLines.filter((l) => !hasHangul(l) && (l.match(/[A-Za-z]{2,}/g) || []).length >= 3);
  return { lettered: letterLines.length, english, ratio: letterLines.length ? english.length / letterLines.length : 0 };
}

export function countHangulLines(text) {
  return text.split('\n').filter((l) => /[가-힣]/.test(l)).length;
}

function walkMd(dir) {
  const out = [];
  const walk = (d) => {
    let names;
    try {
      names = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of names) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

/** --pg-descriptions: playground 의 실제 파일 description 이 한글인지(null 키는 예외). */
export function pgDescriptions(dir, repo = DEFAULT_REPO) {
  const YAML = loadYaml();
  const koDir = path.join(repo, 'i18n/ko');
  const keyMap = new Map(); // 'agents/x.md' → {key, ko}
  for (const abs of listJsonAbs(path.join(koDir, 'descriptions'))) {
    const doc = readJson(abs);
    for (const [k, v] of Object.entries(doc || {})) {
      const m = /^v3\/@claude-flow\/cli\/\.claude\/(.+)$/.exec(k);
      if (m) keyMap.set(m[1], { key: k, ko: v.ko });
    }
  }
  const root = path.join(dir, '.claude');
  const res = { checked: 0, ok: 0, nullOk: 0, bad: [], unmapped: [], noDesc: 0 };
  for (const abs of walkMd(root)) {
    const rel = posix(path.relative(root, abs));
    if (!/^(agents|commands|skills)\//.test(rel)) continue;
    const text = fs.readFileSync(abs, 'utf8');
    const fm = parseFrontmatter(text);
    if (!fm || fm.error || !fm.hasDesc) {
      res.noDesc++;
      continue;
    }
    let desc;
    try {
      desc = YAML.parse(frontmatterSource(fm)).description;
    } catch {
      res.bad.push(`${rel}: YAML 파싱 실패`);
      continue;
    }
    const ent = keyMap.get(rel);
    if (!ent) {
      res.unmapped.push(rel);
      continue;
    }
    res.checked++;
    if (typeof desc === 'string' && hasHangul(desc)) res.ok++;
    else if (ent.ko === null) res.nullOk++;
    else res.bad.push(`${rel}: description 에 한글이 없습니다 (사전 ko ${ent.ko === '' ? '미번역' : '있음'})`);
  }
  return res;
}

// ---------------------------------------------------------------------------
// --selftest: 각 오류 코드의 음성 사례 (임시 디렉터리)
// ---------------------------------------------------------------------------

const TEMPLATE_TEXT = (() => {
  try {
    return fs.readFileSync(path.join(DEFAULT_REPO, TEMPLATE_REL), 'utf8');
  } catch {
    return 'export const x = 1\n';
  }
})();

function mkRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ko-check-'));
  const all = { [TEMPLATE_REL]: TEMPLATE_TEXT, 'i18n/ko/glossary.md': '- **금지 변형**(검사기 GLOSSARY 경고): swarm→무리·군집·스왐, agent→대리인·요원.\n', ...files };
  for (const [rel, text] of Object.entries(all)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, typeof text === 'string' ? text : JSON.stringify(text, null, 2) + '\n');
  }
  return dir;
}

const shard = (target, entries, extra = {}) => ({ schema: SCHEMA_ID, target, source: 'x.ts', entries, obsolete: [], ...extra });
const ent = (key, ko, kind) => ({ key, ko, kind: kind || (/\{\d+\}/.test(key) ? 'template' : 'text'), ctx: ['x.ts:1 y'] });
const fmMd = (desc, body = 'Body text\n') => `---\nname: x\ndescription: ${desc}\n---\n\n${body}`;

export function selftest() {
  const cases = [];
  const yes = (id, code, build, opts = {}) => cases.push({ id, code, build, opts, want: true });
  const no = (id, code, build, opts = {}) => cases.push({ id, code, build, opts, want: false }); // 이 코드가 나오면 안 된다
  const TOK = { 'i18n/ko/ident-tokens.json': { tokens: ['real-time', 'code-review', 'hive-mind', 'post-edit'] } };
  const helpShard = (key, ko, extra = {}) => ({ ...TOK, 'i18n/ko/cli/help/a.json': shard('cli-help', [ent(key, ko)]), ...extra });

  yes('SCHEMA-bad-schema', 'SCHEMA', () => ({ 'i18n/ko/cli/help/a.json': { schema: 'wrong', target: 'cli-help', entries: [] } }));
  yes('SCHEMA-dup-key', 'SCHEMA', () => ({
    'i18n/ko/cli/help/a.json': shard('cli-help', [ent('Show help text', '도움말을 보여줍니다')]),
    'i18n/ko/cli/messages/b.json': shard('cli-messages', [ent('Show help text', '도움말을 보여줍니다')]),
  }));
  yes('MISSING-empty', 'MISSING', () => ({ 'i18n/ko/cli/help/a.json': shard('cli-help', [ent('Show help text', '')]) }));
  yes('NULL_RATIO-over', 'NULL_RATIO', () => ({ 'i18n/ko/cli/help/a.json': shard('cli-help', [ent('Show help text', null), ent('Another sentence here', '다른 문장입니다')]) }));
  yes('HANGUL_KEY', 'HANGUL_KEY', () => ({ 'i18n/ko/cli/help/a.json': shard('cli-help', [ent('도움말 Show', '도움말')]) }));
  yes('EXCLUDED_KEY', 'EXCLUDED_KEY', () => ({ 'i18n/ko/cli/help/a.json': shard('cli-help', [ent('npx ruflo init --force', '초기화')]) }));
  yes('PLACEHOLDER-set', 'PLACEHOLDER', () => ({ 'i18n/ko/cli/messages/a.json': shard('cli-messages', [ent('Moved {0} into {1}', '{0}을(를) 옮겼습니다')]) }));
  yes('PLACEHOLDER-gap', 'PLACEHOLDER', () => ({ 'i18n/ko/cli/messages/a.json': shard('cli-messages', [ent('Moved {1} into {2}', '{1} {2}')]) }));
  yes('WEAK_TEMPLATE', 'WEAK_TEMPLATE', () => ({ 'i18n/ko/cli/messages/a.json': shard('cli-messages', [ent('Hi {0}', null)]) }));
  yes('IDENT-flag', 'IDENT', () => ({ 'i18n/ko/cli/help/a.json': shard('cli-help', [ent('Overwrite files with --force when present', '있으면 강제로 덮어씁니다')]) }));
  yes('IDENT-backtick', 'IDENT', () => ({ 'i18n/ko/cli/messages/a.json': shard('cli-messages', [ent('Run `ruflo daemon start` first', '먼저 데몬을 시작하세요')]) }));
  yes('IDENT-list', 'IDENT', () => ({ 'i18n/ko/cli/help/a.json': shard('cli-help', [ent('Routing mode: auto | low | high', '라우팅 방식: 자동 | 낮음 | 높음')]) }));
  yes('GLOSSARY', 'GLOSSARY', () => ({ 'i18n/ko/cli/help/a.json': shard('cli-help', [ent('Show the swarm overview', '무리 개요를 보여줍니다')]) }));
  yes('XDOMAIN', 'XDOMAIN', () => ({
    'i18n/ko/cli/help/a.json': shard('cli-help', [ent('Show help text', '도움말을 보여줍니다')]),
    'i18n/ko/plugins/ruflo-x/a.json': shard('plugins', [ent('Show help text', '도움말 표시')]),
  }));
  yes('STALE_DICT', 'STALE_DICT', () => ({ 'i18n/ko/cli/help/a.json': shard('cli-help', [ent('Show help text', '도움말을 보여줍니다')]) }));
  yes('PLUGIN_COPY', 'PLUGIN_COPY', () => ({
    'i18n/ko/plugins/ruflo-x/a.json': shard('plugins', [ent('Show help text', '도움말 표시')]),
    'plugins/ruflo-x/hooks/i18n/translate.ts': GEN_HEADER + TEMPLATE_TEXT + '// drift\n',
  }));
  yes('SMOKE_REGEX', 'SMOKE_REGEX', () => ({ 'plugins/ruflo-x/hooks/i18n/wire.ts': "const m = require('x')\n" }));
  yes('SMOKE_REGEX-secret', 'SMOKE_REGEX', () => ({ 'plugins/ruflo-x/hooks/i18n/wire.ts': "const a = \"password: 'abcdefgh12'\"\n" }));
  yes('YAML', 'YAML', () => ({
    'i18n/ko/descriptions/cli-commands.json': { 'a/b.md': { en: 'x thing', ko: '', synth: false, style: 'plain' } },
    'a/b.md': '---\nname: [unclosed\ndescription: x: y: z\n---\nBody\n',
  }));
  yes('DESC_LEN-newline', 'DESC_LEN', () => ({ 'i18n/ko/descriptions/cli-commands.json': { 'a/b.md': { en: 'x thing', ko: '첫 줄\n둘째 줄', synth: false, style: 'plain' } } }));
  yes('DESC_LEN-skill', 'DESC_LEN', () => ({ 'i18n/ko/descriptions/cli-skills.json': { 'a/SKILL.md': { en: 'x thing', ko: '가'.repeat(1025), synth: false, style: 'plain' } } }));
  yes('DESC_LEN-plugin', 'DESC_LEN', () => ({ 'i18n/ko/descriptions/marketplace.json': { 'marketplace:ruflo-x': { en: 'x thing here', ko: '짧음', synth: false, style: 'json' } } }));
  yes('JSON-parse', 'JSON', () => ({ '.claude-plugin/marketplace.json': '{ "name": "x", ' }));
  yes('JSON-diff', 'JSON', () => ({ '.claude-plugin/marketplace.json': '{"name":"ruflo-ko","description":"가나다라마바사아자차"}' }), {
    fmDiff: { changed: ['.claude-plugin/marketplace.json'], origOf: () => '{"name":"ruflo","description":"x"}' },
  });
  yes('FM_DIFF-body', 'FM_DIFF', () => ({ 'a/b.md': fmMd('설명입니다', 'Changed body\n') }), {
    fmDiff: { changed: ['a/b.md'], origOf: () => fmMd('desc here', 'Body text\n') },
  });
  yes('FM_DIFF-col0', 'FM_DIFF', () => ({ 'a/b.md': '---\nname: x\n  description: 설명\n---\nBody\n' }), {
    fmDiff: { changed: ['a/b.md'], origOf: () => '---\nname: x\n  description: desc\n---\nBody\n' },
  });
  yes('APPLIED', 'APPLIED', () => ({
    'i18n/ko/descriptions/cli-commands.json': { 'a/b.md': { en: 'desc here', ko: '설명입니다', synth: false, style: 'plain' } },
    'a/b.md': fmMd('desc here'),
  }), { applied: true });

  // 새 식별자 규칙(MEDIUM-2~5)
  yes('IDENT-semver', 'IDENT', () => helpShard('Requires version 3.6.0 or later', '버전 이상이 필요합니다'));
  yes('IDENT-filename', 'IDENT', () => helpShard('Edit the settings.json file first', '설정 파일을 먼저 고치세요'));
  yes('IDENT-scoped-pkg', 'IDENT', () => helpShard('Install @claude-flow/cli before running', '실행 전에 패키지를 설치하세요'));
  yes('IDENT-flag-eq', 'IDENT', () => helpShard('Use --level=high for deep scans', '깊은 검사에는 --level 을 쓰세요'));
  yes('IDENT-quoted-space', 'IDENT', () => helpShard("Run 'ruflo agent list' to see them", '목록을 보려면 실행하세요'));
  yes('IDENT-slash-ns', 'IDENT', () => helpShard('Type /ruflo: and press tab', '탭을 누르세요'));
  yes('IDENT-slash-multi', 'IDENT', () => helpShard('Open /ruflo:swarm:init to begin', '시작하려면 여세요'));
  yes('IDENT-token-after-colon', 'IDENT', () => helpShard('Hook name: post-edit', '훅 이름: 편집 후'));
  yes('IDENT-token-quoted', 'IDENT', () => helpShard('Pass "hive-mind" as the topology', '토폴로지로 전달하세요'));
  yes('IDENT-valuelist-etc', 'IDENT', () => helpShard('Types: a-b, c-d, etc.', '유형: a-b 등'));
  yes('IDENT_SOFT-prose', 'IDENT_SOFT', () => helpShard('Run a code-review pass on the diff', '차이에 대해 코드 리뷰를 수행합니다'));
  no('IDENT-not-prose', 'IDENT', () => helpShard('Shows real-time status of the agents', '에이전트의 실시간 상태를 보여줍니다'));
  no('IDENT-not-prose-2', 'IDENT', () => helpShard('Shows real-time status of the agents', '에이전트의 실시간 상태를 보여줍니다'));
  no('IDENT-etc-ok', 'IDENT', () => helpShard('Types: a-b, c-d, etc.', '유형: a-b, c-d 등'));
  no('IDENT-eg-ok', 'IDENT', () => helpShard('Modes (e.g. fast-path, slow-path)', '모드(예: fast-path, slow-path)'));
  no('IDENT-slash-trailing-dot', 'IDENT', () => helpShard('Open /ruflo:swarm:init.', '/ruflo:swarm:init 을 여세요.'));
  no('IDENT-slash-multi-colon', 'IDENT', () => helpShard('Use /ruflo:swarm:init: it starts', '/ruflo:swarm:init 을 쓰면 시작합니다'));
  no('IDENT-path-prose', 'IDENT', () => helpShard('Use and/or/else logic here', '여기서 논리를 씁니다'));
  no('IDENT-sentence-initial-file', 'IDENT', () => helpShard('Settings.json updated with new values', '설정이 갱신되었습니다'));
  // SMOKE_REGEX 확장(MEDIUM-8)
  yes('SMOKE_REGEX-ui', 'SMOKE_REGEX', () => ({ 'plugins/ruflo-x/hooks/i18n/wire.ts': 'const x = $.ui.open()\n' }));
  yes('SMOKE_REGEX-env-set', 'SMOKE_REGEX', () => ({ 'plugins/ruflo-x/hooks/i18n/wire.ts': "$.env.set('A', 1)\n" }));
  yes('SMOKE_REGEX-on', 'SMOKE_REGEX', () => ({ 'plugins/ruflo-x/hooks/i18n/wire.ts': "on('session.start', f)\n" }));

  let fail = 0;
  let pass = 0;
  const report = (ok, id, extra = '') => {
    if (ok) pass++;
    else fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${id}${extra ? ` ${extra}` : ''}`);
  };
  for (const c of cases) {
    const dir = mkRepo(c.build());
    try {
      const r = runChecks({ repo: dir, strict: true, ...c.opts });
      const hit = r.issues.some((i) => i.code === c.code);
      const ok = hit === c.want;
      report(ok, c.id, ok ? '' : `(${c.want ? '기대' : '나오면 안 됨'} ${c.code}, 실제 ${[...new Set(r.issues.map((i) => i.code))].join(',') || '없음'}${hit && !c.want ? ': ' + r.issues.filter((i) => i.code === c.code).map((i) => i.msg).join(' / ').slice(0, 200) : ''})`);
    } catch (e) {
      report(false, c.id, `예외 ${e.message}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // 양성(깨끗한 저장소는 오류 0)
  {
    const dir = mkRepo({
      'i18n/ko/cli/help/a.json': shard('cli-help', [ent('Show help text', '도움말을 보여줍니다'), ent('Moved {0} into {1}', '{1}(으)로 {0}을(를) 옮겼습니다')]),
      'i18n/ko/descriptions/cli-commands.json': { 'a/b.md': { en: 'desc here', ko: '설명입니다', synth: false, style: 'plain' } },
      'a/b.md': fmMd('설명입니다'),
    });
    // 깨끗하려면 생성물이 맞아야 한다
    const p = plan({ repo: dir });
    for (const [rel, text] of p.files) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), text);
    }
    const r = runChecks({ repo: dir, strict: true, applied: true });
    const errs = r.issues.filter((i) => i.level === 'error');
    report(errs.length === 0, 'CLEAN-positive', errs.length ? JSON.stringify(errs.slice(0, 3)) : '');
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // 순수 함수 사례
  const t = (id, ok, extra) => report(ok, id, extra);
  t('FM_DIFF-fn-body', diffFrontmatter(fmMd('a b c'), fmMd('가 나 다', 'X\n')).length > 0);
  t('FM_DIFF-fn-ok', diffFrontmatter(fmMd('a b c'), fmMd('가 나 다')).length === 0);
  t('FM_DIFF-fn-synth', diffFrontmatter('# T\n\nbody\n', addSynthFrontmatter('# T\n\nbody\n', '제목')).length === 0);
  t('FM_DIFF-fn-nodesc-changed', diffFrontmatter('---\nname: a\n---\nB\n', '---\nname: b\n---\nB\n').length > 0);
  t('FM_DIFF-fn-nodesc-body', diffFrontmatter('---\nname: a\n---\nB\n', '---\nname: a\n---\nC\n').length > 0);
  t('FM_DIFF-fn-nodesc-same', diffFrontmatter('---\nname: a\n---\nB\n', '---\nname: a\n---\nB\n').length === 0);
  t('FM_DIFF-fn-synth-bom', diffFrontmatter('﻿# T\n\nbody\n', addSynthFrontmatter('﻿# T\n\nbody\n', '제목')).length === 0);
  t('FM_DIFF-fn-synth-bom-dropped', diffFrontmatter('﻿# T\n\nbody\n', addSynthFrontmatter('# T\n\nbody\n', '제목')).length > 0);
  t('FM_DIFF-fn-synth-body', diffFrontmatter('# T\n\nbody\n', addSynthFrontmatter('# T\n\nbody\n', '제목').replace('body', 'BODY')).length > 0);
  t('JSON-fn-allowed', diffOutsideAllowed('{"name":"a","description":"x"}', '{"name":"a","description":"y"}').length === 0);
  t('JSON-fn-name', diffOutsideAllowed('{"name":"a","description":"x"}', '{"name":"b","description":"x"}').length === 1);
  t('JSON-fn-userConfig', diffOutsideAllowed('{"userConfig":{"k":{"title":"a","default":"d"}}}', '{"userConfig":{"k":{"title":"가","default":"e"}}}').length === 1);

  // 머리말 왕복: 바꾼 결과는 YAML 로 읽어 같은 값이 나오고 본문 바이트는 그대로다
  {
    const YAML = loadYaml();
    const values = ['간단한 설명', '콜론: 포함된 설명', '# 샵으로 시작', '- 대시로 시작', 'yes 로 시작하는 설명', '123 으로 시작', '끝이 콜론:', "작은따옴표 ' 포함", '따옴표 " 포함', '백슬래시 \\ 포함'];
    const shapes = [
      ['plain', 'description: old text\n'],
      ['double', 'description: "old: text"\n'],
      ['single', "description: 'old text'\n"],
      ['block', 'description: |\n  old line one\n  old line two\n'],
      ['folded', 'description: >-\n  old folded\n  text\n'],
      ['multi-plain', 'description: old first\n  old continued\n'],
    ];
    let allOk = true;
    const bad = [];
    for (const [shape, descText] of shapes) {
      for (const eol of ['\n', '\r\n']) {
        for (const v of values) {
          const orig = `---${eol}name: x${eol}${descText.replace(/\n/g, eol)}tools: a, b${eol}---${eol}${eol}Body${eol}`;
          const out = setDescription(orig, v);
          let got = null;
          try {
            got = out && YAML.parse(frontmatterSource(parseFrontmatter(out))).description;
          } catch { /* 아래에서 실패로 센다 */ }
          const bodyOk = out && out.endsWith(`${eol}---${eol}${eol}Body${eol}`) && out.includes(`name: x${eol}`) && out.includes(`tools: a, b${eol}`);
          const want = shape === 'block' || shape === 'folded' ? v : v;
          if (!(typeof got === 'string' && got.replace(/\n+$/, '') === want && bodyOk && diffFrontmatter(orig, out).length === 0)) {
            allOk = false;
            bad.push(`${shape}/${JSON.stringify(eol)}/${v}`);
          }
        }
      }
    }
    t('FRONTMATTER-roundtrip', allOk, bad.slice(0, 3).join('; '));
    const noDesc = setDescription('---\nname: x\n---\nB\n', '가');
    t('FRONTMATTER-no-desc-null', noDesc === null);
    const syn = addSynthFrontmatter('﻿# T\r\nbody\r\n', '콜론: 값');
    let synOk = false;
    try {
      synOk = syn.startsWith('﻿---\r\n') && YAML.parse(frontmatterSource(parseFrontmatter(syn))).description === '콜론: 값' && syn.endsWith('# T\r\nbody\r\n');
    } catch { /* 실패 */ }
    t('FRONTMATTER-synth-bom-crlf', synOk);
    // JSON 토큰 치환: 다른 바이트 불변
    const j = '{\n  "name": "a",\n  "description": "old",\n  "list": [ {"description":"x"} ]\n}\n';
    const j2 = setStrings(j, [{ path: ['description'], value: '새 "값"' }]);
    t('JSON-setStrings-bytes', j2 === j.replace('"old"', JSON.stringify('새 "값"')) && JSON.parse(j2).description === '새 "값"');
  }

  // --frontmatter-diff 가 실제 git 경로로 플러그인 하위 디렉터리 md 를 잡는가 (HIGH-1)
  {
    const gitOk = spawnSync('git', ['--version']).status === 0;
    if (!gitOk) t('FM_DIFF-git-real (git 없음, 건너뜀)', true);
    else {
      const skill = (d, b) => `---\nname: x\ndescription: ${d}\n---\n\n${b}\n`;
      const dir = mkRepo({
        'plugins/ruflo-x/skills/foo/SKILL.md': skill('desc one here', 'Body A'),
        'plugins/ruflo-x/commands/sub/cmd.md': skill('desc two here', 'Body B'),
        'plugins/ruflo-x/agents/ag.md': skill('desc three here', 'Body C'),
        'v3/@claude-flow/cli/.claude/skills/s/SKILL.md': skill('desc four here', 'Body D'),
      });
      const g = (...a) => spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' });
      try {
        g('init', '-q');
        g('add', '-A');
        g('commit', '-q', '-m', 'base');
        const rev = g('rev-parse', 'HEAD').stdout.trim();
        // 설명만 바꾸면 통과
        fs.writeFileSync(path.join(dir, 'plugins/ruflo-x/skills/foo/SKILL.md'), skill('한글 설명입니다', 'Body A'));
        let d = fmDiffFor(dir, rev);
        t('FM_DIFF-git-real-desc-found', !!d && d.changed.includes('plugins/ruflo-x/skills/foo/SKILL.md'), JSON.stringify(d && d.changed));
        let r = runChecks({ repo: dir, fmDiff: d });
        t('FM_DIFF-git-real-desc-ok', !r.issues.some((i) => i.code === 'FM_DIFF'));
        // 본문을 바꾸면 하위 디렉터리의 플러그인 SKILL.md·commands·agents 와 v3 skills 모두 잡힌다
        for (const rel of ['plugins/ruflo-x/skills/foo/SKILL.md', 'plugins/ruflo-x/commands/sub/cmd.md', 'plugins/ruflo-x/agents/ag.md', 'v3/@claude-flow/cli/.claude/skills/s/SKILL.md']) {
          const abs = path.join(dir, rel);
          fs.writeFileSync(abs, fs.readFileSync(abs, 'utf8').replace(/Body (.)/, 'Body CHANGED'));
        }
        d = fmDiffFor(dir, rev);
        r = runChecks({ repo: dir, fmDiff: d });
        const bad = new Set(r.issues.filter((i) => i.code === 'FM_DIFF').map((i) => i.where));
        t('FM_DIFF-git-real-body-caught', ['plugins/ruflo-x/skills/foo/SKILL.md', 'plugins/ruflo-x/commands/sub/cmd.md', 'plugins/ruflo-x/agents/ag.md', 'v3/@claude-flow/cli/.claude/skills/s/SKILL.md'].every((x) => bad.has(x)), `잡힌 것: ${[...bad].join(', ')}`);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  }

  // NORMALIZE
  {
    const bad = { dict: { Initialized: '초기화했습니다' }, cases: [{ id: 'neg', in: 'Initialized', out: '틀린 값', scope: 'all' }], keyCases: [] };
    const origLog = console.log;
    console.log = () => {}; // 일부러 틀린 사례라 'FAIL' 출력이 통과한 selftest 로그에 섞이지 않게 한다
    let neg;
    try {
      neg = runSelftest(bad, { quiet: true });
    } finally {
      console.log = origLog;
    }
    t('NORMALIZE-negative (expected-fail 사례가 실패로 잡힘)', neg.fail > 0);
    const pos = runSelftest(BUILTIN_FIXTURE, { quiet: true });
    t('NORMALIZE-builtin', pos.fail === 0, `${pos.pass} pass / ${pos.fail} fail`);
    const fx = path.join(DEFAULT_REPO, 'v3/@claude-flow/cli/__tests__/fixtures/i18n-ko/normalize-cases.json');
    const raw = readJson(fx);
    if (raw) {
      const r = runSelftest({ dict: raw.dict, cases: raw.cases, keyCases: raw.keyCases || BUILTIN_FIXTURE.keyCases }, { quiet: true });
      t('NORMALIZE-fixture', r.fail === 0, `${r.pass} pass / ${r.fail} fail`);
    }
  }

  // 언어 비율
  t('LANG-ratio', langRatio('Hello there my friend\n안녕 world today now\n\x1b[31mAll good here today\x1b[0m\n').english.length === 2);
  t('COUNT-hangul', countHangulLines('abc\n가\nx 나\n') === 2);

  console.log(`check selftest: ${pass} pass, ${fail} fail`);
  return fail === 0;
}

// ---------------------------------------------------------------------------
// 실행
// ---------------------------------------------------------------------------

function git(repo, args) {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

// 머리말·JSON 비교 대상 경로(git pathspec). 디렉터리 이름만 쓰면 하위 디렉터리 파일을 못 맞춘다(plugins/*/commands 등) -> :(glob) 와 ** 를 쓴다.
export const FM_PATHSPECS = ['v3/@claude-flow/cli/.claude/agents/', 'v3/@claude-flow/cli/.claude/commands/', 'v3/@claude-flow/cli/.claude/skills/', ':(glob)plugins/*/commands/**', ':(glob)plugins/*/agents/**', ':(glob)plugins/*/skills/**', '.claude-plugin/marketplace.json', ':(glob)plugins/*/.claude-plugin/plugin.json'];

/** rev 와 작업 트리를 비교해 머리말/JSON 검사 대상 { changed, origOf } 를 만든다. git 실패 시 null. */
export function fmDiffFor(repo, rev) {
  const out = git(repo, ['-c', 'core.quotepath=false', 'diff', '--name-only', '-z', rev, '--', ...FM_PATHSPECS]);
  if (out === null) return null;
  const changed = out.split('\0').filter((n) => n.endsWith('.md') || n.endsWith('.json'));
  return { changed, origOf: (rel) => git(repo, ['show', `${rev}:${rel}`]) };
}

function main() {
  const argv = process.argv.slice(2);
  const flag = (n) => argv.includes(n);
  const opt = (n) => {
    const i = argv.indexOf(n);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const repo = opt('--repo') ? path.resolve(opt('--repo')) : DEFAULT_REPO;

  if (flag('--selftest')) process.exit(selftest() ? 0 : 1);

  if (opt('--count-hangul')) {
    let text;
    try {
      text = fs.readFileSync(opt('--count-hangul'), 'utf8');
    } catch (e) {
      console.error(`읽지 못했습니다: ${e.message}`);
      process.exit(2);
    }
    console.log(countHangulLines(text));
    process.exit(0);
  }

  if (opt('--lang-ratio')) {
    let text;
    try {
      text = fs.readFileSync(opt('--lang-ratio'), 'utf8');
    } catch (e) {
      console.error(`읽지 못했습니다: ${e.message}`);
      process.exit(2);
    }
    const max = Number(opt('--max-en') ?? '0.2');
    const r = langRatio(text);
    for (const l of r.english) console.log(`EN  ${l.trim().slice(0, 160)}`);
    console.log(`lang-ratio: 영문자 줄 ${r.lettered}, 영어 줄 ${r.english.length}, 비율 ${(r.ratio * 100).toFixed(1)}% (상한 ${(max * 100).toFixed(1)}%)`);
    process.exit(r.ratio > max ? 1 : 0);
  }

  if (opt('--pg-descriptions')) {
    const r = pgDescriptions(path.resolve(opt('--pg-descriptions')), repo);
    for (const b of r.bad) console.log(`BAD ${b}`);
    console.log(`pg-descriptions: 대조 ${r.checked}, 한글 ${r.ok}, null 예외 ${r.nullOk}, 위반 ${r.bad.length}, 사전에 없는 파일 ${r.unmapped.length}, description 없음 ${r.noDesc}`);
    process.exit(r.bad.length ? 1 : 0);
  }

  const strict = flag('--strict');
  const koDir = path.join(repo, 'i18n/ko');
  let shards = null;
  const si = argv.indexOf('--shard');
  if (si >= 0) {
    shards = [];
    for (let i = si + 1; i < argv.length && !argv[i].startsWith('--'); i++) {
      const a = argv[i];
      const cands = [path.resolve(a), path.resolve(repo, a), path.resolve(koDir, a)];
      const abs = cands.find((c) => fs.existsSync(c)) || cands[2];
      shards.push(posix(path.relative(koDir, abs)));
    }
    if (!shards.length) {
      console.error('--shard 뒤에 샤드 파일을 하나 이상 주세요');
      process.exit(2);
    }
  }

  let fmDiff = null;
  const rev = opt('--frontmatter-diff');
  if (rev && !shards) {
    fmDiff = fmDiffFor(repo, rev);
    if (fmDiff === null) {
      console.error(`git diff ${rev} 를 실행하지 못했습니다(리비전 확인)`);
      process.exit(2);
    }
    console.log(`frontmatter-diff ${rev}: 검사 대상 변경 파일 ${fmDiff.changed.length}개`);
  }

  let res;
  try {
    res = runChecks({ repo, strict, shards, applied: flag('--applied'), fmDiff });
  } catch (e) {
    console.error(`check 실행 실패: ${e && e.stack ? e.stack : e}`);
    process.exit(2);
  }
  const verbose = flag('--verbose');
  const byCode = new Map();
  for (const i of res.issues) {
    const k = `${i.code}/${i.level}`;
    (byCode.get(k) || byCode.set(k, []).get(k)).push(i);
  }
  const LIMIT = verbose ? Infinity : 8;
  for (const [k, list] of [...byCode].sort((a, b) => cmp(a[0], b[0]))) {
    for (const i of list.slice(0, LIMIT)) console.log(`${i.level === 'error' ? 'ERROR' : 'warn '} ${i.code} ${i.where}: ${i.msg}`);
    if (list.length > LIMIT) console.log(`      ... ${k} ${list.length - LIMIT}건 더 (--verbose 로 전부)`);
  }
  for (const [t, s] of Object.entries(res.nullRatios)) console.log(`null 비율 ${t}: ${s.nulls}/${s.total} (${(s.ratio * 100).toFixed(1)}%)`);
  const errors = res.issues.filter((i) => i.level === 'error').length;
  const warns = res.issues.length - errors;
  console.log(`check${strict ? ' --strict' : ''}${shards ? ` --shard(${shards.length})` : ''}: 오류 ${errors}, 경고 ${warns}`);
  process.exit(errors ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
