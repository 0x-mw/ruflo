import { describe, expect, mock, test } from 'claude-code/testing'

import { KO } from '../hooks/i18n/ko-dict'
import { RUFLO_RUN } from './fixtures/ruflo-run'
import { command, PANE, SESSION } from './fixtures/inputs'
import { elementsOf, stringsOf, textOf, worldOf } from './fixtures/world'

type Run = Parameters<Parameters<typeof test>[1]>
const HANGUL = /[가-힣]/

/**
 * The plugin runs in its own module instance, so the dictionary cannot be edited from here: the test reads the shipped
 * dictionary and looks for pane strings it translates (Text and Button children both).
 * `lang` null is an environment the engine refuses.
 */
async function paneIn($: Run[0], on: Run[1], lang: () => string | null) {
  worldOf(on, RUFLO_RUN)
  mock.clock(on)
  on('env.get', () => (lang() === null ? { deny: 'refused' } : ({ value: lang() } as never)))

  return async () => {
    await $.session.start(SESSION)
    await $.command.run(command('ruflo-swarm-pane'))

    return await $.ui.render(PANE)
  }
}

describe('i18n ko', () => {
  test('RUFLO_LANG=ko: pane strings the dictionary holds are drawn in Korean through the kit and the global h', async ($, on) => {
    let lang: string | null = 'en'
    const draw = await paneIn($, on, () => lang)
    const english = await draw()
    // The kit translates Text.children and Button children (pane.tsx's buttons carry their words as children), so both are asserted.
    const inDict = (s: string) => s.trim() !== '' && typeof KO[s.trim()] === 'string'
    const hits = elementsOf(english, 'Text').flatMap(node => stringsOf(node)).filter(inDict)
    const buttons = elementsOf(english, 'Button').flatMap(node => stringsOf(node)).filter(inDict)

    expect(hits.length).toBeGreaterThan(0)
    expect(buttons.length).toBeGreaterThan(0)

    lang = 'ko'

    const korean = textOf(await draw())
    const koreanButtons = elementsOf(await draw(), 'Button').flatMap(node => stringsOf(node))

    for (const hit of hits) {
      expect(korean).toContain(KO[hit.trim()] as string)
    }

    for (const hit of buttons) {
      expect(koreanButtons.join('|')).toContain(KO[hit.trim()] as string)
    }
  })

  test('RUFLO_LANG=en: the pane holds no Korean', async ($, on) => {
    expect(textOf(await (await paneIn($, on, () => 'en'))())).not.toMatch(HANGUL)
  })

  test('with the environment refused the pane holds no Korean', async ($, on) => {
    expect(textOf(await (await paneIn($, on, () => null))())).not.toMatch(HANGUL)
  })
})
