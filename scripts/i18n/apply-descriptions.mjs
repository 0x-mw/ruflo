#!/usr/bin/env node
// 머리말·manifest description 일괄 적용기 (계획 §4.5, B3).
//   node scripts/i18n/apply-descriptions.mjs [--dry-run] [--revert] [--repo <dir>] [--ko-dir <dir>] [--verbose]
//   node scripts/i18n/apply-descriptions.mjs --selftest
// 입력: <ko-dir>/descriptions/*.json  평평한 객체
//   { "<저장소 상대 md 경로 | marketplace:<이름|$root> | plugin:<이름>[#userConfig.<k>.<title|description>]>":
//       { en, ko, synth, style[, prevKo] } }
// 규칙:
//   - ko 가 null 또는 "" 이면 건드리지 않는다.
//   - 파일의 현재 값이 en 도 ko 도 아니면 STALE 로 보고하고 건너뛴다(끝 개행은 trimEnd 로 무시).
//   - md 는 lib/frontmatter.mjs, JSON 은 lib/json-scan.mjs 로 description 값만 바꾼다. 다른 바이트는 그대로.
//   - --revert: ko 로 바뀐 것을 en 으로 되돌린다. 머리말이 없던 명령(synth)은 추가한 머리말 블록을 지운다.
//   - baseline-yaml-errors.txt 에 적힌 파일은 건너뛴다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO as DEFAULT_REPO, findNodeModules, loadYaml } from './lib/ts-resolve.mjs';
import { cmp } from './lib/shard-io.mjs';
import { parseFrontmatter, frontmatterSource, readDescriptionValue, renderDescriptionLines, joinLines, addSynthFrontmatter } from './lib/frontmatter.mjs';
import { marketplaceTargets, pluginTargets, scanStrings, pathKey } from './lib/json-scan.mjs';

const MARKETPLACE_REL = '.claude-plugin/marketplace.json';
// md 키로 쓸 수 있는 경로(LOW-3): 이 밖의 경로는 파일을 건드리지 않고 오류로 보고한다.
const MD_KEY_ALLOWED = /^(?:v3\/@claude-flow\/cli\/\.claude\/.+|plugins\/[^/]+\/(?:commands|agents|skills)\/.+)\.md$/;
export const mdKeyAllowed = (key) => MD_KEY_ALLOWED.test(key) && !key.split('/').some((seg) => seg === '..' || seg === '.');

// extract.mjs 의 synthDescription 과 같다(머리말 없는 명령 md 의 첫 비어있지 않은 줄, # 제거, 200자).
function synthDescription(text) {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (const raw of body.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l) continue;
    let s = l.replace(/^#+\s*/, '').replace(/^[-*]\s+/, '').trim();
    if (!s) continue;
    if (s.length > 200) {
      s = s.slice(0, 200);
      const sp = s.lastIndexOf(' ');
      if (sp > 80) s = s.slice(0, sp);
    }
    return s;
  }
  return null;
}

const trimEnd = (s) => String(s).replace(/\s+$/, '');
const isStr = (v) => typeof v === 'string';

let yamlMod;
function yaml() {
  if (yamlMod === undefined) yamlMod = findNodeModules('yaml') ? loadYaml() : null;
  return yamlMod;
}

const asciiJson = (v) => JSON.stringify(v).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

/**
 * JSON 텍스트의 해당 경로 문자열 토큰만 바꾼다(json-scan.setStrings 와 같은 방식).
 * ascii=true 이면 비ASCII 를 \uXXXX 로 쓴다. marketplace.json 원본이 그렇게 쓰여 있어, 되돌릴 때 바이트를 맞추기 위함이다.
 */
function setJsonStrings(text, edits, ascii) {
  const toks = new Map(scanStrings(text).map((t) => [pathKey(t.path), t]));
  const plan = edits.map((e) => {
    const t = toks.get(pathKey(e.path));
    if (!t) throw new Error(`문자열 경로를 찾지 못했습니다: ${pathKey(e.path)}`);
    return { t, text: ascii ? asciiJson(e.value) : JSON.stringify(e.value) };
  });
  plan.sort((a, b) => b.t.start - a.t.start);
  let out = text;
  for (const p of plan) out = out.slice(0, p.t.start) + p.text + out.slice(p.t.end);
  JSON.parse(out.charCodeAt(0) === 0xfeff ? out.slice(1) : out);
  return out;
}

