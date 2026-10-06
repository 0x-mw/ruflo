/**
 * Korean never reaches what a model or a script reads: with no pane (isInteractive: false, as in claude -p or an SDK host) `/ruflo <view>` and
 * `/ruflo dump <view>` answer with viewText, which stays English in every locale, while an answer made for the person's transcript is translated.
 * Run with
 *   npx vitest run plugins/ruflo-console/tests/i18n-ko-dump.spec.ts
 */
import { afterEach, describe, expect, it } from 'vitest'

import { createController } from '../hooks/controller'
import { setLocale } from '../hooks/i18n/translate'
import { answerOf } from '../hooks/i18n/wire'
import type { Host } from '../hooks/host'
import { newState, VIEWS } from '../hooks/state'
import { cliAnswer } from './fixtures/world'
import { RUFLO_FILES } from './fixtures/ruflo-run'

const HANGUL = /[가-힣]/
const CWD = '/work'

function worldHost(): Host {
  const all = new Map(Object.entries(RUFLO_FILES).map(([path, text]) => [`${CWD}/${path}`, text] as const))
  const timer = { cancel: () => undefined, fire: () => undefined }

  return {
    fs: {
      read: async (path: string) => all.get(path) ?? Promise.reject(new Error('ENOENT')),
      stat: async (path: string) => (all.has(path) ? { mtimeMs: 1, size: (all.get(path) as string).length } : Promise.reject(new Error('ENOENT'))),
      list: async () => [],
    },
    every: () => timer,
    after: () => timer,
    storeGet: async () => undefined,
    storeSet: async () => undefined,
    invalidate: () => undefined,
    scrollTop: () => undefined,
    blit: () => undefined,
    run: async (argv: readonly string[]) => ({ ...cliAnswer(argv), isStdoutTruncated: false, isStderrTruncated: false }),
    home: async () => '/home/dev',
    configDir: async () => undefined,
    settings: async () => ({}),
    usage: async () => ({}),
    rufloTools: async () => ({ tools: 0, servers: [] }),
    rufloSnapshot: async () => null,
    rufloRoute: async () => null,
    rufloSegment: async () => undefined,
    listCommands: async () => [],
    fetchText: async () => ({ ok: false, status: 0, text: '' }),
    panes: async () => [],
    pluginRoot: CWD,
  } as unknown as Host
}

async function answer(isInteractive: boolean, args: string): Promise<string> {
  const state = newState({})

  state.cwd = CWD
  state.isInteractive = isInteractive

  const control = createController(state, worldHost())

  return (await answerOf(control, state, args, async () => undefined)).text
}

afterEach(() => setLocale('en'))

describe('Korean locale and the text answers of /ruflo', () => {
  it('headless /ruflo <view> and /ruflo dump <view> carry no Hangul on any of the views', async () => {
    setLocale('ko')
    expect(VIEWS.length).toBeGreaterThanOrEqual(30)

    for (const view of VIEWS) {
      for (const args of [view.id, `dump ${view.id}`]) {
        const text = await answer(false, args)

        expect(text, `/ruflo ${args}`).not.toBe('')
        expect(HANGUL.test(text), `/ruflo ${args}`).toBe(false)
      }
    }
  }, 120_000)

  it('an answer made for the person is still translated, and English stays English', async () => {
    setLocale('ko')
    expect(await answer(true, 'yes')).toBe('확인을 기다리는 항목이 없습니다.')
    setLocale('en')
    expect(await answer(true, 'yes')).toBe('Nothing is waiting for a confirm.')
  })
})
