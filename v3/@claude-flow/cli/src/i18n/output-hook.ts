/**
 * Output interception (ko-l10n §4.1.6, §2.1).
 *
 * Patches the cli-core `output` singleton at instance level so that human
 * facing strings pass through `tr()`. When the locale is not 'ko' nothing is
 * patched and no file is read. Import has no side effects; every entry point
 * is exception-safe and restores the original methods on failure (R-05).
 */

import { getLocale, tr } from './index.js';
import { getDict } from './dict.js';
import { displayWidth, truncateW } from './width.js';

const MARK = Symbol.for('ruflo.i18n.installed');
const SKIP_MAX = 16;

type Fn = (...args: any[]) => any;
type Fmt = Record<string, any>;

// translated first argument, returns string
const STRING_FIRST = ['color', 'bold', 'dim', 'success', 'error', 'warning', 'info', 'highlight'];
const SINKS = ['writeln', 'writeErrorln', 'write', 'writeError'];
const MSG_PRINTS = ['printSuccess', 'printWarning', 'printInfo'];
const LIST_FNS = ['list', 'numberedList'];
const LIST_PRINTS = ['printList', 'printNumberedList'];
// untouched, but keep the depth guard so inner sinks do not translate
const PASSTHROUGH = ['printDebug', 'printTrace', 'printJson', 'json'];
// ko replacements that lay out by display width
const LAYOUT_PRINTS = ['printTable', 'printBox'];

