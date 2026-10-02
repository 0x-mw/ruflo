/**
 * The terminal view's harness runner and the x.ruv.io registry probe, under vitest: what argv each harness runs, that
 * the person's text never becomes a flag, how streamed output lands in the scrollback, and how a stop reads.
 */
import { describe, expect, it } from 'vitest'

import { registryProbe } from '../hooks/data/cli'
import { harnessSpec, runHarness, termText, whyNotRun } from '../hooks/harness'
import type { Host } from '../hooks/host'
import { newState } from '../hooks/state'

type Chunk = { stream: 'stdout' | 'stderr'; text: string }

/** A spawn that yields `chunks`, then ends with `code`; `hang` keeps it open until `return()`. */
function fakeSpawn(chunks: Chunk[], code = 0, hang = false) {
  const calls: { argv: readonly string[]; input?: string }[] = []
  const spawn = (argv: readonly string[], input?: string) => {
    calls.push({ argv, ...(input !== undefined && { input }) })

    // As the engine's stream: `return()` kills the child, the loop then ends, and `result` rejects (closed early).
    let release: () => void = () => undefined
    let isClosed = false
    const stream = (async function* () {
      for (const chunk of chunks) yield chunk
      if (hang) await new Promise<void>(resolve => (release = resolve))

      return { code, signal: null }
    })()
    const result = {
      then: (ok: (value: unknown) => void, fail: (error: Error) => void) => (isClosed ? fail(new Error('closed before its end')) : ok({ code, signal: null })),
    }

    return Object.assign(stream, {
      result,
      return: async () => {
        isClosed = true
        release()

        return { done: true, value: undefined }
      },
    }) as never
  }

  return { spawn, calls }
}

const hostWith = (spawn: Host['spawn']): Host => ({ spawn, invalidate: () => undefined, after: () => ({ cancel: () => undefined }) }) as unknown as Host

describe('terminal harnesses', () => {
  it('codex and claude get the text on stdin, never in the argv, and run read-only', () => {
    const state = newState({})
    const host = hostWith(fakeSpawn([]).spawn)
    const codex = harnessSpec(state, host, '--dangerously-bypass-approvals-and-sandbox explain')

    expect(codex?.args).toEqual(['codex', 'exec', '--sandbox', 'read-only', '--skip-git-repo-check', '-'])
    expect(codex?.shows).toContain('(your text on stdin)')

    state.terminal.harness = 'claude'
    expect(harnessSpec(state, host, 'hi')?.args).toEqual(['claude', '-p', '--permission-mode', 'plan', '--max-budget-usd', '1'])
  })

  it('ruflo splits words onto the CLI prefix, with no shell, and refuses empty text or a run in flight', () => {
    const state = newState({})
    const host = hostWith(fakeSpawn([]).spawn)

    state.terminal.harness = 'ruflo'
    expect(harnessSpec(state, host, ' swarm   status; rm x ')?.args).toEqual(['npx', '--offline', '-y', '@claude-flow/cli@latest', 'swarm', 'status;', 'rm', 'x'])
    expect(harnessSpec(state, host, '   ')).toBeNull()
    expect(whyNotRun(state, '')).toBe('type something first')

    state.terminal.running = { label: 'codex', startedAtMs: 0, stop: () => undefined }
    expect(harnessSpec(state, host, 'swarm status')).toBeNull()
    expect(whyNotRun(state, 'swarm status')).toContain('still running')
  })

  it('streams output into the scrollback by line, joining pieces split mid-line, and notes the exit', async () => {
    const state = newState({})
    const { spawn, calls } = fakeSpawn([
      { stream: 'stdout', text: 'hel' },
      { stream: 'stdout', text: 'lo\n  indented\tline\n' },
      { stream: 'stderr', text: '\u001b[31mwarn\u001b[0m\n' },
      { stream: 'stdout', text: 'tail' },
    ])

    await runHarness(state, hostWith(spawn), 'codex', ['codex', 'exec', '-'], 'say hi', 'say hi')

    expect(calls[0]).toEqual({ argv: ['codex', 'exec', '-'], input: 'say hi' })
    expect(state.terminal.lines.map(line => `${line.kind}:${line.text}`)).toEqual(['in:codex> say hi', 'out:hello', 'out:  indented  line', 'err:warn', 'out:tail', expect.stringMatching(/^sys:exit 0 · \d+ s$/)])
    expect(state.terminal.running).toBeNull()
  })

  it('a stop ends the run and says so', async () => {
    const state = newState({})
    const { spawn } = fakeSpawn([{ stream: 'stdout', text: 'working\n' }], 0, true)
    const run = runHarness(state, hostWith(spawn), 'claude', ['claude', '-p'], 'long', 'long')

    await new Promise(resolve => setTimeout(resolve, 5))
    state.terminal.running?.stop()
    await run

    expect(state.terminal.lines.at(-1)?.text).toMatch(/^stopped after \d+ s$/)
    expect(state.terminal.running).toBeNull()
  })

  it('termText keeps indentation but drops escapes, control and bidi characters', () => {
    expect(termText('  a‮b\u0007\u001b]0;title\u0007c  ')).toBe('  abc')
    expect(termText('x'.repeat(500)).length).toBe(400)
  })
})

describe('x.ruv.io registry probe', () => {
  it('asks the network only with federationNetwork on, and keeps the join steps and rooms as capped data', () => {
    expect(registryProbe.isNetwork).toBe(true)
    expect(registryProbe.views).toEqual(['xruv'])

    const out = registryProbe.parse(
      `Result:\n${JSON.stringify({
        relay: 'wss://relay.ruv.io',
        gatewayPubkey: 'a'.repeat(64),
        swarmTag: 'ruflo-swarm',
        registration: { enabled: true, authentication: 'NIP-98', limits: { ipHourly: 3, daily: 100 } },
        join: ['1. generate a key', '2. \u001b[31mPOST\u001b[0m'],
        defaultChannels: [{ channel: 'pub:help', purpose: 'Questions' }, { purpose: 'no name' }],
      })}`,
    )

    expect(out).toEqual({
      relay: 'wss://relay.ruv.io',
      gatewayPubkey: 'a'.repeat(64),
      swarmTag: 'ruflo-swarm',
      registration: { isOpen: true, auth: 'NIP-98', limits: 'ipHourly 3 · daily 100' },
      join: ['1. generate a key', '2. POST'],
      channels: [{ name: 'pub:help', purpose: 'Questions' }],
    })
    expect(registryProbe.parse('not json')).toBeNull()
  })
})
