import { parseRuflo } from '../commands'
import { dispatch } from '../dispatch'
import type { Host } from '../host'
import type { State } from '../state'
import type { Controller } from '../controller'
import type { Kit } from '../views/common'
import { getLocale, localeOf, setLocale, t, tLines, withLocale } from './translate'

/**
 * Where the console meets the translator. Only what a person reads is translated here: the kit of the pane, band and tool rows,
 * toasts, the choice dialog, command descriptions and the answers of `/ruflo`. What Claude reads (model-tools answers, viewText,
 * the prompts the console submits) never passes through this file. register.ts is the one place that touches `$.env`, so it hands
 * the reader in.
 */

/** Sets the locale for this session: RUFLO_LANG=en… is English, unset or anything else is Korean, a refused read is English. */
export async function setupLocale(read: () => Promise<unknown>): Promise<void> {
  try {
    setLocale(localeOf(await read().catch(() => 'en')))
  } catch {
    setLocale('en')
  }
}

/** The kit a person's screen is drawn with; English returns it as it is. */
export const localizeKit = <K extends object>(kit: K): K => withLocale(kit)

/** The choice dialog in Korean; the label chosen comes back as the original English label the caller asked for. */
export function localizeAsk(ask: Host['askChoice']): Host['askChoice'] {
  return async (question, options) => {
    if (getLocale() !== 'ko') return ask(question, options)

    let shown: string[] = []
    const back = new Map<string, string>()

    try {
      shown = options.map(option => t(option))
      for (const [i, label] of shown.entries()) back.set(label, options[i] as string)
      // Two options that read the same once translated, or a translation that is another option's own text: show the English ones.
      if (back.size !== options.length || shown.some((label, i) => label !== options[i] && options.includes(label))) shown = []
    } catch {
      shown = []
    }

    if (shown.length === 0) return ask(t(question), options)

    const answer = await ask(t(question), shown)

    return back.get(answer) ?? answer
  }
}

/** The host with the words a person reads translated: toast text, the dialog and a command's description. */
export function localizeHost(host: Host): Host {
  return {
    ...host,
    ...(host.toast !== undefined && { toast: (text, timeoutMs) => host.toast(t(text), timeoutMs) }),
    ...(host.askChoice !== undefined && { askChoice: localizeAsk(host.askChoice) }),
    ...(host.registerCommand !== undefined && { registerCommand: spec => host.registerCommand(typeof spec.description === 'string' ? { ...spec, description: t(spec.description) } : spec) }),
  }
}

/** A `/ruflo` answer for the person's transcript. */
export function localizeReply<R extends { text?: string }>(reply: R): R {
  try {
    return getLocale() === 'ko' && typeof reply?.text === 'string' ? { ...reply, text: tLines(reply.text) } : reply
  } catch {
    return reply
  }
}

/**
 * What `/ruflo` answers. A view's text (`/ruflo dump`, or `/ruflo <view>` with no pane to open, as in claude -p or an SDK host) can be
 * read by a model or a script, so it is returned as it is; every other answer is for the person's transcript and is translated.
 * Which one it is follows from the parsed command, never from the answer's text.
 */
export async function answerOf(control: Controller, state: State, args: string, delegate: () => Promise<{ text?: string } | undefined>): Promise<{ text: string }> {
  const intent = parseRuflo(args)
  const reply = await dispatch(control, state, args, delegate)

  return intent.kind === 'dump' || (intent.kind === 'open' && !state.isInteractive) ? reply : localizeReply(reply)
}