const ANSI_M = /\x1b\[[0-9;]*m/g;
const SYMBOLS =
  '(?:[\\u2713\\u2714\\u2717\\u2718\\u2716\\u2022\\u00B7\\u26A0\\u2139\\u2192\\u25B8\\u25BA\\u25B6\\u2605\\u2606*>?\\-]|\\p{Extended_Pictographic}\\uFE0F?)';
const PREFIX_RE = new RegExp(`^\\s*(?:${SYMBOLS}+\\s+)?`, 'u');

function stripM(s: string): string {
  return s.replace(ANSI_M, '');
}

/** Exact-match-only lookup (+ symbol prefix / trailing space). Never throws. */
function exactOnly(text: string): string {
  try {
    if (typeof text !== 'string' || text.length === 0 || text.length > 2000) return text;
    if (/[가-힣]/.test(text)) return text;
    const dict = getDict('ko', null);
    const whole = dict.exact.get(text);
    if (whole !== undefined) return whole;
    const m = PREFIX_RE.exec(text);
    const prefix = m ? m[0] : '';
    const rest = text.slice(prefix.length);
    const core = rest.replace(/\s+$/, '');
    if (core.length === 0 || (!prefix && core.length === rest.length)) return text;
    const hit = dict.exact.get(core);
    return hit === undefined ? text : prefix + hit + rest.slice(core.length);
  } catch {
    return text;
  }
}

function isSafeWrite(text: unknown): boolean {
  if (typeof text !== 'string') return false;
  if (text.indexOf('\r') !== -1) return false;
  // any CSI that is not an SGR ('m') sequence
  return !/\x1b\[[0-9;?]*[A-Za-ln-z]/.test(text);
}

export function installOutputI18n(out: unknown): void {
  const fmt = out as Fmt;
  const restore: Array<() => void> = [];
  try {
    if (!fmt || typeof fmt !== 'object') return;
    if (getLocale() !== 'ko') return;
    if ((fmt as any)[MARK]) return;

    let depth = 0;
    // strings produced by our own table()/box(): sinks must not re-translate them
    const produced: string[] = [];
    const remember = (s: string): string => {
      produced.push(s);
      if (produced.length > SKIP_MAX) produced.shift();
      return s;
    };
    const guarded = <T>(f: () => T): T => {
      depth++;
      try {
        return f();
      } finally {
        depth--;
      }
    };
    const t = (s: unknown): any => (depth === 0 && typeof s === 'string' ? tr(s) : s);

    const patch = (key: string, make: (orig: Fn) => Fn): void => {
      const orig = fmt[key];
      if (typeof orig !== 'function') return;
      const had = Object.getOwnPropertyDescriptor(fmt, key);
      Object.defineProperty(fmt, key, {
        value: make(orig),
        writable: true,
        configurable: true,
        enumerable: had ? !!had.enumerable : false,
      });
      restore.push(() => {
        if (had) Object.defineProperty(fmt, key, had);
        else delete fmt[key];
      });
    };

    for (const key of STRING_FIRST) {
      patch(key, (orig) =>
        function (this: unknown, text: unknown, ...rest: unknown[]) {
          const a = t(text);
          return guarded(() => orig.call(this, a, ...rest));
        });
    }

    for (const key of SINKS) {
      const isWrite = key === 'write' || key === 'writeError';
      patch(key, (orig) =>
        function (this: unknown, text?: unknown, ...rest: unknown[]) {
          let a = text;
          if (depth === 0 && typeof text === 'string' && !produced.includes(text)) {
            if (!isWrite || isSafeWrite(text)) a = tr(text);
          }
          return guarded(() => orig.call(this, a, ...rest));
        });
    }

    for (const key of MSG_PRINTS) {
      patch(key, (orig) =>
        function (this: unknown, message: unknown, ...rest: unknown[]) {
          const a = t(message);
          return guarded(() => orig.call(this, a, ...rest));
        });
    }

    patch('printError', (orig) =>
      function (this: unknown, message: unknown, details?: unknown) {
        const a = t(message);
        const b = t(details);
        return guarded(() => orig.call(this, a, b));
      });

    for (const key of [...LIST_FNS, ...LIST_PRINTS]) {
      patch(key, (orig) =>
        function (this: unknown, items: unknown, ...rest: unknown[]) {
          const a = depth === 0 && Array.isArray(items) ? items.map((i) => t(i)) : items;
          return guarded(() => orig.call(this, a, ...rest));
        });
    }

    for (const key of PASSTHROUGH) {
      patch(key, (orig) =>
        function (this: unknown, ...args: unknown[]) {
          return guarded(() => orig.apply(this, args));
        });
    }

    patch('createSpinner', (orig) =>
      function (this: unknown, options: any) {
        const o = options && typeof options === 'object' && typeof options.text === 'string'
          ? { ...options, text: tr(options.text) }
          : options;
        const sp = guarded(() => orig.call(this, o));
        try {
          if (sp && typeof sp.setText === 'function') {
            const setText = sp.setText;
            sp.setText = function (this: unknown, text: unknown) {
              return setText.call(this, typeof text === 'string' ? tr(text) : text);
            };
          }
        } catch {
          /* keep original spinner */
        }
        return sp;
      });

    // ---- ko-only layout (display width aware) ----
    patch('table', () =>
      function (this: Fmt, options: any) {
        return remember(guarded(() => buildTable(this, options)));
      });

    patch('box', () =>
      function (this: Fmt, content: string, title?: string) {
        return remember(guarded(() => buildBox(this, content, title)));
      });

    for (const key of LAYOUT_PRINTS) {
      patch(key, (orig) =>
        function (this: unknown, ...args: unknown[]) {
          return guarded(() => orig.apply(this, args));
        });
    }

    Object.defineProperty(fmt, MARK, { value: true, configurable: true, enumerable: false });
    restore.push(() => {
      delete (fmt as any)[MARK];
    });
  } catch {
    for (let i = restore.length - 1; i >= 0; i--) {
      try {
        restore[i]();
      } catch {
        /* ignore */
      }
    }
  }
}

// ============================================
// ko table / box (ports of cli-core output.ts with display-width math)
// ============================================

function alignW(text: string, width: number, align: 'left' | 'center' | 'right' = 'left'): string {
  const padding = width - displayWidth(stripM(text));
  if (padding <= 0) return text;
  switch (align) {
    case 'right':
      return ' '.repeat(padding) + text;
    case 'center': {
      const left = Math.floor(padding / 2);
      return ' '.repeat(left) + text + ' '.repeat(padding - left);
    }
    default:
      return text + ' '.repeat(padding);
  }
}

function truncW(text: string, max: number): string {
  const stripped = stripM(text);
  if (displayWidth(stripped) <= max) return text;
  return truncateW(stripped, max, '...');
}

function buildTable(f: Fmt, options: any): string {
  const { data, border = true, header = true, padding = 1, maxWidth } = options;
  // only headers are translated; cells are user data (T8)
  const columns: any[] = (options.columns as any[]).map((c) =>
    c && typeof c.header === 'string' ? { ...c, header: tr(c.header) } : c);

  const widths = columns.map((col) => {
    let width = displayWidth(col.header);
    for (const row of data) {
      let value = row[col.key];
      if (col.format) value = col.format(value);
      width = Math.max(width, displayWidth(stripM(String(value ?? ''))));
    }
    if (col.width) width = Math.min(width, col.width);
    return width;
  });
  let w = widths;
  if (maxWidth) {
    const total = widths.reduce((a, b) => a + b, 0) + columns.length * 3 + 1;
    if (total > maxWidth) {
      const reduction = (total - maxWidth) / columns.length;
      w = widths.map((x) => Math.max(3, Math.floor(x - reduction)));
    }
  }

  const ch = border
    ? { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|', lt: '+', rt: '+', tt: '+', bt: '+', x: '+' }
    : { tl: '', tr: '', bl: '', br: '', h: '', v: ' ', lt: '', rt: '', tt: '', bt: '', x: '' };
  const line = (pos: 'top' | 'middle' | 'bottom'): string => {
    const cells = w.map((x) => ch.h.repeat(x + padding * 2)).join(pos === 'top' ? ch.tt : pos === 'bottom' ? ch.bt : ch.x);
    const left = pos === 'top' ? ch.tl : pos === 'bottom' ? ch.bl : ch.lt;
    const right = pos === 'top' ? ch.tr : pos === 'bottom' ? ch.br : ch.rt;
    return `${left}${cells}${right}`;
  };

  const pad = ' '.repeat(padding);
  const lines: string[] = [];
  if (border) lines.push(line('top'));
  if (header) {
    const row = columns
      .map((col, i) => pad + alignW(f.bold(truncW(col.header, w[i])), w[i], col.align) + pad)
      .join(ch.v);
    lines.push(`${ch.v}${row}${ch.v}`);
    if (border) lines.push(line('middle'));
  }
  for (const r of data) {
    const row = columns
      .map((col, i) => {
        let value = r[col.key];
        value = col.format ? col.format(value) : String(value ?? '');
        return pad + alignW(truncW(String(value), w[i]), w[i], col.align) + pad;
      })
      .join(ch.v);
    lines.push(`${ch.v}${row}${ch.v}`);
  }
  if (border) lines.push(line('bottom'));
  return lines.join('\n');
}

function buildBox(f: Fmt, content: string, title?: string): string {
  const shown = title ? tr(title) : title;
  // data lines: exact match only (T8)
  const lines = String(content).split('\n').map(exactOnly);
  const maxLen = Math.max(...lines.map((l) => displayWidth(stripM(l))), shown ? displayWidth(shown) : 0);
  const width = maxLen + 4;
  const result: string[] = [];
  if (shown) {
    const titleText = ` ${shown} `;
    const tw = displayWidth(titleText);
    const leftPad = Math.floor((width - tw - 2) / 2);
    const rightPad = width - tw - leftPad - 2;
    result.push('+' + '-'.repeat(Math.max(0, leftPad)) + f.bold(titleText) + '-'.repeat(Math.max(0, rightPad)) + '+');
  } else {
    result.push('+' + '-'.repeat(width - 2) + '+');
  }
  for (const l of lines) {
    const padding = maxLen - displayWidth(stripM(l));
    result.push(`| ${l}${' '.repeat(Math.max(0, padding))} |`);
  }
  result.push('+' + '-'.repeat(width - 2) + '+');
  return result.join('\n');
}
