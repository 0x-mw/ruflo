import { localeOf, setLocale, t, tLines, withLocale } from './translate'

/** Wiring of the translator into the swarm mod; register.ts only calls these. Nothing here throws. */

/** Sets the locale from RUFLO_LANG as the engine answered it; a refused or failed read is English. */
export function setLocaleFrom(lang: unknown): void {
  setLocale(localeOf(lang))
}

/** The pane kit, marked and translating while the locale is ko; the same object while it is en. */
export const localizeKit = <K extends object>(kit: K): K => withLocale(kit)

/** What a command answers the person, line by line. */
export function tAnswer<R extends { text: string }>(answer: R): R {
  try {
    return { ...answer, text: tLines(answer.text) }
  } catch {
    return answer
  }
}

export { t }
