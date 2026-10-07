// 줄 기반 머리말(frontmatter) 읽기·쓰기 (계획 §4.5). 의존성 없음(YAML 검증은 호출하는 쪽이 한다).
// 원칙: 바뀌는 것은 0열 `description:` 과 그 연속 줄뿐이다. EOL·BOM·나머지 바이트는 그대로 둔다.

const BLOCK_RE = /^[|>]([+-]?)(\d?)([+-]?)\s*(#.*)?$/;

/** 텍스트를 줄 단위로 나눈다. 각 원소는 줄 내용과 줄 끝(eol)을 따로 갖는다. */
export function splitLines(text) {
  const out = [];
  const re = /([^\r\n]*)(\r\n|\n|\r|$)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[0] === '' && m.index >= text.length) break;
    out.push({ text: m[1], eol: m[2] });
    if (m[2] === '') break;
  }
  return out;
}

export const joinLines = (lines) => lines.map((l) => l.text + l.eol).join('');

/** 파일의 대표 EOL. 첫 줄 끝을 따른다. 없으면 '\n'. */
export function detectEol(text) {
  const m = /\r\n|\n|\r/.exec(text);
  return m ? m[0] : '\n';
}

const stripBom = (t) => (t.charCodeAt(0) === 0xfeff ? { bom: '﻿', body: t.slice(1) } : { bom: '', body: t });

/**
 * 머리말 위치를 찾는다.
 * 반환 null(머리말 없음) | { error } | {
 *   bom, lines, endLine(닫는 --- 의 줄 번호), eol,
 *   hasDesc, descStart, descEnd(제외),  // lines 인덱스. description 줄과 연속 줄의 범위
 *   style: plain|double|single|block, indicator(블록일 때 '|-' 같은 표지), indent(블록 들여쓰기 문자열),
 *   rest(첫 줄에서 'description:' 뒤 원문)
 * }
 */
export function parseFrontmatter(text) {
  const { bom, body } = stripBom(text);
  const lines = splitLines(body);
  if (!lines.length || !/^---[ \t]*$/.test(lines[0].text)) return null;
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (/^---[ \t]*$/.test(lines[i].text)) {
      end = i;
      break;
    }
  }
  if (end < 0) return { error: 'unterminated frontmatter' };
  const eol = lines[0].eol || '\n';
  const info = { bom, lines, endLine: end, eol, hasDesc: false };
  const d = lines.findIndex((l, i) => i > 0 && i < end && /^description:/.test(l.text));
  if (d < 0) return info;
  let e = d + 1;
  while (e < end) {
    const t = lines[e].text;
    if (t === '' || /^[ \t]/.test(t)) e++;
    else break;
  }
  // 뒤쪽 빈 줄은 범위에서 뺀다
  while (e > d + 1 && lines[e - 1].text.trim() === '') e--;
  const rest = lines[d].text.slice('description:'.length).trim();
  let style = 'plain';
  let indicator = '';
  let indent = '  ';
  const bm = BLOCK_RE.exec(rest);
  if (bm) {
    style = 'block';
    indicator = rest.match(/^[|>][+\-\d]*/)[0];
    const digit = /\d/.exec(indicator);
    if (digit) indent = ' '.repeat(Number(digit[0]));
    else {
      const first = lines.slice(d + 1, e).find((l) => l.text.trim() !== '');
      const lead = first ? /^[ \t]*/.exec(first.text)[0] : '';
      if (lead) indent = lead;
    }
  } else if (rest.startsWith('"')) style = 'double';
  else if (rest.startsWith("'")) style = 'single';
  return Object.assign(info, { hasDesc: true, descStart: d, descEnd: e, style, indicator, indent, rest });
}

/** 머리말 블록(--- 와 --- 사이)의 원문. YAML 파서에 넘길 때 쓴다. */
export function frontmatterSource(fm) {
  return fm.lines.slice(1, fm.endLine).map((l) => l.text).join('\n');
}

/** 안전하게 plain 으로 쓸 수 있는가 (T15 보강). */
export function plainSafe(v) {
  if (typeof v !== 'string' || v === '') return false;
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(v)) return false;
  if (/: |\s#|\t/.test(v)) return false;
  if (v.endsWith(':')) return false;
  if (/^(true|false|null|~|yes|no|on|off|[-+]?\d)/i.test(v)) return false;
  if (v !== v.trim()) return false;
  if (/[\r\n]/.test(v)) return false;
  return true;
}

/** description 한 값을 style 에 맞는 줄들(eol 제외)로 만든다. */
export function renderDescriptionLines(value, { style = 'plain', indicator = '|', indent = '  ' } = {}) {
  const v = String(value);
  if (style === 'block') {
    const body = v.replace(/\n+$/, '').split('\n').map((l) => (l === '' ? '' : indent + l));
    return [`description: ${indicator || '|'}`, ...body];
  }
  if (style === 'single' && !/[\r\n]/.test(v)) return [`description: '${v.replace(/'/g, "''")}'`];
  if (style === 'plain' && plainSafe(v)) return [`description: ${v}`];
  return [`description: ${JSON.stringify(v)}`];
}

