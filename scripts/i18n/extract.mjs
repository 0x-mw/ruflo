#!/usr/bin/env node
// 번역 대상 문구 추출기 (계획 §2.5, §4.3). TypeScript 구문 분석으로 원문을 뽑아 i18n/ko 샤드를 만든다.
//
//   node scripts/i18n/extract.mjs [--target cli-help|cli-messages|plugins|descriptions|all]
//                                 [--report] [--check] [--plan-batches N]
//
//  - 기본 동작: 샤드를 만들거나 갱신한다(i18n/ko 아래에만 쓴다). 기존 ko 값은 키 기준으로 보존하고,
//    사라진 키는 obsolete 로 옮긴다. 같은 입력이면 같은 바이트를 낸다.
//  - --report: 대상별 키 수·번역 수·null 수·null 비율·누락 수·약한 템플릿 수, structuralEnglish,
//    설계 대비 실제 수를 출력한다.
//  - --check: 쓰지 않고 디스크의 샤드가 최신인지만 본다(새 키가 있으면 exit 1). F1 절차 1단계용.
//  - --plan-batches N: 번역 배치(배치당 400~600 항목, 서로 다른 샤드)를 JSON 으로 출력한다.
//  - exit: 0 성공, 1 --check 불일치 또는 새 YAML 오류, 2 환경(typescript/yaml 없음)
import fs from 'node:fs';
import path from 'node:path';
import { loadTs, loadYaml, REPO } from './lib/ts-resolve.mjs';
import { PH, keysFromText, hasHangul, isLowerToken } from './lib/rules.mjs';
import {
  KO_DIR, cmp, stableJson, readJson, listJson, koMapOf, makeShard, chunkEntries, slugOf, Writer, MAX_SHARD,
} from './lib/shard-io.mjs';

const ts = loadTs();
const YAML = loadYaml();

const CLI = 'v3/@claude-flow/cli';
const NINE = ['init', 'start', 'status', 'doctor', 'agent', 'swarm', 'memory', 'task', 'session'];
const ROOT_ACTION_ONLY = ['mcp', 'hooks'];

// ---------------------------------------------------------------------------
// 인자
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const TARGET = opt('--target') || 'all';
const REPORT = flag('--report');
const CHECK = flag('--check');
const PLAN = opt('--plan-batches');
const REBASELINE = flag('--rebaseline');
if (!['all', 'cli-help', 'cli-messages', 'plugins', 'descriptions'].includes(TARGET)) {
  console.error(`알 수 없는 --target: ${TARGET}`);
  process.exit(2);
}
const want = (t) => TARGET === 'all' || TARGET === t || (TARGET.startsWith('cli-') && t === 'cli-unit');

// ---------------------------------------------------------------------------
// 파일·AST 도우미
// ---------------------------------------------------------------------------
const abs = (rel) => path.join(REPO, rel);
const exists = (rel) => fs.existsSync(abs(rel));

function listFiles(relDir, pred) {
  const out = [];
  const walk = (r) => {
    let ents;
    try {
      ents = fs.readdirSync(abs(r), { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of ents) {
      const p = `${r}/${d.name}`;
      if (d.isDirectory()) {
        if (d.name === 'node_modules' || d.name === 'dist') continue;
        walk(p);
      } else if (pred(p)) out.push(p);
    }
  };
  walk(relDir);
  return out.sort(cmp);
}

const sfCache = new Map();
function parse(rel) {
  if (sfCache.has(rel)) return sfCache.get(rel);
  const text = fs.readFileSync(abs(rel), 'utf8');
  const kind = rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, kind);
  sfCache.set(rel, sf);
  return sf;
}
const lineOf = (sf, node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
const K = () => ts.SyntaxKind;

function walkTree(node, fn) {
  if (fn(node) === false) return;
  ts.forEachChild(node, (c) => walkTree(c, fn));
}

function propNameOf(p) {
  const n = p.name;
  if (!n) return undefined;
  if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  return undefined;
}

function calleeInfo(call) {
  const c = call.expression;
  if (ts.isIdentifier(c)) return { name: c.text, recv: undefined };
  if (ts.isPropertyAccessExpression(c)) return { name: c.name.text, recv: c.expression };
  return { name: undefined, recv: undefined };
}

// ---------------------------------------------------------------------------
// 문자열 → 대안 목록(자리표시는 PH)
// ---------------------------------------------------------------------------
const MAX_ALTS = 16;
const uniq = (a) => [...new Set(a)];

function cross(a, b) {
  if (a.length * b.length > MAX_ALTS) b = [PH];
  const out = [];
  for (const x of a) for (const y of b) out.push(x + y);
  return uniq(out).slice(0, MAX_ALTS);
}

/** 파일 단위 환경: const 로 선언된 정적 문자열 추적, 소비된 노드 기록. imports=true 는 cli-messages 전용 확장(G1). */
function makeEnv(sf, { imports = false } = {}) {
  const consts = new Map();
  const pushCalls = new Map(); // 배열 이름 → push 호출들(확장 전용; 선언 범위는 declOf 로 가른다)
  const importMap = new Map(); // 지역 이름 → {rel, name} (상대 경로 named import)
  walkTree(sf, (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      const init = n.initializer;
      if (
        ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init) || ts.isTemplateExpression(init) ||
        ts.isConditionalExpression(init) || ts.isArrayLiteralExpression(init) ||
        (ts.isBinaryExpression(init) && init.operatorToken.kind === ts.SyntaxKind.PlusToken)
      ) {
        const arr = consts.get(n.name.text) || [];
        arr.push(init);
        consts.set(n.name.text, arr);
      }
    }
  });
  if (imports) {
    walkTree(sf, (n) => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'push' && ts.isIdentifier(n.expression.expression)) {
        const k = n.expression.expression.text;
        const arr = pushCalls.get(k) || [];
        arr.push(n);
        pushCalls.set(k, arr);
      }
      if (ts.isImportDeclaration(n) && !n.importClause?.isTypeOnly && ts.isStringLiteral(n.moduleSpecifier)) {
        const nb = n.importClause?.namedBindings;
        const rel = nb && ts.isNamedImports(nb) ? resolveImport(sf.fileName, n.moduleSpecifier.text) : null;
        if (rel) for (const e of nb.elements) if (!e.isTypeOnly) importMap.set(e.name.text, { rel, name: (e.propertyName || e.name).text });
      }
    });
  }
  return { sf, consts, pushCalls, importMap, ext: imports, consumed: new Set() };
}

/** 바인딩 이름(식별자·구조 분해)이 name 을 선언하는가 → 그 선언 노드(없으면 null) */
function bindingDecl(nameNode, name, decl) {
  if (ts.isIdentifier(nameNode)) return nameNode.text === name ? decl : null;
  if (ts.isObjectBindingPattern(nameNode) || ts.isArrayBindingPattern(nameNode)) {
    for (const e of nameNode.elements) {
      if (ts.isOmittedExpression(e)) continue;
      if (bindingDecl(e.name, name, e)) return e; // 구조 분해 요소: 배열 리터럴 초기값이 아니므로 호출 쪽에서 거른다
    }
  }
  return null;
}

/** 식별자 id 가 가리키는 가장 가까운 선언(변수 선언·구조 분해 요소·매개변수). 없으면 null. */
function declOf(id) {
  const name = id.text;
  for (let a = id.parent; a; a = a.parent) {
    let stmts = null;
    if (ts.isBlock(a) || ts.isSourceFile(a) || ts.isModuleBlock(a)) stmts = a.statements;
    else if (ts.isCaseClause(a) || ts.isDefaultClause(a)) stmts = a.statements;
    if (stmts) {
      for (const st of stmts) {
        if (!ts.isVariableStatement(st)) continue;
        for (const d of st.declarationList.declarations) {
          const r = bindingDecl(d.name, name, d);
          if (r) return r;
        }
      }
    }
    if (ts.isFunctionLike(a) && a.parameters) {
      for (const pm of a.parameters) {
        const r = bindingDecl(pm.name, name, pm);
        if (r) return r;
      }
    }
    if ((ts.isForOfStatement(a) || ts.isForInStatement(a) || ts.isForStatement(a)) && a.initializer && ts.isVariableDeclarationList(a.initializer)) {
      for (const d of a.initializer.declarations) {
        const r = bindingDecl(d.name, name, d);
        if (r) return r;
      }
    }
    if (ts.isCatchClause(a) && a.variableDeclaration) {
      const r = bindingDecl(a.variableDeclaration.name, name, a.variableDeclaration);
      if (r) return r;
    }
  }
  return null;
}

