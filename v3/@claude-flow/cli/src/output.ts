/**
 * V3 CLI Output Formatter — re-export shim (ADR-100, alpha.5).
 *
 * Authoritative source: @claude-flow/cli-core/output. Was a byte-identical
 * 640-line copy. The OutputFormatter class and `output` instance plus all
 * helper exports flow through unchanged. Edit cli-core for behavior changes.
 */

export * from '@claude-flow/cli-core/output';

// ko-l10n: patch the shared singleton for Korean output (no-op unless locale is ko)
import { output as __i18nOutput } from '@claude-flow/cli-core/output';
import { installOutputI18n } from './i18n/output-hook.js';
try { installOutputI18n(__i18nOutput); } catch { /* English output */ }
