/**
 * CLI i18n public API (ko-l10n §4.1.1, §2.3).
 *
 * Module top level only defines functions and constants: no process access,
 * no file I/O, no patching (R-05). Every entry point is exception-safe.
 */

import { getDict, resetDict } from './dict.js';
import { translate } from './translate.js';

export type Locale = 'ko' | 'en';

export interface LocaleInput {
  env: NodeJS.ProcessEnv;
  argv: string[];
  stdoutIsTTY: boolean;
  stdinIsTTY: boolean;
}

const MACHINE_FORMATS = new Set(['json', 'yaml', 'csv', 'raw', 'ndjson']);
const VALUE_FLAGS = new Set(['--format', '-f', '-o', '--output']);

function isMachineOutput(args: string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') return true;
    if (VALUE_FLAGS.has(a)) {
      const v = args[i + 1];
      if (typeof v === 'string' && MACHINE_FORMATS.has(v.toLowerCase())) return true;
      continue;
    }
    const eq = a.indexOf('=');
    if (eq > 0 && (a.startsWith('--format=') || a.startsWith('--output='))) {
      if (MACHINE_FORMATS.has(a.slice(eq + 1).toLowerCase())) return true;
    }
  }
  return false;
}

/** Pure locale decision (§2.3). */
export function resolveLocale(input: LocaleInput): Locale {
  try {
    return resolveLocaleUnsafe(input);
  } catch {
    return 'en';
  }
}

function resolveLocaleUnsafe(input: LocaleInput): Locale {
  const { env, argv, stdoutIsTTY, stdinIsTTY } = input;
  const args = (argv || []).slice(2);
  const pos = args.filter((a) => !a.startsWith('-'));
  const help = args.includes('--help') || args.includes('-h');
  if (env.VITEST || env.NODE_ENV === 'test') return 'en';
  if (args.length === 0 && !stdinIsTTY) return 'en';
  if ((pos[0] === 'mcp' || pos[0] === 'hooks') && !(help || (pos.length === 1 && stdinIsTTY))) {
    return 'en';
  }
  if (isMachineOutput(args)) return 'en';
  const lang = env.RUFLO_LANG;
  if (typeof lang === 'string') {
    if (/^ko/i.test(lang)) return 'ko';
    if (/^en/i.test(lang)) return 'en';
  }
  return stdoutIsTTY === true ? 'ko' : 'en';
}

let decided: Locale | null = null;
let forcedDir: string | null = null;

/** Locale for this process, decided once at first use. 'en' on any error. */
export function getLocale(): Locale {
  if (decided !== null) return decided;
  try {
    decided = resolveLocale({
      env: process.env,
      argv: process.argv,
      stdoutIsTTY: process.stdout.isTTY === true,
      stdinIsTTY: process.stdin.isTTY === true,
    });
  } catch {
    decided = 'en';
  }
  return decided;
}

export function isKo(): boolean {
  return getLocale() === 'ko';
}

/** Translate; returns the input untouched when locale is en or on any error. */
export function tr(text: string): string {
  if (typeof text !== 'string') return text;
  try {
    if (getLocale() !== 'ko') return text;
    return translate(text, getDict('ko', forcedDir));
  } catch {
    return text;
  }
}

/** Test hook. `null` resets everything to the process-derived state. */
export function __setI18nForTest(o: { locale?: Locale; dictDir?: string } | null): void {
  resetDict();
  if (o === null) {
    decided = null;
    forcedDir = null;
    return;
  }
  if (o.locale) decided = o.locale;
  forcedDir = o.dictDir ?? null;
}
