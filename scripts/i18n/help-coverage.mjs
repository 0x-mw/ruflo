#!/usr/bin/env node
// 도움말 적용률 점검기 (계획 §4.3 help-coverage, R-15).
//
//   node scripts/i18n/help-coverage.mjs --dist <cli 패키지>/dist [--emit-missing] [--json]
//
//  - 빌드된 dist 의 실제 Command 트리를 순회해 명령·옵션·예시 description 이 help 사전(샤드)에 있는지 센다.
//    (null 로 둔 키는 의도적 영문 유지라 제외, ko 가 빈 키는 '미번역'으로 센다)
//  - --emit-missing: 샤드에 없는 키를 i18n/ko/cli/help/_runtime.json 에 추가한다(ko 는 빈 문자열).
//  - 같은 순회에서 옵션의 choices·default 값과 하위 명령 이름을 i18n/ko/ident-tokens.json 으로 낸다.
//  - exit: 0 성공, 1 미적용이 있고 --strict 일 때, 2 환경 오류
//  - 실행은 테스트 HOME 으로: env -u RUFLO_LANG HOME=$TH CLAUDE_FLOW_AUTO_UPDATE=false RUFLO_DAEMON_AUTOSTART=0 node ...
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO } from './lib/ts-resolve.mjs';
import { keysFromText } from './lib/rules.mjs';
import { KO_DIR, cmp, stableJson, readJson, listJson, Writer, SHARD_SCHEMA } from './lib/shard-io.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const dist = opt('--dist');
if (!dist) {
  console.error('usage: help-coverage.mjs --dist <cli>/dist [--emit-missing] [--strict] [--json]');
  process.exit(2);
}
const distAbs = path.resolve(dist);
const entry = path.join(distAbs, 'src/commands/index.js');
if (!fs.existsSync(entry)) {
  console.error(`dist 에서 ${entry} 를 찾지 못했습니다. 먼저 CLI 를 빌드하세요.`);
  process.exit(2);
}