/** 상대 import 한 모듈 최상위 `export const NAME = …` 의 초기값을 그 모듈의 env 로 해석(1단계만). */
function importedAlts(node, env, depth) {
  const imp = env.importMap && env.importMap.get(node.text);
  if (!imp || declOf(node)) return null; // 지역 매개변수·구조 분해가 가린 이름은 import 가 아니다
  let init = null;
  const sf2 = parse(imp.rel);
  for (const st of sf2.statements) {
    if (!ts.isVariableStatement(st) || !st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === imp.name && d.initializer) init = d.initializer;
  }
  if (!init) return null;
  return altsOf(init, makeEnv(sf2), depth + 1, true);
}

const stripWrap = (n) => {
  while (n && (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n) || (ts.isSatisfiesExpression && ts.isSatisfiesExpression(n)))) n = n.expression;
  return n;
};

/**
 * 배열 식의 원소 노드들(spread·빈 칸도 동적 원소로 남긴다). 해석 못 하면 null.
 * 확장(env.ext): filter/slice 체인, NonNull·satisfies 벗기기, 같은 선언 범위의 push 인자. 결과의 hasPush 는 push 원소가 있다는 표시.
 * 확장 아님: HEAD 동작 그대로(join 은 벗기기 없음, elementAlts 는 괄호·as 만 벗김, 첫 const 배열).
 */
function arrayElements(node, env, { strip = false, depth = 0 } = {}) {
  if (!node || depth > 6) return null;
  if (!env.ext) {
    let arr = node;
    if (strip) while (ts.isParenthesizedExpression(arr) || ts.isAsExpression(arr)) arr = arr.expression;
    if (ts.isIdentifier(arr) && env.consts.has(arr.text)) arr = env.consts.get(arr.text).find((i) => ts.isArrayLiteralExpression(i)) || arr;
    return ts.isArrayLiteralExpression(arr) ? [...arr.elements] : null;
  }
  const n = stripWrap(node);
  if (ts.isArrayLiteralExpression(n)) return [...n.elements];
  if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ['filter', 'slice'].includes(n.expression.name.text)) {
    return arrayElements(n.expression.expression, env, { depth: depth + 1 });
  }
  if (ts.isIdentifier(n)) {
    const d = declOf(n);
    if (!d || !ts.isVariableDeclaration(d) || !d.initializer) return null;
    const lit = stripWrap(d.initializer);
    if (!ts.isArrayLiteralExpression(lit)) return null;
    const pushed = [];
    for (const call of env.pushCalls.get(n.text) || []) {
      if (declOf(call.expression.expression) !== d) continue;
      for (const a of call.arguments) pushed.push(a);
    }
    const els = [...lit.elements, ...pushed].sort((x, y) => x.getStart(env.sf) - y.getStart(env.sf));
    els.pushed = new Set(pushed);
    return els;
  }
  return null;
}

function altsOf(node, env, depth = 0, trace = true) {
  if (!node || depth > 8) return [PH];
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    env.consumed.add(node);
    return [node.text];
  }
  if (ts.isTemplateExpression(node)) {
    env.consumed.add(node);
    let res = [node.head.text];
    for (const span of node.templateSpans) {
      res = cross(res, altsOf(span.expression, env, depth + 1, false));
      res = cross(res, [span.literal.text]);
    }
    return res;
  }
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || (ts.isSatisfiesExpression && ts.isSatisfiesExpression(node))) {
    return altsOf(node.expression, env, depth + 1, trace);
  }
  if (ts.isConditionalExpression(node)) {
    return uniq([...altsOf(node.whenTrue, env, depth + 1, trace), ...altsOf(node.whenFalse, env, depth + 1, trace)]).slice(0, MAX_ALTS);
  }
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    if (op === ts.SyntaxKind.PlusToken) {
      return cross(altsOf(node.left, env, depth + 1, trace), altsOf(node.right, env, depth + 1, trace));
    }
    if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
      return uniq([...altsOf(node.left, env, depth + 1, trace), ...altsOf(node.right, env, depth + 1, trace)]).slice(0, MAX_ALTS);
    }
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) return altsOf(node.right, env, depth + 1, trace);
    return [PH];
  }
  if (ts.isIdentifier(node) && trace && env.consts.has(node.text)) {
    const inits = env.consts.get(node.text).filter((i) => !ts.isArrayLiteralExpression(i));
    if (inits.length) {
      return uniq(inits.flatMap((i) => altsOf(i, { ...env, consumed: new Set() }, depth + 1, false))).slice(0, MAX_ALTS);
    }
    return [PH];
  }
  if (ts.isIdentifier(node) && trace && env.importMap && env.importMap.has(node.text) && !declOf(node)) {
    return importedAlts(node, env, depth) || [PH];
  }
  // [..].join('\n') → 줄로 이어 붙인 한 문자열
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'join') {
    const els = arrayElements(node.expression.expression, env, { depth: depth + 1 });
    if (els) {
      const sepNode = node.arguments[0];
      const sep = sepNode && (ts.isStringLiteral(sepNode) || ts.isNoSubstitutionTemplateLiteral(sepNode)) ? sepNode.text : ',';
      const parts = els.map((e) => altsOf(e, env, depth + 1, trace)[0] ?? PH);
      if (env.ext) {
        // 길이가 실행 중에 정해지는 목록(spread·동적 원소·push)은 줄 구분자일 때만 원소별로 펼친다(상자 줄)
        if (!els.length) return [PH];
        if (!sep.includes('\n')) {
          if (els.some((e) => ts.isSpreadElement(e)) || parts.some((x) => x === PH)) return [PH];
          if (els.pushed && els.pushed.size) {
            // 조건부 push 가 섞인 목록: 선언 원소만 이은 HEAD 키(번역 보존)와, 길이를 모르는 목록을 뜻하는 PH 를 함께 낸다
            const base = els.filter((e) => !els.pushed.has(e)).map((e) => altsOf(e, env, depth + 1, trace)[0] ?? PH);
            // 선언 원소가 없으면 HEAD 키는 실행 중에 나올 수 없는 빈 join 이므로 PH 하나만 낸다
            if (!base.length) return [PH];
            return uniq([base.join(sep), PH]);
          }
        }
      }
      return [parts.join(sep)];
    }
  }
  return [PH];
}

/** 배열 리터럴(또는 그것을 가리키는 const)의 원소들 → 원소별 대안 목록 */
function elementAlts(node, env) {
  const els = arrayElements(node, env, { strip: true });
  return els ? els.map((e) => ({ node: e, alts: altsOf(e, env) })) : [];
}

// ---------------------------------------------------------------------------
// 소스 결과 수집기
// ---------------------------------------------------------------------------
/** 한 소스 파일에서 찾은 키들(문서 순서). */
class Found {
  constructor(source) {
    this.source = source;
    this.items = []; // {pos, line, label, alts}
    this.weak = [];
    this.dropped = 0;
  }
  add(pos, line, label, alts, opts, post) {
    this.items.push({ pos, line, label, alts, opts, post });
  }
  /** 키 맵으로 확정: Map(key → {key, kind, ctx[]}) */
  finalize() {
    const entries = new Map();
    this.items.sort((a, b) => a.pos - b.pos);
    for (const it of this.items) {
      for (const alt of it.alts) {
        const r = keysFromText(alt, it.opts);
        this.weak.push(...r.weak.map((w) => ({ key: w, ctx: `${this.source}:${it.line} ${it.label}` })));
        this.dropped += r.dropped.length;
        for (const k of r.keys) {
          if (it.post && !it.post(k.key, alt)) continue;
          const ctx = `${this.source.replace(`${CLI}/`, '')}:${it.line} ${it.label}`;
          const cur = entries.get(k.key);
          if (cur) {
            if (cur.ctx.length < 3 && !cur.ctx.includes(ctx)) cur.ctx.push(ctx);
          } else entries.set(k.key, { key: k.key, kind: k.kind, ctx: [ctx] });
        }
      }
    }
    return entries;
  }
}

