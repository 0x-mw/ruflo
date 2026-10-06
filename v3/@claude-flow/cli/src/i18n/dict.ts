/**
 * i18n dictionary location, lazy loading, template compilation and LRU cache
 * (ko-l10n §4.1.2, §4.1.4). Nothing here runs at import time.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Template {
  /** Longest static fragment, used as a cheap pre-filter. */
  anchor: string;
  /** Total length of the static fragments (sort key). */
  staticLen: number;
  re: RegExp;
  /** Translation pieces: strings and capture indexes. */
  parts: Array<string | number>;
  /** Inputs longer than this skip the template (backtracking guard). 0 = no cap. */
  maxLen: number;
}

interface RawTemplate {
  key: string;
  value: string;
}

export class Lru<V> {
  private map = new Map<string, V>();
  constructor(private readonly max: number) {}
  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }
  has(key: string): boolean {
    return this.map.has(key);
  }
  set(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) {
      const first = this.map.keys().next();
      if (!first.done) this.map.delete(first.value);
    }
  }
  get size(): number {
    return this.map.size;
  }
}

export interface Dict {
  exact: Map<string, string>;
  /** Compiled on first use. */
  templates(): Template[];
  /** Memo of whole-string results (null = no translation). */
  cache: Lru<string | null>;
}

const PLACEHOLDER = /\{(\d+)\}/g;
const EDGE_WIDE = [': ', ' — ', ' - ', '= '];

function endsWithAny(s: string, list: string[]): boolean {
  return list.some((x) => s.endsWith(x));
}
function startsWithAny(s: string, list: string[]): boolean {
  return list.some((x) => s.startsWith(x));
}
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&');
}

/** True when the key has the `{n}` placeholder shape. */
export function isTemplateKey(key: string): boolean {
  return /\{\d+\}/.test(key);
}

/**
 * Compile a template key/value pair. Returns null when the pair is invalid or
 * the key does not qualify (too few static letters, adjacent placeholders,
 * non-sequential numbering, placeholder-set mismatch).
 */
export function compileTemplate(key: string, value: string): Template | null {
  try {
    const statics: string[] = [];
    const nums: number[] = [];
    let last = 0;
    PLACEHOLDER.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PLACEHOLDER.exec(key)) !== null) {
      statics.push(key.slice(last, m.index));
      nums.push(Number(m[1]));
      last = m.index + m[0].length;
    }
    statics.push(key.slice(last));
    if (nums.length === 0) return null;
    // sequential from 0, each once
    for (let i = 0; i < nums.length; i++) if (nums[i] !== i) return null;
    // adjacent placeholders forbidden
    for (let i = 1; i < statics.length - 1; i++) if (statics[i] === '') return null;
    // qualification
    const letters = statics.join('').replace(/[^A-Za-z]/g, '').length;
    if (letters < 6) return null;
    if (!statics.some((s) => /[A-Za-z]{4,}/.test(s))) return null;
    // translation placeholder set: same set, each once
    const vnums: number[] = [];
    const parts: Array<string | number> = [];
    let vlast = 0;
    PLACEHOLDER.lastIndex = 0;
    while ((m = PLACEHOLDER.exec(value)) !== null) {
      if (m.index > vlast) parts.push(value.slice(vlast, m.index));
      parts.push(Number(m[1]));
      vnums.push(Number(m[1]));
      vlast = m.index + m[0].length;
    }
    if (vlast < value.length) parts.push(value.slice(vlast));
    if (vnums.length !== nums.length) return null;
    if (new Set(vnums).size !== vnums.length) return null;
    for (const n of vnums) if (n < 0 || n >= nums.length) return null;

    let lazy = 0;
    let src = '^';
    for (let i = 0; i < statics.length; i++) {
      src += escapeRe(statics[i]);
      if (i < nums.length) {
        const first = i === 0 && statics[0] === '';
        const lastEdge = i === nums.length - 1 && statics[statics.length - 1] === '';
        let greedyWide = false;
        if (first || lastEdge) {
          const adj = first ? statics[1] : statics[i];
          greedyWide = first ? startsWithAny(adj, EDGE_WIDE) : endsWithAny(adj, EDGE_WIDE);
          src += greedyWide ? '([\\s\\S]+)' : '(\\S+)';
        } else {
          src += '([\\s\\S]+?)';
          lazy++;
        }
      }
    }
    src += '$';
    const nonEmpty = statics.filter((s) => s.length > 0);
    const anchor = nonEmpty.reduce((a, b) => (b.length > a.length ? b : a), '');
    return {
      anchor,
      staticLen: statics.reduce((n, s) => n + s.length, 0),
      re: new RegExp(src),
      parts,
      // Backtracking guard (not in spec): lines longer than this never match, i.e. stay English.
      // Known limitation; 3+ lazy placeholders -> 200 chars, 5+ -> 80 chars.
      maxLen: lazy >= 5 ? 80 : lazy >= 3 ? 200 : 0,
    };
  } catch {
    return null;
  }
}