/** md 의 현재 description 값. 머리말이 없거나 description 이 없으면 null. */
function currentMdValue(text) {
  const fm = parseFrontmatter(text);
  if (!fm || fm.error || !fm.hasDesc) return null;
  const y = yaml();
  if (y) {
    try {
      const v = y.parse(frontmatterSource(fm)).description;
      if (typeof v === 'string') return trimEnd(v);
    } catch { /* 줄 기반 근사로 */ }
  }
  const v = readDescriptionValue(text);
  return v === null ? null : trimEnd(v);
}

/** description 한 값을 새로 쓴다. style 은 샤드의 원래 style 을 따른다(되돌릴 때 원본 바이트를 복원하기 위해). */
function rewriteDescription(text, value, style, exact = false) {
  const fm = parseFrontmatter(text);
  if (!fm || fm.error || !fm.hasDesc) return null;
  const st = style === 'synth' || style === 'json' ? 'plain' : style;
  // 접힌 블록(>)에서는 값의 개행이 빈 줄로 표현된다(한 줄 바꿈은 공백으로 접힌다).
  const folded = st === 'block' && (fm.indicator || '').startsWith('>');
  // 되돌림(exact): 원래 plain 이었던 값은 안전 판정과 관계없이 그대로 plain 으로 쓴다(원본이 plain 이었으므로 유효하다).
  const verbatim = exact && st === 'plain' && !/[\r\n]/.test(value) && value !== '' && value === value.trim();
  const fresh = verbatim ? [`description: ${value}`] : renderDescriptionLines(folded ? String(value).replace(/\n/g, '\n\n') : value, { style: st, indicator: fm.indicator || '|', indent: fm.indent });
  const eol = fm.lines[fm.descStart].eol || fm.eol;
  const repl = fresh.map((t) => ({ text: t, eol }));
  repl[repl.length - 1].eol = fm.lines[fm.descEnd - 1].eol || eol;
  const lines = [...fm.lines.slice(0, fm.descStart), ...repl, ...fm.lines.slice(fm.descEnd)];
  return fm.bom + joinLines(lines);
}

/** 추가했던 synth 머리말 블록(--- / description / --- / 빈 줄)을 지운다. 모양이 다르면 null. */
function removeSynthHeader(text) {
  const bom = text.charCodeAt(0) === 0xfeff ? '﻿' : '';
  const body = bom ? text.slice(1) : text;
  const fm = parseFrontmatter(body);
  if (!fm || fm.error || !fm.hasDesc || fm.descStart !== 1 || fm.descEnd !== 2 || fm.endLine !== 2) return null;
  const blank = fm.lines[3];
  const cut = blank && blank.text === '' && blank.eol !== '' ? 4 : 3;
  return bom + joinLines(fm.lines.slice(cut));
}

function loadEntries(koDir) {
  const dir = path.join(koDir, 'descriptions');
  const entries = [];
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort(cmp);
  } catch { /* 없음 */ }
  for (const n of names) {
    const doc = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'));
    for (const [key, v] of Object.entries(doc)) if (v && typeof v === 'object') entries.push({ key, v, shard: n });
  }
  return entries;
}

const pjRelCache = new Map();
function pluginJsonRelFor(repo, name) {
  const ck = `${repo}\0${name}`;
  if (!pjRelCache.has(ck)) pjRelCache.set(ck, pluginJsonRelForUncached(repo, name));
  return pjRelCache.get(ck);
}
function pluginJsonRelForUncached(repo, name) {
  const direct = `plugins/${name}/.claude-plugin/plugin.json`;
  if (fs.existsSync(path.join(repo, direct))) return direct;
  let dirs = [];
  try {
    dirs = fs.readdirSync(path.join(repo, 'plugins')).sort(cmp);
  } catch { /* 없음 */ }
  for (const d of dirs) {
    const rel = `plugins/${d}/.claude-plugin/plugin.json`;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(repo, rel), 'utf8').replace(/^﻿/, ''));
      if (j && j.name === name) return rel;
    } catch { /* 다음 */ }
  }
  return null;
}