// ---------------------------------------------------------------------------
// cli-help
// ---------------------------------------------------------------------------
function collectCliHelp() {
  const files = [
    ...listFiles(`${CLI}/src/commands`, (f) => f.endsWith('.ts') && !f.endsWith('.d.ts')),
    `${CLI}/src/index.ts`,
    `${CLI}/src/parser.ts`,
  ].filter(exists);
  const out = [];
  for (const rel of files) {
    const sf = parse(rel);
    const env = makeEnv(sf);
    const found = new Found(rel);
    const fnParams = new Map();
    const note = (name, idx) => {
      if (name && !fnParams.has(name)) fnParams.set(name, idx);
    };
    const isDescParam = (p) => ts.isIdentifier(p.name) && (p.name.text === 'description' || p.name.text === 'desc');
    walkTree(sf, (n) => {
      if (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) {
        const i = n.parameters.findIndex(isDescParam);
        if (i >= 0 && n.name && ts.isIdentifier(n.name)) note(n.name.text, i);
      } else if (ts.isVariableDeclaration(n) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) {
        const i = n.initializer.parameters.findIndex(isDescParam);
        if (i >= 0 && ts.isIdentifier(n.name)) note(n.name.text, i);
      }
    });
    walkTree(sf, (n) => {
      if (ts.isPropertyAssignment(n) && propNameOf(n) === 'description') {
        found.add(n.getStart(sf), lineOf(sf, n), 'description', altsOf(n.initializer, env), { scope: 'cli-help' });
      } else if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(n.left) && n.left.name.text === 'description') {
        // CLI 기본 설명: this.description = options.description || '…' (src/index.ts)
        found.add(n.right.getStart(sf), lineOf(sf, n.right), 'this.description', altsOf(n.right, env), { scope: 'cli-help' });
      } else if (ts.isCallExpression(n) && fnParams.size) {
        const { name } = calleeInfo(n);
        if (name && fnParams.has(name)) {
          const arg = n.arguments[fnParams.get(name)];
          if (arg) found.add(arg.getStart(sf), lineOf(sf, arg), `${name}()`, altsOf(arg, env), { scope: 'cli-help' });
        }
      }
    });
    out.push(found);
  }
  return out;
}

// ---------------------------------------------------------------------------
// cli-messages
// ---------------------------------------------------------------------------
const OUT_ARG0 = new Set([
  'writeln', 'write', 'writeError', 'writeErrorln', 'printSuccess', 'printWarning', 'printInfo',
  'bold', 'dim', 'success', 'error', 'warning', 'info', 'highlight', 'color',
]);
const OUT_LIST = new Set(['printList', 'list', 'printNumberedList', 'numberedList']);
const OUT_BOX = new Set(['printBox', 'box']);
const OUT_TABLE = new Set(['printTable', 'table']);
const SPINNER_METHODS = new Set(['succeed', 'fail', 'stop', 'setText', 'warn', 'start', 'update']);
const PROMPT_FNS = new Set(['select', 'confirm', 'input', 'text', 'number', 'multiSelect', 'password', 'search']);
const OPTS_CLI = { scope: 'cli-messages' };
const LABEL_KEYS = new Set(['property', 'setting']);

const isOutputRecv = (recv, sf) => !!recv && /(^|\.)(output|formatter)$/.test(recv.getText(sf));
const isSpinnerRecv = (recv, sf) => !!recv && /(spinner|spin)$/i.test(recv.getText(sf));
const isConsoleRecv = (recv, sf) => !!recv && recv.getText(sf) === 'console';

function resolveImport(fromRel, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.posix.join(path.posix.dirname(fromRel), spec.replace(/\.js$/, ''));
  for (const cand of [`${base}.ts`, `${base}/index.ts`]) if (exists(cand)) return cand;
  return null;
}

function importsOf(rel) {
  const sf = parse(rel);
  const specs = [];
  walkTree(sf, (n) => {
    if (ts.isImportDeclaration(n) && !n.importClause?.isTypeOnly && ts.isStringLiteral(n.moduleSpecifier)) specs.push(n.moduleSpecifier.text);
    else if (ts.isExportDeclaration(n) && n.moduleSpecifier && !n.isTypeOnly && ts.isStringLiteral(n.moduleSpecifier)) specs.push(n.moduleSpecifier.text);
    else if (ts.isCallExpression(n) && n.arguments.length === 1 && ts.isStringLiteral(n.arguments[0])) {
      if (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === 'require')) specs.push(n.arguments[0].text);
    }
  });
  return [...new Set(specs.map((s) => resolveImport(rel, s)).filter(Boolean))];
}

/** index.ts 같은 배럴이 다시 내보내는(export … from) 모듈들 */
function reexportsOf(rel) {
  const sf = parse(rel);
  const specs = [];
  for (const st of sf.statements) {
    if (ts.isExportDeclaration(st) && st.moduleSpecifier && !st.isTypeOnly && ts.isStringLiteral(st.moduleSpecifier)) specs.push(st.moduleSpecifier.text);
  }
  return [...new Set(specs.map((x) => resolveImport(rel, x)).filter(Boolean))];
}

function rootActionNode(sf, cmdName) {
  let found = null;
  walkTree(sf, (n) => {
    if (found) return false;
    if (ts.isVariableStatement(n)) {
      for (const d of n.declarationList.declarations) {
        const init = d.initializer;
        if (!init || !ts.isObjectLiteralExpression(init)) continue;
        const nameProp = init.properties.find((p) => ts.isPropertyAssignment(p) && propNameOf(p) === 'name');
        if (!nameProp || !ts.isStringLiteral(nameProp.initializer) || nameProp.initializer.text !== cmdName) continue;
        const act = init.properties.find((p) => (ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p)) && propNameOf(p) === 'action');
        if (act) {
          found = act;
          return false;
        }
      }
    }
    return true;
  });
  return found;
}

function collectMessagesFrom(rel, { rootOnly = null, checks = false, structural = null } = {}) {
  const sf = parse(rel);
  const env = makeEnv(sf, { imports: true });
  const found = new Found(rel);
  const promptNames = new Set();
  walkTree(sf, (n) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && /(^|\/)prompt\.js$/.test(n.moduleSpecifier.text)) {
      const nb = n.importClause?.namedBindings;
      if (nb && ts.isNamedImports(nb)) for (const e of nb.elements) promptNames.add(e.name.text);
    }
  });
  const isPromptFile = /(^|\/)prompt\.ts$/.test(rel);
  let scope = sf;
  if (rootOnly) {
    scope = rootActionNode(sf, rootOnly);
    if (!scope) return found;
  }
  const add = (node, label, alts, extra) => found.add(node.getStart(sf), lineOf(sf, node), label, alts, OPTS_CLI, extra);
  const objProps = (obj) => (ts.isObjectLiteralExpression(obj) ? obj.properties.filter(ts.isPropertyAssignment) : []);

  const handleCall = (n) => {
    const { name, recv } = calleeInfo(n);
    if (!name) return;
    if (isOutputRecv(recv, sf)) {
      const a = n.arguments;
      if (OUT_ARG0.has(name)) {
        if (a[0]) add(a[0], name, altsOf(a[0], env));
      } else if (name === 'printError') {
        if (a[0]) add(a[0], name, altsOf(a[0], env));
        if (a[1]) add(a[1], `${name}.details`, altsOf(a[1], env));
      } else if (OUT_LIST.has(name)) {
        if (a[0]) for (const e of elementAlts(a[0], env)) add(e.node, name, e.alts);
      } else if (OUT_BOX.has(name)) {
        if (a[0]) {
          const els = ts.isArrayLiteralExpression(a[0]) ? elementAlts(a[0], env) : [{ node: a[0], alts: altsOf(a[0], env) }];
          for (const e of els) add(e.node, `${name}.content`, e.alts);
        }
        if (a[1]) add(a[1], `${name}.title`, altsOf(a[1], env));
      } else if (OUT_TABLE.has(name)) {
        const o = a[0];
        if (o && ts.isObjectLiteralExpression(o)) {
          const cols = objProps(o).find((p) => propNameOf(p) === 'columns');
          if (cols && ts.isArrayLiteralExpression(cols.initializer)) {
            for (const c of cols.initializer.elements) {
              if (!ts.isObjectLiteralExpression(c)) continue;
              const h = objProps(c).find((p) => propNameOf(p) === 'header');
              if (h) add(h.initializer, `${name}.header`, altsOf(h.initializer, env));
            }
            // 속성 표: key 가 property/setting 인 열의 라벨 칸(데이터 행의 해당 값)
            const labelKeys = cols.initializer.elements.flatMap((c) => {
              if (!ts.isObjectLiteralExpression(c)) return [];
              const k = objProps(c).find((p) => propNameOf(p) === 'key');
              const kt = k && stripWrap(k.initializer);
              return kt && ts.isStringLiteral(kt) && LABEL_KEYS.has(kt.text) ? [kt.text] : [];
            });
            const dataProp = objProps(o).find((p) => propNameOf(p) === 'data');
            const rows = labelKeys.length && dataProp ? arrayElements(dataProp.initializer, env, { strip: true }) : null;
            if (rows) {
              for (const r of rows) {
                const ro = stripWrap(r);
                if (!ts.isObjectLiteralExpression(ro)) continue;
                for (const p of objProps(ro)) if (labelKeys.includes(propNameOf(p))) add(p.initializer, `${name}.cell`, altsOf(p.initializer, env));
              }
            }
          }
        }
      } else if (name === 'createSpinner') {
        const o = a[0];
        if (o && ts.isObjectLiteralExpression(o)) {
          const t = objProps(o).find((p) => propNameOf(p) === 'text');
          if (t) add(t.initializer, 'createSpinner.text', altsOf(t.initializer, env));
        }
      }
    } else if (recv && isSpinnerRecv(recv, sf) && SPINNER_METHODS.has(name)) {
      if (n.arguments[0]) add(n.arguments[0], `spinner.${name}`, altsOf(n.arguments[0], env));
    } else if (!recv && (promptNames.has(name) || (isPromptFile && PROMPT_FNS.has(name)))) {
      const o = n.arguments[0];
      if (!o) return;
      if (ts.isObjectLiteralExpression(o)) {
        for (const p of objProps(o)) {
          const pn = propNameOf(p);
          if (pn === 'message' || pn === 'active' || pn === 'inactive' || pn === 'placeholder') add(p.initializer, `${name}.${pn}`, altsOf(p.initializer, env));
          else if ((pn === 'choices' || pn === 'options') && ts.isArrayLiteralExpression(p.initializer)) {
            for (const c of p.initializer.elements) {
              if (!ts.isObjectLiteralExpression(c)) continue;
              for (const cp of objProps(c)) {
                const cn = propNameOf(cp);
                if (cn === 'label' || cn === 'hint') add(cp.initializer, `${name}.choice.${cn}`, altsOf(cp.initializer, env));
              }
            }
          }
        }
      } else {
        add(o, `${name}.message`, altsOf(o, env));
      }
    } else if (recv && name === 'push' && /(^|\.)(errors|warnings)$/.test(recv.getText(sf))) {
      // init executor 등 1단계 모듈이 결과 객체에 담아 돌려주고 명령이 그대로 출력하는 메시지
      if (n.arguments[0]) add(n.arguments[0], `${recv.getText(sf).split('.').pop()}.push`, altsOf(n.arguments[0], env));
    } else if (structural && isConsoleRecv(recv, sf) && ['log', 'warn', 'error', 'info'].includes(name)) {
      const alts = n.arguments[0] ? altsOf(n.arguments[0], env) : [];
      for (const alt of alts) {
        const r = keysFromText(alt, OPTS_CLI);
        for (const k of r.keys) structural.push({ file: rel.replace(`${CLI}/`, ''), line: lineOf(sf, n), method: name, key: k.key });
      }
    }
  };

  walkTree(scope, (n) => {
    if (ts.isCallExpression(n)) handleCall(n);
    else if (checks && ts.isPropertyAssignment(n)) {
      const pn = propNameOf(n);
      if (pn === 'name' || pn === 'message' || pn === 'fix') add(n.initializer, `check.${pn}`, altsOf(n.initializer, env));
    }
    return true;
  });
  return found;
}

