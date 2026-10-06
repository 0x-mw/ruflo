/**
 * The plugin translator (hooks/i18n/translate.ts, a copy of scripts/i18n/templates/plugin-translate.ts): English leaves the kit untouched,
 * Korean translates Text, Button and Input text only on a marked kit, the mark survives the real wrapper chain, the model's own text
 * (viewText) stays English, and the shared normalisation table (plan 4.1.9, scope all) holds. Run with
 *   npx vitest run plugins/ruflo-console/tests/i18n-ko.spec.ts
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { I18N_MARK, getLocale, isLocalized, localeOf, padEndW, setLocale, t, tExact, tLines, widthOf, withLocale } from '../hooks/i18n/translate'
import { KO } from '../hooks/i18n/ko-dict'
import { newState } from '../hooks/state'
import { withCards } from '../hooks/views/card'
import { wrapKit, type Attention } from '../hooks/views/attention'
import { withClearing } from '../hooks/views/clearing'
import { viewText } from '../hooks/views/pane'
import type { Actions } from '../hooks/views/common'

type Case = { id: string; in: string; out?: string | null; scope: string }

const FIXTURE = new URL('../../../v3/@claude-flow/cli/__tests__/fixtures/i18n-ko/normalize-cases.json', import.meta.url)
const E = '\x1b'
const same = 'SAME'

/** The 4.1.9 table, used until A1's fixture file is in the tree (the file wins when it exists). */
const INLINE: { dict: Record<string, string>; cases: Case[] } = {
  dict: {
    Initialized: '초기화했습니다', Agents: '에이전트', Overview: '개요', store: '저장', Done: '완료', 'Swarm Status': '스웜 상태', 'Select topology': '토폴로지 선택',
    'MCP Servers': 'MCP 서버', 'No MCP config found': 'MCP 설정을 찾지 못했습니다', 'Failed to initialize: {0}': '초기화하지 못했습니다: {0}',
    'Moved {0} into {1}': '{1}(으)로 {0}을(를) 옮겼습니다', 'Run {0} to start background workers': '백그라운드 워커를 시작하려면 {0}을(를) 실행하세요',
    '{0} agents': '에이전트 {0}개', '[default: {0}]': '[기본값: {0}]', '{0} {1}': 'X', 'Hi {0}': 'X',
  },
  cases: [
    ['N1', 'Initialized', '초기화했습니다'], ['N2', '  ✓ Initialized', '  ✓ 초기화했습니다'], ['N3', 'Agents  ', '에이전트  '], ['N4', '? Select topology', '? 토폴로지 선택'],
    ['N5', '▸ store', '▸ 저장'], ['N6', 'Failed to initialize: disk full', '초기화하지 못했습니다: disk full'], ['N7', 'Moved a into b', 'b(으)로 a을(를) 옮겼습니다'],
    ['N10', 'MCP Servers: No MCP config found', 'MCP 서버: MCP 설정을 찾지 못했습니다'], ['N11', 'MCP Servers: some user value', 'MCP 서버: some user value'],
    ['N12', '2: 🏠 Overview', '2: 🏠 개요'], ['N13', 'Swarm Status\nunknown line\n  Done', '스웜 상태\nunknown line\n  완료'], ['N14', '스웜 상태\nDone', '스웜 상태\n완료'],
    ['N15', ' [default: 5]', ' [기본값: 5]'], ['N16', '{"a":1}', same], ['N17', '[1, 2]', same], ['N18', 'a b', same], ['N19', 'Hi there', same], ['N20', '5 agents', '에이전트 5개'],
    ['N21', 'Selected 5 agents', same], ['N22', '', ''], ['N23', 'x'.repeat(2001), same], ['N24', 'Unknown sentence', same], ['N25', '\uD800 broken', same],
  ].map(([id, i, o]) => ({ id: id as string, in: i as string, out: o === same ? null : (o as string), scope: 'all' })),
}

const loaded: { dict: Record<string, string>; cases: Case[] } = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, 'utf8')) : INLINE
const base = loaded.cases.some(c => c.id === 'N1') ? loaded : INLINE