/** 머리말이 있는 파일의 description 만 바꾼다. 머리말이 없거나 description 이 0열에 없으면 null. */
export function setDescription(text, value) {
  const fm = parseFrontmatter(text);
  if (!fm || fm.error || !fm.hasDesc) return null;
  const fresh = renderDescriptionLines(value, fm);
  const eol = fm.lines[fm.descStart].eol || fm.eol;
  const repl = fresh.map((t) => ({ text: t, eol }));
  // 원래 범위의 마지막 줄 끝(eol)을 새 마지막 줄에 이어 쓴다
  repl[repl.length - 1].eol = fm.lines[fm.descEnd - 1].eol || eol;
  const lines = [...fm.lines.slice(0, fm.descStart), ...repl, ...fm.lines.slice(fm.descEnd)];
  return fm.bom + joinLines(lines);
}

/** 머리말이 없던 파일 앞에 `---\ndescription: …\n---\n\n` 을 붙인다. */
export function addSynthFrontmatter(text, value) {
  const { bom, body } = stripBom(text);
  const eol = detectEol(body);
  const [first] = renderDescriptionLines(value, { style: 'plain' });
  return bom + `---${eol}${first}${eol}---${eol}${eol}` + body;
}

/** 현재 description 값(YAML 해석 없이 줄 기반 근사: 따옴표·블록 풀이 포함). 없으면 null. */
export function readDescriptionValue(text) {
  const fm = parseFrontmatter(text);
  if (!fm || fm.error || !fm.hasDesc) return null;
  const first = fm.rest;
  const cont = fm.lines.slice(fm.descStart + 1, fm.descEnd).map((l) => l.text);
  if (fm.style === 'block') {
    const folded = fm.indicator.startsWith('>');
    const strip = fm.indent.length;
    const body = cont.map((l) => (l.trim() === '' ? '' : l.slice(Math.min(strip, /^[ \t]*/.exec(l)[0].length))));
    const v = folded ? body.join(' ').replace(/ +\n/g, '\n') : body.join('\n');
    return v.replace(/\n+$/, '');
  }
  const joined = [first, ...cont.map((l) => l.trim())].filter((s) => s !== '').join(' ');
  if (fm.style === 'double') {
    try {
      return JSON.parse(joined);
    } catch {
      return joined.replace(/^"|"$/g, '');
    }
  }
  if (fm.style === 'single') return joined.replace(/^'|'$/g, '').replace(/''/g, "'");
  return joined;
}

/**
 * 원본(orig)과 현재(cur) 텍스트가 머리말 허용 범위 안에서만 다른가 (FM_DIFF).
 * 반환: 위반 사유 문자열 목록(비면 통과).
 */
export function diffFrontmatter(orig, cur) {
  const bad = [];
  if (orig === cur) return bad;
  const fo = parseFrontmatter(orig);
  const fc = parseFrontmatter(cur);
  if (fc && fc.error) return ['현재 머리말이 닫히지 않았습니다'];
  if (fo === null) {
    // synth 추가: 앞에 머리말 블록, 나머지는 원본 그대로
    if (!fc) return ['머리말이 없던 파일에 머리말이 생기지 않았는데 내용이 바뀌었습니다'];
    if (!fc.hasDesc) return ['추가된 머리말에 description 이 없습니다'];
    const o = stripBom(orig);
    const c = stripBom(cur);
    const head = joinLines(fc.lines.slice(0, fc.endLine + 1));
    const blank = fc.lines[fc.endLine + 1];
    const headEnd = head.length + (blank && blank.text === '' ? blank.eol.length : 0);
    if (o.bom !== c.bom) bad.push('BOM 이 바뀌었습니다');
    if (c.body.slice(headEnd) !== o.body) bad.push('synth 머리말 뒤의 본문 바이트가 원본과 다릅니다');
    if (fc.descStart !== 1 || fc.descEnd !== 2 || fc.endLine !== 2) bad.push('synth 머리말은 description 한 줄만 가져야 합니다');
    return bad;
  }
  if (fo.error) return ['원본 머리말이 깨져 있습니다(손대면 안 되는 파일)'];
  if (!fc) return ['머리말이 사라졌습니다'];
  if (!fo.hasDesc || !fc.hasDesc) {
    if (fo.hasDesc !== fc.hasDesc) bad.push('description 줄이 생기거나 사라졌습니다');
    // 양쪽 모두 description 이 없으면 파일은 한 바이트도 바뀌면 안 된다(name·본문 변경 탐지)
    else if (orig !== cur) bad.push('description 이 없는 파일의 내용이 바뀌었습니다');
    return bad;
  }
  if (fo.bom !== fc.bom) bad.push('BOM 이 바뀌었습니다');
  const before = (x) => joinLines(x.lines.slice(0, x.descStart));
  const after = (x) => joinLines(x.lines.slice(x.descEnd));
  if (before(fo) !== before(fc)) bad.push('description 앞의 줄이 바뀌었습니다');
  if (after(fo) !== after(fc)) bad.push('description 뒤의 줄·본문이 바뀌었습니다');
  return bad;
}

/** description: 이 머리말 안에서 0열에 있는가 (FM_DIFF 의 마지막 조건). */
export function descriptionAtCol0(text) {
  const fm = parseFrontmatter(text);
  if (!fm || fm.error) return true;
  const idx = fm.lines.findIndex((l, i) => i > 0 && i < fm.endLine && /^\s+description:/.test(l.text));
  const col0 = fm.lines.some((l, i) => i > 0 && i < fm.endLine && /^description:/.test(l.text));
  return !(idx >= 0 && !col0);
}
