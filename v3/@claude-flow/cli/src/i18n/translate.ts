/**
 * Pure translation engine (ko-l10n §4.1.3). Never throws: any failure returns
 * the input unchanged. No I/O, no process access.
 */

import { applyTemplate, type Dict } from './dict.js';

const MAX_LEN = 2000;
const HANGUL = /[가-힣]/;
const ANSI_SPLIT = /(\x1b\[[0-9;?]*[A-Za-z])/;
const SYMBOLS =
  '(?:[\\u2713\\u2714\\u2717\\u2718\\u2716\\u2022\\u00B7\\u26A0\\u2139\\u2192\\u25B8\\u25BA\\u25B6\\u2605\\u2606*>?\\-]|\\p{Extended_Pictographic}\\uFE0F?)';
const PREFIX_RE = new RegExp(`^\\s*(?:${SYMBOLS}+\\s+)?`, 'u');

interface Split {
  prefix: string;
  core: string;
  suffix: string;
}

/** §4.1.3 rule 5: peel leading symbols/whitespace and trailing whitespace. */
function splitAffix(s: string): Split {
  const m = PREFIX_RE.exec(s);
  const prefix = m ? m[0] : '';
  const rest = s.slice(prefix.length);
  const core = rest.replace(/\s+$/, '');
  return { prefix, core, suffix: rest.slice(core.length) };
}

function looksLikeJson(s: string): boolean {
  const t = s.trim();
  if (t.length === 0) return false;
  const a = t[0];
  const z = t[t.length - 1];
  if (!((a === '{' && z === '}') || (a === '[' && z === ']'))) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

function tmpl(d: Dict, text: string): string | null {
  if (text.length === 0) return null;
  for (const t of d.templates()) {
    const r = applyTemplate(t, text, d.exact);
    if (r !== null) return r;
  }
  return null;
}

/** Whole-string template whose captures are inserted verbatim (no dictionary lookup of captures). */
function tmplVerbatim(d: Dict, text: string): string | null {
  if (text.length === 0) return null;
  for (const t of d.templates()) {
    const r = applyTemplate(t, text);
    if (r !== null) return r;
  }
  return null;
}

/** exact, then template, for a bare core string. */
function coreLookup(d: Dict, core: string, withTemplate: boolean): string | null {
  if (core.length === 0) return null;
  const e = d.exact.get(core);
  if (e !== undefined) return e;
  return withTemplate ? tmpl(d, core) : null;
}

/** Exact (+ affix) lookup, optionally followed by template. */
function lookup(d: Dict, text: string, withTemplate: boolean): string | null {
  const e = d.exact.get(text);
  if (e !== undefined) return e;
  const sp = splitAffix(text);
  if (sp.core.length > 0 && (sp.prefix || sp.suffix)) {
    const r = coreLookup(d, sp.core, withTemplate);
    if (r !== null) return sp.prefix + r + sp.suffix;
  }
  if (withTemplate) {
    const r = tmpl(d, text);
    if (r !== null) return r;
  }
  return null;
}

/** Apply f to each non-ANSI run of s; null when s has no ESC or nothing changed. */
function ansiMap(s: string, f: (run: string) => string | null): string | null {
  if (s.indexOf('\x1b') === -1) return null;
  const runs = s.split(ANSI_SPLIT);
  let changed = false;
  for (let i = 0; i < runs.length; i += 2) {
    const run = runs[i];
    if (!run || HANGUL.test(run)) continue;
    const t = f(run);
    if (t !== null) {
      runs[i] = t;
      changed = true;
    }
  }
  return changed ? runs.join('') : null;
}

/** Rule 7: colon split. Left may use templates, right is exact-only. */
function colonSplit(d: Dict, text: string): string | null {
  const i = text.indexOf(': ');
  if (i < 0) return null;
  const left = text.slice(0, i);
  const right = text.slice(i + 2);
  let l = HANGUL.test(left) ? null : lookup(d, left, true);
  let r = HANGUL.test(right) ? null : lookup(d, right, false);
  // a side that still has ANSI and did not match whole: translate its runs (right stays exact-only)
  if (l === null && !HANGUL.test(left)) l = ansiMap(left, (x) => lookupLine(d, x, true));
  if (r === null && !HANGUL.test(right)) r = ansiMap(right, (x) => lookup(d, x, false));
  if (l === null && r === null) return null;
  return (l ?? left) + ': ' + (r ?? right);
}

/** Rule 6 for one text run (no ANSI handling). */
function lookupLine(d: Dict, u: string, tried = false): string | null {
  if (u.length === 0 || HANGUL.test(u)) return null;
  const r = lookup(d, u, !tried);
  if (r !== null) return r;
  return colonSplit(d, u);
}

/** Rules 6+8 for one unit (line). `tried`: whole-string templates already failed on u. */
function unit(d: Dict, u: string, tried = false): string {
  if (u.length === 0 || HANGUL.test(u)) return u;
  const r = lookupLine(d, u, tried);
  if (r !== null) return r;
  if (u.indexOf('\x1b') === -1) return u;
  const runs = u.split(ANSI_SPLIT);
  // visible text decides where the first ': ' is; everything right of it is exact-only (constraint 3)
  let vis = '';
  for (let i = 0; i < runs.length; i += 2) vis += runs[i];
  const ci = vis.indexOf(': ');
  const cut = ci < 0 ? -1 : ci + 2;
  let pos = 0;
  let changed = false;
  for (let i = 0; i < runs.length; i += 2) {
    const run = runs[i];
    const start = pos;
    pos += run.length;
    if (!run || HANGUL.test(run)) continue;
    let t: string | null = null;
    if (cut < 0 || pos <= ci) {
      t = lookupLine(d, run);
    } else if (start >= cut) {
      const x = lookup(d, run, false);
      t = x;
    } else {
      // run holds the colon (or starts at the space right after it)
      const k = ci - start;
      if (k < 0) {
        t = lookup(d, run, false);
      } else {
        const label = run.slice(0, k);
        const sep = run.slice(k, Math.min(k + 2, run.length));
        const tail = run.slice(k + 2);
        const l = label && !HANGUL.test(label) ? lookup(d, label, true) : null;
        const rr = tail && !HANGUL.test(tail) ? lookup(d, tail, false) : null;
        if (l !== null || rr !== null) t = (l ?? label) + sep + (rr ?? tail);
      }
    }
    if (t !== null) {
      runs[i] = t;
      changed = true;
    }
  }
  return changed ? runs.join('') : u;
}

function run(d: Dict, s: string): string {
  if (looksLikeJson(s)) return s;
  const e = d.exact.get(s);
  if (e !== undefined) return e;
  // rule 3: whole-string template, ANSI allowed
  {
    const sp = splitAffix(s);
    if (sp.core.length > 0) {
      const r = tmpl(d, sp.core);
      if (r !== null) return sp.prefix + r + sp.suffix;
    }
    if (sp.prefix || sp.suffix) {
      const r = tmpl(d, s);
      if (r !== null) return r;
    }
  }
  if (s.indexOf('\n') >= 0) {
    return s
      .split(/(\r?\n)/)
      .map((part, i) => (i % 2 === 1 ? part : unit(d, part)))
      .join('');
  }
  return unit(d, s, true);
}

/** Translate one string. Returns the input unchanged on any miss or error. */
export function translate(text: unknown, dict: Dict): string {
  try {
    if (typeof text !== 'string') return text as string;
    if (text.length === 0 || text.length > MAX_LEN) return text;
    const hit = dict.cache.get(text);
    if (hit !== undefined) return hit === null ? text : hit;
    const out = run(dict, text);
    dict.cache.set(text, out === text ? null : out);
    return out;
  } catch {
    return text as string;
  }
}

/**
 * Whole-string translation only (G1): exact match, then affix-split exact,
 * then whole-string template (captures stay verbatim, never re-translated). No line split, no colon split, no ANSI runs.
 * Placeholder captures stay verbatim. Never throws.
 */
export function translateWhole(text: unknown, dict: Dict): string {
  try {
    if (typeof text !== 'string') return text as string;
    if (text.length === 0 || text.length > MAX_LEN || HANGUL.test(text)) return text;
    if (looksLikeJson(text)) return text;
    const e = dict.exact.get(text);
    if (e !== undefined) return e;
    const sp = splitAffix(text);
    if (sp.core.length > 0) {
      const x = dict.exact.get(sp.core);
      if (x !== undefined) return sp.prefix + x + sp.suffix;
      const r = tmplVerbatim(dict, sp.core);
      if (r !== null) return sp.prefix + r + sp.suffix;
    }
    const r = tmplVerbatim(dict, text);
    return r !== null ? r : text;
  } catch {
    return text as string;
  }
}