// The real dictionary (F1) must not leak into the table test: this file runs on the fixture dictionary alone. The full-size cost check is i18n-ko-bench.spec.ts.
const STATUS = '{0}: {1} · {2} · {3} running · {4} done ({5} unverified) · {6} failed · read {7}'
const fresh: Record<string, string> = {
  ...base.dict, Claims: '클레임', Cost: '비용', Settings: '설정', Hide: '숨김', Remove: '숨김', ok: '정상', '{0} — saved locally': '{0} — 로컬에 저장됨',
  [STATUS]: '{0}: {1} · {2} · {3}개 실행 · {4}개 완료 (미검증 {5}) · {6}개 실패 · 읽음 {7}',
}

try {
  for (const key of Object.keys(KO)) delete KO[key]
  Object.assign(KO, fresh)
} catch {
  // a frozen dictionary: the table cases below then run on whatever it holds
}

const el = (type: string) => (props: Record<string, unknown>) => ({ type, props }) as never
const rawKit = () => ({ Box: el('Box'), Text: el('Text'), Button: el('Button'), Input: el('Input') })
const fix = (s: string) => s.replace(/\\e/g, E)
const asProps = (node: unknown) => (node as { props: Record<string, unknown> }).props

describe('locale', () => {
  it('is English by default; /^en/i is English and everything else, unset included, is Korean', () => {
    expect(getLocale()).toBe('en')
    expect(localeOf('en')).toBe('en')
    expect(localeOf('EN_US')).toBe('en')
    expect(localeOf('ko')).toBe('ko')
    expect(localeOf(undefined)).toBe('ko')
    expect(localeOf('')).toBe('ko')
    expect(t('Initialized')).toBe('Initialized')
  })

  it('in English withLocale hands back the very same kit and padEndW is padEnd', () => {
    const kit = rawKit()

    expect(withLocale(kit)).toBe(kit)
    expect(isLocalized(kit)).toBe(false)
    expect(padEndW('한글', 8)).toBe('한글'.padEnd(8))
    expect(widthOf('한글')).toBe(2)
  })
})