function collectCliMessages(structural) {
  const nine = NINE.map((n) => `${CLI}/src/commands/${n}.ts`).filter(exists);
  const base = new Set([...nine, `${CLI}/src/index.ts`, `${CLI}/src/prompt.ts`, `${CLI}/src/parser.ts`]);
  const reached = new Set();
  const addReached = (i) => {
    if (!base.has(i) && !/\/(output|prompt)\.ts$/.test(i) && !/\/types(\/|\.ts)/.test(i)) reached.add(i);
  };
  for (const f of nine) {
    for (const i of importsOf(f)) {
      addReached(i);
      // 배럴(index.ts)이면 그 안에서 다시 내보내는 모듈까지 본다: src/init/index.ts → executor.ts 등
      if (/\/index\.ts$/.test(i)) for (const r of reexportsOf(i)) addReached(r);
    }
  }
  const rootOnly = ROOT_ACTION_ONLY.map((n) => [n, `${CLI}/src/commands/${n}.ts`]).filter(([, f]) => exists(f));
  const list = [...new Set([...base, ...reached])].filter(exists).sort(cmp);
  const out = [];
  for (const rel of list) {
    const checks = /\/commands\/(doctor|status)\.ts$/.test(rel);
    out.push(collectMessagesFrom(rel, { checks, structural }));
  }
  for (const [n, rel] of rootOnly) out.push(collectMessagesFrom(rel, { rootOnly: n, structural }));
  out.sort((a, b) => cmp(a.source, b.source));
  return { found: out, reached: [...reached].sort(cmp) };
}

// ---------------------------------------------------------------------------
// plugins (제외 목록 방식)
// ---------------------------------------------------------------------------
const UI_PROPS = new Set([
  'label', 'short', 'group', 'title', 'blurb', 'hint', 'summary', 'text', 'description', 'why', 'detail', 'note', 'empty', 'what',
  'name', 'placeholder', 'submitLabel', 'message', 'tip', 'help', 'caption', 'heading', 'subtitle', 'tooltip', 'prompt', 'expect', 'body',
]);
const SKIP_PROPS = new Set([
  'key', 'id', 'kind', 'color', 'icon', 'command', 'tool', 'type', 'args', 'argv', 'cmd', 'cwd', 'path', 'file', 'dir', 'event', 'scope',
  'mode', 'variant', 'align', 'role', 'as', 'go', 'view', 'href', 'url', 'env', 'glob', 'pattern', 'regex', 'accent', 'style', 'fg', 'bg',
]);
const UI_CALLS = new Set([
  'text', 'kv', 'rule', 'section', 'button', 'tagChip', 'starts', 'startField', 'toast', 'log', 'notify', 'confirm', 'askChoice', 'ask',
  'Text', 'Button', 'Input', 'chip', 'badge', 'row', 'col', 'tLines', 't',
]);
const SKIP_CALLS = new Set([
  'on', 'get', 'set', 'has', 'delete', 'includes', 'startsWith', 'endsWith', 'indexOf', 'lastIndexOf', 'split', 'join', 'replace', 'replaceAll',
  'match', 'matchAll', 'test', 'exec', 'padEnd', 'padStart', 'repeat', 'localeCompare', 'parse', 'RegExp', 'require', 'import', 'Symbol', 'for',
  'access', 'readFile', 'writeFile', 'stat', 'mkdir', 'spawn', 'execFile', 'resolve', 'run', 'runner', 'shell', 'sh', 'cli', 'ruflo', 'append',
  'mark', 'fromCharCode', 'normalize', 'at', 'charAt', 'trimStart', 'trimEnd', 'slice', 'substring', 'concat', 'equals', 'is', 'isOneOf',
  'readdir', 'unlink', 'rm', 'copyFile', 'rename', 'existsSync', 'getItem', 'setItem', 'querySelector', 'addEventListener', 'emit',
]);
// views/common.ts 의 그리기 도우미: 첫 인자가 ctx 이면 표시 문구는 이 인덱스의 인자뿐(나머지는 id·키·색)
const CTX_ARGS = { text: [1], tagChip: [1], rule: [1, 2], section: [2, 3], kv: [1, 2], button: [2], startField: [2], starts: [1] };
const SKIP_NEW = new Set(['RegExp', 'Map', 'Set', 'URL', 'Date', 'WeakMap', 'WeakSet']);
const EQ_OPS = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken,
]);

function lastName(callee, sf) {
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return undefined;
}

/** 노드 문맥 분류: {skip, ui, label} */
function classify(node0, sf) {
  let node = node0;
  // 조건식·논리식·괄호·배열은 컨테이너까지 올라간다
  for (;;) {
    const p = node.parent;
    if (!p) return { skip: true };
    if (ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isNonNullExpression(p)) node = p;
    else if (ts.isConditionalExpression(p) && p.condition !== node) node = p;
    else if (ts.isBinaryExpression(p) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(p.operatorToken.kind)) node = p;
    else if (ts.isArrayLiteralExpression(p)) node = p;
    else if (ts.isSpreadElement(p)) node = p;
    else break;
  }
  const p = node.parent;
  if (ts.isLiteralTypeNode(p) || ts.isTypeNode?.(p)) return { skip: true };
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isExternalModuleReference(p)) return { skip: true };
  if (ts.isTemplateSpan(p)) return { skip: true }; // 템플릿 안쪽: 템플릿 단위에서 처리됨
  if (ts.isPropertyAssignment(p)) {
    if (p.name === node) return { skip: true };
    const n = propNameOf(p);
    if (n && SKIP_PROPS.has(n)) return { skip: true };
    return { skip: false, ui: !!(n && UI_PROPS.has(n)), label: n || 'prop' };
  }
  if (ts.isShorthandPropertyAssignment(p) || ts.isComputedPropertyName(p)) return { skip: true };
  if (ts.isElementAccessExpression(p)) return { skip: true };
  if (ts.isBinaryExpression(p) && EQ_OPS.has(p.operatorToken.kind)) return { skip: true };
  if (ts.isCaseClause(p)) return { skip: true };
  if (ts.isCallExpression(p) && p.arguments.includes(node)) {
    const nm = lastName(p.expression, sf);
    if (nm && SKIP_CALLS.has(nm)) return { skip: true };
    const a0 = p.arguments[0];
    if (nm && CTX_ARGS[nm] && a0 && ts.isIdentifier(a0) && a0.text === 'ctx' && !CTX_ARGS[nm].includes(p.arguments.indexOf(node))) return { skip: true };
    return { skip: false, ui: !!(nm && UI_CALLS.has(nm)), label: nm ? `${nm}()` : 'call' };
  }
  if (ts.isNewExpression(p) && p.arguments?.includes(node)) {
    const nm = ts.isIdentifier(p.expression) ? p.expression.text : undefined;
    if (nm && SKIP_NEW.has(nm)) return { skip: true };
    return { skip: false, ui: nm === 'Error', label: nm ? `new ${nm}` : 'new' };
  }
  if (ts.isJsxExpression(p)) return { skip: false, ui: true, label: 'jsx' };
  if (ts.isJsxAttribute(p)) {
    const n = p.name.getText(sf);
    return SKIP_PROPS.has(n) || !(UI_PROPS.has(n) || n === 'label') ? { skip: true } : { skip: false, ui: true, label: `jsx:${n}` };
  }
  if (ts.isReturnStatement(p) || ts.isArrowFunction(p) || ts.isVariableDeclaration(p) || ts.isBinaryExpression(p) || ts.isExpressionStatement(p) || ts.isTemplateSpan(p)) {
    return { skip: false, ui: false, label: ts.isReturnStatement(p) ? 'return' : ts.isVariableDeclaration(p) ? 'const' : 'expr' };
  }
  return { skip: false, ui: false, label: 'expr' };
}