/**
 * 적용 또는 되돌림. 반환: { stats, changes[], stale[], errors[], skippedBaseline[], writes }
 * opts: { repo, koDir, dryRun, revert }
 */
export function run(opts) {
  const repo = opts.repo || DEFAULT_REPO;
  const koDir = opts.koDir || path.join(repo, 'i18n/ko');
  const revert = !!opts.revert;
  const entries = loadEntries(koDir);
  let baseline = new Set();
  try {
    baseline = new Set(fs.readFileSync(path.join(koDir, 'baseline-yaml-errors.txt'), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
  } catch { /* 없음 */ }

  const res = { stats: { entries: entries.length, untranslated: 0, baselineSkipped: 0, changed: 0, already: 0, stale: 0, error: 0 }, changes: [], stale: [], errors: [], skippedBaseline: [], writes: 0 };
  const jsonEdits = new Map(); // rel → [{ path, value, key }]
  const jsonCache = new Map(); // rel → text

  const readFile = (rel) => fs.readFileSync(path.join(repo, rel), 'utf8');
  const note = (key, from, to) => {
    res.stats.changed++;
    res.changes.push({ key, from, to });
  };
  const mark = (kind, key, msg) => {
    if (kind === 'stale') {
      res.stats.stale++;
      res.stale.push({ key, msg });
    } else {
      res.stats.error++;
      res.errors.push({ key, msg });
    }
  };

  for (const { key, v } of entries) {
    if (!isStr(v.ko) || v.ko === '') {
      res.stats.untranslated++;
      continue;
    }
    if (!isStr(v.en)) {
      mark('error', key, 'en 이 문자열이 아닙니다');
      continue;
    }
    if (baseline.has(key)) {
      res.stats.baselineSkipped++;
      res.skippedBaseline.push(key);
      continue;
    }
    const from = revert ? v.ko : v.en;
    const to = revert ? v.en : v.ko;
    try {
      if (/^marketplace:/.test(key) || /^plugin:/.test(key)) {
        const isMk = key.startsWith('marketplace:');
        const pname = isMk ? '' : key.slice('plugin:'.length).split('#')[0];
        const rel = isMk ? MARKETPLACE_REL : pluginJsonRelFor(repo, pname);
        if (!rel) {
          mark('error', key, 'plugin.json 을 찾지 못했습니다');
          continue;
        }
        if (!jsonCache.has(rel)) jsonCache.set(rel, readFile(rel));
        const text = jsonCache.get(rel);
        const target = (isMk ? marketplaceTargets(text) : pluginTargets(text, pname)).get(key);
        if (!target) {
          mark('stale', key, '파일에서 이 키의 위치를 찾지 못했습니다');
          continue;
        }
        if (target.value === to) res.stats.already++;
        else if (target.value === from) {
          note(key, from, to);
          if (!jsonEdits.has(rel)) jsonEdits.set(rel, []);
          jsonEdits.get(rel).push({ path: target.path, value: to, key });
        } else mark('stale', key, `현재 값이 en 도 ko 도 아닙니다: ${JSON.stringify(target.value).slice(0, 80)}`);
        continue;
      }

      // md
      if (!mdKeyAllowed(key)) {
        mark('error', key, '허용 경로 밖의 md 키입니다(v3/@claude-flow/cli/.claude/** 또는 plugins/*/{commands,agents,skills}/** 만 가능)');
        continue;
      }
      if (v.synth && trimEnd(v.ko) === trimEnd(v.en)) {
        res.stats.already++; // ko 가 en 과 같으면 머리말을 추가할 이유가 없다(LOW-2)
        continue;
      }
      const text = readFile(key);
      const fm = parseFrontmatter(text);
      if (fm && fm.error) {
        mark('stale', key, `머리말 오류: ${fm.error}`);
        continue;
      }
      if (v.synth) {
        if (!revert) {
          if (fm === null) {
            const s = synthDescription(text);
            if (s !== null && trimEnd(s) === trimEnd(v.en)) {
              note(key, '(머리말 없음)', v.ko);
              if (!opts.dryRun) {
                fs.writeFileSync(path.join(repo, key), addSynthFrontmatter(text, v.ko));
                res.writes++;
              }
            } else mark('stale', key, `머리말 없는 명령의 첫 줄이 en 과 다릅니다: ${JSON.stringify(s).slice(0, 80)}`);
          } else if (fm.hasDesc && currentMdValue(text) === trimEnd(v.ko)) res.stats.already++;
          else mark('stale', key, '머리말이 이미 있는데 ko 가 아닙니다');
        } else if (fm === null) res.stats.already++;
        else if (fm.hasDesc && currentMdValue(text) === trimEnd(v.ko)) {
          const out = removeSynthHeader(text);
          if (out === null) mark('stale', key, '추가한 머리말 모양이 아니라 지울 수 없습니다');
          else {
            note(key, v.ko, '(머리말 제거)');
            if (!opts.dryRun) {
              fs.writeFileSync(path.join(repo, key), out);
              res.writes++;
            }
          }
        } else mark('stale', key, '머리말이 ko 가 아닙니다');
        continue;
      }
      const cur = currentMdValue(text);
      if (cur === null) {
        mark('stale', key, '머리말 description 을 읽지 못했습니다');
        continue;
      }
      if (cur === trimEnd(to)) res.stats.already++;
      else if (cur === trimEnd(from)) {
        const out = rewriteDescription(text, to, v.style || 'plain', revert);
        if (out === null) {
          mark('error', key, 'description 을 다시 쓰지 못했습니다');
          continue;
        }
        note(key, from, to);
        if (!opts.dryRun) {
          fs.writeFileSync(path.join(repo, key), out);
          res.writes++;
        }
      } else mark('stale', key, `현재 값이 en 도 ko 도 아닙니다: ${JSON.stringify(cur).slice(0, 80)}`);
    } catch (e) {
      mark('error', key, String(e && e.message ? e.message : e));
    }
  }

  for (const [rel, edits] of jsonEdits) {
    try {
      const out = setJsonStrings(jsonCache.get(rel), edits, rel === MARKETPLACE_REL && revert);
      if (!opts.dryRun) {
        fs.writeFileSync(path.join(repo, rel), out);
        res.writes++;
      }
    } catch (e) {
      for (const ed of edits) {
        res.stats.changed--;
        res.changes = res.changes.filter((c) => c.key !== ed.key);
        mark('error', ed.key, String(e && e.message ? e.message : e));
      }
    }
  }
  return res;
}

function report(res, opts) {
  const mode = opts.revert ? 'revert' : 'apply';
  const s = res.stats;
  const say = (m) => process.stdout.write(m + '\n');
  say(`[apply-descriptions] mode=${mode}${opts.dryRun ? ' (dry-run)' : ''}`);
  for (const c of res.changes) say(`  ${opts.dryRun ? 'WOULD ' : ''}CHANGE ${c.key}${opts.verbose ? `\n    ${JSON.stringify(c.from).slice(0, 100)}\n -> ${JSON.stringify(c.to).slice(0, 100)}` : ''}`);
  for (const c of res.stale) say(`  STALE  ${c.key}: ${c.msg}`);
  for (const c of res.errors) say(`  ERROR  ${c.key}: ${c.msg}`);
  for (const k of res.skippedBaseline) say(`  SKIP   ${k} (baseline-yaml-errors)`);
  say(`entries=${s.entries} 변경=${s.changed} 이미적용=${s.already} STALE=${s.stale} 번역없음(건너뜀)=${s.untranslated} 기준선예외=${s.baselineSkipped} 오류=${s.error}${opts.dryRun ? '' : ` 쓴파일=${res.writes}`}`);
}

// ---------------------------------------------------------------------------
// --selftest
// ---------------------------------------------------------------------------

function selftest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-desc-'));
  let failed = 0;
  const ok = (name, cond, extra = '') => {
    process.stdout.write(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ' ' + extra}\n`);
    if (!cond) failed++;
  };
  const w = (rel, text) => {
    const p = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  };
  const rd = (rel) => fs.readFileSync(path.join(tmp, rel), 'utf8');

  const files = {
    'plugins/q/commands/plain.md': '---\nname: plain\ndescription: Hello world agent\ntools: Read\n---\n\n# Body\ntext\n',
    'plugins/q/commands/double.md': '---\r\nname: dbl\r\ndescription: "Say \\"hi\\" now"\r\n---\r\nBody\r\n',
    'plugins/q/commands/single.md': "---\nname: sng\ndescription: 'It''s fine'\n---\nBody\n",
    'plugins/q/commands/block.md': '---\nname: blk\ndescription: |\n  Line one\n  Line two\nallowed-tools: Read\n---\n\nBody\n',
    'plugins/q/commands/cmd.md': '# Swarm Init\n\nInitialize things.\n',
    'plugins/q/commands/cmd-crlf.md': '﻿# Deploy\r\n\r\nDeploy it.\r\n',
    'plugins/q/commands/stale.md': '---\ndescription: Changed upstream\n---\nx\n',
    'plugins/q/commands/skip.md': '---\ndescription: [broken\n---\nx\n',
  };
  for (const [rel, t] of Object.entries(files)) w(rel, t);
  const mk = JSON.stringify({ name: 'mk', description: 'Root desc', plugins: [{ name: 'p1', description: 'Plugin one' }, { name: 'p2', description: 'Plugin two', x: 1 }] }, null, 2) + '\r\n';
  w('.claude-plugin/marketplace.json', mk);
  const pj = '{\n    "name": "p1",\n  "description": "Plugin one",\n  "userConfig": { "g": { "title": "Guard", "description": "Guard desc", "type": "boolean" } },\n  "version": "1.0.0"\n}\n';
  w('plugins/p1/.claude-plugin/plugin.json', pj);
  const E = (en, ko, style, synth = false) => ({ en, ko, synth, style });
  const shard = {
    'plugins/q/commands/plain.md': E('Hello world agent', '안녕 세계: 에이전트', 'plain'),
    'plugins/q/commands/double.md': E('Say "hi" now', '"안녕"이라고 말해', 'double'),
    'plugins/q/commands/single.md': E("It's fine", "괜찮아요 '따옴표'", 'single'),
    'plugins/q/commands/block.md': E('Line one\nLine two', '첫째 줄\n둘째 줄', 'block'),
    'plugins/q/commands/cmd.md': E('Swarm Init', '스웜 초기화', 'synth', true),
    'plugins/q/commands/cmd-crlf.md': E('Deploy', '배포', 'synth', true),
    'plugins/q/commands/stale.md': E('Original en', '원본 번역', 'plain'),
    'plugins/q/commands/skip.md': E('x', '엑스', 'plain'),
    'plugins/q/commands/empty.md': E('x', '', 'plain'),
    'marketplace:$root': E('Root desc', '루트 설명', 'json'),
    'marketplace:p1': E('Plugin one', '플러그인 하나', 'json'),
    'marketplace:p2': E('Plugin two', '플러그인 둘', 'json'),
    'plugin:p1': E('Plugin one', '플러그인 하나', 'json'),
    'plugin:p1#userConfig.g.title': E('Guard', '가드', 'json'),
    'plugin:p1#userConfig.g.description': E('Guard desc', '가드 설명', 'json'),
  };
  w('i18n/ko/descriptions/t.json', JSON.stringify(shard, null, 2));
  w('i18n/ko/baseline-yaml-errors.txt', 'plugins/q/commands/skip.md\n');
  const snap = () => Object.fromEntries([...Object.keys(files), '.claude-plugin/marketplace.json', 'plugins/p1/.claude-plugin/plugin.json'].map((r) => [r, rd(r)]));
  const orig = snap();
  const base = { repo: tmp, koDir: path.join(tmp, 'i18n/ko') };

  let r = run({ ...base, dryRun: true });
  ok('dry-run 은 파일을 바꾸지 않는다', JSON.stringify(snap()) === JSON.stringify(orig));
  ok('dry-run 변경 12(md 6 + json 6), STALE 1, 기준선 1, 번역없음 1', r.stats.changed === 12 && r.stats.stale === 1 && r.stats.baselineSkipped === 1 && r.stats.untranslated === 1, JSON.stringify(r.stats));
  r = run({ ...base, revert: true, dryRun: true });
  ok('revert dry-run: 적용 전이므로 변경 0', r.stats.changed === 0, JSON.stringify(r.stats));

  r = run({ ...base });
  const cur = snap();
  ok('적용: 쓴 파일 수 8(md 6 + json 2)', r.writes === 8, String(r.writes));
  ok('plain 에 ": " 가 든 ko 는 큰따옴표로', /^description: "안녕 세계: 에이전트"$/m.test(cur['plugins/q/commands/plain.md']));
  ok('plain 머리말의 다른 줄은 불변', cur['plugins/q/commands/plain.md'].replace(/^description:.*\n/m, '') === orig['plugins/q/commands/plain.md'].replace(/^description:.*\n/m, ''));
  ok('CRLF 유지', cur['plugins/q/commands/double.md'].includes('\r\n') && !/[^\r]\n/.test(cur['plugins/q/commands/double.md']));
  ok('블록 스칼라 유지', /^description: \|\n {2}첫째 줄\n {2}둘째 줄\nallowed-tools: Read$/m.test(cur['plugins/q/commands/block.md']));
  ok('synth 머리말 추가', cur['plugins/q/commands/cmd.md'] === '---\ndescription: 스웜 초기화\n---\n\n# Swarm Init\n\nInitialize things.\n');
  ok('synth BOM·CRLF 유지', cur['plugins/q/commands/cmd-crlf.md'] === '﻿---\r\ndescription: 배포\r\n---\r\n\r\n# Deploy\r\n\r\nDeploy it.\r\n', JSON.stringify(cur['plugins/q/commands/cmd-crlf.md']));
  ok('STALE 파일 불변', cur['plugins/q/commands/stale.md'] === orig['plugins/q/commands/stale.md']);
  ok('기준선 파일 불변', cur['plugins/q/commands/skip.md'] === orig['plugins/q/commands/skip.md']);
  const mkObj = JSON.parse(cur['.claude-plugin/marketplace.json']);
  ok('marketplace 값 변경, 다른 키·CRLF 끝 보존', mkObj.description === '루트 설명' && mkObj.plugins[1].description === '플러그인 둘' && mkObj.plugins[1].x === 1 && cur['.claude-plugin/marketplace.json'].endsWith('}\r\n'));
  const pjObj = JSON.parse(cur['plugins/p1/.claude-plugin/plugin.json']);
  ok('plugin.json userConfig 변경, 들여쓰기 보존', pjObj.description === '플러그인 하나' && pjObj.userConfig.g.title === '가드' && pjObj.userConfig.g.type === 'boolean' && cur['plugins/p1/.claude-plugin/plugin.json'].includes('"name": "p1",\n  "description"'));

  r = run({ ...base });
  ok('재적용은 변경 0, 이미적용 12', r.stats.changed === 0 && r.stats.already === 12, JSON.stringify(r.stats));
  r = run({ ...base, revert: true, dryRun: true });
  ok('revert dry-run 변경 12', r.stats.changed === 12, JSON.stringify(r.stats));
  r = run({ ...base, revert: true });
  const back = snap();
  for (const k of Object.keys(orig)) ok(`왕복 바이트 동일: ${k}`, back[k] === orig[k], JSON.stringify(back[k]).slice(0, 120));
  r = run({ ...base, revert: true });
  ok('재되돌림은 변경 0', r.stats.changed === 0, JSON.stringify(r.stats));

  // --- 실제 저장소 파일 왕복(임시 복사본에서) ---
  const realEntries = loadEntries(path.join(DEFAULT_REPO, 'i18n/ko'));
  if (realEntries.length) {
    const rt = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-desc-real-'));
    const copied = new Set();
    const copy = (rel) => {
      if (copied.has(rel)) return;
      copied.add(rel);
      const src = path.join(DEFAULT_REPO, rel);
      if (!fs.existsSync(src)) return;
      fs.mkdirSync(path.dirname(path.join(rt, rel)), { recursive: true });
      fs.copyFileSync(src, path.join(rt, rel));
    };
    const fake = {};
    realEntries.forEach(({ key, v }, i) => {
      if (/^marketplace:/.test(key)) copy(MARKETPLACE_REL);
      else if (/^plugin:/.test(key)) {
        const rel = pluginJsonRelFor(DEFAULT_REPO, key.slice('plugin:'.length).split('#')[0]);
        if (rel) copy(rel);
      } else copy(key);
      const en = trimEnd(v.en);
      const ko = i % 3 === 0 ? `번역: ${en}` : i % 3 === 1 ? `번역 ${en}` : `"번역" # ${en}`;
      fake[key] = { ...v, ko };
    });
    w2(rt, 'i18n/ko/descriptions/all.json', JSON.stringify(fake));
    try {
      fs.copyFileSync(path.join(DEFAULT_REPO, 'i18n/ko/baseline-yaml-errors.txt'), path.join(rt, 'i18n/ko/baseline-yaml-errors.txt'));
    } catch { /* 없음 */ }
    const before = new Map([...copied].filter((r2) => fs.existsSync(path.join(rt, r2))).map((r2) => [r2, fs.readFileSync(path.join(rt, r2), 'utf8')]));
    const o = { repo: rt, koDir: path.join(rt, 'i18n/ko') };
    const a = run(o);
    ok(`실제 파일 적용(${a.stats.changed}건) 오류·STALE 0`, a.stats.error === 0 && a.stats.stale === 0, JSON.stringify(a.stats) + JSON.stringify(a.stale.slice(0, 3)) + JSON.stringify(a.errors.slice(0, 3)));
    let badYaml = 0;
    const y = yaml();
    if (y) {
      for (const [key, v] of Object.entries(fake)) {
        if (/^(marketplace|plugin):/.test(key) || a.skippedBaseline.includes(key)) continue;
        const t = fs.readFileSync(path.join(rt, key), 'utf8');
        const fm = parseFrontmatter(t);
        let val = null;
        try {
          val = fm && !fm.error ? y.parse(frontmatterSource(fm)).description : null;
        } catch { /* 깨짐 */ }
        if (typeof val !== 'string' || trimEnd(val) !== trimEnd(v.ko)) badYaml++;
      }
    }
    ok(`적용 뒤 YAML 파싱 값 == ko${y ? '' : '(yaml 모듈 없어 건너뜀)'}`, badYaml === 0, `${badYaml}건`);
    const b = run({ ...o, revert: true });
    ok(`실제 파일 되돌림(${b.stats.changed}건) 오류·STALE 0`, b.stats.error === 0 && b.stats.stale === 0, JSON.stringify(b.stats) + JSON.stringify(b.stale.slice(0, 3)));
    const diffNames = [];
    for (const [rel, t] of before) {
      const now = fs.readFileSync(path.join(rt, rel), 'utf8');
      if (now === t) continue;
      diffNames.push(rel);
      if (process.env.APPLY_DEBUG) {
        const a1 = t.split('\n');
        const b1 = now.split('\n');
        const i = a1.findIndex((l, n) => l !== b1[n]);
        process.stdout.write(`  DIFF ${rel}:${i + 1}\n   원본 ${JSON.stringify(a1[i]).slice(0, 160)}\n   복원 ${JSON.stringify(b1[i]).slice(0, 160)}\n`);
      }
    }
    // 원본 줄 바꿈(접힌 블록·여러 줄 plain)이나 값 뒤 YAML 주석(` #...`)은 파싱된 값에 남지 않아 되돌릴 때 복원할 수 없다.
    // 값(YAML 해석)은 같다. 알려진 파일만 허용하고 새로 생기면 실패한다.
    const KNOWN = new Set([
      'v3/@claude-flow/cli/.claude/agents/templates/base-template-generator.md',
      'plugins/ruflo-bbs-federation/skills/cross-host-federation/SKILL.md',
      'plugins/ruflo-metaharness/skills/harness-security-bench/SKILL.md',
    ]);
    const unexpected = diffNames.filter((n) => !KNOWN.has(n));
    ok(`실제 파일 ${before.size}개 왕복 바이트 동일(알려진 예외 ${diffNames.length - unexpected.length}개: 줄 바꿈·값 뒤 주석 복원 불가)`, unexpected.length === 0, `${unexpected.length}개 다름: ${unexpected.slice(0, 8).join(', ')}`);
    let valueDiff = 0;
    if (y) {
      for (const n of diffNames) {
        const A = parseFrontmatter(before.get(n));
        const B = parseFrontmatter(fs.readFileSync(path.join(rt, n), 'utf8'));
        const va = y.parse(frontmatterSource(A)).description;
        const vb = y.parse(frontmatterSource(B)).description;
        if (trimEnd(va) !== trimEnd(vb)) valueDiff++;
      }
    }
    ok('알려진 예외 파일도 YAML 해석 값은 원본과 같다', valueDiff === 0, `${valueDiff}개`);
    fs.rmSync(rt, { recursive: true, force: true });
  } else process.stdout.write('SKIP 실제 파일 왕복(샤드가 비어 있음)\n');

  // LOW-2·LOW-3: ko === en 인 synth 는 머리말을 추가하지 않고, 허용 경로 밖의 md 키는 거부한다
  {
    const t2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ko-apply-low-'));
    const w2 = (rel, text) => {
      const p2 = path.join(t2, rel);
      fs.mkdirSync(path.dirname(p2), { recursive: true });
      fs.writeFileSync(p2, text);
    };
    w2('plugins/q/commands/same.md', '# Same\n\nbody\n');
    w2('outside/x.md', '---\ndescription: Hello there\n---\nB\n');
    w2('i18n/ko/descriptions/t.json', JSON.stringify({
      'plugins/q/commands/same.md': { en: 'Same', ko: 'Same', synth: true, style: 'synth' },
      'outside/x.md': { en: 'Hello there', ko: '안녕 거기', synth: false, style: 'plain' },
    }));
    const r2 = run({ repo: t2, koDir: path.join(t2, 'i18n/ko'), dryRun: false });
    ok('ko === en 인 synth 는 머리말을 추가하지 않는다', fs.readFileSync(path.join(t2, 'plugins/q/commands/same.md'), 'utf8') === '# Same\n\nbody\n' && r2.stats.changed === 0, JSON.stringify(r2.stats));
    ok('허용 경로 밖 md 키는 거부(파일 불변)', r2.stats.error === 1 && fs.readFileSync(path.join(t2, 'outside/x.md'), 'utf8').includes('Hello there'), JSON.stringify(r2.stats));
    ok('mdKeyAllowed 목록', mdKeyAllowed('plugins/a/skills/b/SKILL.md') && mdKeyAllowed('v3/@claude-flow/cli/.claude/agents/x.md') && !mdKeyAllowed('plugins/a/README.md') && !mdKeyAllowed('../x/commands/a.md') && !mdKeyAllowed('plugins/a/commands/../../x.md'));
    fs.rmSync(t2, { recursive: true, force: true });
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  process.stdout.write(failed ? `selftest 실패 ${failed}건\n` : 'selftest 통과\n');
  return failed ? 1 : 0;
}

function w2(root, rel, text) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}

// ---------------------------------------------------------------------------

function main(argv) {
  const opts = { dryRun: false, revert: false, verbose: false, repo: null, koDir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--revert') opts.revert = true;
    else if (a === '--verbose') opts.verbose = true;
    else if (a === '--selftest') return selftest();
    else if (a === '--repo') opts.repo = path.resolve(argv[++i] || '');
    else if (a === '--ko-dir') opts.koDir = path.resolve(argv[++i] || '');
    else if (a === '-h' || a === '--help') {
      process.stdout.write('usage: apply-descriptions.mjs [--dry-run] [--revert] [--verbose] [--repo <dir>] [--ko-dir <dir>] | --selftest\n');
      return 0;
    } else {
      process.stderr.write(`알 수 없는 옵션: ${a}\n`);
      return 2;
    }
  }
  const res = run(opts);
  report(res, opts);
  return res.stats.error ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
