// JSON 문자열 토큰의 위치를 찾아 그 문자열만 바꾼다 (계획 §4.5). 다른 바이트는 그대로 둔다.
// 의존성 없음. 입력은 유효한 JSON 이어야 한다(아니면 throw).

/** JSON 텍스트의 모든 문자열 "값" 토큰. 반환: [{ path: (string|number)[], start, end, value }] (start..end 는 따옴표 포함 구간) */
export function scanStrings(text) {
  const out = [];
  let i = 0;
  const ws = () => {
    while (i < text.length && ' \t\r\n'.includes(text[i])) i++;
  };
  const str = () => {
    const start = i;
    i++; // "
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    if (i >= text.length) throw new Error(`unterminated string at ${start}`);
    i++;
    return { start, end: i, value: JSON.parse(text.slice(start, i)) };
  };
  const value = (p) => {
    ws();
    const c = text[i];
    if (c === '"') {
      const t = str();
      out.push({ path: p, ...t });
    } else if (c === '{') {
      i++;
      ws();
      if (text[i] === '}') return void i++;
      for (;;) {
        ws();
        const k = str();
        ws();
        if (text[i] !== ':') throw new Error(`expected ':' at ${i}`);
        i++;
        value([...p, k.value]);
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === '}') return void i++;
        throw new Error(`expected ',' or '}' at ${i}`);
      }
    } else if (c === '[') {
      i++;
      ws();
      if (text[i] === ']') return void i++;
      for (let n = 0; ; n++) {
        value([...p, n]);
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === ']') return void i++;
        throw new Error(`expected ',' or ']' at ${i}`);
      }
    } else {
      const m = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|^true|^false|^null/.exec(text.slice(i, i + 40));
      if (!m) throw new Error(`unexpected token at ${i}`);
      i += m[0].length;
    }
  };
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  value([]);
  ws();
  if (i < text.length) throw new Error(`trailing data at ${i}`);
  return out;
}

export const pathKey = (p) => p.map((s) => (typeof s === 'number' ? `[${s}]` : `.${s}`)).join('');

/**
 * edits: [{ path, value }]. 해당 경로의 문자열 토큰만 JSON.stringify(value) 로 바꾼다.
 * 경로가 없거나 문자열이 아니면 throw. 바꾼 뒤 JSON.parse 로 재검증한다.
 */
export function setStrings(text, edits) {
  const toks = new Map(scanStrings(text).map((t) => [pathKey(t.path), t]));
  const plan = [];
  for (const e of edits) {
    const t = toks.get(pathKey(e.path));
    if (!t) throw new Error(`문자열 경로를 찾지 못했습니다: ${pathKey(e.path)}`);
    plan.push({ t, text: JSON.stringify(e.value) });
  }
  plan.sort((a, b) => b.t.start - a.t.start);
  let out = text;
  for (const p of plan) out = out.slice(0, p.t.start) + p.text + out.slice(p.t.end);
  JSON.parse(out.charCodeAt(0) === 0xfeff ? out.slice(1) : out);
  return out;
}

// ---------------------------------------------------------------------------
// 파일 종류별 description 위치 (extract.mjs 의 키 규칙과 같다)
// ---------------------------------------------------------------------------

/** marketplace.json → Map<'marketplace:$root'|'marketplace:<name>', {path, value}> */
export function marketplaceTargets(text) {
  const obj = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  const m = new Map();
  if (typeof obj.description === 'string') m.set('marketplace:$root', { path: ['description'], value: obj.description });
  (obj.plugins || []).forEach((pl, i) => {
    if (pl && typeof pl.description === 'string') m.set(`marketplace:${pl.name}`, { path: ['plugins', i, 'description'], value: pl.description });
  });
  return m;
}

/** plugin.json → Map<'plugin:<name>'|'plugin:<name>#userConfig.<k>.title|description', {path, value}> */
export function pluginTargets(text, fallbackName = '') {
  const obj = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  const name = typeof obj.name === 'string' ? obj.name : fallbackName;
  const m = new Map();
  if (typeof obj.description === 'string') m.set(`plugin:${name}`, { path: ['description'], value: obj.description });
  if (obj.userConfig && typeof obj.userConfig === 'object') {
    for (const k of Object.keys(obj.userConfig)) {
      for (const f of ['title', 'description']) {
        const u = obj.userConfig[k];
        if (u && typeof u[f] === 'string') m.set(`plugin:${name}#userConfig.${k}.${f}`, { path: ['userConfig', k, f], value: u[f] });
      }
    }
  }
  return m;
}

/** 번역이 허용되는 JSON 경로인가 (JSON 검사: description, userConfig.*.title|description, 마켓플레이스 plugins[].description). */
export function isAllowedPath(p) {
  const s = pathKey(p);
  return s === '.description' || /^\.plugins\[\d+\]\.description$/.test(s) || /^\.userConfig\.[^.[]+\.(title|description)$/.test(s);
}

/**
 * 두 JSON 텍스트(원본 a, 현재 b)를 재귀 비교해 허용 경로 밖에서 다른 곳을 모은다.
 * 반환: 위반 경로 문자열 목록(비면 통과).
 */
export function diffOutsideAllowed(aText, bText) {
  const a = JSON.parse(aText.charCodeAt(0) === 0xfeff ? aText.slice(1) : aText);
  const b = JSON.parse(bText.charCodeAt(0) === 0xfeff ? bText.slice(1) : bText);
  const bad = [];
  const walk = (x, y, p) => {
    if (typeof x === 'string' && typeof y === 'string') {
      if (x !== y && !isAllowedPath(p)) bad.push(pathKey(p) || '(root)');
      return;
    }
    if (Array.isArray(x) && Array.isArray(y)) {
      if (x.length !== y.length) return void bad.push(`${pathKey(p) || '(root)'} (길이 ${x.length}→${y.length})`);
      x.forEach((v, i) => walk(v, y[i], [...p, i]));
      return;
    }
    if (x && y && typeof x === 'object' && typeof y === 'object' && !Array.isArray(x) && !Array.isArray(y)) {
      const kx = Object.keys(x);
      const ky = Object.keys(y);
      if (kx.join('\u0000') !== ky.join('\u0000')) return void bad.push(`${pathKey(p) || '(root)'} (키 집합·순서)`);
      for (const k of kx) walk(x[k], y[k], [...p, k]);
      return;
    }
    if (JSON.stringify(x) !== JSON.stringify(y)) bad.push(pathKey(p) || '(root)');
  };
  walk(a, b, []);
  return bad;
}
