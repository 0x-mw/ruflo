/**
 * Cost of the plugin translator with the real console dictionary (hooks/i18n/ko-dict.ts) on real screen strings (the lines viewText draws for every view).
 * Timing is machine-dependent, so it is off in the default pure spec set and runs only on request:
 *   RUFLO_I18N_PERF=1 npx vitest run plugins/ruflo-console/tests/i18n-ko-bench.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { setLocale, t } from '../hooks/i18n/translate'
import { VIEWS, newState } from '../hooks/state'
import { viewText } from '../hooks/views/pane'
import type { Actions } from '../hooks/views/common'

const PERF = process.env.RUFLO_I18N_PERF === '1'

describe('cost (opt-in: RUFLO_I18N_PERF=1)', () => {
  it.skipIf(!PERF)('t() averages under 20 microseconds a call over 10,000 real screen strings with the full dictionary', () => {
    const act = new Proxy(() => undefined, { get: (_t, key) => (key === 'then' ? undefined : act), apply: () => undefined }) as unknown as Actions
    const lines = new Set<string>()

    for (const view of VIEWS) {
      const ctx = { state: newState({}), nowMs: 1_700_000_000_000, columns: 100, act }

      for (const line of viewText(ctx, view.id).split('\n')) if (line.trim() !== '') lines.add(line)
    }

    const pool = [...lines]

    expect(pool.length).toBeGreaterThan(20)

    setLocale('ko')

    try {
      t('warm up')

      // Best of three passes (a machine hiccup must not fail the run). A numeric suffix, new on every pass, keeps the result cache from answering, the way live counts and names do.
      const passes = [0, 1, 2].map(pass => {
        const strings = Array.from({ length: 10_000 }, (_, i) => `${pool[i % pool.length]} ${pass * 10_000 + i}`)
        const start = performance.now()

        for (const s of strings) t(s)

        return ((performance.now() - start) * 1000) / strings.length
      })
      const micros = Math.min(...passes)

      console.log(`i18n t(): ${micros.toFixed(2)} microseconds per call (passes: ${passes.map(p => p.toFixed(2)).join(', ')})`)
      expect(micros).toBeLessThan(20)
    } finally {
      setLocale('en')
    }
  })
})
