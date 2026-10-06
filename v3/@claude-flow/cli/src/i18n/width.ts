/**
 * Display-width helpers (ko-l10n §4.1.7).
 *
 * Pure functions, no side effects at import time. Wide East-Asian code points
 * take two terminal cells, combining marks and variation selectors take zero.
 */

const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;

/** Terminal cell width of one code point. */
export function codePointWidth(cp: number): number {
  if (
    (cp >= 0x0300 && cp <= 0x036f) ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    cp === 0x20e3
  ) {
    return 0;
  }
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa960 && cp <= 0xa97f) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

/** Display width of a string. ANSI SGR/CSI sequences count as zero width. */
export function displayWidth(text: string): number {
  if (typeof text !== 'string' || text.length === 0) return 0;
  const plain = text.indexOf('\x1b') === -1 ? text : text.replace(ANSI_RE, '');
  let w = 0;
  for (const ch of plain) {
    w += codePointWidth(ch.codePointAt(0) as number);
  }
  return w;
}

/** padEnd by display width. */
export function padEndW(text: string, width: number, fill = ' '): string {
  const gap = width - displayWidth(text);
  return gap > 0 ? text + fill.repeat(gap) : text;
}

/** padStart by display width. */
export function padStartW(text: string, width: number, fill = ' '): string {
  const gap = width - displayWidth(text);
  return gap > 0 ? fill.repeat(gap) + text : text;
}

/**
 * Truncate to at most `max` cells, ending with `ellipsis` when cut.
 * ANSI sequences are not preserved; call on plain text.
 */
export function truncateW(text: string, max: number, ellipsis = '...'): string {
  if (displayWidth(text) <= max) return text;
  const room = max - displayWidth(ellipsis);
  if (room <= 0) return ellipsis.slice(0, Math.max(0, max));
  let out = '';
  let w = 0;
  for (const ch of text) {
    const cw = codePointWidth(ch.codePointAt(0) as number);
    if (w + cw > room) break;
    out += ch;
    w += cw;
  }
  return out + ellipsis;
}