const humanShape = (key, ui) => {
  if (/\s/.test(key) || /^[A-Z]/.test(key)) return true;
  if (/^[^A-Za-z{]/.test(key)) return true; // 기호 뒤 단어
  if (ui) return isLowerToken(key);
  return false;
};

function collectPluginFile(rel, { onlyFunctions = null } = {}) {
  const sf = parse(rel);
  const env = makeEnv(sf);
  const found = new Found(rel);
  const consumed = env.consumed;
  const consider = (node, label0) => {
    const cls = classify(node, sf);
    if (cls.skip) return;
    const alts = altsOf(node, env);
    const ui = !!cls.ui;
    found.add(node.getStart(sf), lineOf(sf, node), cls.label || label0, alts, { scope: 'plugins', ui }, (key) => humanShape(key, ui));
  };
  const visit = (node) => {
    // 모델이 읽는 경로(tool.*) 는 제외
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'on') {
      const a0 = node.arguments[0];
      if (a0 && ts.isStringLiteral(a0) && a0.text.startsWith('tool.')) return;
    }
    if (ts.isTypeNode(node) && !ts.isExpressionWithTypeArguments(node)) return;
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isJsxText(node)) {
      const t = node.text.replace(/\s+/g, ' ').trim();
      if (t) found.add(node.getStart(sf), lineOf(sf, node), 'jsx', [t], { scope: 'plugins', ui: true }, (key) => humanShape(key, true));
      return;
    }
    if (!consumed.has(node)) {
      const isStringish = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node);
      const isConcat = ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken && !(ts.isBinaryExpression(node.parent) && node.parent.operatorToken.kind === ts.SyntaxKind.PlusToken);
      if (isStringish || isConcat) {
        if (isConcat) {
          // 한쪽이라도 문자열 리터럴이 들어 있어야 연결 문자열로 본다
          let hasStr = false;
          walkTree(node, (c) => {
            if (ts.isStringLiteral(c) || ts.isNoSubstitutionTemplateLiteral(c) || ts.isTemplateExpression(c)) hasStr = true;
            return !(ts.isCallExpression(c) || ts.isFunctionLike(c));
          });
          if (hasStr) consider(node, 'concat');
        } else {
          consider(node, 'string');
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  if (onlyFunctions) {
    walkTree(sf, (n) => {
      if (ts.isFunctionDeclaration(n) && n.name && onlyFunctions.includes(n.name.text)) {
        visit(n);
        return false;
      }
      return true;
    });
  } else {
    visit(sf);
  }
  return found;
}

function pluginFiles() {
  const out = [];
  const keep = (f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('.d.ts') && !/\/hooks\/i18n\//.test(f);
  for (const p of ['ruflo-console', 'ruflo-swarm']) {
    for (const f of listFiles(`plugins/${p}/hooks`, keep)) {
      if (p === 'ruflo-console' && /\/hooks\/model-tools\.ts$/.test(f)) continue; // 모델이 읽는 응답
      out.push({ plugin: p, rel: f });
    }
  }
  const mods = 'plugins/ruflo-mods/hooks';
  const modsFiles = [
    `${mods}/session.ts`, `${mods}/trust.ts`, `${mods}/protector.ts`,
    ...listFiles(`${mods}/delivery`, keep), ...listFiles(`${mods}/cost`, keep), ...listFiles(`${mods}/agents`, keep),
  ];
  for (const f of modsFiles) if (exists(f)) out.push({ plugin: 'ruflo-mods', rel: f });
  if (exists(`${mods}/state.ts`)) out.push({ plugin: 'ruflo-mods', rel: `${mods}/state.ts`, onlyFunctions: ['report', 'statusText'] });
  return out;
}

// ---------------------------------------------------------------------------
// 샤드 만들기 (런타임 사전 단위: 중복 제거는 단위 안에서만)
// ---------------------------------------------------------------------------

/**
 * sources: [{ dirRel, slug, target, source, found: Map }] — 이미 단위 안에서 정렬된 순서.
 * 첫 출현 샤드가 키를 소유한다. 반환: 기록할 샤드 목록(조각 포함).
 */
function buildUnitShards(unitName, sources, oldShardsByRel, keepRel = []) {
  const owner = new Map();
  const owned = sources.map(() => []);
  sources.forEach((s, i) => {
    for (const e of s.found.values()) {
      const o = owner.get(e.key);
      if (o) {
        const ent = o.entry;
        for (const c of e.ctx) if (ent.ctx.length < 3 && !ent.ctx.includes(c)) ent.ctx.push(c);
      } else {
        const entry = { key: e.key, kind: e.kind, ctx: [...e.ctx] };
        owner.set(e.key, { i, entry });
        owned[i].push(entry);
      }
    }
  });
  const unitKeys = new Set(owner.keys());
  const oldList = [...oldShardsByRel.values()];
  const koMap = koMapOf(oldList);
  const shards = [];
  sources.forEach((s, i) => {
    if (!owned[i].length) return;
    const entries = owned[i].map((e) => ({ key: e.key, ko: koMap.has(e.key) ? koMap.get(e.key) : '', kind: e.kind, ctx: e.ctx }));
    const chunks = chunkEntries(entries);
    chunks.forEach((chunk, ci) => {
      const rel = `${s.dirRel}/${s.slug}${chunks.length > 1 ? `.p${ci + 1}` : ''}.json`;
      const oldShard = oldShardsByRel.get(rel) || null;
      shards.push({ rel, shard: makeShard({ target: s.target, source: s.source, entries: chunk, oldShard, unitKeys }) });
    });
  });
  // _runtime 같이 손으로(도구로) 만든 샤드: 정적으로 소유된 키는 빼고 보존
  for (const rel of keepRel) {
    const old = oldShardsByRel.get(rel);
    if (!old) continue;
    const entries = (old.entries || []).filter((e) => !owner.has(e.key));
    if (entries.length) shards.push({ rel, shard: makeShard({ target: old.target, source: old.source, entries, oldShard: old, unitKeys: new Set([...unitKeys, ...entries.map((e) => e.key)]) }) });
  }
  return shards;
}

function readOld(dirRel) {
  const m = new Map();
  for (const rel of listJson(dirRel)) {
    const j = readJson(path.join(KO_DIR, rel));
    if (j) m.set(rel, j);
  }
  return m;
}

const slugFromSource = (source, base) => slugOf(source.slice(source.indexOf(base) + base.length));

// ---------------------------------------------------------------------------
// descriptions
// ---------------------------------------------------------------------------
const DESC_GROUPS = ['cli-agents', 'cli-commands', 'cli-skills', 'plugins-a-h', 'plugins-i-q', 'plugins-r-z', 'marketplace'];

function pluginGroup(name) {
  const m = /^ruflo-(.)/.exec(name) || /^(.)/.exec(name);
  const c = (m ? m[1] : 'a').toLowerCase();
  if (c >= 'i' && c <= 'q') return 'plugins-i-q';
  if (c >= 'r' && c <= 'z') return 'plugins-r-z';
  return 'plugins-a-h';
}

const BLOCK_RE = /^[|>][+-]?\d*[+-]?\s*(#.*)?$/;

/** 줄 기반 머리말 읽기. 반환 null(머리말 없음) | {error} | {hasDesc, value, style} */
function readFrontmatter(text) {
  let t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (!/^---[ \t]*\r?\n/.test(t)) return null;
  const lines = t.split(/\r?\n/);
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (/^---[ \t]*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  if (end < 0) return { error: 'unterminated frontmatter' };
  const fm = lines.slice(1, end).join('\n');
  let obj;
  try {
    obj = YAML.parse(fm);
  } catch (e) {
    return { error: String(e.message || e).split('\n')[0] };
  }
  if (!obj || typeof obj !== 'object') return { hasDesc: false };
  const dl = lines.slice(1, end).find((l) => /^description:/.test(l));
  if (!('description' in obj)) return { hasDesc: false };
  if (typeof obj.description !== 'string') return { hasDesc: false, nonString: true };
  if (dl === undefined) return { hasDesc: false, nested: true };
  const rest = dl.slice('description:'.length).trim();
  let style = 'plain';
  if (BLOCK_RE.test(rest)) style = 'block';
  else if (rest.startsWith('"')) style = 'double';
  else if (rest.startsWith("'")) style = 'single';
  return { hasDesc: true, value: obj.description.replace(/\n+$/, ''), style };
}

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

function collectDescriptions(report) {
  const groups = new Map(DESC_GROUPS.map((g) => [g, new Map()]));
  const yamlErrors = [];
  const stats = {
    cliAgents: { md: 0, withDesc: 0, noFrontmatter: 0, noDesc: 0, nonMd: 0 },
    cliSkills: { md: 0, withDesc: 0, noFrontmatter: 0, noDesc: 0 },
    cliCommands: { md: 0, withDesc: 0, synth: 0, noDesc: 0 },
    pluginCommands: { md: 0, withDesc: 0, synth: 0, noDesc: 0 },
    pluginAgents: { md: 0, withDesc: 0, noFrontmatter: 0, noDesc: 0 },
    pluginSkills: { md: 0, withDesc: 0, noFrontmatter: 0, noDesc: 0 },
    pluginsDirs: 0, marketplacePlugins: 0, pluginJson: 0, userConfig: 0,
  };
  const issues = [];

  const handleMd = (rel, group, st, { synthOk }) => {
    st.md++;
    const text = fs.readFileSync(abs(rel), 'utf8');
    const fm = readFrontmatter(text);
    if (fm === null) {
      if (!synthOk) {
        st.noFrontmatter++;
        return;
      }
      const s = synthDescription(text);
      if (!s) {
        st.noDesc++;
        issues.push({ file: rel, issue: 'no-frontmatter-empty' });
        return;
      }
      st.synth++;
      groups.get(group).set(rel, { en: s, ko: '', synth: true, style: 'synth' });
      return;
    }
    if (fm.error) {
      yamlErrors.push({ file: rel, error: fm.error });
      return;
    }
    if (!fm.hasDesc) {
      st.noDesc++;
      issues.push({ file: rel, issue: fm.nonString ? 'non-string-description' : fm.nested ? 'description-not-col0' : 'no-description' });
      return;
    }
    st.withDesc++;
    groups.get(group).set(rel, { en: fm.value, ko: '', synth: false, style: fm.style });
  };

  // (1) cli skills
  for (const rel of listFiles(`${CLI}/.claude/skills`, (f) => f.endsWith('/SKILL.md'))) handleMd(rel, 'cli-skills', stats.cliSkills, { synthOk: false });
  // (2) cli agents (머리말이 있는 것만)
  const agentFiles = listFiles(`${CLI}/.claude/agents`, () => true);
  stats.cliAgents.nonMd = agentFiles.filter((f) => !f.endsWith('.md')).length;
  for (const rel of agentFiles.filter((f) => f.endsWith('.md'))) handleMd(rel, 'cli-agents', stats.cliAgents, { synthOk: false });
  // (3) cli commands (전부, 머리말 없으면 synth)
  for (const rel of listFiles(`${CLI}/.claude/commands`, (f) => f.endsWith('.md'))) handleMd(rel, 'cli-commands', stats.cliCommands, { synthOk: true });
  // (4) plugins
  const pluginDirs = fs.readdirSync(abs('plugins'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort(cmp);
  stats.pluginsDirs = pluginDirs.length;
  for (const p of pluginDirs) {
    const g = pluginGroup(p);
    for (const rel of listFiles(`plugins/${p}/commands`, (f) => f.endsWith('.md'))) handleMd(rel, g, stats.pluginCommands, { synthOk: true });
    for (const rel of listFiles(`plugins/${p}/agents`, (f) => f.endsWith('.md'))) handleMd(rel, g, stats.pluginAgents, { synthOk: false });
    for (const rel of listFiles(`plugins/${p}/skills`, (f) => f.endsWith('/SKILL.md'))) handleMd(rel, g, stats.pluginSkills, { synthOk: false });
  }
  // (5) marketplace.json
  const mkRel = '.claude-plugin/marketplace.json';
  if (exists(mkRel)) {
    const mk = JSON.parse(fs.readFileSync(abs(mkRel), 'utf8'));
    const mg = groups.get('marketplace');
    if (typeof mk.description === 'string') mg.set('marketplace:$root', { en: mk.description, ko: '', synth: false, style: 'json' });
    for (const pl of mk.plugins || []) {
      stats.marketplacePlugins++;
      if (typeof pl.description === 'string') mg.set(`marketplace:${pl.name}`, { en: pl.description, ko: '', synth: false, style: 'json' });
    }
  }
  // (6) plugin.json
  for (const p of pluginDirs) {
    const rel = `plugins/${p}/.claude-plugin/plugin.json`;
    if (!exists(rel)) continue;
    stats.pluginJson++;
    let pj;
    try {
      pj = JSON.parse(fs.readFileSync(abs(rel), 'utf8'));
    } catch (e) {
      issues.push({ file: rel, issue: 'json-parse' });
      continue;
    }
    const name = typeof pj.name === 'string' ? pj.name : p;
    const g = groups.get(pluginGroup(p));
    if (typeof pj.description === 'string') g.set(`plugin:${name}`, { en: pj.description, ko: '', synth: false, style: 'json' });
    if (pj.userConfig && typeof pj.userConfig === 'object') {
      for (const k of Object.keys(pj.userConfig).sort(cmp)) {
        const u = pj.userConfig[k];
        for (const f of ['title', 'description']) {
          if (u && typeof u[f] === 'string') {
            stats.userConfig++;
            g.set(`plugin:${name}#userConfig.${k}.${f}`, { en: u[f], ko: '', synth: false, style: 'json' });
          }
        }
      }
    }
  }
  return { groups, yamlErrors, stats, issues };
}

// ---------------------------------------------------------------------------
// 실행
// ---------------------------------------------------------------------------
const writer = new Writer({ dryRun: CHECK });
const summary = {}; // 대상별 통계
const allShards = new Map(); // rel → shard (계획 배치용, 쓰기 후 상태)
const structural = [];
const weakAll = [];
const notes = {};

function recordShards(target, shards, extra = {}) {
  let keys = 0, translated = 0, nulls = 0, empty = 0, tmpl = 0;
  for (const { rel, shard } of shards) {
    allShards.set(rel, shard);
    for (const e of shard.entries) {
      keys++;
      if (e.kind === 'template') tmpl++;
      if (e.ko === null) nulls++;
      else if (e.ko === '') empty++;
      else translated++;
    }
  }
  summary[target] = { shards: shards.length, keys, templates: tmpl, translated, null: nulls, empty, nullRatio: keys ? Number((nulls / keys).toFixed(4)) : 0, ...extra };
}

function writeShards(shards) {
  for (const { rel, shard } of shards) writer.write(rel, stableJson(shard));
}

// ---- CLI(help + messages 는 같은 런타임 사전 단위) ----
if (want('cli-unit')) {
  const wantHelp = TARGET === 'all' || TARGET === 'cli-help';
  const wantMsg = TARGET === 'all' || TARGET === 'cli-messages';
  const oldHelp = readOld('cli/help');
  const oldMsg = readOld('cli/messages');
  const oldUnit = new Map([...oldHelp, ...oldMsg]);
  const helpFound = collectCliHelp();
  const { found: msgFound, reached } = collectCliMessages(structural);
  notes.cliReached = reached.map((r) => r.replace(`${CLI}/`, ''));
  const mk = (list, dirRel, target, base) =>
    list.map((f) => ({ dirRel, slug: slugFromSource(f.source, base), target, source: f.source, found: f.finalize(), f }));
  const helpSrc = mk(helpFound, 'cli/help', 'cli-help', `${CLI}/src/`).sort((a, b) => cmp(a.source, b.source));
  const msgSrc = mk(msgFound, 'cli/messages', 'cli-messages', `${CLI}/src/`).sort((a, b) => cmp(a.source, b.source));
  // 단위 안에서 help 가 먼저, 그다음 messages
  const keepRuntime = oldHelp.has('cli/help/_runtime.json') ? ['cli/help/_runtime.json'] : [];
  const shards = buildUnitShards('cli', [...helpSrc, ...msgSrc], oldUnit, keepRuntime);
  const helpShards = shards.filter((s) => s.rel.startsWith('cli/help/'));
  const msgShards = shards.filter((s) => s.rel.startsWith('cli/messages/'));
  if (wantHelp) {
    writeShards(helpShards);
    recordShards('cli-help', helpShards, { weakTemplates: helpSrc.reduce((n, s) => n + s.f.weak.length, 0) });
  }
  if (wantMsg) {
    writeShards(msgShards);
    recordShards('cli-messages', msgShards, { weakTemplates: msgSrc.reduce((n, s) => n + s.f.weak.length, 0) });
  }
  for (const s of [...(wantHelp ? helpSrc : []), ...(wantMsg ? msgSrc : [])]) for (const w of s.f.weak) weakAll.push({ target: s.target, key: w.key, ctx: w.ctx });
  if (wantHelp) writer.prune('cli/help');
  if (wantMsg) writer.prune('cli/messages');
}

// ---- plugins ----
if (want('plugins')) {
  const old = readOld('plugins');
  const files = pluginFiles();
  const byPlugin = new Map();
  for (const f of files) {
    const found = collectPluginFile(f.rel, { onlyFunctions: f.onlyFunctions });
    const list = byPlugin.get(f.plugin) || [];
    list.push({ dirRel: `plugins/${f.plugin}`, slug: slugOf(f.rel.slice(`plugins/${f.plugin}/hooks/`.length)), target: 'plugins', source: f.rel, found: found.finalize(), f: found });
    byPlugin.set(f.plugin, list);
  }
  const all = [];
  let weak = 0;
  for (const [p, list] of [...byPlugin].sort((a, b) => cmp(a[0], b[0]))) {
    list.sort((a, b) => cmp(a.source, b.source));
    const oldP = new Map([...old].filter(([rel]) => rel.startsWith(`plugins/${p}/`)));
    all.push(...buildUnitShards(p, list, oldP));
    for (const s of list) {
      weak += s.f.weak.length;
      for (const w of s.f.weak) weakAll.push({ target: `plugins/${p}`, key: w.key, ctx: w.ctx });
    }
  }
  writeShards(all);
  writer.prune('plugins');
  const perPlugin = {};
  for (const { rel, shard } of all) {
    const p = rel.split('/')[1];
    perPlugin[p] = (perPlugin[p] || 0) + shard.entries.length;
  }
  recordShards('plugins', all, { weakTemplates: weak, perPlugin });
}

// ---- descriptions ----
let descYamlErrors = [];
if (want('descriptions')) {
  const { groups, yamlErrors, stats, issues } = collectDescriptions();
  // 설명이 이미 한국어로 적용된 상태(apply-descriptions 후)면 샤드의 en 이 한국어로 오염되므로 쓰지 않는다.
  let appliedFiles = 0;
  for (const g of groups.values()) for (const v of g.values()) if (hasHangul(v.en)) appliedFiles++;
  if (appliedFiles) {
    console.error(`!! 설명이 적용된 상태입니다. 먼저 node scripts/i18n/apply-descriptions.mjs --revert 를 실행하세요 (한글이 든 설명 ${appliedFiles}개 파일; descriptions 샤드는 쓰지 않았습니다)`);
    process.exitCode = 1;
  } else {
  // baseline-yaml-errors.txt: 원본에서 이미 깨진 파일. 처음 한 번만 기록한다(--rebaseline 으로 갱신).
  const baseRel = 'baseline-yaml-errors.txt';
  const baseAbs = path.join(KO_DIR, baseRel);
  const found = yamlErrors.map((e) => e.file).sort(cmp);
  let baseline;
  if (!fs.existsSync(baseAbs) || REBASELINE) {
    baseline = found;
    writer.write(baseRel, found.length ? found.join('\n') + '\n' : '');
  } else {
    baseline = fs.readFileSync(baseAbs, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  }
  descYamlErrors = yamlErrors.filter((e) => !baseline.includes(e.file));
  const oldAll = readOld('descriptions');
  const koOld = new Map(); // 경로 → 이전 항목
  for (const j of oldAll.values()) for (const [k, v] of Object.entries(j)) koOld.set(k, v);
  let total = 0, translated = 0, nulls = 0, empty = 0, changed = 0;
  const shards = [];
  for (const g of DESC_GROUPS) {
    const m = groups.get(g);
    const keys = [...m.keys()].sort(cmp);
    if (!keys.length) continue;
    const chunks = [];
    const parts = Math.ceil(keys.length / MAX_SHARD);
    const size = Math.ceil(keys.length / parts);
    for (let i = 0; i < keys.length; i += size) chunks.push(keys.slice(i, i + size));
    chunks.forEach((ck, ci) => {
      const obj = {};
      for (const k of ck) {
        const cur = m.get(k);
        const prev = koOld.get(k);
        let ko = '';
        const rec = { en: cur.en, ko, synth: cur.synth, style: cur.style };
        if (prev) {
          if (prev.en === cur.en) rec.ko = prev.ko;
          else {
            changed++;
            if (typeof prev.ko === 'string' && prev.ko) rec.prevKo = prev.ko;
          }
        }
        obj[k] = rec;
        total++;
        if (rec.ko === null) nulls++;
        else if (rec.ko === '') empty++;
        else translated++;
      }
      const rel = `descriptions/${g}${chunks.length > 1 ? `.${ci + 1}` : ''}.json`;
      shards.push({ rel, obj });
    });
  }
  for (const s of shards) {
    writer.write(s.rel, stableJson(s.obj));
    allShards.set(s.rel, { entries: Object.keys(s.obj).map((k) => ({ key: k })) });
  }
  writer.prune('descriptions');
  summary.descriptions = {
    shards: shards.length, keys: total, translated, null: nulls, empty, nullRatio: total ? Number((nulls / total).toFixed(4)) : 0,
    enChanged: changed, byGroup: Object.fromEntries(DESC_GROUPS.map((g) => [g, groups.get(g).size])),
  };
  notes.descStats = stats;
  notes.descIssues = issues;
  notes.yamlErrors = yamlErrors;
  notes.baselineYaml = baseline;
  }
}

// ---- coverage.json ----
if (!CHECK) {
  const covRel = 'coverage.json';
  const cur = readJson(path.join(KO_DIR, covRel)) || {};
  const cov = { schema: 'ruflo-i18n-coverage/1', targets: cur.targets || {}, structuralEnglish: cur.structuralEnglish, weakTemplates: cur.weakTemplates, nullList: cur.nullList || {}, design: cur.design || {} };
  for (const [t, s] of Object.entries(summary)) cov.targets[t] = s;
  if (want('cli-unit') && TARGET !== 'cli-help') {
    const seen = new Set();
    cov.structuralEnglish = structural
      .filter((s) => { const k = `${s.file}:${s.line}:${s.method}:${s.key}`; if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => cmp(a.file, b.file) || a.line - b.line || cmp(a.key, b.key));
  }
  {
    // 이번에 처리한 대상의 약한 템플릿만 새 값으로 바꾼다(처리하지 않은 대상은 보존)
    const processed = (t) => (t === 'cli-help' ? !!summary['cli-help'] : t === 'cli-messages' ? !!summary['cli-messages'] : t.startsWith('plugins') ? !!summary.plugins : false);
    const prev = (cov.weakTemplates || []).filter((w) => !processed(w.target));
    const merged = [...prev, ...weakAll].sort((a, b) => cmp(a.target, b.target) || cmp(a.key, b.key) || cmp(a.ctx, b.ctx));
    if (merged.length) cov.weakTemplates = merged;
    else delete cov.weakTemplates;
  }
  // null 목록(메인이 F1 에서 검토): 샤드에서 ko === null 인 키
  const nullList = {};
  for (const [rel, sh] of allShards) {
    if (!sh.entries) continue;
    const t = rel.startsWith('plugins/') ? 'plugins' : rel.startsWith('cli/help') ? 'cli-help' : rel.startsWith('cli/messages') ? 'cli-messages' : null;
    if (!t) continue;
    for (const e of sh.entries) if (e.ko === null) (nullList[t] ||= []).push(e.key);
  }
  for (const t of Object.keys(nullList)) nullList[t].sort(cmp);
  for (const t of ['cli-help', 'cli-messages', 'plugins']) {
    if (!summary[t]) continue;
    if (nullList[t] && nullList[t].length) cov.nullList[t] = nullList[t];
    else delete cov.nullList[t];
  }
  if (summary.descriptions) {
    const nl = [];
    for (const rel of listJson('descriptions')) {
      const j = readJson(path.join(KO_DIR, rel));
      for (const [k, v] of Object.entries(j || {})) if (v && v.ko === null) nl.push(k);
    }
    if (nl.length) cov.nullList.descriptions = nl.sort(cmp);
    else delete cov.nullList.descriptions;
  }
  if (notes.descStats) {
    const d = notes.descStats;
    cov.design = {
      agents: { design: 91, actualFiles: d.cliAgents.md + d.cliAgents.nonMd, mdWithDescription: d.cliAgents.withDesc, mdNoFrontmatter: d.cliAgents.noFrontmatter, mdNoDescription: d.cliAgents.noDesc, nonMd: d.cliAgents.nonMd },
      skills: { design: 37, actual: d.cliSkills.md, withDescription: d.cliSkills.withDesc, noDescription: d.cliSkills.noDesc + d.cliSkills.noFrontmatter },
      commands: { design: 167, actual: d.cliCommands.md, withDescription: d.cliCommands.withDesc, synth: d.cliCommands.synth, noDescription: d.cliCommands.noDesc },
      marketplace: { design: 46, marketplacePlugins: d.marketplacePlugins, pluginDirs: d.pluginsDirs, pluginJson: d.pluginJson },
      issues: notes.descIssues,
    };
  }
  if (!cov.structuralEnglish) delete cov.structuralEnglish;
  if (!cov.weakTemplates) delete cov.weakTemplates;
  writer.write(covRel, stableJson(cov));
}

// ---------------------------------------------------------------------------
// 보고
// ---------------------------------------------------------------------------
function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function printReport() {
  console.log('== i18n extract report ==');
  console.log(pad('target', 14) + pad('shards', 8) + pad('keys', 8) + pad('templ', 8) + pad('ko', 8) + pad('null', 8) + pad('empty(누락)', 12) + pad('null비율', 10) + '약한템플릿');
  for (const [t, s] of Object.entries(summary)) {
    console.log(pad(t, 14) + pad(s.shards, 8) + pad(s.keys, 8) + pad(s.templates ?? '-', 8) + pad(s.translated, 8) + pad(s.null, 8) + pad(s.empty, 12) + pad((s.nullRatio * 100).toFixed(1) + '%', 10) + (s.weakTemplates ?? '-'));
  }
  if (summary.plugins) console.log('plugins per plugin:', JSON.stringify(summary.plugins.perPlugin));
  if (summary.descriptions) console.log('descriptions by group:', JSON.stringify(summary.descriptions.byGroup), `enChanged=${summary.descriptions.enChanged}`);
  if (notes.descStats) {
    const d = notes.descStats;
    console.log('-- 설계 수 대 실제 수 --');
    console.log(`agents : 설계 91 / 실제 파일 ${d.cliAgents.md + d.cliAgents.nonMd} (md ${d.cliAgents.md}: 머리말+description ${d.cliAgents.withDesc}, 머리말 없음 ${d.cliAgents.noFrontmatter}, description 없음 ${d.cliAgents.noDesc}; 비-md(yaml/json) ${d.cliAgents.nonMd} 제외)`);
    console.log(`skills : 설계 37 / 실제 SKILL.md ${d.cliSkills.md} (description ${d.cliSkills.withDesc})`);
    console.log(`commands: 설계 167 / 실제 ${d.cliCommands.md} (머리말 ${d.cliCommands.withDesc}, synth ${d.cliCommands.synth}, 없음 ${d.cliCommands.noDesc})`);
    console.log(`marketplace: 설계 46 / 마켓플레이스 항목 ${d.marketplacePlugins} / plugins 디렉터리 ${d.pluginsDirs} / plugin.json ${d.pluginJson} (차이: 마켓플레이스 밖 플러그인)`);
    console.log(`plugins: commands md ${d.pluginCommands.md} (desc ${d.pluginCommands.withDesc}, synth ${d.pluginCommands.synth}), agents md ${d.pluginAgents.md} (desc ${d.pluginAgents.withDesc}, 머리말 없음 ${d.pluginAgents.noFrontmatter}), skills SKILL.md ${d.pluginSkills.md} (desc ${d.pluginSkills.withDesc}), userConfig 항목 ${d.userConfig}`);
    if (notes.descIssues.length) console.log(`description 이상: ${notes.descIssues.length}건 (coverage.json design.issues)`);
    console.log(`baseline YAML 오류 파일: ${notes.baselineYaml.length} (${notes.baselineYaml.join(', ')})`);
    if (descYamlErrors.length) console.log(`!! 새 YAML 오류: ${descYamlErrors.map((e) => e.file).join(', ')}`);
  }
  if (notes.cliReached) console.log(`cli-messages 1단계 모듈 ${notes.cliReached.length}개: ${notes.cliReached.join(', ')}`);
  console.log(`structuralEnglish(console.*): ${structural.length}`);
  if (summary['cli-messages']) {
    const bySource = {};
    for (const [rel, sh] of allShards) if (rel.startsWith('cli/messages/')) bySource[sh.source.replace(`${CLI}/src/`, '')] = (bySource[sh.source.replace(`${CLI}/src/`, '')] || 0) + sh.entries.length;
    console.log('cli-messages 출처별 키 수:', JSON.stringify(bySource));
  }
}

if (REPORT) printReport();

if (CHECK) {
  const changed = writer.changed;
  if (changed.length || descYamlErrors.length) {
    console.log(`--check: 디스크 샤드가 최신이 아닙니다 (${changed.length}개 파일 차이)`);
    for (const c of changed.slice(0, 40)) console.log(`  ${c}`);
    if (descYamlErrors.length) console.log(`  새 YAML 오류: ${descYamlErrors.map((e) => e.file).join(', ')}`);
    process.exit(1);
  }
  console.log('--check: 최신입니다(새 키 없음)');
} else {
  console.log(`extract: ${writer.changed.length}개 파일 갱신 (${Object.entries(summary).map(([t, s]) => `${t}=${s.keys}`).join(', ')})`);
  if (descYamlErrors.length) {
    console.error(`!! baseline 에 없는 YAML 오류: ${descYamlErrors.map((e) => `${e.file} (${e.error})`).join('; ')}`);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// 번역 배치 계획
// ---------------------------------------------------------------------------
if (PLAN) {
  const N = Number(PLAN) || 550;
  const LO = 400;
  const HI = 600;
  // 디스크 상태 기준(--check 이어도 읽기만 한다). 순서: cli help → cli messages → plugins → descriptions
  const rank = (rel) => (rel.startsWith('cli/help') ? 0 : rel.startsWith('cli/messages') ? 1 : rel.startsWith('plugins/') ? 2 : 3);
  const list = [];
  for (const rel of listJson('.')) {
    if (!/^(cli|plugins|descriptions)\//.test(rel)) continue;
    const j = readJson(path.join(KO_DIR, rel));
    if (!j) continue;
    const n = Array.isArray(j.entries) ? j.entries.length : Object.keys(j).length;
    if (n) list.push({ rel: `i18n/ko/${rel}`, n, r: rank(rel) });
  }
  list.sort((a, b) => a.r - b.r || cmp(a.rel, b.rel));
  let remaining = list.slice();
  const batches = [];
  while (remaining.length) {
    const take = [];
    let sum = 0;
    for (const s of remaining) {
      if (sum + s.n <= HI) {
        take.push(s);
        sum += s.n;
        if (sum >= N) break;
      }
    }
    if (!take.length) take.push(remaining[0]), (sum = remaining[0].n); // 단일 샤드가 600 초과(발생하지 않아야 함)
    const set = new Set(take);
    remaining = remaining.filter((s) => !set.has(s));
    batches.push({ shards: take.map((s) => s.rel), entries: sum });
  }
  // 마지막 배치가 400 미만이면 앞 배치 중 여유 있는 곳에 합친다
  const last = batches[batches.length - 1];
  if (batches.length > 1 && last.entries < LO) {
    for (let i = batches.length - 2; i >= 0; i--) {
      if (batches[i].entries + last.entries <= HI) {
        batches[i].shards.push(...last.shards);
        batches[i].entries += last.entries;
        batches.pop();
        break;
      }
    }
  }
  const plan = batches.map((b, i) => ({ id: `D${i + 1}`, shards: b.shards, entries: b.entries }));
  console.log('== batch plan ==');
  console.log(JSON.stringify(plan, null, 1));
  console.log(`batches=${plan.length} total=${plan.reduce((n, b) => n + b.entries, 0)} min=${Math.min(...plan.map((b) => b.entries))} max=${Math.max(...plan.map((b) => b.entries))}`);
}

void hasHangul;
