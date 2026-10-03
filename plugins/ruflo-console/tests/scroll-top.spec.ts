/**
 * Scroll to the top after a page change: switching to another page, and opening help over a page, move the pane back to its first row
 * (the host's `scrollTop`); re-pressing the page you are on does not. Run with
 *   npx vitest run plugins/ruflo-console/tests/scroll-top.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { createController } from '../hooks/controller'
import type { Host } from '../hooks/host'
import { newState } from '../hooks/state'

/** A host that answers every call with an empty promise, and counts the scrolls. */
function fakeHost(): { host: Host; scrolls: { count: number } } {
  const scrolls = { count: 0 }
  const host = new Proxy(
    {},
    {
      get: (_target, key) => {
        if (key === 'scrollTop') return () => void (scrolls.count += 1)
        if (key === 'after' || key === 'every') return () => ({ cancel: () => undefined })
        if (key === 'pluginRoot') return '/plugin'
        if (key === 'fs') return { read: async () => Promise.reject(new Error('ENOENT')), stat: async () => Promise.reject(new Error('ENOENT')), list: async () => Promise.reject(new Error('ENOENT')) }

        return () => Promise.resolve(undefined)
      },
    },
  ) as unknown as Host

  return { host, scrolls }
}

describe('scroll to the top', () => {
  it('scrolls the pane to its top when another page is switched to, and not when the same page is pressed again', () => {
    const state = newState({})
    const { host, scrolls } = fakeHost()
    const control = createController(state, host)

    state.view = 'overview'
    control.setView('swarm')
    expect(scrolls.count).toBe(1)
    expect(state.view).toBe('swarm')

    control.setView('swarm')
    expect(scrolls.count).toBe(1)

    control.setView('claims')
    expect(scrolls.count).toBe(2)
  })

  it('scrolls to the top when the palette opens, and not when it closes', () => {
    const state = newState({})
    const { host, scrolls } = fakeHost()
    const control = createController(state, host)

    control.actions.palette('all')
    expect(scrolls.count).toBe(1)
    control.actions.palette('all')
    expect(scrolls.count).toBe(1)
  })

  it('scrolls to the top when help opens over a page, and not when it closes', () => {
    const state = newState({})
    const { host, scrolls } = fakeHost()
    const control = createController(state, host)

    control.actions.help()
    expect(state.isHelp).toBe(true)
    expect(scrolls.count).toBe(1)

    control.actions.help()
    expect(state.isHelp).toBe(false)
    expect(scrolls.count).toBe(1)
  })
})