// 진입 모듈이 import 중 stdout 에 찍는 것을 막는다(보고 출력만 남기려고)
const realWrite = process.stdout.write.bind(process.stdout);
let mod;
try {
  process.stdout.write = () => true;
  mod = await import(pathToFileURL(entry).href);
} catch (e) {
  process.stdout.write = realWrite;
  console.error(`dist 를 불러오지 못했습니다: ${e && e.message}`);
  process.exit(2);
} finally {
  process.stdout.write = realWrite;
}
let commands;
try {
  commands = typeof mod.loadAllCommands === 'function' ? await mod.loadAllCommands() : mod.commands;
} catch (e) {
  console.error(`명령 트리를 적재하지 못했습니다: ${e && e.message}`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// 트리 순회
// ---------------------------------------------------------------------------
const descs = []; // {text, where}
const tokens = { choices: new Set(), defaults: new Set(), subcommands: new Set(), aliases: new Set(), options: new Set() };
let commandCount = 0;
let optionCount = 0;
let exampleCount = 0;
const seenCmd = new Set();

function walk(cmd, trail) {
  if (!cmd || typeof cmd !== 'object') return;
  const name = typeof cmd.name === 'string' ? cmd.name : '?';
  const pathStr = [...trail, name].join(' ');
  if (seenCmd.has(pathStr)) return;
  seenCmd.add(pathStr);
  commandCount++;
  if (trail.length) tokens.subcommands.add(name);
  else tokens.subcommands.add(name);
  for (const a of cmd.aliases || []) if (typeof a === 'string') tokens.aliases.add(a);
  if (typeof cmd.description === 'string') descs.push({ text: cmd.description, where: `${pathStr} (description)` });
  for (const o of cmd.options || []) {
    optionCount++;
    if (typeof o.description === 'string') descs.push({ text: o.description, where: `${pathStr} --${o.name}` });
    if (o.name) tokens.options.add(`--${o.name}`);
    if (o.short) tokens.options.add(`-${o.short}`);
    for (const c of o.choices || []) if (typeof c === 'string' || typeof c === 'number') tokens.choices.add(String(c));
    const d = o.default;
    if (typeof d === 'string' && d !== '') tokens.defaults.add(d);
    else if (typeof d === 'number') tokens.defaults.add(String(d));
  }
  for (const ex of cmd.examples || []) {
    exampleCount++;
    if (ex && typeof ex.description === 'string') descs.push({ text: ex.description, where: `${pathStr} (example)` });
  }
  for (const s of cmd.subcommands || []) walk(s, [...trail, name]);
}
for (const c of commands || []) walk(c, []);

// ---------------------------------------------------------------------------
// 사전(샤드) 조회 구조: CLI 런타임 단위 = help + messages
// ---------------------------------------------------------------------------
const unit = new Map(); // key → ko
for (const rel of [...listJson('cli/help'), ...listJson('cli/messages')]) {
  const j = readJson(path.join(KO_DIR, rel));
  if (!j || !Array.isArray(j.entries)) continue;
  for (const e of j.entries) if (!unit.has(e.key)) unit.set(e.key, e.ko);
}

const uniq = new Map(); // 텍스트 → where[]
for (const d of descs) {
  if (!uniq.has(d.text)) uniq.set(d.text, []);
  uniq.get(d.text).push(d.where);
}
let applicable = 0, applied = 0, excluded = 0, unappliedEmpty = 0, unappliedAbsent = 0, nullKeys = 0;
const absent = new Map(); // key → {kind, where}
for (const [text, wheres] of uniq) {
  const r = keysFromText(text, { scope: 'cli-help' });
  if (!r.keys.length) {
    excluded++;
    continue;
  }
  applicable++;
  let state = 'applied';
  for (const k of r.keys) {
    if (!unit.has(k.key)) {
      state = 'absent';
      if (!absent.has(k.key)) absent.set(k.key, { kind: k.kind, where: wheres[0] });
    } else {
      const ko = unit.get(k.key);
      if (ko === null) nullKeys++;
      else if (ko === '' && state !== 'absent') state = 'empty';
    }
  }
  if (state === 'applied') applied++;
  else if (state === 'empty') unappliedEmpty++;
  else unappliedAbsent++;
}
const unapplied = unappliedAbsent + unappliedEmpty;

// ---------------------------------------------------------------------------
// 산출물
// ---------------------------------------------------------------------------
const writer = new Writer();
const identTokens = {
  schema: 'ruflo-i18n-ident-tokens/1',
  tokens: [...new Set([...tokens.choices, ...tokens.defaults, ...tokens.subcommands, ...tokens.aliases])].filter((t) => t.length > 0).sort(cmp),
  sources: Object.fromEntries(Object.entries(tokens).map(([k, v]) => [k, [...v].sort(cmp)])),
};
writer.write('ident-tokens.json', stableJson(identTokens));

let emitted = 0;
if (flag('--emit-missing') && absent.size) {
  const rel = 'cli/help/_runtime.json';
  const cur = readJson(path.join(KO_DIR, rel)) || { schema: SHARD_SCHEMA, target: 'cli-help', source: 'runtime:help-coverage', entries: [], obsolete: [] };
  const have = new Set(cur.entries.map((e) => e.key));
  for (const [key, v] of [...absent].sort((a, b) => cmp(a[0], b[0]))) {
    if (have.has(key)) continue;
    cur.entries.push({ key, ko: '', kind: v.kind, ctx: [`runtime: ${v.where}`] });
    emitted++;
  }
  cur.entries.sort((a, b) => cmp(a.key, b.key));
  writer.write(rel, stableJson(cur));
}

const result = {
  dist: distAbs,
  commands: commandCount,
  options: optionCount,
  examples: exampleCount,
  descriptions: descs.length,
  uniqueDescriptions: uniq.size,
  applicable,
  excluded,
  applied,
  unapplied,
  unappliedAbsent,
  unappliedEmpty,
  nullKeys,
  emitted,
  identTokens: identTokens.tokens.length,
};
if (flag('--json')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log('== help-coverage ==');
  console.log(`명령 ${commandCount}개(하위 포함), 옵션 ${optionCount}개, 예시 ${exampleCount}개`);
  console.log(`description ${descs.length}개 (고유 ${uniq.size}개; 번역 대상 ${applicable}, 규칙상 제외 ${excluded})`);
  console.log(`적용됨 ${applied}, 미적용 ${unapplied} (사전에 없음 ${unappliedAbsent}, 미번역 ko="" ${unappliedEmpty}), null(의도적 영문) 키 ${nullKeys}`);
  if (absent.size) {
    console.log(`사전에 없는 키 ${absent.size}개${flag('--emit-missing') ? ` → _runtime 샤드에 ${emitted}개 추가` : ' (--emit-missing 으로 _runtime 샤드에 추가)'}`);
    for (const [k, v] of [...absent].slice(0, 10)) console.log(`  - ${JSON.stringify(k).slice(0, 100)}  @ ${v.where}`);
  }
  console.log(`ident-tokens.json: 토큰 ${identTokens.tokens.length}개 (choices ${tokens.choices.size}, defaults ${tokens.defaults.size}, 하위명령 ${tokens.subcommands.size}, 별칭 ${tokens.aliases.size})`);
}
if (flag('--strict') && unapplied > 0) process.exit(1);
void REPO;