describe('Korean', () => {
  it('translates Text children (string and array), Button labels and Input labels, and marks the kit', () => {
    setLocale('ko')

    try {
      const kit = withLocale(rawKit())

      expect(isLocalized(kit)).toBe(true)
      expect((kit as unknown as Record<symbol, unknown>)[I18N_MARK]).toBe(true)
      expect(asProps(kit.Text({ children: '2: 🏠 Overview' })).children).toBe('2: 🏠 개요')
      expect(asProps(kit.Text({ children: ['Agents', 7, 'Done'] })).children).toEqual(['에이전트', 7, '완료'])
      expect(asProps(kit.Button({ key: 'a', label: '▸ store' })).label).toBe('▸ 저장')
      expect(asProps(kit.Input({ key: 'i', label: 'Agents', placeholder: 'Done', submitLabel: 'Initialized' }))).toMatchObject({ label: '에이전트', placeholder: '완료', submitLabel: '초기화했습니다' })
      expect(withLocale(kit)).toBe(kit)
    } finally {
      setLocale('en')
    }
  })

  it('the mark survives the real wrapper chain: withClearing, then wrapKit, then withCards', () => {
    setLocale('ko')

    try {
      const state = { fieldText: new Map<string, string>(), pending: {} } as never
      const attention = { key: null, keys: new Map(), panel: [], placed: false, mode: 'draw', donated: [] } as unknown as Attention
      const chain = withCards(wrapKit(withClearing(withLocale(rawKit()), state, () => undefined), state, attention))

      expect(isLocalized(chain)).toBe(true)
      expect(asProps(chain.Text({ children: 'Overview' })).children).toBe('개요')
      expect(asProps(chain.Button({ key: 'b', label: 'Done' })).label).toBe('완료')
    } finally {
      setLocale('en')
    }
  })

  it('viewText, the text the model reads, stays English in Korean (an unmarked plain kit)', () => {
    const act = new Proxy(() => undefined, { get: (_t, key) => (key === 'then' ? undefined : act), apply: () => undefined }) as unknown as Actions
    const ctx = () => ({ state: newState({}), nowMs: 1_700_000_000_000, columns: 100, act })
    const english = viewText(ctx(), 'menu')

    setLocale('ko')

    try {
      expect(viewText(ctx(), 'menu')).toBe(english)
    } finally {
      setLocale('en')
    }
  })

  it('the normalisation table (scope all) holds, and nothing throws', () => {
    setLocale('ko')

    try {
      for (const c of base.cases) {
        if (c.scope === 'cli') continue
        const input = fix(c.in)
        const want = c.out === undefined || c.out === null || String(c.out).startsWith('그대로') ? input : fix(c.out)

        expect(t(input), c.id).toBe(want)
      }

      expect(() => t(undefined as never)).not.toThrow()
      expect(t(42 as never)).toBe(42)
    } finally {
      setLocale('en')
    }
  })

  it('long multi-line input with a chained template stays fast (no regex backtracking), and a leading symbol keeps rule 3a before 3b', () => {
    setLocale('ko')

    try {
      const row = 'mission-i: opus · 2h · i running · 3 done (1 unverified) · 0 failed'
      const lines = `${Array.from({ length: 25 }, () => row).join('\n')}\nupdated 5s ago`
      const evil = `${'a: b · c · d running · e done (f unverified) · '.repeat(40)}`.slice(0, 1990)
      const start = performance.now()

      expect(t(lines)).toBe(lines)
      expect(t(evil)).toBe(evil)
      expect(performance.now() - start).toBeLessThan(250)
      expect(t('a: b · c · 3 running · 4 done (5 unverified) · 6 failed · read 7')).toBe('a: b · c · 3개 실행 · 4개 완료 (미검증 5) · 6개 실패 · 읽음 7')
      expect(t('✓ ok — saved locally')).toBe('✓ 정상 — 로컬에 저장됨')
    } finally {
      setLocale('en')
    }
  })

  it('Text without children gets no children key', () => {
    setLocale('ko')

    try {
      expect('children' in asProps(withLocale(rawKit()).Text({ color: 'red' }))).toBe(false)
    } finally {
      setLocale('en')
    }
  })

  it('widthOf counts wide characters twice and padEndW pads to the display width', () => {
    setLocale('ko')

    try {
      expect(widthOf('abc')).toBe(3)
      expect(widthOf('한글')).toBe(4)
      expect(widthOf('á')).toBe(1)
      expect(padEndW('한글', 8)).toBe('한글    ')
      expect(padEndW('한글한글한글', 4)).toBe('한글한글한글')
    } finally {
      setLocale('en')
    }
  })

  it('tLines translates every line of text past 2000 characters (\\r\\n kept), where t hands a long text back untouched; JSON stays as it is', () => {
    setLocale('ko')

    try {
      const word = Object.keys(KO).find(k => /^[A-Z][a-z]{3,9}$/.test(k) && KO[k] !== k) as string
      const lines = Array.from({ length: 300 }, (_, i) => (i % 3 === 2 ? `${word} extra line ${i}` : word))
      const crlf = lines.join('\r\n')
      const lf = lines.join('\n')
      const out = tLines(crlf)

      expect(crlf.length).toBeGreaterThan(2000)
      expect(t(crlf)).toBe(crlf)
      expect(out.split('\r\n')).toHaveLength(300)
      expect(out.split('\r\n')[0]).toBe(KO[word])
      expect(out).not.toBe(crlf)
      expect(tLines(lf).split('\n')[1]).toBe(KO[word])
      expect(tLines(`Overview\nAgents`)).toBe(t('Overview\nAgents'))

      const json = JSON.stringify(Array.from({ length: 200 }, () => ({ name: word, list: [word] })), null, 2)

      expect(json.length).toBeGreaterThan(2000)
      expect(tLines(json)).toBe(json)
      expect(tLines(undefined as never)).toBe(undefined)
    } finally {
      setLocale('en')
    }
  })

  it('widthOf counts emoji twice (U+1F300-1FAFF, default-emoji symbols, anything with U+FE0F), U+FE0F itself is 0, and a toString that throws does not throw', () => {
    setLocale('ko')

    try {
      for (const e of ['⚙️', '✅', '🚀', '🛡️', '⚡', '⚠️', '1️⃣']) expect(widthOf(e), e).toBe(2)

      expect(widthOf('\ufe0f')).toBe(0)
      expect(widthOf('✓')).toBe(1)
      expect(widthOf('⚙')).toBe(1)
      expect(widthOf('⚙️ 설정')).toBe(7)
      expect(padEndW('✅ ok', 8)).toBe('✅ ok   ')
      expect(widthOf({ toString: () => { throw new Error('x') } } as never)).toBeGreaterThanOrEqual(0)
      expect(() => padEndW({ toString: () => { throw new Error('x') } } as never, 4)).not.toThrow()
    } finally {
      setLocale('en')
    }
  })

  it('a capitals-only screen title falls back to its Title Case or lower case entry, with the leading symbol kept', () => {
    setLocale('ko')

    try {
      expect(t('📌 CLAIMS')).toBe(`📌 ${KO.Claims}`)
      expect(t('💰 COST')).toBe(`💰 ${KO.Cost}`)
      expect(t('⚙️ SETTINGS')).toBe(`⚙️ ${KO.Settings}`)
      expect(t('COST')).toBe(KO.Cost)
      expect(t('NOTHING SUCH HERE')).toBe('NOTHING SUCH HERE')
      expect(t('COST2')).toBe('COST2')
    } finally {
      setLocale('en')
    }
  })

  it('tExact: exact entries only (symbols and spaces peeled and put back, capitals-only titles too); no template, no colon split, no line split', () => {
    expect(tExact('Overview')).toBe('Overview')
    setLocale('ko')

    try {
      expect(tExact('Overview')).toBe(KO.Overview)
      expect(tExact('  ▸ Overview  ')).toBe(`  ▸ ${KO.Overview}  `)
      expect(tExact('📌 CLAIMS')).toBe(`📌 ${KO.Claims}`)
      expect(tExact('Overview: Agents')).toBe('Overview: Agents')
      expect(tExact('Overview\nAgents')).toBe('Overview\nAgents')
      expect(tExact('Failed to initialize: disk full')).toBe('Failed to initialize: disk full')
      expect(t('Failed to initialize: disk full')).not.toBe('Failed to initialize: disk full')
      expect(tExact('')).toBe('')
      expect(tExact('x'.repeat(2001))).toBe('x'.repeat(2001))
      expect(tExact(undefined as never)).toBe(undefined)
      expect(tExact(7 as never)).toBe(7)
    } finally {
      setLocale('en')
    }
  })

  const WIRE = fileURLToPath(new URL('../hooks/i18n/wire.ts', import.meta.url))

  it.skipIf(!existsSync(WIRE))('localizeAsk: the dialog shows Korean labels and the answer comes back as the original English label', async () => {
    const wire = (await import(/* @vite-ignore */ WIRE)) as { localizeHost?: (host: unknown) => { askChoice: (q: string, o: readonly string[]) => Promise<string> } }

    expect(wire.localizeHost).toBeTypeOf('function')
    setLocale('ko')

    try {
      let shown: readonly string[] = []
      const host = (wire.localizeHost as NonNullable<typeof wire.localizeHost>)({ toast: () => undefined, askChoice: async (_q: string, options: readonly string[]) => ((shown = options), options[1] as string) })

      expect(await host.askChoice('Overview', ['Agents', 'Done'])).toBe('Done')
      expect(shown).toEqual(['에이전트', '완료'])
    } finally {
      setLocale('en')
    }
  })

  it.skipIf(!existsSync(WIRE))('localizeAsk: two options that read the same once translated are shown in English, and the answer is still the one picked', async () => {
    const wire = (await import(/* @vite-ignore */ WIRE)) as { localizeHost?: (host: unknown) => { askChoice: (q: string, o: readonly string[]) => Promise<string> } }

    setLocale('ko')

    try {
      const pair = ['Hide', 'Remove'] // both read '숨김' once translated

      expect(t(pair[0] as string)).toBe(t(pair[1] as string))
      expect(t('Hide')).not.toBe('Hide')

      let shown: readonly string[] = []
      const host = (wire.localizeHost as NonNullable<typeof wire.localizeHost>)({ toast: () => undefined, askChoice: async (_q: string, options: readonly string[]) => ((shown = options), options[1] as string) })

      expect(await host.askChoice('Overview', pair)).toBe(pair[1])
      expect(shown).toEqual(pair)
    } finally {
      setLocale('en')
    }
  })

  it('never throws on null, undefined or non-string input, in either locale', () => {
    for (const loc of ['en', 'ko'] as const) {
      setLocale(loc)

      try {
        for (const bad of [undefined, null, 5, {}] as never[]) {
          expect(() => isLocalized(bad)).not.toThrow()
          expect(() => widthOf(bad)).not.toThrow()
          expect(() => padEndW(bad, 3)).not.toThrow()
          expect(() => t(bad)).not.toThrow()
        }

        const kit = withLocale(rawKit())

        expect(() => kit.Text(undefined as never)).not.toThrow()
        expect(() => kit.Button(undefined as never)).not.toThrow()
        expect(() => kit.Input(undefined as never)).not.toThrow()
        expect(isLocalized(undefined as never)).toBe(false)
      } finally {
        setLocale('en')
      }
    }
  })
})