/** Apply a compiled template to text. Returns null when it does not match. */
export function applyTemplate(
  t: Template,
  text: string,
  exact?: Map<string, string>,
): string | null {
  if (t.maxLen > 0 && text.length > t.maxLen) return null;
  if (t.anchor && !text.includes(t.anchor)) return null;
  const m = t.re.exec(text);
  if (!m) return null;
  let out = '';
  for (const p of t.parts) {
    if (typeof p !== 'number') {
      out += p;
      continue;
    }
    const cap = m[p + 1] ?? '';
    // captures: exact lookup once, no recursion (§4.1.4)
    out += (exact && exact.get(cap)) || cap;
  }
  return out;
}

/** Build a Dict from an entries record. */
export function buildDict(input: Record<string, unknown> | Map<string, unknown>): Dict {
  const entries: Map<string, unknown> =
    input instanceof Map ? input : new Map(Object.entries(input));
  const exact = new Map<string, string>();
  const raws: RawTemplate[] = [];
  for (const [k, v] of entries) {
    if (typeof v !== 'string' || v.length === 0) continue;
    if (isTemplateKey(k)) raws.push({ key: k, value: v });
    else if (!exact.has(k)) exact.set(k, v);
  }
  let compiled: Template[] | null = null;
  return {
    exact,
    cache: new Lru<string | null>(512),
    templates() {
      if (compiled === null) {
        const list: Template[] = [];
        for (const r of raws) {
          const t = compileTemplate(r.key, r.value);
          if (t) list.push(t);
        }
        list.sort((a, b) => b.staticLen - a.staticLen);
        compiled = list;
      }
      return compiled;
    },
  };
}

/** Find the dictionary directory for a locale (§4.1.2). Returns null if none. */
export function locateDictDir(locale: string, override?: string | null): string | null {
  try {
    const env = override ?? process.env.RUFLO_I18N_DIR;
    if (env) return env;
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 6; i++) {
      const pj = path.join(dir, 'package.json');
      try {
        if (fs.existsSync(pj)) {
          const name = JSON.parse(fs.readFileSync(pj, 'utf8')).name;
          if (name === '@claude-flow/cli') return path.join(dir, 'i18n', locale);
        }
      } catch {
        /* keep walking */
      }
      const up = path.dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  } catch {
    /* fall through */
  }
  return null;
}

const FILES = ['help.json', 'messages.json'];

/** Load help.json + messages.json from dir. Missing/broken files are skipped. */
export function loadDictFrom(dir: string | null, locale?: string): Dict {
  const entries = new Map<string, unknown>();
  if (dir) {
    for (const f of FILES) {
      try {
        const doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        const ok =
          doc && typeof doc === 'object' && doc.schema === 'ruflo-i18n-dict/1' &&
          (locale === undefined || doc.locale === locale);
        const e = ok ? doc.entries : null;
        if (e && typeof e === 'object') {
          for (const k of Object.keys(e)) if (!entries.has(k)) entries.set(k, e[k]);
        }
      } catch {
        /* empty dictionary for this file */
      }
    }
  }
  return buildDict(entries);
}

let cached: Dict | null = null;
let cachedKey = '';

/** Lazily load (once) the dictionary for a locale. */
export function getDict(locale: string, dirOverride?: string | null): Dict {
  const key = `${locale}\u0000${dirOverride ?? ''}`;
  if (cached && cachedKey === key) return cached;
  cached = loadDictFrom(locateDictDir(locale, dirOverride), locale);
  cachedKey = key;
  return cached;
}

export function resetDict(): void {
  cached = null;
  cachedKey = '';
}
